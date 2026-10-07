'use strict';

const express = require('express');
const { pipeline } = require('node:stream/promises');
const { trusted } = require('mongoose');
const Workspace = require('../../core/models/Workspace');
const User = require('../../core/models/User');
const { planIncludesApp } = require('../../core/plans');
const { runInWorkspace } = require('../../core/tenancy');
const { limiter } = require('../../core/middleware/rateLimit');
const { objectId, z } = require('../../core/middleware/validate');
const AppError = require('../../core/utils/AppError');
const FileNode = require('./models/FileNode');
const FileShare = require('./models/FileShare');
const limits = require('./limits');
const links = require('./links');
const storage = require('./storage');
const { sendFile } = require('./download');
const { iso } = require('./serialize');

// Routes that work without signing in, mounted at /api/public/files:
//
//   GET /download/:token                    a signed download link (links.js)
//   GET /thumb/:token                       a file's preview image (thumbnails.js)
//   GET /links/:token[?folder=id]           what a public link shows: the shared
//                                           item, and a folder's contents
//   GET /links/:token/download/:nodeId      a file from a public link
//
// None of them trust anything but the signed token. Everything a public link
// reaches must sit inside the item that was shared.

const MAX_LISTED = 2000;
const linkQuery = z.object({ folder: objectId.optional() });
const downloadQuery = z.object({ inline: z.enum(['0', '1']).optional() });

const gone = () => AppError.notFound('This link doesn\'t work anymore. Ask whoever shared it for a new one.', 'LINK_NOT_FOUND');

// Whether the Files app is still available in the workspace: its plan includes
// it and its admins haven't turned it off. Turning the app off stops its links.
async function filesAvailable(workspaceId) {
  const ws = await Workspace.findById(workspaceId).select('plan apps').lean();
  return Boolean(ws) && planIncludesApp(ws.plan, 'files') && ws.apps?.files !== false;
}

// What a visitor sees of an item: no ids of people, nothing about where it sits
// in its owner's drive above the shared item.
const publicItem = (n) => ({
  id: String(n._id),
  kind: n.kind,
  name: n.name,
  ...(n.kind === 'file' ? { size: n.size, mime: n.mime || 'application/octet-stream' } : {}),
  updatedAt: iso(n.updatedAt),
});

// The shared item behind a public link, checked all the way: the token's
// signature, the share still existing, public links still allowed, and the app
// still on in its workspace. Runs `fn(root, share)` inside that workspace.
async function withLink(token, fn) {
  const shareId = links.parseShareToken(token);
  if (!shareId) throw gone();
  const share = await FileShare.findOne({ _id: shareId, grantee: null }).setOptions({ allWorkspaces: true }).lean();
  if (!share || !(await limits.getSettings()).linkSharing || !(await filesAvailable(share.workspace))) throw gone();
  return runInWorkspace(share.workspace, async () => {
    const root = await FileNode.findOne({ _id: share.node, trashedAt: null, status: trusted({ $ne: 'uploading' }) }).lean();
    if (!root) throw gone();
    return fn(root, share);
  });
}

// An item inside the shared one (or the shared item itself), never outside it.
async function findWithin(root, nodeId, kind) {
  if (String(nodeId) === String(root._id)) {
    if (root.kind !== kind) throw AppError.notFound('Not found');
    return root;
  }
  const node = await FileNode.findOne({ _id: nodeId, path: root._id, kind, trashedAt: null, status: trusted({ $ne: 'uploading' }) }).lean();
  if (!node) throw AppError.notFound('Not found');
  return node;
}

function publicRouter() {
  const router = express.Router();

  // Tokens are unguessable; this only stops someone hammering the server.
  router.use(limiter({
    prefix: 'files-public',
    windowMs: 60_000,
    limit: 300,
    message: 'Too many requests, slow down.',
  }));

  router.get('/download/:token', async (req, res) => {
    const payload = links.parseDownloadToken(req.params.token);
    if (!payload || !(await filesAvailable(payload.w))) throw AppError.notFound('This download link has expired. Open the file again.', 'LINK_EXPIRED');
    await runInWorkspace(payload.w, async () => {
      const node = await FileNode.findOne({ _id: payload.n, kind: 'file', status: 'ready', trashedAt: null }).lean();
      if (!node) throw AppError.notFound('File not found');
      await sendFile(req, res, node, { inline: payload.i === 1 });
    });
  });

  // Preview images are always sent as images, with the type checked when they
  // were stored, and cached for as long as the link stays the same (an hour).
  router.get('/thumb/:token', async (req, res) => {
    const payload = links.parseThumbToken(req.params.token);
    if (!payload || !(await filesAvailable(payload.w))) throw AppError.notFound('Preview not found');
    storage.assertConfigured();
    await runInWorkspace(payload.w, async () => {
      const node = await FileNode.findOne({ _id: payload.n, kind: 'file', status: 'ready', thumb: 'ready' }).lean();
      if (!node) throw AppError.notFound('Preview not found');
      let object;
      try {
        object = await storage.read(storage.thumbKeyFor(node.storageKey));
      } catch (err) {
        if (storage.isGone(err)) throw AppError.notFound('Preview not found');
        throw err;
      }
      res.set({
        'Content-Type': node.thumbMime || 'image/webp',
        ...(object.ContentLength != null ? { 'Content-Length': String(object.ContentLength) } : {}),
        'Cache-Control': 'private, max-age=3600',
      });
      // The browser may give up on an image scrolled out of view: nothing to report.
      await pipeline(object.Body, res).catch(() => res.destroy());
    });
  });

  router.get('/links/:token', async (req, res) => {
    const { folder } = linkQuery.parse(req.query);
    await withLink(req.params.token, async (root) => {
      const owner = await User.findById(root.owner).select('name').lean();
      const out = { item: publicItem(root), ownerName: owner?.name ?? null };
      if (root.kind === 'folder') {
        const current = folder ? await findWithin(root, folder, 'folder') : root;
        // Breadcrumbs from the shared folder down to the one being looked at.
        const from = current.path.findIndex((id) => String(id) === String(root._id));
        const between = from === -1 ? [] : current.path.slice(from + 1);
        const names = new Map((await FileNode.find({ _id: trusted({ $in: between }) }).select('name').lean()).map((n) => [String(n._id), n.name]));
        const nodes = await FileNode.find({ parent: current._id, trashedAt: null, status: trusted({ $ne: 'uploading' }) })
          .sort({ kind: -1, nameKey: 1 }).limit(MAX_LISTED).lean();
        Object.assign(out, {
          folder: publicItem(current),
          breadcrumbs: [root, ...between.map((id) => ({ _id: id, name: names.get(String(id)) ?? '…' })), ...(current === root ? [] : [current])]
            .map((n) => ({ id: String(n._id), name: n.name })),
          items: nodes.map(publicItem),
        });
      }
      res.json(out);
    });
  });

  router.get('/links/:token/download/:nodeId', async (req, res) => {
    if (!objectId.safeParse(req.params.nodeId).success) throw AppError.notFound('Not found');
    const { inline } = downloadQuery.parse(req.query);
    await withLink(req.params.token, async (root) => {
      const node = await findWithin(root, req.params.nodeId, 'file');
      await sendFile(req, res, node, { inline: inline === '1' });
    });
  });

  return router;
}

module.exports = { publicRouter, filesAvailable };
