'use strict';

const express = require('express');
const User = require('../models/User');
const cache = require('../services/cache');
const { body, ids, z } = require('../middleware/validate');
const AppError = require('../utils/AppError');

// Enough for a self-hosted install. Paging and search come if an instance outgrows it.
const MAX_USERS_LISTED = 500;

const appSchema = z.strictObject({ enabled: z.boolean() });
const roleSchema = z.strictObject({ role: z.enum(['user', 'admin']) });

const adminUser = (u) => ({
  id: String(u._id),
  name: u.name,
  email: u.email,
  role: u.role || 'user',
  createdAt: new Date(u.createdAt).toISOString(),
});

// Mounted behind requireAuth and requireAdmin.
module.exports = function adminRouter({ limiters, appState }) {
  const router = express.Router();

  router.get('/apps', async (_req, res) => {
    res.json({ apps: await appState.list() });
  });

  router.patch('/apps/:appId', limiters.sensitive, body(appSchema), async (req, res) => {
    if (!appState.has(req.params.appId)) throw AppError.notFound('App not found');
    await appState.setEnabled(req.params.appId, req.body.enabled);
    res.json({ apps: await appState.list() });
  });

  router.get('/users', async (_req, res) => {
    const users = await User.find().sort({ createdAt: 1 }).limit(MAX_USERS_LISTED).select('name email role createdAt').lean();
    res.json({ users: users.map(adminUser) });
  });

  router.patch('/users/:userId', limiters.sensitive, ids('userId'), body(roleSchema), async (req, res) => {
    const user = await User.findByIdAndUpdate(req.params.userId, { $set: { role: req.body.role } }, { new: false })
      .select('name email role createdAt')
      .lean();
    if (!user) throw AppError.notFound('User not found');

    // Never leave the instance without an admin. Checking after the write (and
    // undoing it) stays correct when two admins demote each other at once.
    if (req.body.role === 'user' && (await User.countDocuments({ role: 'admin' })) === 0) {
      await User.updateOne({ _id: user._id }, { $set: { role: 'admin' } });
      throw AppError.conflict('There must be at least one admin', 'LAST_ADMIN');
    }
    await cache.invalidateUser(String(user._id));
    res.json({ user: adminUser({ ...user, role: req.body.role }) });
  });

  return router;
};
