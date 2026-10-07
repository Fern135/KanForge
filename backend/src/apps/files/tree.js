'use strict';

const { trusted } = require('mongoose');
const FileNode = require('./models/FileNode');
const FileShare = require('./models/FileShare');
const FileGarbage = require('./models/FileGarbage');
const storage = require('./storage');
const { z } = require('../../core/middleware/validate');
const AppError = require('../../core/utils/AppError');

// Folder tree operations shared by the routes: who can do what with an item,
// where it sits, moving whole branches, and deleting safely.

// Files and folders one person can own, across every workspace (trash included).
// Storage limits already bound files by size; this bounds empty folders and tiny files.
const MAX_ITEMS_PER_USER = 100_000;

// A file or folder name: anything printable, like Google Drive (slashes included,
// since nothing here is a real path). Control characters are refused.
// eslint-disable-next-line no-control-regex
const nameSchema = z.string().trim().min(1, 'Give it a name').max(255).regex(/^[^\x00-\x1f\x7f]+$/, 'Names cannot contain control characters');

// Roles from weakest to strongest. The owner can do everything; "edit" can add,
// rename, move and trash; "view" can open and download.
const RANK = { view: 1, edit: 2, owner: 3 };
const atLeast = (role, need) => Boolean(role) && RANK[role] >= RANK[need];

const notFound = () => AppError.notFound('File or folder not found');

// What `userId` can do with `node`: 'owner', 'edit', 'view' or null (nothing).
// Sharing a folder shares everything inside it, so shares on any ancestor count,
// and the strongest one wins. Only the owner ever sees the trash.
async function roleOf(userId, node) {
  if (String(node.owner) === String(userId)) return 'owner';
  if (node.trashedAt) return null;
  const shares = await FileShare.find({ grantee: userId, node: trusted({ $in: [node._id, ...node.path] }) }).select('role').lean();
  let best = null;
  for (const s of shares) if (!best || RANK[s.role] > RANK[best]) best = s.role;
  return best;
}

// Loads a finished file or folder and checks the caller can at least `need` it.
// Someone with no access at all gets 404, the same as for an id that doesn't
// exist, so ids can't be probed. Returns { node, role }.
async function requireRole(req, nodeId, need) {
  const node = await FileNode.findOne({ _id: nodeId, status: trusted({ $ne: 'uploading' }) }).lean();
  if (!node) throw notFound();
  const role = await roleOf(req.user.id, node);
  if (!role) throw notFound();
  if (!atLeast(role, need)) {
    throw AppError.forbidden(need === 'owner' ? 'Only the owner can do that' : 'You can view this but not change it', 'FILES_FORBIDDEN');
  }
  return { node, role };
}

// The folder new items go into, checked for edit access. null: the caller's own
// top level. Returns the folder (or null).
async function targetFolder(req, parentId) {
  if (!parentId) return null;
  const { node } = await requireRole(req, parentId, 'edit');
  if (node.kind !== 'folder' || node.trashedAt) throw notFound();
  return node;
}

// Refuses new items once the owner's drive holds MAX_ITEMS_PER_USER.
async function assertItemRoom(ownerId, adding = 1) {
  const count = await FileNode.countDocuments({ owner: ownerId }).setOptions({ allWorkspaces: true });
  if (count + adding > MAX_ITEMS_PER_USER) {
    throw AppError.badRequest(`A drive can hold up to ${MAX_ITEMS_PER_USER.toLocaleString('en-US')} files and folders`, 'LIMIT');
  }
}

// The folders above `node`, top down, as far up as `userId` can see. The owner
// sees the whole way up; someone it was shared with sees from the highest folder
// they have access to (the rest of the owner's drive stays private).
async function breadcrumbs(node, userId) {
  if (!node.path.length) return [];
  const ancestors = await FileNode.find({ _id: trusted({ $in: node.path }) }).select('name').lean();
  const byId = new Map(ancestors.map((a) => [String(a._id), a]));
  const chain = node.path.map((id) => byId.get(String(id))).filter(Boolean);
  if (String(node.owner) === String(userId)) return chain.map(crumb);
  const shared = new Set((await FileShare.find({ grantee: userId, node: trusted({ $in: node.path }) }).select('node').lean()).map((s) => String(s.node)));
  const from = chain.findIndex((a) => shared.has(String(a._id)));
  return from === -1 ? [] : chain.slice(from).map(crumb);
}

const crumb = (a) => ({ id: String(a._id), name: a.name });

// Where children of `parent` go: the parent's path plus the parent itself.
const childPath = (parent) => (parent ? [...parent.path, parent._id] : []);

// Moves `node` under `parent` (null: the top of the owner's drive), carrying
// everything inside it along: each descendant's path keeps its part below
// `node` and gets the new part above it.
async function moveUnder(node, parent) {
  const newPath = childPath(parent);
  await FileNode.updateOne({ _id: node._id }, { $set: { parent: parent ? parent._id : null, path: newPath } });
  if (node.kind !== 'folder') return;
  await FileNode.updateMany(
    { path: node._id },
    [{ $set: { path: { $concatArrays: [newPath, { $slice: ['$path', node.path.length, { $size: '$path' }] }] } } }],
    { updatePipeline: true },
  );
}

// Deletes nodes for good. Their contents are queued for the sweeper first (see
// FileGarbage), so a crash between the two steps leaves at worst an entry the
// sweeper deletes twice, never contents nothing points to. An unfinished upload
// is queued with its upload id, so its parts are thrown away too.
// `options` passes { allWorkspaces: true } through for work that spans
// workspaces (account deletion, the sweeper); otherwise only the current
// workspace is touched.
async function discard(nodes, options = {}) {
  if (!nodes.length) return;
  const garbage = nodes
    .filter((n) => n.kind === 'file' && n.storageKey)
    .flatMap((n) => [
      n.status === 'uploading' && n.uploadId ? { key: n.storageKey, uploadId: n.uploadId } : { key: n.storageKey },
      // Its preview image goes with it.
      ...(n.thumb === 'ready' ? [{ key: storage.thumbKeyFor(n.storageKey) }] : []),
    ]);
  if (garbage.length) await FileGarbage.insertMany(garbage);
  const ids = nodes.map((n) => n._id);
  await FileShare.deleteMany({ node: trusted({ $in: ids }) }).setOptions(options);
  await FileNode.deleteMany({ _id: trusted({ $in: ids }) }).setOptions(options);
}

// Like discard, for every node matching `filter`, in batches so a huge drive
// never loads into memory at once. Returns how many were deleted.
async function discardWhere(filter, options = {}) {
  let removed = 0;
  for (;;) {
    const batch = await FileNode.find(filter).setOptions(options).limit(500).select('kind storageKey status uploadId thumb').lean();
    if (!batch.length) return removed;
    await discard(batch, options);
    removed += batch.length;
  }
}

module.exports = {
  MAX_ITEMS_PER_USER,
  nameSchema,
  RANK,
  atLeast,
  roleOf,
  requireRole,
  targetFolder,
  assertItemRoom,
  breadcrumbs,
  childPath,
  moveUnder,
  discard,
  discardWhere,
  notFound,
};
