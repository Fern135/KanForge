'use strict';

const { Types } = require('mongoose');
const { planOf } = require('../../core/plans');
const FileNode = require('./models/FileNode');
const FileQuota = require('./models/FileQuota');
const FilesSettings = require('./models/FilesSettings');
const AppError = require('../../core/utils/AppError');

// How much each person can store, and how big one file can be.
//
// Hosted plans (Standard, Plus) set both in core/plans.js, and storage is counted
// per person in each workspace: someone in two Plus workspaces has 15 GB in each.
//
// On a self-hosted install (plan "self-hosted") a platform admin sets them in the
// admin panel: a default for everyone, and optionally a different limit for
// particular people (FileQuota). Storage is counted per person across the whole
// server, since it's one machine's disk. With nothing set, there is no limit.
//
// Everything a person owns counts, including the trash and uploads still in
// progress (their full size is reserved the moment they start).

// What one S3 multipart upload can hold: 10,000 parts, and parts are at most
// a few MB here (see uploads.js). A safe ceiling whatever the admin sets.
const TECHNICAL_MAX_FILE_BYTES = 50 * 1024 ** 3;

const everywhere = { allWorkspaces: true };

// The instance's Files settings, with defaults for anything never set.
async function getSettings() {
  const doc = await FilesSettings.findById(FilesSettings.INSTANCE).lean();
  return {
    linkSharing: doc?.linkSharing ?? true,
    defaultQuotaBytes: doc?.defaultQuotaBytes ?? null,
    maxFileBytes: doc?.maxFileBytes ?? null,
  };
}

// Saves the given settings (only the keys passed) and returns all of them.
async function updateSettings(changes) {
  await FilesSettings.updateOne({ _id: FilesSettings.INSTANCE }, { $set: changes }, { upsert: true });
  return getSettings();
}

const isSelfHostedPlan = (workspace) => workspace.plan === 'self-hosted';

// The limits for files owned by `ownerId` in `workspace` (req.workspace):
//   quotaBytes:    total storage, or null for unlimited
//   maxFileBytes:  the largest single file
//   perWorkspace:  whether usage is counted in this workspace only
async function limitsFor(ownerId, workspace) {
  if (!isSelfHostedPlan(workspace)) {
    const plan = planOf(workspace.plan);
    return {
      quotaBytes: plan.storageBytes ?? null,
      maxFileBytes: Math.min(plan.maxFileBytes ?? TECHNICAL_MAX_FILE_BYTES, TECHNICAL_MAX_FILE_BYTES),
      perWorkspace: true,
    };
  }
  const [settings, own] = await Promise.all([getSettings(), FileQuota.findById(ownerId).lean()]);
  return {
    // A personal limit wins over the default, even when it's "unlimited" (null).
    quotaBytes: own ? own.bytes : settings.defaultQuotaBytes,
    maxFileBytes: Math.min(settings.maxFileBytes ?? TECHNICAL_MAX_FILE_BYTES, TECHNICAL_MAX_FILE_BYTES),
    perWorkspace: false,
  };
}

// Bytes `ownerId` uses: in the current workspace, or (perWorkspace false) in all of them.
async function usedBytes(ownerId, perWorkspace) {
  const [row] = await FileNode.aggregate(
    [
      { $match: { owner: new Types.ObjectId(String(ownerId)), kind: 'file' } },
      { $group: { _id: null, total: { $sum: '$size' }, trash: { $sum: { $cond: [{ $ne: ['$trashedAt', null] }, '$size', 0] } } } },
    ],
    perWorkspace ? {} : everywhere,
  );
  return { total: row?.total || 0, trash: row?.trash || 0 };
}

const fmt = (bytes) => {
  const gb = bytes / 1024 ** 3;
  return gb >= 1 ? `${Number(gb.toFixed(1))} GB` : `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
};

// Refuses a file that's too big on its own, or that doesn't fit in the owner's
// storage. `ownerName` is set when the storage is someone else's (uploading
// into a folder they shared), so the message says whose storage is full.
async function assertFits({ ownerId, ownerName, workspace, size }) {
  const limits = await limitsFor(ownerId, workspace);
  if (size > limits.maxFileBytes) {
    throw AppError.badRequest(`Files can be up to ${fmt(limits.maxFileBytes)}`, 'FILE_TOO_LARGE');
  }
  if (limits.quotaBytes === null) return limits;
  const { total } = await usedBytes(ownerId, limits.perWorkspace);
  if (total + size > limits.quotaBytes) throw storageFull(limits, ownerName);
  return limits;
}

function storageFull(limits, ownerName) {
  const whose = ownerName ? `${ownerName}'s storage` : 'Your storage';
  return AppError.badRequest(`${whose} is full (${fmt(limits.quotaBytes)}). Empty the trash or delete files to make room.`, 'STORAGE_FULL');
}

// Checked again once an upload is recorded: uploads starting at the same moment
// can all pass assertFits. Returns false when together they went over.
async function stillFits(ownerId, limits) {
  if (limits.quotaBytes === null) return true;
  const { total } = await usedBytes(ownerId, limits.perWorkspace);
  return total <= limits.quotaBytes;
}

module.exports = {
  TECHNICAL_MAX_FILE_BYTES,
  getSettings,
  updateSettings,
  limitsFor,
  usedBytes,
  assertFits,
  stillFits,
  storageFull,
};
