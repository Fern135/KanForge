'use strict';

const { trusted } = require('mongoose');
const config = require('../config');
const Workspace = require('../models/Workspace');
const Membership = require('../models/Membership');
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

// The creator becomes its admin. The first workspace on a self-hosted install
// also takes in everyone who signs up later, like a single-team install always did.
async function create({ name, slug, userId }) {
  if ((await Workspace.countDocuments({ createdBy: userId })) >= MAX_CREATED_PER_USER) {
    throw AppError.badRequest(`You can create up to ${MAX_CREATED_PER_USER} workspaces`, 'LIMIT');
  }
  const first = !(await Workspace.exists({}));
  let ws;
  try {
    ws = await Workspace.create({
      name,
      slug,
      plan: config.defaultPlan,
      createdBy: userId,
      autoJoin: first && config.defaultPlan === 'self-hosted',
    });
  } catch (err) {
    if (err?.code === 11000) throw AppError.conflict('That address is already taken', 'SLUG_TAKEN');
    throw err;
  }
  await Membership.create({ workspace: ws._id, user: userId, role: 'admin' });
  return summary(ws.toObject(), 'admin');
}

// New accounts join every workspace the platform admin marked "auto-join".
async function joinAutoJoin(userId) {
  const workspaces = await Workspace.find({ autoJoin: true }).select('_id').lean();
  if (!workspaces.length) return;
  await Membership.insertMany(
    workspaces.map((ws) => ({ workspace: ws._id, user: userId, role: 'member' })),
    { ordered: false },
  ).catch((err) => {
    if (err?.code !== 11000 && !err?.writeErrors?.every((e) => e.code === 11000)) throw err;
  });
}

module.exports = { listForUser, create, joinAutoJoin, summary, MAX_CREATED_PER_USER };
