'use strict';

const crypto = require('node:crypto');
const express = require('express');
const argon2 = require('argon2');
const config = require('../config');
const User = require('../models/User');
const events = require('../services/events');
const tokens = require('../services/tokens');
const lockout = require('../services/lockout');
const { verifyCurrentPassword } = require('../services/currentPassword');
const { ARGON_OPTS } = require('../services/passwords');
const cache = require('../services/cache');
const { requireAuth } = require('../middleware/auth');
const { requireCsrf } = require('../middleware/csrf');
const { body, z } = require('../middleware/validate');
const AppError = require('../utils/AppError');
const { audit, emailHash } = require('../utils/audit');

// Verified when an email is unknown so response timing doesn't reveal which accounts exist.
const DUMMY_HASH_PROMISE = argon2.hash('dummy-password-for-timing', ARGON_OPTS);

const email = z.string().trim().toLowerCase().max(254).pipe(z.email());
const password = z.string().min(12, 'Password must be at least 12 characters').max(128);
const name = z.string().trim().min(1).max(60).regex(/^[^<>]*$/, 'Name contains invalid characters');

const registerSchema = z.strictObject({ email, name, password });
const loginSchema = z.strictObject({ email, password: z.string().min(1).max(128) });
const profileSchema = z.strictObject({ name });
const changePasswordSchema = z.strictObject({ currentPassword: z.string().min(1).max(128), newPassword: password });

// 6-8 digits, minus the patterns people guess first (111111, 123456, 654321).
const pin = z
  .string()
  .regex(/^\d{6,8}$/, 'PIN must be 6 to 8 digits')
  .refine((v) => !/^(\d)\1+$/.test(v), 'PIN is too easy to guess')
  .refine((v) => !'0123456789'.includes(v) && !'9876543210'.includes(v), 'PIN is too easy to guess');
const pinLoginSchema = z.strictObject({ pin: z.string().regex(/^\d{1,8}$/) });
const setPinSchema = z.strictObject({ currentPassword: z.string().min(1).max(128), pin });
const disablePinSchema = z.strictObject({ currentPassword: z.string().min(1).max(128) });

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

// PIN sign-in only works on a device remembered for the account, so the PIN
// alone is enough to say who is signing in.
const pinCookieOpts = () => ({
  httpOnly: true,
  secure: config.refresh.cookieSecure,
  sameSite: 'strict',
  path: config.refresh.cookiePath,
});

function pinDeviceHash(req) {
  const raw = req.cookies?.[config.pinDevice.cookieName];
  if (typeof raw !== 'string' || raw.length < 32 || raw.length > 128) return null;
  return tokens.sha256(raw);
}

// The user this device is remembered for, if the PIN is still on and the device hasn't expired.
async function pinDeviceUser(req, fields = '') {
  const hash = pinDeviceHash(req);
  if (!hash) return null;
  const user = await User.findOne({ 'pinDevices.tokenHash': hash }).select(`+pinHash +pinDevices ${fields}`);
  const device = user?.pinDevices?.find((d) => d.tokenHash === hash);
  if (!user?.pinHash || !device || Date.now() - device.createdAt.getTime() > config.pinDevice.ttlMs) return null;
  return user;
}

function clearPinDevice(res) {
  res.clearCookie(config.pinDevice.cookieName, pinCookieOpts());
}

async function dropPinDevice(req) {
  const hash = pinDeviceHash(req);
  if (hash) await User.updateMany({ 'pinDevices.tokenHash': hash }, { $pull: { pinDevices: { tokenHash: hash } } });
}

// Issues a fresh device token and keeps only the most recent devices.
async function rememberPinDevice(req, res, userId) {
  await dropPinDevice(req);
  const raw = tokens.randomToken(32);
  const device = { tokenHash: tokens.sha256(raw), createdAt: new Date() };
  await User.updateOne({ _id: userId }, { $push: { pinDevices: { $each: [device], $slice: -config.pinDevice.max } } });
  res.cookie(config.pinDevice.cookieName, raw, { ...pinCookieOpts(), maxAge: config.pinDevice.ttlMs });
}

// "This browser has signed in to this account before" (see services/lockout.js).
// A MAC of the email under the server secret, so it can't be made without signing in.
const knownDeviceValue = (mail) =>
  crypto.createHmac('sha256', config.jwt.secret).update(`known-device:${mail}`).digest('base64url');

function isKnownDevice(req, mail) {
  const raw = req.cookies?.[config.knownDevice.cookieName];
  const expected = knownDeviceValue(mail);
  return typeof raw === 'string' && raw.length === expected.length && crypto.timingSafeEqual(Buffer.from(raw), Buffer.from(expected));
}

function rememberKnownDevice(res, mail) {
  res.cookie(config.knownDevice.cookieName, knownDeviceValue(mail), {
    httpOnly: true,
    secure: config.refresh.cookieSecure,
    sameSite: 'strict',
    path: config.refresh.cookiePath,
    maxAge: config.knownDevice.ttlMs,
  });
}

const disabledError = () => AppError.forbidden('This account has been disabled. Ask your administrator.', 'ACCOUNT_DISABLED');

// Every sign-in ends here (password, PIN, sign-up, password change), after the
// credentials check out, so a disabled account learns it's disabled only then.
async function startSession(req, res, user, status = 200) {
  if (user.disabled) {
    audit(req, 'signin.refused_disabled', { user: String(user._id) });
    throw disabledError();
  }
  const { token: refreshToken, family } = await tokens.createSession(user._id, meta(req));
  setAuthCookies(res, refreshToken);
  rememberKnownDevice(res, user.email);
  res.status(status).json({ user: user.toJSON(), accessToken: tokens.signAccessToken(user, family) });
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
    audit(req, 'account.created', { user: String(user._id) });
    await startSession(req, res, user, 201);
  });

  router.post('/login', limiters.auth, body(loginSchema), async (req, res) => {
    const { email: mail, password: pwd } = req.body;
    if (await lockout.isLocked(mail, req.ip, 'password', { knownDevice: isKnownDevice(req, mail) })) {
      audit(req, 'signin.locked', { method: 'password', emailHash: emailHash(mail) });
      throw AppError.tooMany('Too many failed attempts. Try again in 15 minutes.', 'LOCKED');
    }
    const user = await User.findOne({ email: mail }).select('+passwordHash +pinHash');
    const ok = user
      ? await argon2.verify(user.passwordHash, pwd)
      : (await argon2.verify(await DUMMY_HASH_PROMISE, pwd), false);

    if (!ok) {
      audit(req, 'signin.failed', { method: 'password', ...(user ? { user: String(user._id) } : { emailHash: emailHash(mail), unknownAccount: true }) });
      await lockout.registerFailure(mail, req.ip);
      throw AppError.unauthorized('Invalid email or password', 'BAD_CREDENTIALS');
    }
    await lockout.clearFailures(mail, req.ip);

    if (argon2.needsRehash(user.passwordHash, ARGON_OPTS)) {
      user.passwordHash = await argon2.hash(pwd, ARGON_OPTS);
      await user.save();
    }
    // With the PIN on, a password sign-in also sets up this device for PIN sign-in.
    if (user.pinHash) await rememberPinDevice(req, res, user._id);
    audit(req, 'signin.succeeded', { method: 'password', user: String(user._id) });
    await startSession(req, res, user);
  });

  // Which account this device can sign in to with a PIN, if any.
  router.get('/pin-device', limiters.refresh, async (req, res) => {
    const user = await pinDeviceUser(req);
    if (!user) {
      if (req.cookies?.[config.pinDevice.cookieName]) clearPinDevice(res);
      return res.json({ user: null });
    }
    res.json({ user: { name: user.name, email: user.email } });
  });

  router.post('/pin-device/forget', limiters.refresh, async (req, res) => {
    await dropPinDevice(req);
    clearPinDevice(res);
    res.status(204).end();
  });

  // PIN only: the remembered device says which account. Failures use their own
  // lockout counters, which lock the account sooner than password failures do.
  router.post('/login-pin', limiters.auth, body(pinLoginSchema), async (req, res) => {
    const user = await pinDeviceUser(req);
    if (!user) {
      clearPinDevice(res);
      throw AppError.unauthorized('This device isn\'t set up for PIN sign-in. Sign in with your password.', 'PIN_DEVICE_UNKNOWN');
    }
    if (await lockout.isLocked(user.email, req.ip, 'pin', { knownDevice: isKnownDevice(req, user.email) })) {
      audit(req, 'signin.locked', { method: 'pin', user: String(user._id) });
      throw AppError.tooMany('Too many failed attempts. Try again in 15 minutes.', 'LOCKED');
    }
    if (!(await argon2.verify(user.pinHash, req.body.pin))) {
      audit(req, 'signin.failed', { method: 'pin', user: String(user._id) });
      await lockout.registerFailure(user.email, req.ip, 'pin');
      throw AppError.unauthorized('Incorrect PIN', 'BAD_CREDENTIALS');
    }
    await lockout.clearFailures(user.email, req.ip, 'pin');
    audit(req, 'signin.succeeded', { method: 'pin', user: String(user._id) });
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
    if (!user || user.disabled) {
      clearAuthCookies(res);
      throw AppError.unauthorized('Session expired', 'REFRESH_INVALID');
    }
    setAuthCookies(res, result.token);
    res.json({ user: user.toJSON(), accessToken: tokens.signAccessToken(user, result.family) });
  });

  router.post('/logout', limiters.refresh, requireCsrf, async (req, res) => {
    await tokens.revokeSession(req.cookies?.[config.refresh.cookieName]);
    // The access token this tab was using stops working too.
    const [scheme, access] = (req.get('authorization') || '').split(' ');
    if (scheme === 'Bearer' && access && access.length <= 2048) {
      try {
        await tokens.revokeAccessToken(tokens.verifyAccessToken(access));
      } catch {
        // Already invalid or expired: nothing to cancel.
      }
    }
    clearAuthCookies(res);
    res.status(204).end();
  });

  router.post('/logout-all', limiters.sensitive, requireAuth, async (req, res) => {
    // Every remembered PIN device goes too, so the next sign-in needs the password.
    await User.updateOne({ _id: req.user.id }, { $inc: { tokenVersion: 1 }, $unset: { pinDevices: '' } });
    await tokens.revokeAllSessions(req.user.id);
    await cache.invalidateUser(req.user.id);
    clearAuthCookies(res);
    clearPinDevice(res);
    audit(req, 'signout.everywhere');
    res.status(204).end();
  });

  router.get('/me', requireAuth, (req, res) => {
    const { id, email: mail, name: displayName, role, mustChangePassword } = req.user;
    res.json({ user: { id, email: mail, name: displayName, role, ...(mustChangePassword ? { mustChangePassword } : {}) } });
  });

  router.patch('/me', limiters.sensitive, requireAuth, body(profileSchema), async (req, res) => {
    const user = await User.findByIdAndUpdate(req.user.id, { $set: { name: req.body.name } }, { returnDocument: 'after' });
    await cache.invalidateUser(req.user.id);
    // Apps may cache the name elsewhere (Boards embeds member names in board payloads).
    await events.emit('user.renamed', req.user.id);
    res.json({ user: user.toJSON() });
  });

  router.post('/change-password', limiters.sensitive, requireAuth, body(changePasswordSchema), async (req, res) => {
    const user = await User.findById(req.user.id).select('+passwordHash +pinHash');
    await verifyCurrentPassword(req, user, req.body.currentPassword);
    if (req.body.newPassword === req.body.currentPassword) {
      throw AppError.badRequest('Choose a password that is different from the current one', 'SAME_PASSWORD');
    }
    user.passwordHash = await argon2.hash(req.body.newPassword, ARGON_OPTS);
    user.tokenVersion += 1;
    // Replacing a temporary password from a platform admin unlocks the account.
    user.mustChangePassword = undefined;
    await user.save();
    await User.updateOne({ _id: user._id }, { $unset: { pinDevices: '' } });
    await tokens.revokeAllSessions(user._id);
    await cache.invalidateUser(req.user.id);
    // Other devices lose PIN sign-in along with their sessions. This one keeps it.
    if (user.pinHash) await rememberPinDevice(req, res, user._id);
    else clearPinDevice(res);
    audit(req, 'password.changed');
    await startSession(req, res, user);
  });

  router.get('/pin', requireAuth, async (req, res) => {
    const user = await User.findById(req.user.id).select('+pinHash').lean();
    res.json({ enabled: Boolean(user?.pinHash) });
  });

  // Turning the PIN on, changing it, or turning it off all need the password.
  // Turning it on or changing it also sets up this device for PIN sign-in.
  router.put('/pin', limiters.sensitive, requireAuth, body(setPinSchema), async (req, res) => {
    const user = await User.findById(req.user.id).select('+passwordHash');
    await verifyCurrentPassword(req, user, req.body.currentPassword);
    user.pinHash = await argon2.hash(req.body.pin, ARGON_OPTS);
    await user.save();
    await rememberPinDevice(req, res, user._id);
    audit(req, 'pin.enabled');
    res.json({ enabled: true });
  });

  router.post('/pin/disable', limiters.sensitive, requireAuth, body(disablePinSchema), async (req, res) => {
    const user = await User.findById(req.user.id).select('+passwordHash');
    await verifyCurrentPassword(req, user, req.body.currentPassword);
    await User.updateOne({ _id: user._id }, { $unset: { pinHash: '', pinDevices: '' } });
    clearPinDevice(res);
    audit(req, 'pin.disabled');
    res.json({ enabled: false });
  });

  return router;
};
