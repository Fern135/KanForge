'use strict';

const express = require('express');
const User = require('../models/User');
const Workspace = require('../models/Workspace');
const Membership = require('../models/Membership');
const { PAID_PLAN_IDS, planOf } = require('../plans');
const { trusted } = require('mongoose');
const cache = require('../services/cache');
const { platformStats } = require('../services/platformStats');
const { body, ids, z } = require('../middleware/validate');
const { confirmPassword, requireRecentAuth } = require('../middleware/recentAuth');
const AppError = require('../utils/AppError');
const { audit } = require('../utils/audit');

// Enough for a self-hosted install. Paging and search come if an instance outgrows it.
const MAX_WORKSPACES_LISTED = 500;

const workspaceSchema = z
  .strictObject({ plan: z.enum(PAID_PLAN_IDS) });
const addAdminSchema = z.strictObject({ email: z.string().trim().toLowerCase().max(254).pipe(z.email()) });
const confirmSchema = z.strictObject({ password: z.string().min(1).max(128) });

// Platform admins are the only accounts listed by name and email. Everyone else
// only shows up in the totals.
const adminUser = (u) => ({
  id: String(u._id),
  name: u.name,
  email: u.email,
  createdAt: new Date(u.createdAt).toISOString(),
});

// Workspace metadata only. Platform admins never see what's inside a workspace.
const adminWorkspace = (ws, seats) => ({
  id: String(ws._id),
  name: ws.name,
  slug: ws.slug,
  plan: ws.plan,
  planName: planOf(ws.plan).name,
  seats,
  createdAt: new Date(ws.createdAt).toISOString(),
});

async function seatCounts(workspaceIds) {
  const rows = await Membership.aggregate([
    { $match: { workspace: { $in: workspaceIds } } },
    { $group: { _id: '$workspace', seats: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.seats]));
}

// Platform admin (User.role "admin"): runs the whole server. Mounted behind
// requireAuth and requireAdmin.
module.exports = function adminRouter({ limiters }) {
  const router = express.Router();

  // Changes below need the password typed again within the last 10 minutes.
  router.post('/confirm', limiters.sensitive, body(confirmSchema), async (req, res) => {
    await confirmPassword(req, req.body.password);
    res.status(204).end();
  });

  // Self-hosted workspaces are private and not listed.
  router.get('/workspaces', async (_req, res) => {
    const list = await Workspace.find({ plan: trusted({ $in: PAID_PLAN_IDS }) }).sort({ createdAt: 1 }).limit(MAX_WORKSPACES_LISTED)
      .select('name slug plan createdAt').lean();
    const seats = await seatCounts(list.map((w) => w._id));
    res.json({ workspaces: list.map((w) => adminWorkspace(w, seats.get(String(w._id)) || 0)) });
  });

  router.patch('/workspaces/:workspaceId', limiters.sensitive, requireRecentAuth, ids('workspaceId'), body(workspaceSchema), async (req, res) => {
    const ws = await Workspace.findOneAndUpdate({ _id: req.params.workspaceId, plan: trusted({ $in: PAID_PLAN_IDS }) }, { $set: req.body }, { new: true })
      .select('name slug plan createdAt').lean();
    if (!ws) throw AppError.notFound('Workspace not found');
    audit(req, 'admin.plan_changed', { target: String(ws._id), plan: ws.plan });
    const seats = await seatCounts([ws._id]);
    res.json({ workspace: adminWorkspace(ws, seats.get(String(ws._id)) || 0) });
  });

  router.get('/stats', async (_req, res) => {
    res.json({ stats: await platformStats() });
  });

  router.get('/admins', async (_req, res) => {
    const admins = await User.find({ role: 'admin' }).sort({ createdAt: 1 }).select('name email createdAt').lean();
    res.json({ admins: admins.map(adminUser) });
  });

  // Makes an existing account a platform admin.
  router.post('/admins', limiters.sensitive, requireRecentAuth, body(addAdminSchema), async (req, res) => {
    const user = await User.findOne({ email: req.body.email }).select('name email role createdAt').lean();
    if (!user) throw AppError.notFound('No account uses that email. They need to sign up first.', 'USER_NOT_FOUND');
    if (user.role === 'admin') throw AppError.conflict('They are already a platform admin', 'ALREADY_ADMIN');
    await User.updateOne({ _id: user._id }, { $set: { role: 'admin' } });
    await cache.invalidateUser(String(user._id));
    audit(req, 'admin.role_changed', { target: String(user._id), from: 'user', to: 'admin' });
    res.status(201).json({ admin: adminUser(user) });
  });

  router.delete('/admins/:userId', limiters.sensitive, requireRecentAuth, ids('userId'), async (req, res) => {
    const user = await User.findOneAndUpdate({ _id: req.params.userId, role: 'admin' }, { $set: { role: 'user' } }).select('_id').lean();
    if (!user) throw AppError.notFound('Admin not found');
    // Never leave the instance without an admin. Checking after the write (and
    // undoing it) stays correct when two admins remove each other at once.
    if ((await User.countDocuments({ role: 'admin' })) === 0) {
      await User.updateOne({ _id: user._id }, { $set: { role: 'admin' } });
      throw AppError.conflict('There must be at least one platform admin', 'LAST_ADMIN');
    }
    await cache.invalidateUser(String(user._id));
    audit(req, 'admin.role_changed', { target: String(user._id), from: 'admin', to: 'user' });
    res.status(204).end();
  });

  return router;
};
