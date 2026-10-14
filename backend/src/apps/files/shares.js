'use strict';

const express = require('express');
const { trusted } = require('mongoose');
const User = require('../../core/models/User');
const Membership = require('../../core/models/Membership');
const FileShare = require('./models/FileShare');
const limits = require('./limits');
const links = require('./links');
const { requireRole } = require('./tree');
const { body, ids, objectId, z } = require('../../core/middleware/validate');
const AppError = require('../../core/utils/AppError');

// Sharing, like Google Drive's "Share" dialog. Only an item's owner shares it:
//   with people in the same workspace, who can view it or edit it, and/or
//   with a public link anyone can open to view and download (if a platform
//   admin allows public links on this server).
// Sharing a folder shares everything inside it, including what's added later.

// People one item can be shared with directly. A whole team is usually better
// served by sharing a folder.
const MAX_SHARES_PER_ITEM = 100;

const role = z.enum(['view', 'edit']);
const shareSchema = z.strictObject({ userId: objectId, role });
const roleSchema = z.strictObject({ role });

const person = (u) => ({ id: String(u._id), name: u.name, email: u.email });

// The public link's address, under the app (see the PublicShare page).
const linkUrl = (shareId) => `/app/s/${links.shareToken(shareId)}`;

// The share settings of an item: who has access and its public link, if any.
async function shareInfo(node) {
  const shares = await FileShare.find({ node: node._id }).sort({ createdAt: 1 }).lean();
  const people = shares.filter((s) => s.grantee);
  const users = await User.find({ _id: trusted({ $in: people.map((s) => s.grantee) }) }).select('name email').lean();
  const byId = new Map(users.map((u) => [String(u._id), u]));
  const link = shares.find((s) => !s.grantee);
  return {
    people: people
      .filter((s) => byId.has(String(s.grantee)))
      .map((s) => ({ id: String(s._id), role: s.role, user: person(byId.get(String(s.grantee))) })),
    link: link ? { id: String(link._id), url: linkUrl(link._id) } : null,
  };
}

function sharesRouter() {
  const router = express.Router();

  router.get('/nodes/:nodeId/shares', ids('nodeId'), async (req, res) => {
    const { node } = await requireRole(req, req.params.nodeId, 'owner');
    const settings = await limits.getSettings();
    res.json({ ...(await shareInfo(node)), linkSharing: settings.linkSharing });
  });

  // Gives someone in this workspace access, or changes what they can do if they
  // already have it.
  router.post('/nodes/:nodeId/shares', ids('nodeId'), body(shareSchema), async (req, res) => {
    const { node } = await requireRole(req, req.params.nodeId, 'owner');
    if (node.trashedAt) throw AppError.badRequest('Restore it from the trash first', 'IN_TRASH');
    if (req.body.userId === String(node.owner)) throw AppError.badRequest('That\'s the owner', 'OWNER');
    // Only members of this workspace. Answered the same whether or not the
    // account exists, so this can't be used to find accounts.
    if (!(await Membership.exists({ workspace: req.workspace.id, user: req.body.userId }))) {
      throw AppError.badRequest('They aren\'t a member of this workspace', 'NOT_A_MEMBER');
    }
    const exists = await FileShare.exists({ node: node._id, grantee: req.body.userId });
    if (!exists && (await FileShare.countDocuments({ node: node._id })) >= MAX_SHARES_PER_ITEM) {
      throw AppError.badRequest(`An item can be shared with up to ${MAX_SHARES_PER_ITEM} people`, 'LIMIT');
    }
    await FileShare.updateOne(
      { node: node._id, grantee: req.body.userId },
      { $set: { role: req.body.role }, $setOnInsert: { owner: node.owner, createdBy: req.user.id } },
      { upsert: true },
    );
    res.status(201).json(await shareInfo(node));
  });

  router.patch('/shares/:shareId', ids('shareId'), body(roleSchema), async (req, res) => {
    const share = await FileShare.findOneAndUpdate(
      { _id: req.params.shareId, owner: req.user.id, grantee: trusted({ $ne: null }) },
      { $set: { role: req.body.role } },
      { returnDocument: 'after' },
    ).lean();
    if (!share) throw AppError.notFound('Share not found');
    res.json({ share: { id: String(share._id), role: share.role } });
  });

  // The owner removes someone's access, or someone removes an item from their
  // own "Shared with me".
  router.delete('/shares/:shareId', ids('shareId'), async (req, res) => {
    const r = await FileShare.deleteOne({ _id: req.params.shareId, $or: [{ owner: req.user.id }, { grantee: req.user.id }] });
    if (!r.deletedCount) throw AppError.notFound('Share not found');
    res.status(204).end();
  });

  // Turns on the item's public link (or returns the one it has).
  router.post('/nodes/:nodeId/link', ids('nodeId'), async (req, res) => {
    const { node } = await requireRole(req, req.params.nodeId, 'owner');
    if (node.trashedAt) throw AppError.badRequest('Restore it from the trash first', 'IN_TRASH');
    if (!(await limits.getSettings()).linkSharing) {
      throw AppError.forbidden('Public links are turned off on this server', 'LINKS_DISABLED');
    }
    await FileShare.updateOne(
      { node: node._id, grantee: null },
      { $setOnInsert: { owner: node.owner, role: 'view', createdBy: req.user.id } },
      { upsert: true },
    );
    res.status(201).json(await shareInfo(node));
  });

  // Turns the public link off. Its address stops working at once, and turning it
  // on again makes a new one.
  router.delete('/nodes/:nodeId/link', ids('nodeId'), async (req, res) => {
    const { node } = await requireRole(req, req.params.nodeId, 'owner');
    await FileShare.deleteOne({ node: node._id, grantee: null });
    res.json(await shareInfo(node));
  });

  return router;
}

module.exports = { sharesRouter };
