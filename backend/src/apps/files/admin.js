'use strict';

const express = require('express');
const config = require('../../core/config');
const User = require('../../core/models/User');
const { requireRecentAuth } = require('../../core/middleware/recentAuth');
const { body, ids, z } = require('../../core/middleware/validate');
const AppError = require('../../core/utils/AppError');
const { audit } = require('../../core/utils/audit');
const FileNode = require('./models/FileNode');
const FileQuota = require('./models/FileQuota');
const storage = require('./storage');
const limits = require('./limits');

// The Files part of the platform admin panel, mounted at /api/admin/apps/files
// behind requireAuth and requireAdmin.
//
// Both kinds of server can turn public links on or off. A self-hosted server
// also sets how much each person can store and the largest file (hosted plans
// fix those in core/plans.js), and sees how much everyone uses.

const MAX_PEOPLE_LISTED = 1000;
// Byte counts the admin can set: up to 1 PB, which no single server will reach.
const bytes = z.number().int().min(0).max(1024 ** 5);

const settingsSchema = z
  .strictObject({
    linkSharing: z.boolean().optional(),
    defaultQuotaBytes: bytes.nullable().optional(),
    maxFileBytes: bytes.min(1).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to change');
const quotaSchema = z.strictObject({ bytes: bytes.nullable() });

// Storage limits are for self-hosted servers only.
function selfHostedOnly(_req, _res, next) {
  if (!config.selfHosted) throw AppError.notFound('Not found');
  next();
}

function adminRouter({ limiters }) {
  const router = express.Router();

  router.get('/', async (_req, res) => {
    const settings = await limits.getSettings();
    const out = { settings, configured: storage.configured(), selfHosted: config.selfHosted, technicalMaxFileBytes: limits.TECHNICAL_MAX_FILE_BYTES };
    if (config.selfHosted) {
      // Everyone, with what they use across every workspace and their own limit if they have one.
      const [users, usage, quotas] = await Promise.all([
        User.find().sort({ name: 1 }).limit(MAX_PEOPLE_LISTED).select('name email').lean(),
        FileNode.aggregate([{ $match: { kind: 'file' } }, { $group: { _id: '$owner', total: { $sum: '$size' } } }], { allWorkspaces: true }),
        FileQuota.find().lean(),
      ]);
      const used = new Map(usage.map((u) => [String(u._id), u.total]));
      const own = new Map(quotas.map((q) => [String(q._id), q.bytes]));
      out.people = users.map((u) => ({
        id: String(u._id),
        name: u.name,
        email: u.email,
        usedBytes: used.get(String(u._id)) || 0,
        // custom: a limit of their own (quotaBytes null then means unlimited for them).
        custom: own.has(String(u._id)),
        quotaBytes: own.has(String(u._id)) ? own.get(String(u._id)) : settings.defaultQuotaBytes,
      }));
      out.totalUsedBytes = usage.reduce((s, u) => s + u.total, 0);
    }
    res.json(out);
  });

  router.patch('/settings', limiters.sensitive, requireRecentAuth, body(settingsSchema), async (req, res) => {
    const changes = { ...req.body };
    if (!config.selfHosted && (changes.defaultQuotaBytes !== undefined || changes.maxFileBytes !== undefined)) {
      throw AppError.badRequest('Storage limits on the hosted service come from each workspace\'s plan', 'PLAN_LIMITS');
    }
    const settings = await limits.updateSettings(changes);
    audit(req, 'admin.files_settings_changed', changes);
    res.json({ settings });
  });

  // Gives one person their own storage limit (bytes null: unlimited).
  router.put('/quotas/:userId', selfHostedOnly, limiters.sensitive, requireRecentAuth, ids('userId'), body(quotaSchema), async (req, res) => {
    if (!(await User.exists({ _id: req.params.userId }))) throw AppError.notFound('Person not found');
    await FileQuota.updateOne({ _id: req.params.userId }, { $set: { bytes: req.body.bytes } }, { upsert: true });
    audit(req, 'admin.files_quota_changed', { target: req.params.userId, bytes: req.body.bytes });
    res.json({ quota: { custom: true, quotaBytes: req.body.bytes } });
  });

  // Puts them back on the default limit.
  router.delete('/quotas/:userId', selfHostedOnly, limiters.sensitive, requireRecentAuth, ids('userId'), async (req, res) => {
    await FileQuota.deleteOne({ _id: req.params.userId });
    audit(req, 'admin.files_quota_changed', { target: req.params.userId, bytes: 'default' });
    res.json({ quota: { custom: false, quotaBytes: (await limits.getSettings()).defaultQuotaBytes } });
  });

  return router;
}

module.exports = { adminRouter };
