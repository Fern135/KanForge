'use strict';

const User = require('../models/User');
const { redis } = require('../db/redis');
const logger = require('../utils/logger');
const cache = require('../services/cache');
const { verifyAccessToken, isAccessTokenRevoked } = require('../services/tokens');
const AppError = require('../utils/AppError');
const { accessTo } = require('../access');

const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

async function loadUser(id) {
  const cached = await cache.getUser(id);
  if (cached) return cached;
  const user = await User.findById(id).select('email name role tokenVersion access mustChangePassword').lean();
  if (!user) return null;
  const slim = {
    id: String(user._id),
    email: user.email,
    name: user.name,
    role: user.role || 'user',
    tokenVersion: user.tokenVersion,
    access: user.access || null,
    mustChangePassword: Boolean(user.mustChangePassword),
  };
  await cache.setUser(slim.id, slim);
  return slim;
}

// Records when an account was last active, at most once an hour, for the
// platform stats. Never holds up or fails the request.
function markActive(userId) {
  redis.set(`seen:${userId}`, '1', 'EX', 3600, 'NX')
    .then((fresh) => fresh && User.updateOne({ _id: userId }, { $set: { lastActiveAt: new Date() } }))
    .catch((err) => logger.warn({ err: err.message }, 'could not record activity'));
}

// Requires a valid Bearer access token. The token only travels in a header,
// never in a cookie, so these routes can't be CSRF'd.
async function requireAuth(req, _res, next) {
  const header = req.get('authorization') || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token || token.length > 2048) {
    throw AppError.unauthorized();
  }
  const payload = verifyAccessToken(token);
  if (!/^[a-f0-9]{24}$/.test(payload.sub)) throw AppError.unauthorized('Invalid token', 'TOKEN_INVALID');

  const [user, revoked] = await Promise.all([loadUser(payload.sub), isAccessTokenRevoked(payload.jti)]);
  if (!user || revoked || user.tokenVersion !== payload.ver) {
    throw AppError.unauthorized('Session revoked', 'TOKEN_INVALID');
  }
  // A temporary password (set by a platform admin) is replaced before anything
  // else: only the account routes answer until then.
  if (user.mustChangePassword && req.baseUrl !== '/api/auth') {
    throw AppError.forbidden('Choose a new password first', 'PASSWORD_CHANGE_REQUIRED');
  }
  req.user = user;
  markActive(user.id);
  // The sign-in session this token belongs to (see requireRecentAuth).
  req.sessionId = typeof payload.sid === 'string' ? payload.sid : null;
  next();
}

// Use after requireAuth. The role comes from the (briefly cached) user record,
// so a demotion takes effect as soon as the cache entry is dropped.
function requireAdmin(req, _res, next) {
  if (req.user?.role !== 'admin') throw AppError.forbidden('Admins only');
  next();
}

// Use after requireWorkspace. An app outside the workspace's plan answers 403
// PLAN_REQUIRED. A turned-off app answers 404 on every route, as if it weren't installed.
const requireAppEnabled = (appState, id) => (req, _res, next) => {
  const app = appState.find(req.workspace, id);
  if (!app?.included) {
    throw AppError.forbidden(`${app?.name || 'This app'} isn't included in this workspace's plan`, 'PLAN_REQUIRED');
  }
  if (!app.enabled) throw AppError.notFound('This app is turned off', 'APP_DISABLED');
  next();
};

// Use after requireAppEnabled. What this person may do in the app (see access.js):
// no access answers 403 NO_ACCESS, and view-only allows reads only.
const requireAppAccess = (id) => (req, _res, next) => {
  const level = accessTo(req.user, id);
  if (level === 'none') throw AppError.forbidden("You don't have access to this app", 'NO_ACCESS');
  if (level === 'view' && !READS.has(req.method)) {
    throw AppError.forbidden('You can view this app but not make changes', 'READ_ONLY');
  }
  next();
};

module.exports = { requireAuth, requireAdmin, requireAppEnabled, requireAppAccess, loadUser };
