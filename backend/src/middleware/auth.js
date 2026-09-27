'use strict';

const User = require('../models/User');
const cache = require('../services/cache');
const { verifyAccessToken } = require('../services/tokens');
const AppError = require('../utils/AppError');

async function loadUser(id) {
  const cached = await cache.getUser(id);
  if (cached) return cached;
  const user = await User.findById(id).select('email name tokenVersion').lean();
  if (!user) return null;
  const slim = { id: String(user._id), email: user.email, name: user.name, tokenVersion: user.tokenVersion };
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

module.exports = { requireAuth, loadUser };
