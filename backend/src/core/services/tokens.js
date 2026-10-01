'use strict';

const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { trusted, Types } = require('mongoose');
const config = require('../config');
const Session = require('../models/Session');
const { redis } = require('../db/redis');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');

// Two tabs refreshing at the same moment would otherwise look like token theft.
// A token rotated within this window is rejected, but it doesn't revoke the family.
const ROTATION_GRACE_MS = 10_000;
// Browsers one account can be signed in on at once. Signing in on one more signs
// out the one used least recently, so sessions can't pile up without end.
const MAX_DEVICES = 50;

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const randomToken = (bytes = 48) => crypto.randomBytes(bytes).toString('base64url');

// sid: the sign-in session (refresh token family) the access token belongs to.
function signAccessToken(user, sid) {
  return jwt.sign({ ver: user.tokenVersion, sid }, config.jwt.secret, {
    algorithm: 'HS256',
    subject: String(user._id ?? user.id),
    expiresIn: config.jwt.ttlSeconds,
    issuer: config.jwt.issuer,
    audience: config.jwt.audience,
    jwtid: randomToken(12),
  });
}

function verifyAccessToken(token) {
  try {
    return jwt.verify(token, config.jwt.secret, {
      algorithms: ['HS256'],
      issuer: config.jwt.issuer,
      audience: config.jwt.audience,
    });
  } catch {
    throw AppError.unauthorized('Invalid or expired token', 'TOKEN_INVALID');
  }
}

// Signing out cancels the access token it was sent with, so it stops working at
// once instead of when it expires. Cancelled tokens are kept in Redis until then.
const revokedKey = (jti) => `revoked-at:${jti}`;

async function revokeAccessToken(payload) {
  const ttl = Math.ceil(payload.exp - Date.now() / 1000);
  if (!payload.jti || ttl <= 0) return;
  await redis.set(revokedKey(payload.jti), '1', 'EX', ttl);
}

// Signing out one device (a sign-in session) cancels every access token issued
// to it, the same way, keyed by the session instead of the token.
const revokedSessionKey = (sid) => `revoked-sid:${sid}`;

// Redis being briefly unreachable shouldn't sign everyone out, so a failed check
// is logged and treated as not revoked. Tokens still expire within minutes.
// sid: the sign-in session the token belongs to, if it carries one.
async function isAccessTokenRevoked(jti, sid) {
  if (!jti) return false;
  try {
    const keys = [revokedKey(jti), ...(typeof sid === 'string' ? [revokedSessionKey(sid)] : [])];
    return (await redis.exists(...keys)) > 0;
  } catch (err) {
    logger.warn({ err: err.message }, 'revoked token check failed');
    return false;
  }
}

async function createSession(userId, meta, family = randomToken(16)) {
  const token = randomToken();
  await Session.create({
    user: userId,
    tokenHash: sha256(token),
    family,
    expiresAt: new Date(Date.now() + config.refresh.ttlMs),
    userAgent: (meta.userAgent || '').slice(0, 256),
    ip: (meta.ip || '').slice(0, 64),
    ...(meta.device ? { device: meta.device } : {}),
  });
  return { token, family };
}

/**
 * Atomically consumes a refresh token and issues its successor. Returns
 * { userId, token, family }. Replaying an already-rotated token revokes every session
 * in its family.
 */
async function rotateSession(rawToken, meta) {
  if (typeof rawToken !== 'string' || rawToken.length < 32 || rawToken.length > 128) {
    throw AppError.unauthorized('Session expired', 'REFRESH_INVALID');
  }
  const tokenHash = sha256(rawToken);
  const now = new Date();

  const consumed = await Session.findOneAndUpdate(
    { tokenHash, revokedAt: null, expiresAt: trusted({ $gt: now }) },
    { $set: { revokedAt: now } },
    { returnDocument: 'before' },
  ).lean();

  if (!consumed) {
    const existing = await Session.findOne({ tokenHash }).lean();
    if (existing?.revokedAt) {
      if (now - existing.revokedAt < ROTATION_GRACE_MS) {
        throw AppError.unauthorized('Session refreshed concurrently', 'REFRESH_RACE');
      }
      await Session.updateMany(
        { family: existing.family, revokedAt: null },
        { $set: { revokedAt: now } },
      );
    }
    throw AppError.unauthorized('Session expired', 'REFRESH_INVALID');
  }

  // Still the same browser: it keeps its device.
  const { token } = await createSession(consumed.user, { ...meta, device: consumed.device }, consumed.family);
  return { userId: consumed.user, token, family: consumed.family };
}

async function revokeSession(rawToken) {
  if (typeof rawToken !== 'string' || rawToken.length > 128) return;
  await Session.updateOne(
    { tokenHash: sha256(rawToken), revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );
}

// Ends sign-in sessions (families) at once: their refresh tokens stop working,
// and so do access tokens already issued to them.
async function endFamilies(userId, families) {
  if (!families.length) return;
  await Session.updateMany({ user: userId, family: trusted({ $in: families }), revokedAt: null }, { $set: { revokedAt: new Date() } });
  const pipeline = redis.pipeline();
  for (const f of families) pipeline.set(revokedSessionKey(f), '1', 'EX', config.jwt.ttlSeconds);
  await pipeline.exec();
}

const liveSessions = (userId) => Session.find({ user: userId, revokedAt: null, expiresAt: trusted({ $gt: new Date() }) })
  .sort({ createdAt: -1 }).select('family device userAgent ip createdAt').lean();

// One entry per browser. A browser is its device id (set at sign-in); sessions
// from before device ids existed count as one browser per user agent (their IP
// may have changed since, so it isn't part of it).
function byDevice(live) {
  const groups = new Map();
  for (const s of live) {
    const key = s.device ? `d:${s.device}` : `l:${s.userAgent || ''}`;
    if (!groups.has(key)) groups.set(key, { latest: s, families: [] });
    const g = groups.get(key);
    if (!g.families.includes(s.family)) g.families.push(s.family);
  }
  return [...groups.values()];
}

// The browsers an account is signed in on, most recently active first.
// signedInAt: when that browser signed in; lastActiveAt: its last refresh
// (every few minutes while in use). current: the one asking (currentSid).
async function listSessions(userId, currentSid) {
  const groups = byDevice(await liveSessions(userId));
  const families = groups.flatMap((g) => g.families);
  const firsts = await Session.aggregate([
    { $match: { user: new Types.ObjectId(String(userId)), family: { $in: families } } },
    { $group: { _id: '$family', first: { $min: '$createdAt' } } },
  ]);
  const signedIn = new Map(firsts.map((f) => [f._id, f.first]));
  return groups.map(({ latest, families: fams }) => ({
    id: latest.family,
    userAgent: latest.userAgent || '',
    // IPv4 addresses arrive in IPv6 form (::ffff:203.0.113.5).
    ip: (latest.ip || '').replace(/^::ffff:/, ''),
    signedInAt: new Date(Math.min(...fams.map((f) => (signedIn.get(f) || latest.createdAt).getTime()))).toISOString(),
    lastActiveAt: latest.createdAt.toISOString(),
    current: fams.includes(currentSid),
  }));
}

// Signs out the browser that session `family` belongs to (every session it
// holds). Returns { result: 'done' | 'current' (the browser asking) | 'missing',
// device: that browser's id hash, or null for sessions from before device ids }.
async function signOutDevice(userId, family, currentSid) {
  const group = byDevice(await liveSessions(userId)).find((g) => g.families.includes(family));
  if (!group) return { result: 'missing', device: null };
  const device = group.latest.device || null;
  if (group.families.includes(currentSid)) return { result: 'current', device };
  await endFamilies(userId, group.families);
  return { result: 'done', device };
}

// A browser signing in again: its earlier sessions for this account end, so it
// shows up once in the device list instead of once per sign-in. Sessions from
// before device ids existed can't be told apart, so those from the same kind of
// browser (user agent) end too.
async function replaceDeviceSessions(userId, device, userAgent = '') {
  const families = await Session.distinct('family', {
    user: userId,
    revokedAt: null,
    $or: [{ device }, { device: trusted({ $exists: false }), userAgent: userAgent.slice(0, 256) }],
  });
  await endFamilies(userId, families);
}

// Makes room for one more browser: the least recently used ones beyond the
// limit are signed out. Returns their device id hashes, so the caller can take
// their PIN sign-in away too.
async function trimDevices(userId) {
  const dropped = byDevice(await liveSessions(userId)).slice(MAX_DEVICES - 1);
  await endFamilies(userId, dropped.flatMap((g) => g.families));
  return dropped.map((g) => g.latest.device).filter(Boolean);
}

async function revokeAllSessions(userId) {
  await Session.updateMany({ user: userId, revokedAt: null }, { $set: { revokedAt: new Date() } });
}

module.exports = {
  signAccessToken,
  verifyAccessToken,
  revokeAccessToken,
  isAccessTokenRevoked,
  createSession,
  rotateSession,
  revokeSession,
  revokeAllSessions,
  listSessions,
  signOutDevice,
  replaceDeviceSessions,
  trimDevices,
  MAX_DEVICES,
  randomToken,
  sha256,
};
