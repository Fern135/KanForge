'use strict';

const User = require('../models/User');
const cache = require('../services/cache');
const { verifyAccessToken } = require('../services/tokens');
const AppError = require('../utils/AppError');

async function loadUser(id) {
  const cached = await cache.getUser(id);
  if (cached) return cached;
  const user = await User.findById(id).select('email name role tokenVersion').lean();
  if (!user) return null;
  const slim = {
    id: String(user._id),
    email: user.email,
    name: user.name,
    role: user.role || 'user',
    tokenVersion: user.tokenVersion,
  };
  await cache.setUser(slim.id, slim);
  return slim;
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

  const user = await loadUser(payload.sub);
  if (!user || user.tokenVersion !== payload.ver) {
    throw AppError.unauthorized('Session revoked', 'TOKEN_INVALID');
  }
  req.user = user;
  next();
}

// Use after requireAuth. The role comes from the (briefly cached) user record,
// so a demotion takes effect as soon as the cache entry is dropped.
function requireAdmin(req, _res, next) {
  if (req.user?.role !== 'admin') throw AppError.forbidden('Admins only');
  next();
}

// Use after requireAuth. A turned-off app answers 404 on every route, as if it
// weren't installed.
const requireAppEnabled = (appState, id) => async (req, _res, next) => {
  if (!(await appState.isEnabled(id))) throw AppError.notFound('This app is turned off', 'APP_DISABLED');
  next();
};

module.exports = { requireAuth, requireAdmin, requireAppEnabled, loadUser };
