'use strict';

const express = require('express');
const { limiter, perUser, READS } = require('../../core/middleware/rateLimit');
const { searchLimiter } = require('../../core/services/search');
const events = require('../../core/services/events');
const FileShare = require('./models/FileShare');
const FileQuota = require('./models/FileQuota');
const { nodesRouter } = require('./routes');
const { uploadsRouter } = require('./uploads');
const { thumbnailsRouter } = require('./thumbnails');
const { sharesRouter } = require('./shares');
const { publicRouter } = require('./public');
const { adminRouter } = require('./admin');
const { discardWhere } = require('./tree');
const sweeper = require('./sweeper');

// Files: a Google Drive-style drive. Folders inside folders with no depth limit,
// uploads of any size (by file picker or drag and drop), sharing with people in
// the workspace or by public link, search, and a trash that empties itself after
// 30 days. File contents live in an S3-compatible object store (Garage by
// default); everything else is in MongoDB.
//
//   routes.js    browsing, folders, rename/move, trash, search, download links
//   uploads.js   uploading in parts
//   thumbnails.js  preview images for the grid view
//   shares.js    sharing with people and public links
//   public.js    links that work without signing in
//   admin.js     the platform admin's storage settings
//   limits.js    how much each person can store
//   tree.js      access checks and folder tree operations
//   sweeper.js   background clean-up
//   storage.js   the object store

const everywhere = { allWorkspaces: true };

// Everything someone owns goes with their account, in every workspace, and so
// does everything shared with or by them.
events.on('user.deleted', async (userId) => {
  await discardWhere({ owner: userId }, everywhere);
  await FileShare.deleteMany({ $or: [{ owner: userId }, { grantee: userId }] }).setOptions(everywhere);
  await FileQuota.deleteOne({ _id: userId });
  sweeper.kick();
});

// Runs inside the workspace they were removed from. Their files stay theirs (like
// notes and documents) and come back if they rejoin, but nothing stays shared
// with them, and what they shared stops being shared.
events.on('workspace.memberRemoved', async ({ userId }) => {
  await FileShare.deleteMany({ $or: [{ owner: userId }, { grantee: userId }] });
});

// Runs inside a workspace that's about to be deleted: its files' contents are
// queued for deletion before its records go.
events.on('workspace.deleting', async () => {
  await discardWhere({});
  sweeper.kick();
});

module.exports = {
  id: 'files',
  name: 'Files',
  description: 'Store, organise and share files, like Google Drive. Drag and drop to upload, folders inside folders, and public links.',
  defaultEnabled: true,

  // Upload parts and preview images are raw bytes rather than JSON (see
  // uploads.js and thumbnails.js). Relative to /api/files.
  streamPaths: [/^\/uploads\/[a-f0-9]{24}\/parts\/\d{1,5}$/, /^\/nodes\/[a-f0-9]{24}\/thumbnail$/],

  // Mounted at /api/files, behind requireAuth and the app on/off check.
  createRouter({ limiters }) {
    const own = {
      // Uploading a folder of small files makes several requests per file, so
      // this is higher than in the other apps.
      writes: limiter({
        prefix: 'files-writes',
        windowMs: 60_000,
        limit: 1200,
        keyGenerator: perUser,
        skip: (req) => READS.has(req.method),
        message: 'Too many changes, slow down.',
      }),
      search: searchLimiter('files-search'),
    };
    const router = express.Router();
    router.use(own.writes);
    router.use('/uploads', uploadsRouter());
    router.use(sharesRouter());
    router.use(thumbnailsRouter());
    router.use(nodesRouter({ ...limiters, ...own }));
    return router;
  },

  // Mounted at /api/public/files, with no sign-in (see public.js).
  createPublicRouter: () => publicRouter(),

  // Mounted at /api/admin/apps/files, for platform admins (see admin.js).
  createAdminRouter: ({ limiters }) => adminRouter({ limiters }),

  // Background clean-up, started and stopped by server.js.
  start: sweeper.start,
  stop: sweeper.stop,
};
