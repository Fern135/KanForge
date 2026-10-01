'use strict';

const express = require('express');
const { limiter, perUser, READS } = require('../../core/middleware/rateLimit');
const { searchLimiter } = require('../../core/services/search');
const events = require('../../core/services/events');
const Note = require('./models/Note');
const NoteFolder = require('./models/NoteFolder');
const notesRouter = require('./routes');

// Notes and folders are private to their owner, so they go with the account.
events.on('user.deleted', async (userId) => {
  const all = { allWorkspaces: true };
  await Promise.all([Note.deleteMany({ owner: userId }).setOptions(all), NoteFolder.deleteMany({ owner: userId }).setOptions(all)]);
});

module.exports = {
  id: 'notes',
  name: 'Notes',
  description: 'Rich-text notes with checklists, tags, search, archive and trash.',
  defaultEnabled: true,

  // Relative to /api/notes. A note's content can be larger than the default 32 KB body.
  bodyLimits: [{ path: '', limit: '256kb' }],

  // Mounted at /api/notes, behind requireAuth and the app on/off check.
  createRouter({ limiters }) {
    const own = {
      // Autosave sends a change roughly every second while typing.
      writes: limiter({
        prefix: 'notes-writes',
        windowMs: 60_000,
        limit: 300,
        keyGenerator: perUser,
        skip: (req) => READS.has(req.method),
        message: 'Too many changes, slow down.',
      }),
      bulk: limiter({
        prefix: 'notes-bulk',
        windowMs: 15 * 60_000,
        limit: 30,
        keyGenerator: perUser,
        message: 'Too many imports or exports. Try again in a few minutes.',
      }),
      search: searchLimiter('notes-search'),
    };
    const router = express.Router();
    router.use(own.writes);
    router.use(notesRouter({ ...limiters, ...own }));
    return router;
  },
};
