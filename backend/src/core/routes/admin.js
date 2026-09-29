'use strict';

const express = require('express');
const User = require('../models/User');
const Workspace = require('../models/Workspace');
const Membership = require('../models/Membership');
const { PLAN_IDS, planOf } = require('../plans');
const cache = require('../services/cache');
const { body, ids, z } = require('../middleware/validate');
const AppError = require('../utils/AppError');

// Enough for a self-hosted install. Paging and search come if an instance outgrows it.
const MAX_USERS_LISTED = 500;
const MAX_WORKSPACES_LISTED = 500;

const workspaceSchema = z
  .strictObject({ plan: z.enum(PLAN_IDS).optional(), autoJoin: z.boolean().optional() })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
const roleSchema = z.strictObject({ role: z.enum(['user', 'admin']) });

const adminUser = (u) => ({
  id: String(u._id),
  name: u.name,
  email: u.email,
  role: u.role || 'user',
  createdAt: new Date(u.createdAt).toISOString(),
});

// Workspace metadata only. Platform admins never see what's inside a workspace.
const adminWorkspace = (ws, seats) => ({
  id: String(ws._id),
  name: ws.name,
  slug: ws.slug,
  plan: ws.plan,
  planName: planOf(ws.plan).name,
  autoJoin: Boolean(ws.autoJoin),
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

  router.get('/workspaces', async (_req, res) => {
    const list = await Workspace.find().sort({ createdAt: 1 }).limit(MAX_WORKSPACES_LISTED)
      .select('name slug plan autoJoin createdAt').lean();
    const seats = await seatCounts(list.map((w) => w._id));
    res.json({ workspaces: list.map((w) => adminWorkspace(w, seats.get(String(w._id)) || 0)) });
  });

  router.patch('/workspaces/:workspaceId', limiters.sensitive, ids('workspaceId'), body(workspaceSchema), async (req, res) => {
    const ws = await Workspace.findByIdAndUpdate(req.params.workspaceId, { $set: req.body }, { new: true })
      .select('name slug plan autoJoin createdAt').lean();
    if (!ws) throw AppError.notFound('Workspace not found');
    const seats = await seatCounts([ws._id]);
    res.json({ workspace: adminWorkspace(ws, seats.get(String(ws._id)) || 0) });
  });

  router.get('/users', async (_req, res) => {
    const users = await User.find().sort({ createdAt: 1 }).limit(MAX_USERS_LISTED).select('name email role createdAt').lean();
    res.json({ users: users.map(adminUser) });
  });

  router.patch('/users/:userId', limiters.sensitive, ids('userId'), body(roleSchema), async (req, res) => {
    const user = await User.findByIdAndUpdate(req.params.userId, { $set: { role: req.body.role } }, { new: false })
      .select('name email role createdAt')
      .lean();
    if (!user) throw AppError.notFound('User not found');

    // Never leave the instance without an admin. Checking after the write (and
    // undoing it) stays correct when two admins demote each other at once.
    if (req.body.role === 'user' && (await User.countDocuments({ role: 'admin' })) === 0) {
      await User.updateOne({ _id: user._id }, { $set: { role: 'admin' } });
      throw AppError.conflict('There must be at least one admin', 'LAST_ADMIN');
    }
    await cache.invalidateUser(String(user._id));
    res.json({ user: adminUser({ ...user, role: req.body.role }) });
  });

  return router;
};
