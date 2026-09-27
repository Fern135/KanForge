'use strict';

const express = require('express');
const { trusted } = require('mongoose');
const Board = require('../models/Board');
const List = require('../models/List');
const Card = require('../models/Card');
const Comment = require('../models/Comment');
const User = require('../models/User');
const cache = require('../services/cache');
const { requireBoardMember, requireBoardOwner } = require('../middleware/boardAccess');
const { body, ids, z } = require('../middleware/validate');
const AppError = require('../utils/AppError');
const s = require('../utils/serialize');
const listsRouter = require('./lists');
const cardsRouter = require('./cards');

const MAX_BOARDS_PER_USER = 100;
const { LABEL_COLORS, BOARD_BACKGROUNDS } = Board;
const DEFAULT_LABELS = ['green', 'yellow', 'orange', 'red', 'purple', 'blue'].map((color) => ({ name: '', color }));

const title = z.string().trim().min(1).max(100);
const createSchema = z.strictObject({ title, background: z.enum(BOARD_BACKGROUNDS).optional() });
const updateSchema = z
  .strictObject({ title: title.optional(), background: z.enum(BOARD_BACKGROUNDS).optional() })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
const memberSchema = z.strictObject({ email: z.string().trim().toLowerCase().max(254).pipe(z.email()) });
const labelSchema = z.strictObject({ name: z.string().trim().max(40).default(''), color: z.enum(LABEL_COLORS) });
const labelUpdateSchema = z
  .strictObject({ name: z.string().trim().max(40).optional(), color: z.enum(LABEL_COLORS).optional() })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

async function buildBoardPayload(board) {
  const [lists, cards, users] = await Promise.all([
    List.find({ board: board._id }).sort({ position: 1 }).lean(),
    Card.find({ board: board._id }).sort({ position: 1 }).lean(),
    User.find({ _id: trusted({ $in: board.members.map((m) => m.user) }) }).select('name email').lean(),
  ]);
  const byId = new Map(users.map((u) => [String(u._id), u]));
  return {
    id: String(board._id),
    title: board.title,
    background: board.background,
    labels: board.labels.map(s.label),
    members: board.members
      .filter((m) => byId.has(String(m.user)))
      .map((m) => {
        const u = byId.get(String(m.user));
        return { id: String(u._id), name: u.name, email: u.email, role: m.role };
      }),
    lists: lists.map(s.list),
    cards: cards.map(s.card),
  };
}

module.exports = function boardsRouter(limiters) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    const boards = await Board.find({ 'members.user': req.user.id })
      .select('title background members updatedAt')
      .sort({ updatedAt: -1 })
      .limit(MAX_BOARDS_PER_USER)
      .lean();
    res.json({ boards: boards.map((b) => s.boardSummary(b, req.user.id)) });
  });

  router.post('/', body(createSchema), async (req, res) => {
    const count = await Board.countDocuments({ 'members.user': req.user.id });
    if (count >= MAX_BOARDS_PER_USER) throw AppError.badRequest('Board limit reached', 'LIMIT');
    const board = await Board.create({
      title: req.body.title,
      background: req.body.background || 'navy',
      members: [{ user: req.user.id, role: 'owner' }],
      labels: DEFAULT_LABELS,
    });
    res.status(201).json({ board: s.boardSummary(board.toObject(), req.user.id) });
  });

  // Everything below is scoped to a board the caller is a member of.
  router.use('/:boardId', ids('boardId'), requireBoardMember);

  router.get('/:boardId', async (req, res) => {
    let payload = await cache.getBoard(req.params.boardId);
    if (!payload) {
      payload = await buildBoardPayload(req.board);
      await cache.setBoard(req.params.boardId, payload);
    }
    res.set('Cache-Control', 'no-store');
    res.json({ board: { ...payload, role: req.boardRole } });
  });

  router.patch('/:boardId', body(updateSchema), async (req, res) => {
    const board = await Board.findByIdAndUpdate(req.board._id, { $set: req.body }, { new: true, runValidators: true }).lean();
    await cache.invalidateBoard(board._id);
    res.json({ board: s.boardSummary(board, req.user.id) });
  });

  router.delete('/:boardId', requireBoardOwner, async (req, res) => {
    const boardId = req.board._id;
    await Promise.all([
      Comment.deleteMany({ board: boardId }),
      Card.deleteMany({ board: boardId }),
      List.deleteMany({ board: boardId }),
    ]);
    await Board.deleteOne({ _id: boardId });
    await cache.invalidateBoard(boardId);
    res.status(204).end();
  });

  // Members
  router.post('/:boardId/members', limiters.sensitive, requireBoardOwner, body(memberSchema), async (req, res) => {
    const user = await User.findOne({ email: req.body.email }).select('name email').lean();
    if (!user) throw AppError.notFound('No account exists with that email', 'USER_NOT_FOUND');
    if (req.board.members.some((m) => String(m.user) === String(user._id))) {
      throw AppError.conflict('That user is already a member', 'ALREADY_MEMBER');
    }
    const updated = await Board.updateOne(
      { _id: req.board._id, 'members.user': trusted({ $ne: user._id }), 'members.99': trusted({ $exists: false }) },
      { $push: { members: { user: user._id, role: 'member' } } },
    );
    if (!updated.modifiedCount) throw AppError.conflict('Could not add member', 'MEMBER_ADD_FAILED');
    await cache.invalidateBoard(req.board._id);
    res.status(201).json({ member: { id: String(user._id), name: user.name, email: user.email, role: 'member' } });
  });

  router.delete('/:boardId/members/:userId', ids('userId'), async (req, res) => {
    const target = req.params.userId;
    const isSelf = target === req.user.id;
    if (!isSelf && req.boardRole !== 'owner') throw AppError.forbidden('Only the board owner can remove members');
    const member = req.board.members.find((m) => String(m.user) === target);
    if (!member) throw AppError.notFound('Member not found');
    if (member.role === 'owner') throw AppError.badRequest('The owner cannot be removed from the board', 'OWNER');
    await Board.updateOne({ _id: req.board._id }, { $pull: { members: { user: member.user } } });
    await cache.invalidateBoard(req.board._id);
    res.status(204).end();
  });

  // Labels
  router.post('/:boardId/labels', body(labelSchema), async (req, res) => {
    const board = await Board.findOneAndUpdate(
      { _id: req.board._id, 'labels.29': trusted({ $exists: false }) },
      { $push: { labels: req.body } },
      { new: true, runValidators: true },
    ).lean();
    if (!board) throw AppError.badRequest('Label limit reached', 'LIMIT');
    await cache.invalidateBoard(req.board._id);
    res.status(201).json({ label: s.label(board.labels[board.labels.length - 1]) });
  });

  router.patch('/:boardId/labels/:labelId', ids('labelId'), body(labelUpdateSchema), async (req, res) => {
    const set = {};
    if (req.body.name !== undefined) set['labels.$.name'] = req.body.name;
    if (req.body.color !== undefined) set['labels.$.color'] = req.body.color;
    const board = await Board.findOneAndUpdate(
      { _id: req.board._id, 'labels._id': req.params.labelId },
      { $set: set },
      { new: true, runValidators: true },
    ).lean();
    if (!board) throw AppError.notFound('Label not found');
    await cache.invalidateBoard(req.board._id);
    res.json({ label: s.label(board.labels.find((l) => String(l._id) === req.params.labelId)) });
  });

  router.delete('/:boardId/labels/:labelId', ids('labelId'), async (req, res) => {
    const result = await Board.updateOne({ _id: req.board._id }, { $pull: { labels: { _id: req.params.labelId } } });
    if (!result.modifiedCount) throw AppError.notFound('Label not found');
    await Card.updateMany({ board: req.board._id }, { $pull: { labels: req.params.labelId } });
    await cache.invalidateBoard(req.board._id);
    res.status(204).end();
  });

  router.use('/:boardId/lists', listsRouter());
  router.use('/:boardId/cards', cardsRouter(limiters));

  return router;
};
