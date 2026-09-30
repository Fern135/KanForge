'use strict';

const User = require('../models/User');
const Workspace = require('../models/Workspace');
const Membership = require('../models/Membership');
const { PLANS, PAID_PLAN_IDS } = require('../plans');

// Totals for the super admin dashboard. Counts only: no names, emails or
// content from inside any workspace. Workspaces on the Self-hosted plan are
// private and left out of the workspace, seat, plan and revenue figures.
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const WEEKS = 12;

// Monday 00:00 UTC of the week `t` falls in.
function weekStart(t) {
  const d = new Date(t);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY_MS;
}

const countSince = (field, since) => User.aggregate([{ $match: { [field]: { $gte: new Date(since) } } }, { $count: 'n' }])
  .then(([row]) => row?.n || 0);

async function signupsByWeek(now) {
  const first = weekStart(now) - (WEEKS - 1) * WEEK_MS;
  const rows = await User.aggregate([
    { $match: { createdAt: { $gte: new Date(first) } } },
    { $group: { _id: { $floor: { $divide: [{ $subtract: ['$createdAt', new Date(first)] }, WEEK_MS] } }, n: { $sum: 1 } } },
  ]);
  const counts = new Map(rows.map((r) => [r._id, r.n]));
  return Array.from({ length: WEEKS }, (_, i) => ({ weekStart: new Date(first + i * WEEK_MS).toISOString(), signups: counts.get(i) || 0 }));
}

async function planMix() {
  const [workspaces, seats] = await Promise.all([
    Workspace.aggregate([{ $match: { plan: { $in: PAID_PLAN_IDS } } }, { $group: { _id: '$plan', n: { $sum: 1 } } }]),
    Membership.aggregate([
      { $lookup: { from: 'workspaces', localField: 'workspace', foreignField: '_id', as: 'ws' } },
      { $unwind: '$ws' },
      { $match: { 'ws.plan': { $in: PAID_PLAN_IDS } } },
      { $group: { _id: '$ws.plan', n: { $sum: 1 } } },
    ]),
  ]);
  const byPlan = (rows) => new Map(rows.map((r) => [r._id, r.n]));
  const [ws, st] = [byPlan(workspaces), byPlan(seats)];
  return PAID_PLAN_IDS.map((id) => ({
    plan: id,
    name: PLANS[id].name,
    seatPrice: PLANS[id].seatPrice,
    workspaces: ws.get(id) || 0,
    seats: st.get(id) || 0,
    monthlyRevenue: (st.get(id) || 0) * PLANS[id].seatPrice,
  }));
}

async function platformStats(now = Date.now()) {
  const [accounts, active7, active30, signups, plans] = await Promise.all([
    User.estimatedDocumentCount(),
    countSince('lastActiveAt', now - 7 * DAY_MS),
    countSince('lastActiveAt', now - 30 * DAY_MS),
    signupsByWeek(now),
    planMix(),
  ]);
  const monthlyRevenue = plans.reduce((sum, p) => sum + p.monthlyRevenue, 0);
  return {
    accounts,
    active7,
    active30,
    workspaces: plans.reduce((sum, p) => sum + p.workspaces, 0),
    seats: plans.reduce((sum, p) => sum + p.seats, 0),
    // An estimate from seats × plan price until real payments exist.
    monthlyRevenue,
    yearlyRevenue: monthlyRevenue * 12,
    signups,
    plans,
  };
}

module.exports = { platformStats, weekStart };
