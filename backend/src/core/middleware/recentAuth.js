'use strict';

const User = require('../models/User');
const { verifyCurrentPassword } = require('../services/currentPassword');
const { redis } = require('../db/redis');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');
const { audit } = require('../utils/audit');

// "Sudo mode" for platform admin changes: the admin types their password again,
// and for the next 10 minutes this sign-in session (not their other devices) can
// make changes without asking. A stolen session alone can't make changes.
const WINDOW_SECONDS = 10 * 60;
const key = (sessionId) => `recent-auth:${sessionId}`;

// Checks the password (with the whole-account lockout) and opens the window.
async function confirmPassword(req, password) {
  if (!req.sessionId) throw AppError.unauthorized('Sign in again to continue', 'TOKEN_INVALID');
  const user = await User.findById(req.user.id).select('+passwordHash');
  if (!user) throw AppError.unauthorized('Sign in again to continue', 'TOKEN_INVALID');
  await verifyCurrentPassword(req, user, password);
  await redis.set(key(req.sessionId), '1', 'EX', WINDOW_SECONDS);
  audit(req, 'admin.confirmed');
}

// Use after requireAuth. If Redis can't be reached, changes are refused rather
// than allowed without the check.
async function requireRecentAuth(req, _res, next) {
  let recent = false;
  try {
    recent = Boolean(req.sessionId && (await redis.exists(key(req.sessionId))));
  } catch (err) {
    logger.warn({ err: err.message }, 'recent auth check failed');
  }
  if (!recent) throw AppError.forbidden('Enter your password to make this change', 'REAUTH_REQUIRED');
  next();
}

module.exports = { confirmPassword, requireRecentAuth, RECENT_AUTH_SECONDS: WINDOW_SECONDS };
