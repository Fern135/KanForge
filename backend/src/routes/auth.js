'use strict';

const express = require('express');
const argon2 = require('argon2');
const config = require('../config');
const User = require('../models/User');
const Board = require('../models/Board');
const tokens = require('../services/tokens');
const lockout = require('../services/lockout');
const cache = require('../services/cache');
const { requireAuth } = require('../middleware/auth');
const { requireCsrf } = require('../middleware/csrf');
const { body, z } = require('../middleware/validate');
const AppError = require('../utils/AppError');

// OWASP-recommended Argon2id parameters (19 MiB, t=2, p=1). This is strong and
// still fast enough to keep login snappy.
const ARGON_OPTS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };
// Verified when an email is unknown so response timing doesn't reveal which accounts exist.
const DUMMY_HASH_PROMISE = argon2.hash('dummy-password-for-timing', ARGON_OPTS);

const email = z.string().trim().toLowerCase().max(254).pipe(z.email());
const password = z.string().min(12, 'Password must be at least 12 characters').max(128);
const name = z.string().trim().min(1).max(60).regex(/^[^<>]*$/, 'Name contains invalid characters');

const registerSchema = z.strictObject({ email, name, password });
const loginSchema = z.strictObject({ email, password: z.string().min(1).max(128) });
const profileSchema = z.strictObject({ name });
const changePasswordSchema = z.strictObject({ currentPassword: z.string().min(1).max(128), newPassword: password });

const meta = (req) => ({ ip: req.ip, userAgent: req.get('user-agent') });

function setAuthCookies(res, refreshToken) {
  const base = { secure: config.refresh.cookieSecure, sameSite: 'strict', maxAge: config.refresh.ttlMs };
  res.cookie(config.refresh.cookieName, refreshToken, { ...base, httpOnly: true, path: config.refresh.cookiePath });
  res.cookie(config.refresh.csrfCookieName, tokens.randomToken(24), { ...base, httpOnly: false, path: '/' });
}

function clearAuthCookies(res) {
  const base = { secure: config.refresh.cookieSecure, sameSite: 'strict' };
  res.clearCookie(config.refresh.cookieName, { ...base, httpOnly: true, path: config.refresh.cookiePath });
  res.clearCookie(config.refresh.csrfCookieName, { ...base, path: '/' });
}

async function startSession(req, res, user, status = 200) {
  const refreshToken = await tokens.createSession(user._id, meta(req));
  setAuthCookies(res, refreshToken);
  res.status(status).json({ user: user.toJSON(), accessToken: tokens.signAccessToken(user) });
}

module.exports = function authRouter(limiters) {
  const router = express.Router();

  router.post('/register', limiters.auth, body(registerSchema), async (req, res) => {
    const { email: mail, name: displayName, password: pwd } = req.body;
    const localPart = mail.split('@')[0];
    if (localPart.length >= 4 && pwd.toLowerCase().includes(localPart)) {
      throw AppError.badRequest('Password must not contain your email name', 'WEAK_PASSWORD');
    }
    const passwordHash = await argon2.hash(pwd, ARGON_OPTS);
    let user;
    try {
      user = await User.create({ email: mail, name: displayName, passwordHash });
    } catch (err) {
      if (err?.code === 11000) throw AppError.conflict('An account with that email already exists', 'EMAIL_TAKEN');
      throw err;
    }
    await startSession(req, res, user, 201);
  });

  router.post('/login', limiters.auth, body(loginSchema), async (req, res) => {
    const { email: mail, password: pwd } = req.body;
    if (await lockout.isLocked(mail, req.ip)) {
      throw AppError.tooMany('Too many failed attempts. Try again in 15 minutes.', 'LOCKED');
    }
    const user = await User.findOne({ email: mail }).select('+passwordHash');
    const ok = user
      ? await argon2.verify(user.passwordHash, pwd)
      : (await argon2.verify(await DUMMY_HASH_PROMISE, pwd), false);

    if (!ok) {
      await lockout.registerFailure(mail, req.ip);
      throw AppError.unauthorized('Invalid email or password', 'BAD_CREDENTIALS');
    }
    await lockout.clearFailures(mail, req.ip);

    if (argon2.needsRehash(user.passwordHash, ARGON_OPTS)) {
      user.passwordHash = await argon2.hash(pwd, ARGON_OPTS);
      await user.save();
    }
    await startSession(req, res, user);
  });

  router.post('/refresh', limiters.refresh, requireCsrf, async (req, res) => {
    let result;
    try {
      result = await tokens.rotateSession(req.cookies?.[config.refresh.cookieName], meta(req));
    } catch (err) {
      if (err.code !== 'REFRESH_RACE') clearAuthCookies(res);
      throw err;
    }
    const user = await User.findById(result.userId);
    if (!user) {
      clearAuthCookies(res);
      throw AppError.unauthorized('Session expired', 'REFRESH_INVALID');
    }
    setAuthCookies(res, result.token);
    res.json({ user: user.toJSON(), accessToken: tokens.signAccessToken(user) });
  });

  router.post('/logout', limiters.refresh, requireCsrf, async (req, res) => {
    await tokens.revokeSession(req.cookies?.[config.refresh.cookieName]);
    clearAuthCookies(res);
    res.status(204).end();
  });

  router.post('/logout-all', requireAuth, async (req, res) => {
    await User.updateOne({ _id: req.user.id }, { $inc: { tokenVersion: 1 } });
    await tokens.revokeAllSessions(req.user.id);
    await cache.invalidateUser(req.user.id);
    clearAuthCookies(res);
    res.status(204).end();
  });

  router.get('/me', requireAuth, (req, res) => {
    res.json({ user: { id: req.user.id, email: req.user.email, name: req.user.name } });
  });

  router.patch('/me', requireAuth, body(profileSchema), async (req, res) => {
    const user = await User.findByIdAndUpdate(req.user.id, { $set: { name: req.body.name } }, { new: true });
    await cache.invalidateUser(req.user.id);
    // Cached board payloads embed member names, so drop every board this user is on.
    const boards = await Board.find({ 'members.user': req.user.id }).select('_id').lean();
    await Promise.all(boards.map((b) => cache.invalidateBoard(String(b._id))));
    res.json({ user: user.toJSON() });
  });

  router.post('/change-password', limiters.sensitive, requireAuth, body(changePasswordSchema), async (req, res) => {
    const user = await User.findById(req.user.id).select('+passwordHash');
    if (!(await argon2.verify(user.passwordHash, req.body.currentPassword))) {
      throw AppError.badRequest('Current password is incorrect', 'BAD_CREDENTIALS');
    }
    user.passwordHash = await argon2.hash(req.body.newPassword, ARGON_OPTS);
    user.tokenVersion += 1;
    await user.save();
    await tokens.revokeAllSessions(user._id);
    await cache.invalidateUser(req.user.id);
    await startSession(req, res, user);
  });

  return router;
};
