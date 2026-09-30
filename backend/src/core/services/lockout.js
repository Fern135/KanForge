'use strict';

const crypto = require('node:crypto');
const { redis } = require('../db/redis');
const config = require('../config');

// Brute-force protection on top of IP rate limiting:
//  - 5 failures for one email from one IP lock that email+IP pair.
//  - 20 failures for one email from any IP lock the account, which stops
//    distributed guessing.
// PIN sign-in is counted separately and locks the account sooner, because a
// PIN has far fewer possible values than a password.
// The account-wide lock doesn't apply to a browser that has signed in to the
// account before (knownDevice), so strangers failing on purpose can't lock the
// owner out of their usual devices. The email+IP lock still applies to everyone.
const SCOPES = {
  password: { prefix: '', accountMax: 20 },
  pin: { prefix: 'pin:', accountMax: 10 },
};

const h = (v) => crypto.createHash('sha256').update(v).digest('hex').slice(0, 32);
const keys = (email, ip, scope) => {
  const { prefix } = SCOPES[scope];
  return {
    pairFail: `lf:${prefix}p:${h(`${email}|${ip}`)}`,
    acctFail: `lf:${prefix}a:${h(email)}`,
    pairLock: `ll:${prefix}p:${h(`${email}|${ip}`)}`,
    acctLock: `ll:${prefix}a:${h(email)}`,
  };
};

async function isLocked(email, ip, scope = 'password', { knownDevice = false } = {}) {
  const k = keys(email, ip, scope);
  const [pair, acct] = await redis.mget(k.pairLock, k.acctLock);
  return Boolean(pair || (acct && !knownDevice));
}

async function registerFailure(email, ip, scope = 'password') {
  const { windowSeconds, lockSeconds, maxAttempts } = config.lockout;
  const k = keys(email, ip, scope);
  const [[, pairCount], , [, acctCount]] = await redis
    .multi()
    .incr(k.pairFail)
    .expire(k.pairFail, windowSeconds, 'NX')
    .incr(k.acctFail)
    .expire(k.acctFail, windowSeconds, 'NX')
    .exec();

  const multi = redis.multi();
  if (pairCount >= maxAttempts) multi.set(k.pairLock, '1', 'EX', lockSeconds);
  if (acctCount >= SCOPES[scope].accountMax) multi.set(k.acctLock, '1', 'EX', lockSeconds);
  await multi.exec();
}

async function clearFailures(email, ip, scope = 'password') {
  const k = keys(email, ip, scope);
  await redis.del(k.pairFail, k.pairLock);
}

module.exports = { isLocked, registerFailure, clearFailures };
