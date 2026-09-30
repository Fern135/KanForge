'use strict';

const argon2 = require('argon2');
const lockout = require('./lockout');
const AppError = require('../utils/AppError');
const { audit } = require('../utils/audit');

// Checks the signed-in person's password when an action asks for it again
// (changing the password or PIN, platform admin changes). Wrong guesses count
// towards the whole-account lockout, as with sign-in: whoever is asking already
// holds a session, which is the case this guards against.
// user: the User document, loaded with +passwordHash.
async function verifyCurrentPassword(req, user, password) {
  if (await lockout.isLocked(user.email, req.ip)) {
    audit(req, 'reauth.locked');
    throw AppError.tooMany('Too many failed attempts. Try again in 15 minutes.', 'LOCKED');
  }
  if (!(await argon2.verify(user.passwordHash, password))) {
    audit(req, 'reauth.failed');
    await lockout.registerFailure(user.email, req.ip);
    throw AppError.badRequest('Password is incorrect', 'BAD_CREDENTIALS');
  }
  await lockout.clearFailures(user.email, req.ip);
}

module.exports = { verifyCurrentPassword };
