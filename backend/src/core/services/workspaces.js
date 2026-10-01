'use strict';

const { trusted } = require('mongoose');
const config = require('../config');
const Workspace = require('../models/Workspace');
const Membership = require('../models/Membership');
const Invite = require('../models/Invite');
const { runInWorkspace, tenantModels } = require('../tenancy');
const { planOf } = require('../plans');
const AppError = require('../utils/AppError');

// Stops one account from creating workspaces without end.
const MAX_CREATED_PER_USER = 20;

const summary = (ws, role) => ({
  id: String(ws._id),
  name: ws.name,
  slug: ws.slug,
  plan: ws.plan,
  planName: planOf(ws.plan).name,
  role,
});

async function listForUser(userId) {
  const memberships = await Membership.find({ user: userId }).select('workspace role').lean();
  const workspaces = await Workspace.find({ _id: trusted({ $in: memberships.map((m) => m.workspace) }) })
    .select('name slug plan')
    .sort({ name: 1 })
    .lean();
  const roles = new Map(memberships.map((m) => [String(m.workspace), m.role]));
  return workspaces.map((ws) => summary(ws, roles.get(String(ws._id))));
}

// The creator becomes its admin. Everyone else joins through an invite link.
async function create({ name, slug, userId }) {
  const tooMany = () => AppError.badRequest(`You can create up to ${MAX_CREATED_PER_USER} workspaces`, 'LIMIT');
  if ((await Workspace.countDocuments({ createdBy: userId })) >= MAX_CREATED_PER_USER) throw tooMany();
  let ws;
  try {
    ws = await Workspace.create({
      name,
      slug,
      plan: config.defaultPlan,
      createdBy: userId,
    });
  } catch (err) {
    if (err?.code === 11000) throw AppError.conflict('That address is already taken', 'SLUG_TAKEN');
    throw err;
  }
  // Counted again: requests running at the same moment can all pass the check
  // above. If together they went over, this one is undone.
  if ((await Workspace.countDocuments({ createdBy: userId })) > MAX_CREATED_PER_USER) {
    await Workspace.deleteOne({ _id: ws._id });
    throw tooMany();
  }
  await Membership.create({ workspace: ws._id, user: userId, role: 'admin' });
  return summary(ws.toObject(), 'admin');
}

// Deletes a workspace and everything in it: every app's data, its members and
// its invite links. Used when the last person in it deletes their account.
async function remove(workspaceId) {
  await runInWorkspace(workspaceId, () => Promise.all(tenantModels().map((M) => M.deleteMany({}))));
  await Promise.all([Invite.deleteMany({ workspace: workspaceId }), Membership.deleteMany({ workspace: workspaceId })]);
  await Workspace.deleteOne({ _id: workspaceId });
}

module.exports = { listForUser, create, remove, summary, MAX_CREATED_PER_USER };
