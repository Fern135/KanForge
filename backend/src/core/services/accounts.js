'use strict';

const { trusted } = require('mongoose');
const User = require('../models/User');
const Workspace = require('../models/Workspace');
const Membership = require('../models/Membership');
const Invite = require('../models/Invite');
const Session = require('../models/Session');
const events = require('./events');
const cache = require('./cache');
const { runInWorkspace } = require('../tenancy');
const AppError = require('../utils/AppError');

// Deletes an account for good. In each workspace it's removed the way a workspace
// admin removes a member (boards pass to an admin there), then everything it owned
// privately (notes, documents) is deleted with it. Refused when it's the only member
// of a workspace, which would leave that workspace with no one in it.
async function deleteAccount(userId) {
  const memberships = await Membership.find({ user: userId }).select('workspace role').lean();

  // Check every workspace first, so a refusal never leaves the account half removed.
  const steps = [];
  for (const m of memberships) {
    const others = await Membership.find({ workspace: m.workspace, user: trusted({ $ne: userId }) })
      .sort({ createdAt: 1 }).select('user role').lean();
    if (!others.length) {
      const ws = await Workspace.findById(m.workspace).select('name').lean();
      throw AppError.conflict(
        `They're the only member of "${ws?.name ?? 'a workspace'}". Add someone else to it first, or disable the account instead.`,
        'ONLY_MEMBER',
      );
    }
    steps.push({ m, successor: others.find((o) => o.role === 'admin') || others[0] });
  }

  for (const { m, successor } of steps) {
    // The only admin is leaving: the longest-standing member takes over.
    if (successor.role !== 'admin') await Membership.updateOne({ _id: successor._id }, { $set: { role: 'admin' } });
    await runInWorkspace(m.workspace, () => events.emit('workspace.memberRemoved', { userId: String(userId), successorId: String(successor.user) }));
    await Membership.deleteOne({ _id: m._id });
    await Invite.deleteMany({ workspace: m.workspace, createdBy: userId });
  }

  await events.emit('user.deleted', String(userId));
  await Session.deleteMany({ user: userId });
  await User.deleteOne({ _id: userId });
  await cache.invalidateUser(String(userId));
}

module.exports = { deleteAccount };
