'use strict';

const { trusted } = require('mongoose');
const User = require('../../core/models/User');
const FileShare = require('./models/FileShare');
const links = require('./links');

// How files and folders look to the frontend.

// Dates go out as ISO strings, and missing ones (never trashed, say) as null.
const iso = (d) => (d ? new Date(d).toISOString() : null);

// One file or folder. extras: { names: Map of user id -> name, shared: Set of node ids with shares }
function item(n, { names, shared } = {}) {
  return {
    id: String(n._id),
    kind: n.kind,
    name: n.name,
    parentId: n.parent ? String(n.parent) : null,
    // Only files have a size and type.
    ...(n.kind === 'file' ? {
      size: n.size,
      mime: n.mime || 'application/octet-stream',
      // Whether it has a preview image ('ready'), can't have one ('none') or
      // hasn't been tried yet (null), and where to load it from.
      thumb: n.thumb ?? null,
      thumbUrl: n.thumb === 'ready' ? `/api/public/files/thumb/${links.thumbToken({ w: String(n.workspace), n: String(n._id) })}` : null,
    } : {}),
    ownerId: String(n.owner),
    ...(names ? { ownerName: names.get(String(n.owner)) ?? null } : {}),
    shared: shared ? shared.has(String(n._id)) : undefined,
    createdAt: iso(n.createdAt),
    updatedAt: iso(n.updatedAt),
    trashedAt: iso(n.trashedAt),
  };
}

// Serializes a list, looking up what the list view shows next to each item: whether
// it's shared, and (withOwners) its owner's name, in two queries for the whole list.
async function items(nodes, { withOwners = false } = {}) {
  if (!nodes.length) return [];
  const ids = nodes.map((n) => n._id);
  const sharedIds = await FileShare.distinct('node', { node: trusted({ $in: ids }) });
  const shared = new Set(sharedIds.map(String));
  let names;
  if (withOwners) {
    const owners = [...new Set(nodes.map((n) => String(n.owner)))];
    const users = await User.find({ _id: trusted({ $in: owners }) }).select('name').lean();
    names = new Map(users.map((u) => [String(u._id), u.name]));
  }
  return nodes.map((n) => item(n, { names, shared }));
}

module.exports = { item, items, iso };
