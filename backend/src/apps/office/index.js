'use strict';

const express = require('express');
const { limiter, perUser, READS } = require('../../core/middleware/rateLimit');
const documentsRouter = require('./documents');
const folders = require('./folders');
const { imagesRouter } = require('./images');

module.exports = {
  id: 'office',
  name: 'Office',
  description: 'Documents in a Word-style editor, with spreadsheets and presentations to come. Everything runs in the browser.',
  defaultEnabled: true,

  // Relative to /api/office. Longer paths win, so image uploads get their own limit.
  bodyLimits: [
    { path: '/images', limit: '8mb' },
    { path: '', limit: '3mb' },
  ],

  // Mounted at /api/office, behind requireAuth and the app on/off check.
  createRouter({ limiters }) {
    const own = {
      // Autosave sends a change roughly every second while typing.
      writes: limiter({
        prefix: 'office-writes',
        windowMs: 60_000,
        limit: 300,
        keyGenerator: perUser,
        skip: (req) => READS.has(req.method),
        message: 'Too many changes, slow down.',
      }),
      // Image uploads (a pasted or imported document can bring several at once).
      bulk: limiter({
        prefix: 'office-bulk',
        windowMs: 15 * 60_000,
        limit: 200,
        keyGenerator: perUser,
        message: 'Too many uploads. Try again in a few minutes.',
      }),
    };
    const router = express.Router();
    router.use(own.writes);
    router.use('/documents', documentsRouter());
    router.use('/folders', folders.router());
    router.use('/images', imagesRouter({ ...limiters, ...own }));
    return router;
  },
};
