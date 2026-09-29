'use strict';

const express = require('express');
const { Types } = require('mongoose');
const { limiter, perUser, READS } = require('../../core/middleware/rateLimit');
const events = require('../../core/services/events');
const Board = require('./models/Board');
const cache = require('./cache');
const boardsRouter = require('./routes/boards');

// Board payloads embed member names, so a rename drops every board the user is on,
// in every workspace.
events.on('user.renamed', async (userId) => {
  const boards = await Board.find({ 'members.user': userId }).setOptions({ allWorkspaces: true }).select('_id').lean();
  await Promise.all(boards.map((b) => cache.invalidateBoard(String(b._id))));
});

// Runs inside the workspace the person was removed from (see tenancy.js). Boards
// they owned pass to the successor, and they come off every other board.
events.on('workspace.memberRemoved', async ({ userId, successorId }) => {
  const boards = await Board.find({ 'members.user': userId }).select('members').lean();
  for (const b of boards) {
    const wasOwner = b.members.some((m) => String(m.user) === userId && m.role === 'owner');
    await Board.updateOne({ _id: b._id }, { $pull: { members: { user: userId } } });
    if (wasOwner) {
      const successorIsMember = b.members.some((m) => String(m.user) === successorId);
      await Board.updateOne(
        { _id: b._id },
        successorIsMember
          ? { $set: { 'members.$[s].role': 'owner' } }
          : { $push: { members: { user: successorId, role: 'owner' } } },
        successorIsMember ? { arrayFilters: [{ 's.user': new Types.ObjectId(successorId) }] } : {},
      );
    }
    await cache.invalidateBoard(String(b._id));
  }
});

module.exports = {
  id: 'boards',
  name: 'Boards',
  description: 'Kanban boards with lists, cards, labels and checklists.',
  defaultEnabled: true,

  // Relative to /api/boards. Bulk imports carry many items, so they get a larger body limit.
  bodyLimits: [
    { path: '/:boardId/cards/bulk', limit: '256kb' },
    { path: '/:boardId/cards/:cardId/checklist/bulk', limit: '256kb' },
  ],

  // Mounted at /api/boards, behind requireAuth and the app on/off check.
  createRouter({ limiters }) {
    const own = {
      // Board changes per user. Reads are left to the global limit.
      writes: limiter({
        prefix: 'writes',
        windowMs: 60_000,
        limit: 300,
        keyGenerator: perUser,
        skip: (req) => READS.has(req.method),
        message: 'Too many changes, slow down.',
      }),
      bulk: limiter({
        prefix: 'bulk',
        windowMs: 15 * 60_000,
        limit: 30,
        keyGenerator: perUser,
        message: 'Too many imports. Try again in a few minutes.',
      }),
    };
    const router = express.Router();
    router.use(own.writes);
    router.use(boardsRouter({ ...limiters, ...own }));
    return router;
  },
};
