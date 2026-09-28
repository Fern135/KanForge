'use strict';

const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { trusted } = require('mongoose');
const config = require('../config');
const Session = require('../models/Session');
const AppError = require('../utils/AppError');

// Two tabs refreshing at the same moment would otherwise look like token theft.
// A token rotated within this window is rejected, but it doesn't revoke the family.
const ROTATION_GRACE_MS = 10_000;

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const randomToken = (bytes = 48) => crypto.randomBytes(bytes).toString('base64url');

function signAccessToken(user) {
  return jwt.sign({ ver: user.tokenVersion }, config.jwt.secret, {
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

async function createSession(userId, meta, family = randomToken(16)) {
  const token = randomToken();
  await Session.create({
    user: userId,
    tokenHash: sha256(token),
    family,
    expiresAt: new Date(Date.now() + config.refresh.ttlMs),
    userAgent: (meta.userAgent || '').slice(0, 256),
    ip: (meta.ip || '').slice(0, 64),
  });
  return token;
}

/**
 * Atomically consumes a refresh token and issues its successor. Returns
 * { userId, token }. Replaying an already-rotated token revokes every session
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
    { new: false },
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

  const token = await createSession(consumed.user, meta, consumed.family);
  return { userId: consumed.user, token };
}

async function revokeSession(rawToken) {
  if (typeof rawToken !== 'string' || rawToken.length > 128) return;
  await Session.updateOne(
    { tokenHash: sha256(rawToken), revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );
}

async function revokeAllSessions(userId) {
  await Session.updateMany({ user: userId, revokedAt: null }, { $set: { revokedAt: new Date() } });
}

module.exports = {
  signAccessToken,
  verifyAccessToken,
  createSession,
  rotateSession,
  revokeSession,
  revokeAllSessions,
  randomToken,
  sha256,
};
