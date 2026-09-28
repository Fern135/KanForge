'use strict';

const express = require('express');
const { limiter, perUser, READS } = require('../../core/middleware/rateLimit');
const events = require('../../core/services/events');
const Board = require('./models/Board');
const cache = require('./cache');
const boardsRouter = require('./routes/boards');

// Board payloads embed member names, so a rename drops every board the user is on.
events.on('user.renamed', async (userId) => {
  const boards = await Board.find({ 'members.user': userId }).select('_id').lean();
  await Promise.all(boards.map((b) => cache.invalidateBoard(String(b._id))));
});

module.exports = {
  id: 'boards',
  name: 'Boards',
  description: 'Kanban boards with lists, cards, labels and checklists.',
  defaultEnabled: true,

  // Relative to /api/boards. Bulk imports carry many items, so they get a larger body limit.
  largeBodyPaths: ['/:boardId/cards/bulk', '/:boardId/cards/:cardId/checklist/bulk'],

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
