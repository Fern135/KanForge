'use strict';

const express = require('express');
const { trusted } = require('mongoose');
const User = require('../models/User');
const Workspace = require('../models/Workspace');
const Membership = require('../models/Membership');
const events = require('../services/events');
const workspaces = require('../services/workspaces');
const { requireWorkspaceAdmin, SLUG_RE } = require('../middleware/workspace');
const { planOf } = require('../plans');
const { body, ids, z } = require('../middleware/validate');
const AppError = require('../utils/AppError');

const MAX_MEMBERS_LISTED = 1000;

const name = z.string().trim().min(1, 'Name is required').max(60);
const createSchema = z.strictObject({
  name,
  slug: z.string().trim().toLowerCase().regex(SLUG_RE, 'Use 3 to 40 lowercase letters, numbers and hyphens'),
});
const renameSchema = z.strictObject({ name });
const addMemberSchema = z.strictObject({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  role: z.enum(Membership.ROLES).default('member'),
});
const roleSchema = z.strictObject({ role: z.enum(Membership.ROLES) });
const appSchema = z.strictObject({ enabled: z.boolean() });

const member = (u, m) => ({
  id: String(u._id),
  name: u.name,
  email: u.email,
  role: m.role,
  joinedAt: new Date(m.createdAt).toISOString(),
});

const adminCount = (workspaceId) => Membership.countDocuments({ workspace: workspaceId, role: 'admin' });
const lastAdmin = () => AppError.conflict('A workspace needs at least one admin. Make someone else an admin first.', 'LAST_ADMIN');

// Mounted at /api/workspaces behind requireAuth: the caller's workspaces.
function workspacesRouter({ limiters }) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    res.json({ workspaces: await workspaces.listForUser(req.user.id) });
  });

  router.post('/', limiters.sensitive, body(createSchema), async (req, res) => {
    const workspace = await workspaces.create({ ...req.body, userId: req.user.id });
    res.status(201).json({ workspace });
  });

  return router;
}

// Mounted at /api/workspace behind requireAuth and requireWorkspace: the
// workspace named in the X-Workspace header.
function currentWorkspaceRouter({ limiters, appState }) {
  const router = express.Router();
  const ws = (req) => req.workspace.id;

  router.get('/', (req, res) => {
    const plan = planOf(req.workspace.plan);
    res.json({
      workspace: { ...workspaces.summary({ _id: ws(req), ...req.workspace }, req.workspaceRole) },
      apps: appState.list(req.workspace).map(({ id, name: appName, included, enabled }) => ({ id, name: appName, included, enabled })),
      limits: { maxBoardsPerUser: plan.maxBoardsPerUser },
    });
  });

  router.patch('/', limiters.sensitive, requireWorkspaceAdmin, body(renameSchema), async (req, res) => {
    await Workspace.updateOne({ _id: ws(req) }, { $set: { name: req.body.name } });
    res.json({ workspace: workspaces.summary({ _id: ws(req), ...req.workspace, name: req.body.name }, req.workspaceRole) });
  });

  router.get('/members', async (req, res) => {
    const memberships = await Membership.find({ workspace: ws(req) })
      .sort({ createdAt: 1 })
      .limit(MAX_MEMBERS_LISTED)
      .select('user role createdAt')
      .lean();
    const users = await User.find({ _id: trusted({ $in: memberships.map((m) => m.user) }) }).select('name email').lean();
    const byId = new Map(users.map((u) => [String(u._id), u]));
    res.json({
      members: memberships.filter((m) => byId.has(String(m.user))).map((m) => member(byId.get(String(m.user)), m)),
    });
  });

  // Adds someone who already has an account on this server.
  router.post('/members', limiters.sensitive, requireWorkspaceAdmin, body(addMemberSchema), async (req, res) => {
    const user = await User.findOne({ email: req.body.email }).select('name email').lean();
    if (!user) {
      throw AppError.notFound('No account uses that email. Ask them to sign up first, then add them.', 'USER_NOT_FOUND');
    }
    let m;
    try {
      m = await Membership.create({ workspace: ws(req), user: user._id, role: req.body.role });
    } catch (err) {
      if (err?.code === 11000) throw AppError.conflict('They are already in this workspace', 'ALREADY_MEMBER');
      throw err;
    }
    res.status(201).json({ member: member(user, m) });
  });

  router.patch('/members/:userId', limiters.sensitive, requireWorkspaceAdmin, ids('userId'), body(roleSchema), async (req, res) => {
    const before = await Membership.findOneAndUpdate(
      { workspace: ws(req), user: req.params.userId },
      { $set: { role: req.body.role } },
      { new: false },
    ).lean();
    if (!before) throw AppError.notFound('Member not found');
    // Checking after the write (and undoing it) stays correct when two admins demote each other at once.
    if (req.body.role === 'member' && (await adminCount(ws(req))) === 0) {
      await Membership.updateOne({ _id: before._id }, { $set: { role: 'admin' } });
      throw lastAdmin();
    }
    const user = await User.findById(req.params.userId).select('name email').lean();
    res.json({ member: member(user, { ...before, role: req.body.role }) });
  });

  // Removes a member, or leaves the workspace when it's yourself. Boards they
  // owned pass to the admin removing them (or, when leaving, to another admin).
  // Their private notes and documents stay in the workspace, hidden, and come
  // back if they're added again.
  router.delete('/members/:userId', limiters.sensitive, ids('userId'), async (req, res) => {
    const target = req.params.userId;
    const self = target === req.user.id;
    if (!self && req.workspaceRole !== 'admin') throw AppError.forbidden('Only workspace admins can remove members');
    const m = await Membership.findOne({ workspace: ws(req), user: target }).lean();
    if (!m) throw AppError.notFound('Member not found');

    let successorId = req.user.id;
    if (self) {
      const other = await Membership.findOne({ workspace: ws(req), role: 'admin', user: trusted({ $ne: m.user }) })
        .sort({ createdAt: 1 })
        .lean();
      if (!other) throw lastAdmin();
      successorId = String(other.user);
    }

    await Membership.deleteOne({ _id: m._id });
    if (m.role === 'admin' && (await adminCount(ws(req))) === 0) {
      await Membership.create({ workspace: m.workspace, user: m.user, role: 'admin' });
      throw lastAdmin();
    }
    await events.emit('workspace.memberRemoved', { userId: target, successorId });
    res.status(204).end();
  });

  router.patch('/apps/:appId', limiters.sensitive, requireWorkspaceAdmin, body(appSchema), async (req, res) => {
    const app = appState.find(req.workspace, req.params.appId);
    if (!app) throw AppError.notFound('App not found');
    if (!app.included && req.body.enabled) {
      throw AppError.forbidden(`${app.name} isn't included in this workspace's plan`, 'PLAN_REQUIRED');
    }
    await appState.setEnabled(req.workspace, app.id, req.body.enabled);
    res.json({ apps: appState.list(req.workspace).map(({ id, name: appName, included, enabled }) => ({ id, name: appName, included, enabled })) });
  });

  return router;
}

module.exports = { workspacesRouter, currentWorkspaceRouter };
