'use strict';

const express = require('express');
const { trusted } = require('mongoose');
const FileNode = require('./models/FileNode');
const FileShare = require('./models/FileShare');
const storage = require('./storage');
const limits = require('./limits');
const links = require('./links');
const sweeper = require('./sweeper');
const { items, item } = require('./serialize');
const {
  requireRole, breadcrumbs, childPath, moveUnder, discardWhere, notFound, assertItemRoom, targetFolder, nameSchema: name,
} = require('./tree');
const { body, ids, objectId, z } = require('../../core/middleware/validate');
const { runSearch } = require('../../core/services/search');
const AppError = require('../../core/utils/AppError');

// Everything about browsing and organising a drive. Uploads are in uploads.js,
// sharing in shares.js, and links that work without signing in in public.js.

// One folder shows at most this many items. Plenty for real use, and it keeps
// a single response bounded.
const MAX_LISTED = 2000;
const MAX_RECENT = 50;
const MAX_SEARCH_RESULTS = 200;
const createFolderSchema = z.strictObject({ name, parentId: objectId.nullable().default(null) });
const updateSchema = z
  .strictObject({ name: name.optional(), parentId: objectId.nullable().optional() })
  .refine((v) => v.name !== undefined || v.parentId !== undefined, 'Nothing to change');
const downloadSchema = z.strictObject({ inline: z.boolean().default(false) });
const browseQuery = z.object({ folder: objectId.optional() });
const searchQuery = z.object({ q: z.string().trim().min(1).max(100) });

// Finished items only: an upload in progress isn't shown anywhere until it completes.
const visible = (extra = {}) => ({ trashedAt: null, status: trusted({ $ne: 'uploading' }), ...extra });
// Folders first, then by name.
const ORDER = { kind: -1, nameKey: 1 };

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function nodesRouter(limiters) {
  const router = express.Router();

  // The caller's storage in this workspace: how much they use, their limits, and
  // whether storage is set up at all (the page explains when it isn't).
  router.get('/storage', async (req, res) => {
    const [lim, settings] = await Promise.all([limits.limitsFor(req.user.id, req.workspace), limits.getSettings()]);
    const usage = await limits.usedBytes(req.user.id, lim.perWorkspace);
    res.json({
      storage: {
        configured: storage.configured(),
        usedBytes: usage.total,
        trashBytes: usage.trash,
        quotaBytes: lim.quotaBytes,
        maxFileBytes: lim.maxFileBytes,
        // Whether usage counts this workspace only, or every workspace on the server.
        perWorkspace: lim.perWorkspace,
        linkSharing: settings.linkSharing,
      },
    });
  });

  // A folder's contents. Without ?folder, the top of the caller's own drive.
  router.get('/browse', async (req, res) => {
    const { folder } = browseQuery.parse(req.query);
    if (!folder) {
      const nodes = await FileNode.find(visible({ owner: req.user.id, parent: null })).sort(ORDER).limit(MAX_LISTED + 1).lean();
      return res.json({ folder: null, role: 'owner', breadcrumbs: [], items: await items(nodes.slice(0, MAX_LISTED)), truncated: nodes.length > MAX_LISTED });
    }
    const { node, role } = await requireRole(req, folder, 'view');
    if (node.kind !== 'folder' || node.trashedAt) throw notFound();
    const nodes = await FileNode.find(visible({ parent: node._id })).sort(ORDER).limit(MAX_LISTED + 1).lean();
    const withOwners = role !== 'owner';
    return res.json({
      folder: (await items([node], { withOwners }))[0],
      role,
      breadcrumbs: await breadcrumbs(node, req.user.id),
      items: await items(nodes.slice(0, MAX_LISTED), { withOwners }),
      truncated: nodes.length > MAX_LISTED,
    });
  });

  // The caller's most recently changed files.
  router.get('/recent', async (req, res) => {
    const nodes = await FileNode.find(visible({ owner: req.user.id, kind: 'file' })).sort({ updatedAt: -1 }).limit(MAX_RECENT).lean();
    res.json({ items: await items(nodes) });
  });

  // Everything other people shared with the caller directly (the top of each
  // share; what's inside a shared folder is reached by opening it).
  router.get('/shared', async (req, res) => {
    const shares = await FileShare.find({ grantee: req.user.id }).sort({ createdAt: -1 }).limit(MAX_LISTED).select('node role').lean();
    const nodes = await FileNode.find(visible({ _id: trusted({ $in: shares.map((s) => s.node) }) })).lean();
    const roles = new Map(shares.map((s) => [String(s.node), s.role]));
    const order = new Map(shares.map((s, i) => [String(s.node), i]));
    nodes.sort((a, b) => order.get(String(a._id)) - order.get(String(b._id)));
    const list = await items(nodes, { withOwners: true });
    res.json({ items: list.map((it) => ({ ...it, role: roles.get(it.id) })) });
  });

  // What the caller put in the trash: only the items that were trashed
  // themselves, not everything inside a trashed folder.
  router.get('/trash', async (req, res) => {
    const nodes = await FileNode.find({ owner: req.user.id, trashedAt: trusted({ $ne: null }), $expr: trusted({ $eq: ['$trashRoot', '$_id'] }) })
      .sort({ trashedAt: -1 }).limit(MAX_LISTED).lean();
    res.json({ items: await items(nodes) });
  });

  // Finds items by name in the caller's drive and in everything shared with them.
  router.get('/search', limiters.search, async (req, res) => {
    const { q } = searchQuery.parse(req.query);
    const roots = (await FileShare.find({ grantee: req.user.id }).select('node').lean()).map((s) => s.node);
    const filter = visible({ nameKey: new RegExp(escapeRegex(q.toLowerCase())) });
    filter.$or = [{ owner: req.user.id }];
    if (roots.length) filter.$or.push({ _id: trusted({ $in: roots }) }, { path: trusted({ $in: roots }) });
    const nodes = await runSearch(FileNode.find(filter).sort(ORDER).limit(MAX_SEARCH_RESULTS).lean(), true);
    res.json({ items: await items(nodes, { withOwners: true }) });
  });

  // One item, with where it is and what the caller can do with it.
  router.get('/nodes/:nodeId', ids('nodeId'), async (req, res) => {
    const { node, role } = await requireRole(req, req.params.nodeId, 'view');
    res.json({ item: (await items([node], { withOwners: role !== 'owner' }))[0], role, breadcrumbs: await breadcrumbs(node, req.user.id) });
  });

  // A new folder, in the caller's drive or in a folder shared with them for editing
  // (it then belongs to that folder's owner, like everything else in their tree).
  router.post('/folders', body(createFolderSchema), async (req, res) => {
    const parent = await targetFolder(req, req.body.parentId);
    const owner = parent ? parent.owner : req.user.id;
    await assertItemRoom(owner);
    const folder = await FileNode.create({
      owner,
      kind: 'folder',
      name: req.body.name,
      nameKey: req.body.name.toLowerCase(),
      parent: parent ? parent._id : null,
      path: childPath(parent),
    });
    res.status(201).json({ item: item(folder.toObject()) });
  });

  // Renames and/or moves an item. Moving keeps it in the same owner's drive:
  // items never change hands by being moved.
  router.patch('/nodes/:nodeId', ids('nodeId'), body(updateSchema), async (req, res) => {
    const { node, role } = await requireRole(req, req.params.nodeId, 'edit');
    if (node.trashedAt) throw AppError.badRequest('Restore it from the trash first', 'IN_TRASH');

    if (req.body.parentId !== undefined && String(req.body.parentId) !== String(node.parent)) {
      let dest = null;
      if (req.body.parentId === null) {
        // The top level is the owner's own: someone it was shared with can't put things there.
        if (role !== 'owner') throw AppError.forbidden('Only the owner can move this to the top of their drive', 'FILES_FORBIDDEN');
      } else {
        dest = await targetFolder(req, req.body.parentId);
        if (String(dest.owner) !== String(node.owner)) {
          throw AppError.badRequest('Items can only be moved within the same person\'s drive', 'OTHER_DRIVE');
        }
        if (String(dest._id) === String(node._id) || dest.path.some((id) => String(id) === String(node._id))) {
          throw AppError.badRequest('A folder can\'t go inside itself', 'CYCLE');
        }
      }
      await moveUnder(node, dest);
    }
    if (req.body.name !== undefined) {
      await FileNode.updateOne({ _id: node._id }, { $set: { name: req.body.name, nameKey: req.body.name.toLowerCase() } });
    }
    const updated = await FileNode.findById(node._id).lean();
    res.json({ item: (await items([updated], { withOwners: role !== 'owner' }))[0] });
  });

  // Moves an item, and everything inside it, to its owner's trash. Anyone who can
  // edit it can do this; only the owner can restore it or delete it for good.
  router.post('/nodes/:nodeId/trash', ids('nodeId'), async (req, res) => {
    const { node } = await requireRole(req, req.params.nodeId, 'edit');
    if (node.trashedAt) throw AppError.badRequest('It\'s already in the trash', 'IN_TRASH');
    const at = new Date();
    // Items inside that were trashed earlier keep their own trash entry.
    await FileNode.updateMany(
      { $or: [{ _id: node._id }, { path: node._id }], trashedAt: null },
      { $set: { trashedAt: at, trashRoot: node._id } },
    );
    res.status(204).end();
  });

  // Brings an item back from the trash, with everything that went with it. If its
  // folder is gone or itself in the trash, it comes back at the top of the drive.
  router.post('/nodes/:nodeId/restore', ids('nodeId'), async (req, res) => {
    const { node } = await requireRole(req, req.params.nodeId, 'owner');
    if (!node.trashedAt || String(node.trashRoot) !== String(node._id)) throw AppError.badRequest('It isn\'t in the trash', 'NOT_IN_TRASH');
    if (node.parent && !(await FileNode.exists({ _id: node.parent, trashedAt: null }))) await moveUnder(node, null);
    await FileNode.updateMany({ trashRoot: node._id }, { $set: { trashedAt: null, trashRoot: null } });
    const restored = await FileNode.findById(node._id).lean();
    res.json({ item: (await items([restored]))[0] });
  });

  // Deletes a trashed item for good, with everything that went to the trash with it.
  router.delete('/nodes/:nodeId', ids('nodeId'), async (req, res) => {
    const { node } = await requireRole(req, req.params.nodeId, 'owner');
    if (!node.trashedAt || String(node.trashRoot) !== String(node._id)) {
      throw AppError.badRequest('Move it to the trash first', 'NOT_IN_TRASH');
    }
    await discardWhere({ owner: req.user.id, trashRoot: node._id });
    sweeper.kick();
    res.status(204).end();
  });

  // Deletes everything in the caller's trash for good.
  router.delete('/trash', async (req, res) => {
    const deleted = await discardWhere({ owner: req.user.id, trashedAt: trusted({ $ne: null }) });
    sweeper.kick();
    res.json({ deleted });
  });

  // A short-lived URL to download (or, with inline, view) a file. The browser
  // fetches it directly, which a plain link, <img> or <video> can do without the
  // Authorization header (see links.js).
  router.post('/nodes/:nodeId/download', ids('nodeId'), body(downloadSchema), async (req, res) => {
    storage.assertConfigured();
    const { node } = await requireRole(req, req.params.nodeId, 'view');
    if (node.kind !== 'file' || node.trashedAt) throw AppError.badRequest('Only files can be downloaded', 'NOT_A_FILE');
    const token = links.downloadToken({ w: req.workspace.id, n: String(node._id), i: req.body.inline ? 1 : 0 });
    res.json({ url: `/api/public/files/download/${token}`, expiresInSeconds: links.DOWNLOAD_TTL_SECONDS });
  });

  return router;
}

module.exports = { nodesRouter };
