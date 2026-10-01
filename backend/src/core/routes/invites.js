'use strict';

const express = require('express');
const { trusted } = require('mongoose');
const Invite = require('../models/Invite');
const Workspace = require('../models/Workspace');
const Membership = require('../models/Membership');
const User = require('../models/User');
const cache = require('../services/cache');
const { strictest, restrictionsOf } = require('../access');
const tokens = require('../services/tokens');
const workspaces = require('../services/workspaces');
const { body, ids, z } = require('../middleware/validate');
const AppError = require('../utils/AppError');
const { audit } = require('../utils/audit');

// Invite links are the only way into a workspace someone didn't create. The
// token is shown once, when the link is made; only its hash is stored. It travels
// in the link's #fragment and in request bodies, never in a URL the server sees,
// so it doesn't end up in access logs.
const MAX_ACTIVE_PER_WORKSPACE = 50;
const TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

const createSchema = z.strictObject({
  role: z.enum(Membership.ROLES).default('member'),
  expiresInDays: z.number().int().min(1).max(30).default(7),
  maxUses: z.number().int().min(1).max(1000).nullable().default(null),
});

const tokenSchema = z.strictObject({ token: z.string().max(64) });

const invalid = () => AppError.notFound('This invite link is invalid or has expired', 'INVITE_INVALID');

// Still usable: not expired (the TTL index deletes expired links only about once
// a minute) and not used up.
const usable = (extra = {}) => ({
  ...extra,
  expiresAt: trusted({ $gt: new Date() }),
  $or: [{ maxUses: null }, { $expr: trusted({ $lt: ['$uses', '$maxUses'] }) }],
});

const inviteSummary = (i) => ({
  id: String(i._id),
  role: i.role,
  expiresAt: new Date(i.expiresAt).toISOString(),
  maxUses: i.maxUses ?? null,
  uses: i.uses,
  createdAt: new Date(i.createdAt).toISOString(),
});

function tokenHash(req) {
  if (!TOKEN_RE.test(req.body.token)) throw invalid();
  return tokens.sha256(req.body.token);
}

// Mounted at /api/workspace/invites, inside the current workspace. Admins only.
function workspaceInvitesRouter({ limiters }) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    const list = await Invite.find(usable({ workspace: req.workspace.id }))
      .sort({ createdAt: -1 })
      .limit(MAX_ACTIVE_PER_WORKSPACE)
      .lean();
    res.json({ invites: list.map(inviteSummary) });
  });

  router.post('/', limiters.sensitive, body(createSchema), async (req, res) => {
    // Someone whose app access a platform admin limited could otherwise invite a
    // second account of their own without those limits.
    if (req.user.role !== 'admin' && restrictionsOf(req.user.access || {})) {
      throw AppError.forbidden('Your app access is limited, so you can\'t create invite links. Ask a platform admin to invite people.', 'ACCESS_LIMITED');
    }
    if ((await Invite.countDocuments(usable({ workspace: req.workspace.id }))) >= MAX_ACTIVE_PER_WORKSPACE) {
      throw AppError.badRequest(`A workspace can have up to ${MAX_ACTIVE_PER_WORKSPACE} active invite links`, 'LIMIT');
    }
    const token = tokens.randomToken(24);
    const invite = await Invite.create({
      workspace: req.workspace.id,
      tokenHash: tokens.sha256(token),
      role: req.body.role,
      createdBy: req.user.id,
      expiresAt: new Date(Date.now() + req.body.expiresInDays * DAY_MS),
      maxUses: req.body.maxUses,
    });
    audit(req, 'invite.created', { invite: String(invite._id), role: invite.role, expiresInDays: req.body.expiresInDays, maxUses: invite.maxUses });
    res.status(201).json({ invite: inviteSummary(invite.toObject()), token });
  });

  router.delete('/:inviteId', limiters.sensitive, ids('inviteId'), async (req, res) => {
    const r = await Invite.deleteOne({ _id: req.params.inviteId, workspace: req.workspace.id });
    if (!r.deletedCount) throw AppError.notFound('Invite not found');
    audit(req, 'invite.revoked', { invite: req.params.inviteId });
    res.status(204).end();
  });

  return router;
}

// Mounted at /api/invites behind requireAuth: opening and accepting a link.
// Both take { token } in the body.
function invitesRouter({ limiters }) {
  const router = express.Router();

  async function load(req) {
    const invite = await Invite.findOne(usable({ tokenHash: tokenHash(req) })).lean();
    const ws = invite && (await Workspace.findById(invite.workspace).select('name slug plan').lean());
    if (!ws) throw invalid();
    const member = await Membership.exists({ workspace: ws._id, user: req.user.id });
    return { invite, ws, member: Boolean(member) };
  }

  router.post('/preview', limiters.sensitive, body(tokenSchema), async (req, res) => {
    const { invite, ws, member } = await load(req);
    res.json({ workspace: { name: ws.name, slug: ws.slug }, role: invite.role, member });
  });

  router.post('/accept', limiters.sensitive, body(tokenSchema), async (req, res) => {
    const { ws, member } = await load(req);
    if (member) {
      const m = await Membership.findOne({ workspace: ws._id, user: req.user.id }).select('role').lean();
      return res.json({ workspace: workspaces.summary(ws, m.role) });
    }
    // Counts the use atomically, so a link can't be used more times than it allows.
    const invite = await Invite.findOneAndUpdate(usable({ tokenHash: tokenHash(req) }), { $inc: { uses: 1 } }, { returnDocument: 'after' }).lean();
    if (!invite) throw invalid();
    try {
      await Membership.create({ workspace: ws._id, user: req.user.id, role: invite.role });
    } catch (err) {
      // Joined through another request at the same moment.
      if (err?.code !== 11000) throw err;
    }
    // A link made from the platform admin's People page also limits what the
    // person can use in each app. It only ever adds limits: the stricter of what
    // they had and what the link carries, app by app.
    if (invite.access && Object.keys(invite.access).length) {
      const current = await User.findById(req.user.id).select('access').lean();
      await User.updateOne({ _id: req.user.id }, { $set: { access: strictest(current?.access, invite.access) } });
      await cache.invalidateUser(req.user.id);
    }
    audit(req, 'invite.accepted', { invite: String(invite._id), workspace: String(ws._id), role: invite.role });
    res.status(201).json({ workspace: workspaces.summary(ws, invite.role) });
  });

  return router;
}

module.exports = { invitesRouter, workspaceInvitesRouter };
