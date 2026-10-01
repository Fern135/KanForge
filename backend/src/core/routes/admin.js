'use strict';

const express = require('express');
const config = require('../config');
const User = require('../models/User');
const Workspace = require('../models/Workspace');
const Membership = require('../models/Membership');
const Invite = require('../models/Invite');
const { PAID_PLAN_IDS, planOf } = require('../plans');
const { ACCESS_LEVELS, restrictionsOf } = require('../access');
const { trusted, Types } = require('mongoose');
const cache = require('../services/cache');
const tokens = require('../services/tokens');
const { temporaryPassword, hashPassword } = require('../services/passwords');
const { deleteAccount } = require('../services/accounts');
const { platformStats } = require('../services/platformStats');
const { body, ids, objectId, z } = require('../middleware/validate');
const { confirmPassword, requireRecentAuth } = require('../middleware/recentAuth');
const AppError = require('../utils/AppError');
const { audit } = require('../utils/audit');

// Enough for a self-hosted install. Paging and search come if an instance outgrows it.
const MAX_WORKSPACES_LISTED = 500;
const MAX_PEOPLE_LISTED = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const workspaceSchema = z
  .strictObject({ plan: z.enum(PAID_PLAN_IDS) });
const addAdminSchema = z.strictObject({ email: z.string().trim().toLowerCase().max(254).pipe(z.email()) });
const confirmSchema = z.strictObject({ password: z.string().min(1).max(128) });
const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());
const nameSchema = z.string().trim().min(1).max(60).regex(/^[^<>]*$/, 'Name contains invalid characters');

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

// Everyone on a self-hosted install, for the People page.
const person = (u, workspaceNames = []) => ({
  id: String(u._id),
  name: u.name,
  email: u.email,
  role: u.role || 'user',
  access: u.access || {},
  mustChangePassword: Boolean(u.mustChangePassword),
  disabled: Boolean(u.disabled),
  deletionRequestedAt: u.deletionRequestedAt ? new Date(u.deletionRequestedAt).toISOString() : null,
  workspaces: workspaceNames,
  createdAt: new Date(u.createdAt).toISOString(),
  lastActiveAt: u.lastActiveAt ? new Date(u.lastActiveAt).toISOString() : null,
});

// People is for self-hosted installs, where the platform admin runs the server
// for their own people. The hosted service keeps who is in each workspace private.
function selfHostedOnly(_req, _res, next) {
  if (!config.selfHosted) throw AppError.notFound('Not found');
  next();
}

// Platform admin (User.role "admin"): runs the whole server. Mounted behind
// requireAuth and requireAdmin. apps: [{ id, name }] of every installed app.
module.exports = function adminRouter({ limiters, apps }) {
  const router = express.Router();
  const appIds = apps.map((a) => a.id);
  const accessSchema = z.partialRecord(z.enum(appIds), z.enum(ACCESS_LEVELS));
  const workspaceRoleSchema = z.enum(Membership.ROLES).default('member');
  const addPersonSchema = z.strictObject({
    name: nameSchema,
    email: emailSchema,
    workspaceId: objectId,
    role: workspaceRoleSchema,
    access: accessSchema.default({}),
  });
  const invitePersonSchema = z.strictObject({
    workspaceId: objectId,
    role: workspaceRoleSchema,
    access: accessSchema.default({}),
    expiresInDays: z.number().int().min(1).max(30).default(7),
    maxUses: z.number().int().min(1).max(1000).nullable().default(1),
  });
  const updatePersonSchema = z
    .strictObject({ access: accessSchema.optional(), disabled: z.boolean().optional() })
    .refine((b) => b.access || b.disabled !== undefined, 'Nothing to change');

  async function findWorkspace(id) {
    const ws = await Workspace.findById(id).select('name slug').lean();
    if (!ws) throw AppError.notFound('Workspace not found', 'WORKSPACE_NOT_FOUND');
    return ws;
  }

  // Someone else's account, not a platform admin (they always have full access,
  // and can't be disabled or deleted until they stop being one).
  async function findPerson(req) {
    const user = await User.findById(req.params.userId);
    if (!user) throw AppError.notFound('Person not found');
    if (user.role === 'admin') {
      throw AppError.badRequest('Platform admins always have full access. Remove them as platform admin first.', 'ADMIN_FULL_ACCESS');
    }
    return user;
  }

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
    const ws = await Workspace.findOneAndUpdate({ _id: req.params.workspaceId, plan: trusted({ $in: PAID_PLAN_IDS }) }, { $set: req.body }, { returnDocument: 'after' })
      .select('name slug plan createdAt').lean();
    if (!ws) throw AppError.notFound('Workspace not found');
    audit(req, 'admin.plan_changed', { target: String(ws._id), plan: ws.plan });
    const seats = await seatCounts([ws._id]);
    res.json({ workspace: adminWorkspace(ws, seats.get(String(ws._id)) || 0) });
  });

  router.get('/stats', async (_req, res) => {
    res.json({ stats: await platformStats(), selfHosted: config.selfHosted });
  });

  // People who asked for their account to be deleted, oldest request first. On
  // the hosted service too: the only place it lists people other than admins,
  // because acting on the request needs to know whose it is.
  router.get('/deletion-requests', async (_req, res) => {
    const users = await User.find({ deletionRequestedAt: trusted({ $exists: true }) }).sort({ deletionRequestedAt: 1 })
      .limit(MAX_PEOPLE_LISTED).select('name email deletionRequestedAt').lean();
    const memberships = await Membership.find({ user: trusted({ $in: users.map((u) => u._id) }) }).select('user workspace').lean();
    const counts = await Membership.aggregate([
      { $match: { workspace: { $in: [...new Set(memberships.map((m) => String(m.workspace)))].map((id) => new Types.ObjectId(id)) } } },
      { $group: { _id: '$workspace', n: { $sum: 1 } } },
    ]);
    const size = new Map(counts.map((c) => [String(c._id), c.n]));
    const soloOf = (id) => memberships.filter((m) => String(m.user) === id && size.get(String(m.workspace)) === 1).map((m) => String(m.workspace));
    const soloIds = [...new Set(users.flatMap((u) => soloOf(String(u._id))))];
    const names = new Map((await Workspace.find({ _id: trusted({ $in: soloIds }) }).select('name').lean()).map((w) => [String(w._id), w.name]));
    res.json({
      requests: users.map((u) => ({
        id: String(u._id),
        name: u.name,
        email: u.email,
        requestedAt: u.deletionRequestedAt.toISOString(),
        // Workspaces only they are in, deleted along with the account.
        soloWorkspaces: soloOf(String(u._id)).map((id) => names.get(id)).filter(Boolean),
      })),
    });
  });

  // Carries out a deletion request.
  router.delete('/deletion-requests/:userId', limiters.sensitive, requireRecentAuth, ids('userId'), async (req, res) => {
    const user = await User.findOne({ _id: req.params.userId, deletionRequestedAt: trusted({ $exists: true }) }).select('role').lean();
    if (!user) throw AppError.notFound('No deletion request for that account');
    if (user.role === 'admin') {
      throw AppError.badRequest('Platform admins can\'t be deleted. Remove them as platform admin first.', 'ADMIN_FULL_ACCESS');
    }
    await deleteAccount(user._id, { withSoloWorkspaces: true });
    audit(req, 'admin.account_deleted', { target: req.params.userId, requested: true });
    res.status(204).end();
  });

  // Everyone on the install, the workspaces they're in and what they can use.
  router.get('/people', selfHostedOnly, async (_req, res) => {
    const [users, workspaceList] = await Promise.all([
      User.find().sort({ name: 1 }).limit(MAX_PEOPLE_LISTED)
        .select('name email role access mustChangePassword disabled deletionRequestedAt createdAt lastActiveAt').lean(),
      Workspace.find().sort({ name: 1 }).limit(MAX_WORKSPACES_LISTED).select('name slug').lean(),
    ]);
    const names = new Map(workspaceList.map((w) => [String(w._id), w.name]));
    const memberships = await Membership.find({ user: trusted({ $in: users.map((u) => u._id) }) }).select('user workspace').lean();
    const byUser = new Map();
    for (const m of memberships) {
      const wsName = names.get(String(m.workspace));
      if (wsName) byUser.set(String(m.user), [...(byUser.get(String(m.user)) || []), wsName]);
    }
    res.json({
      people: users.map((u) => person(u, (byUser.get(String(u._id)) || []).sort())),
      apps,
      workspaces: workspaceList.map((w) => ({ id: String(w._id), name: w.name, slug: w.slug })),
    });
  });

  // Makes an account with a temporary password (shown once, here) and puts it in
  // a workspace. The person picks their own password at first sign-in.
  router.post('/people', selfHostedOnly, limiters.sensitive, requireRecentAuth, body(addPersonSchema), async (req, res) => {
    const ws = await findWorkspace(req.body.workspaceId);
    const password = temporaryPassword();
    let user;
    try {
      user = await User.create({
        name: req.body.name,
        email: req.body.email,
        passwordHash: await hashPassword(password),
        access: restrictionsOf(req.body.access),
        mustChangePassword: true,
      });
    } catch (err) {
      if (err?.code === 11000) throw AppError.conflict('An account with that email already exists', 'EMAIL_TAKEN');
      throw err;
    }
    await Membership.create({ workspace: ws._id, user: user._id, role: req.body.role });
    audit(req, 'admin.person_added', { target: String(user._id), workspace: String(ws._id), role: req.body.role });
    res.status(201).json({ person: person(user.toObject({ flattenMaps: true }), [ws.name]), password });
  });

  // An invite link that joins a workspace and sets app access for whoever uses it.
  router.post('/people/invite', selfHostedOnly, limiters.sensitive, requireRecentAuth, body(invitePersonSchema), async (req, res) => {
    const ws = await findWorkspace(req.body.workspaceId);
    const token = tokens.randomToken(24);
    const invite = await Invite.create({
      workspace: ws._id,
      tokenHash: tokens.sha256(token),
      role: req.body.role,
      createdBy: req.user.id,
      expiresAt: new Date(Date.now() + req.body.expiresInDays * DAY_MS),
      maxUses: req.body.maxUses,
      access: restrictionsOf(req.body.access),
    });
    audit(req, 'admin.person_invited', { invite: String(invite._id), workspace: String(ws._id), role: invite.role });
    res.status(201).json({ token, expiresAt: invite.expiresAt.toISOString(), workspace: { name: ws.name, slug: ws.slug } });
  });

  // What someone can use in each app, and whether they can sign in at all.
  // Applies to their next request. Disabling also signs them out everywhere.
  router.patch('/people/:userId', selfHostedOnly, limiters.sensitive, requireRecentAuth, ids('userId'), body(updatePersonSchema), async (req, res) => {
    const user = await findPerson(req);
    const target = String(user._id);
    const out = {};
    if (req.body.access) {
      const access = restrictionsOf({ ...(user.access ? Object.fromEntries(user.access) : {}), ...req.body.access });
      await User.updateOne({ _id: user._id }, access ? { $set: { access } } : { $unset: { access: '' } });
      audit(req, 'admin.access_changed', { target, access: access || {} });
      out.access = access || {};
    }
    if (req.body.disabled === true) {
      await User.updateOne({ _id: user._id }, { $set: { disabled: true }, $inc: { tokenVersion: 1 }, $unset: { pinDevices: '' } });
      await tokens.revokeAllSessions(user._id);
      audit(req, 'admin.account_disabled', { target });
    } else if (req.body.disabled === false) {
      await User.updateOne({ _id: user._id }, { $unset: { disabled: '' } });
      audit(req, 'admin.account_enabled', { target });
    }
    if (req.body.disabled !== undefined) out.disabled = req.body.disabled;
    await cache.invalidateUser(target);
    res.json(out);
  });

  // Deletes someone's account for good (see services/accounts.js). When they
  // asked for it themselves, workspaces only they are in go with it.
  router.delete('/people/:userId', selfHostedOnly, limiters.sensitive, requireRecentAuth, ids('userId'), async (req, res) => {
    const user = await findPerson(req);
    await deleteAccount(user._id, { withSoloWorkspaces: Boolean(user.deletionRequestedAt) });
    audit(req, 'admin.account_deleted', { target: String(user._id) });
    res.status(204).end();
  });

  // A new temporary password for someone who lost theirs. Signs them out everywhere.
  router.post('/people/:userId/reset-password', selfHostedOnly, limiters.sensitive, requireRecentAuth, ids('userId'), async (req, res) => {
    if (req.params.userId === req.user.id) throw AppError.badRequest('Change your own password from your account page', 'OWN_ACCOUNT');
    const user = await User.findById(req.params.userId);
    if (!user) throw AppError.notFound('Person not found');
    const password = temporaryPassword();
    await User.updateOne(
      { _id: user._id },
      { $set: { passwordHash: await hashPassword(password), mustChangePassword: true }, $inc: { tokenVersion: 1 }, $unset: { pinDevices: '' } },
    );
    await tokens.revokeAllSessions(user._id);
    await cache.invalidateUser(String(user._id));
    audit(req, 'admin.password_reset', { target: String(user._id) });
    res.json({ password });
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
