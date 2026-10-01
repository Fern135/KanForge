'use strict';

const { trusted } = require('mongoose');
const User = require('../models/User');
const Workspace = require('../models/Workspace');
const Membership = require('../models/Membership');
const Invite = require('../models/Invite');
const Session = require('../models/Session');
const events = require('./events');
const tokens = require('./tokens');
const workspaces = require('./workspaces');
const cache = require('./cache');
const { runInWorkspace } = require('../tenancy');
const AppError = require('../utils/AppError');

// Deletes an account for good. In each workspace it's removed the way a workspace
// admin removes a member (boards pass to an admin there), then everything it owned
// privately (notes, documents) is deleted with it. A workspace where it's the only
// member would be left with no one: that's refused, unless withSoloWorkspaces
// (the person asked for the deletion), which deletes those workspaces too.
async function deleteAccount(userId, { withSoloWorkspaces = false } = {}) {
  const memberships = await Membership.find({ user: userId }).select('workspace role').lean();

  // Check every workspace first, so a refusal never leaves the account half removed.
  const steps = [];
  const solo = [];
  for (const m of memberships) {
    const others = await Membership.find({ workspace: m.workspace, user: trusted({ $ne: userId }) })
      .sort({ createdAt: 1 }).select('user role').lean();
    if (!others.length) {
      if (withSoloWorkspaces) {
        solo.push(m.workspace);
        continue;
      }
      const ws = await Workspace.findById(m.workspace).select('name').lean();
      throw AppError.conflict(
        `They're the only member of "${ws?.name ?? 'a workspace'}". Add someone else to it first, or disable the account instead.`,
        'ONLY_MEMBER',
      );
    }
    steps.push({ m, successor: others.find((o) => o.role === 'admin') || others[0] });
  }

  // From here on the account can't act: nothing it does mid-deletion (a new note,
  // joining a workspace) can slip past the cleanup. If a step fails, it stays
  // disabled and the deletion can be retried.
  await User.updateOne({ _id: userId }, { $set: { disabled: true }, $inc: { tokenVersion: 1 }, $unset: { pinDevices: '' } });
  await tokens.revokeAllSessions(userId);
  await cache.invalidateUser(String(userId));

  for (const workspaceId of solo) await workspaces.remove(workspaceId);
  for (const { m, successor } of steps) {
    // The only admin is leaving: the longest-standing member takes over.
    if (successor.role !== 'admin') await Membership.updateOne({ _id: successor._id }, { $set: { role: 'admin' } });
    // Strict: if boards can't be handed over, stop (the deletion can be retried) rather than leave them behind.
    await runInWorkspace(m.workspace, () => events.emitStrict('workspace.memberRemoved', { userId: String(userId), successorId: String(successor.user) }));
    await Membership.deleteOne({ _id: m._id });
    await Invite.deleteMany({ workspace: m.workspace, createdBy: userId });
  }

  // Strict: the account is only deleted once everything it owned privately is gone.
  await events.emitStrict('user.deleted', String(userId));
  await Session.deleteMany({ user: userId });
  await User.deleteOne({ _id: userId });
  await cache.invalidateUser(String(userId));
}

module.exports = { deleteAccount };
