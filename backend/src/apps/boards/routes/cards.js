'use strict';

const express = require('express');
const { trusted } = require('mongoose');
const List = require('../models/List');
const Card = require('../models/Card');
const Comment = require('../models/Comment');
const cache = require('../cache');
const { positionAt, GAP } = require('../services/position');
const { body, ids, objectId, z } = require('../../../core/middleware/validate');
const AppError = require('../../../core/utils/AppError');
const s = require('../serialize');

const MAX_CARDS_PER_LIST = 500;
const MAX_CHECKLIST = 100;
const MAX_IMPORT_CARDS = 100;

const title = z.string().trim().min(1).max(200);
const index = z.number().int().min(0).max(10_000);
const checklistText = z.string().trim().min(1).max(200);
const checklistItem = z.strictObject({ text: checklistText, done: z.boolean().optional() });
const cardFields = {
  description: z.string().trim().max(5000).optional(),
  labels: z.array(objectId).max(30).optional(),
  dueDate: z.iso.datetime({ offset: true }).nullable().optional(),
  dueComplete: z.boolean().optional(),
  checklistTitle: z.string().trim().min(1).max(100).optional(),
  checklistHideDone: z.boolean().optional(),
};
const createSchema = z.strictObject({ listId: objectId, title });
const updateSchema = z
  .strictObject({ title: title.optional(), ...cardFields })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
const importSchema = z.strictObject({
  listId: objectId,
  cards: z
    .array(z.strictObject({ title, ...cardFields, checklist: z.array(checklistItem).max(MAX_CHECKLIST).optional() }))
    .min(1)
    .max(MAX_IMPORT_CARDS),
});
const moveSchema = z.strictObject({ listId: objectId, index });
const checklistCreateSchema = z.strictObject({ text: checklistText });
const checklistBulkSchema = z.strictObject({ items: z.array(checklistItem).min(1).max(MAX_CHECKLIST) });
const checklistUpdateSchema = z
  .strictObject({ text: z.string().trim().min(1).max(200).optional(), done: z.boolean().optional() })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
const commentSchema = z.strictObject({ text: z.string().trim().min(1).max(2000) });

module.exports = function cardsRouter(limiters) {
  const router = express.Router({ mergeParams: true });

  const assertListInBoard = async (listId, boardId) => {
    const exists = await List.exists({ _id: listId, board: boardId });
    if (!exists) throw AppError.badRequest('List not found on this board', 'BAD_LIST');
  };

  // Loads the card only if it belongs to the already-authorized board.
  async function loadCard(req, _res, next) {
    const card = await Card.findOne({ _id: req.params.cardId, board: req.board._id }).lean();
    if (!card) throw AppError.notFound('Card not found');
    req.card = card;
    next();
  }

  // Returns the de-duplicated label ids, or throws if any isn't one of the board's labels.
  const boardLabels = (board, labels) => {
    const allowed = new Set(board.labels.map((l) => String(l._id)));
    if (!labels.every((l) => allowed.has(l))) throw AppError.badRequest('Unknown label', 'BAD_LABEL');
    return [...new Set(labels)];
  };

  const done = async (req, res, card, status = 200) => {
    await cache.invalidateBoard(req.board._id);
    res.status(status).json({ card: s.card(card) });
  };

  router.post('/', body(createSchema), async (req, res) => {
    const { listId } = req.body;
    await assertListInBoard(listId, req.board._id);
    if ((await Card.countDocuments({ list: listId })) >= MAX_CARDS_PER_LIST) {
      throw AppError.badRequest('Card limit reached for this list', 'LIMIT');
    }
    const position = await positionAt(Card, { list: listId }, Number.MAX_SAFE_INTEGER);
    const card = await Card.create({
      board: req.board._id,
      list: listId,
      title: req.body.title,
      position,
      createdBy: req.user.id,
    });
    await done(req, res, card.toObject(), 201);
  });

  // Creates many cards at the end of a list. All-or-nothing: rejected if the list would exceed its limit.
  router.post('/bulk', limiters.bulk, body(importSchema), async (req, res) => {
    const { listId, cards } = req.body;
    await assertListInBoard(listId, req.board._id);
    if ((await Card.countDocuments({ list: listId })) + cards.length > MAX_CARDS_PER_LIST) {
      throw AppError.badRequest(`A list can hold at most ${MAX_CARDS_PER_LIST} cards`, 'LIMIT');
    }
    const start = await positionAt(Card, { list: listId }, Number.MAX_SAFE_INTEGER);
    const docs = cards.map((c, i) => ({
      ...c,
      labels: boardLabels(req.board, c.labels || []),
      dueDate: c.dueDate ? new Date(c.dueDate) : null,
      checklist: (c.checklist || []).map((item) => ({ text: item.text, done: Boolean(item.done) })),
      board: req.board._id,
      list: listId,
      position: start + i * GAP,
      createdBy: req.user.id,
    }));
    const created = await Card.insertMany(docs, { ordered: true });
    await cache.invalidateBoard(req.board._id);
    res.status(201).json({ cards: created.map((c) => s.card(c.toObject())) });
  });

  router.use('/:cardId', ids('cardId'), loadCard);

  router.get('/:cardId', (req, res) => {
    res.json({ card: s.card(req.card) });
  });

  router.patch('/:cardId', body(updateSchema), async (req, res) => {
    const update = { ...req.body };
    if (update.labels) update.labels = boardLabels(req.board, update.labels);
    if (update.dueDate !== undefined) update.dueDate = update.dueDate ? new Date(update.dueDate) : null;
    const card = await Card.findByIdAndUpdate(req.card._id, { $set: update }, { new: true, runValidators: true }).lean();
    await done(req, res, card);
  });

  router.put('/:cardId/move', body(moveSchema), async (req, res) => {
    const { listId } = req.body;
    if (listId !== String(req.card.list)) {
      await assertListInBoard(listId, req.board._id);
      if ((await Card.countDocuments({ list: listId })) >= MAX_CARDS_PER_LIST) {
        throw AppError.badRequest('Card limit reached for this list', 'LIMIT');
      }
    }
    const position = await positionAt(Card, { list: listId }, req.body.index, req.card._id);
    const card = await Card.findByIdAndUpdate(req.card._id, { $set: { list: listId, position } }, { new: true }).lean();
    await done(req, res, card);
  });

  router.delete('/:cardId', async (req, res) => {
    await Comment.deleteMany({ card: req.card._id, board: req.board._id });
    await Card.deleteOne({ _id: req.card._id });
    await cache.invalidateBoard(req.board._id);
    res.status(204).end();
  });

  // Checklist
  router.post('/:cardId/checklist', body(checklistCreateSchema), async (req, res) => {
    const card = await Card.findOneAndUpdate(
      { _id: req.card._id, [`checklist.${MAX_CHECKLIST - 1}`]: trusted({ $exists: false }) },
      { $push: { checklist: { text: req.body.text } } },
      { new: true, runValidators: true },
    ).lean();
    if (!card) throw AppError.badRequest('Checklist limit reached', 'LIMIT');
    await done(req, res, card, 201);
  });

  // Appends many items at once. All-or-nothing: rejected if the result would exceed the limit.
  router.post('/:cardId/checklist/bulk', limiters.bulk, body(checklistBulkSchema), async (req, res) => {
    const { items } = req.body;
    const card = await Card.findOneAndUpdate(
      { _id: req.card._id, [`checklist.${MAX_CHECKLIST - items.length}`]: trusted({ $exists: false }) },
      { $push: { checklist: { $each: items.map((i) => ({ text: i.text, done: Boolean(i.done) })) } } },
      { new: true, runValidators: true },
    ).lean();
    if (!card) throw AppError.badRequest(`A checklist can hold at most ${MAX_CHECKLIST} items`, 'LIMIT');
    await done(req, res, card, 201);
  });

  router.patch('/:cardId/checklist/:itemId', ids('itemId'), body(checklistUpdateSchema), async (req, res) => {
    const set = {};
    if (req.body.text !== undefined) set['checklist.$.text'] = req.body.text;
    if (req.body.done !== undefined) set['checklist.$.done'] = req.body.done;
    const card = await Card.findOneAndUpdate(
      { _id: req.card._id, 'checklist._id': req.params.itemId },
      { $set: set },
      { new: true, runValidators: true },
    ).lean();
    if (!card) throw AppError.notFound('Checklist item not found');
    await done(req, res, card);
  });

  router.delete('/:cardId/checklist/:itemId', ids('itemId'), async (req, res) => {
    const card = await Card.findOneAndUpdate(
      { _id: req.card._id },
      { $pull: { checklist: { _id: req.params.itemId } } },
      { new: true },
    ).lean();
    await done(req, res, card);
  });

  // Comments
  router.get('/:cardId/comments', async (req, res) => {
    const comments = await Comment.find({ card: req.card._id, board: req.board._id })
      .sort({ createdAt: -1 })
      .limit(100)
      .populate('author', 'name')
      .lean();
    res.json({ comments: comments.map(s.comment) });
  });

  router.post('/:cardId/comments', body(commentSchema), async (req, res) => {
    const comment = await Comment.create({
      board: req.board._id,
      card: req.card._id,
      author: req.user.id,
      text: req.body.text,
    });
    await Card.updateOne({ _id: req.card._id }, { $inc: { commentCount: 1 } });
    await cache.invalidateBoard(req.board._id);
    res.status(201).json({
      comment: s.comment({ ...comment.toObject(), author: { _id: req.user.id, name: req.user.name } }),
    });
  });

  router.delete('/:cardId/comments/:commentId', ids('commentId'), async (req, res) => {
    const comment = await Comment.findOne({ _id: req.params.commentId, card: req.card._id, board: req.board._id }).lean();
    if (!comment) throw AppError.notFound('Comment not found');
    if (String(comment.author) !== req.user.id && req.boardRole !== 'owner') {
      throw AppError.forbidden('You can only delete your own comments');
    }
    await Comment.deleteOne({ _id: comment._id });
    await Card.updateOne({ _id: req.card._id, commentCount: trusted({ $gt: 0 }) }, { $inc: { commentCount: -1 } });
    await cache.invalidateBoard(req.board._id);
    res.status(204).end();
  });

  return router;
};
