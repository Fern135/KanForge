'use strict';

const crypto = require('node:crypto');
const { redis } = require('../db/redis');
const config = require('../config');

// Brute-force protection on top of IP rate limiting:
//  - 5 failures for one email from one IP lock that email+IP pair.
//  - 20 failures for one email from any IP lock the account, which stops
//    distributed guessing.
const PER_ACCOUNT_MAX = 20;

const h = (v) => crypto.createHash('sha256').update(v).digest('hex').slice(0, 32);
const keys = (email, ip) => ({
  pairFail: `lf:p:${h(`${email}|${ip}`)}`,
  acctFail: `lf:a:${h(email)}`,
  pairLock: `ll:p:${h(`${email}|${ip}`)}`,
  acctLock: `ll:a:${h(email)}`,
});

async function isLocked(email, ip) {
  const k = keys(email, ip);
  const [pair, acct] = await redis.mget(k.pairLock, k.acctLock);
  return Boolean(pair || acct);
}

async function registerFailure(email, ip) {
  const { windowSeconds, lockSeconds, maxAttempts } = config.lockout;
  const k = keys(email, ip);
  const [[, pairCount], , [, acctCount]] = await redis
    .multi()
    .incr(k.pairFail)
    .expire(k.pairFail, windowSeconds, 'NX')
    .incr(k.acctFail)
    .expire(k.acctFail, windowSeconds, 'NX')
    .exec();

  const multi = redis.multi();
  if (pairCount >= maxAttempts) multi.set(k.pairLock, '1', 'EX', lockSeconds);
  if (acctCount >= PER_ACCOUNT_MAX) multi.set(k.acctLock, '1', 'EX', lockSeconds);
  await multi.exec();
}

async function clearFailures(email, ip) {
  const k = keys(email, ip);
  await redis.del(k.pairFail, k.pairLock);
}

module.exports = { isLocked, registerFailure, clearFailures };
