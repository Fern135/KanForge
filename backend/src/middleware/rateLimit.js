'use strict';

const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const { redis } = require('../db/redis');

const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Keys by the signed-in user, so people sharing an IP don't share a budget.
const perUser = (req) => (req.user ? `u:${req.user.id}` : `ip:${ipKeyGenerator(req.ip)}`);

// Limits are stored in Redis so they hold across API replicas and restarts.
// `memory: true` keeps the counters in process instead, for endpoints that
// must keep answering when Redis is down (health checks).
function limiter({ prefix, windowMs, limit, message, memory = false, ...options }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    ...options,
    ...(memory ? {} : {
      store: new RedisStore({
        prefix: `rl:${prefix}:`,
        sendCommand: (command, ...args) => redis.call(command, ...args),
      }),
    }),
    handler: (_req, res) => {
      res.status(429).json({ error: { code: 'RATE_LIMITED', message } });
    },
  });
}

const createLimiters = () => ({
  health: limiter({
    prefix: 'health',
    memory: true,
    windowMs: 60_000,
    limit: 60,
    message: 'Too many requests, slow down.',
  }),
  api: limiter({
    prefix: 'api',
    windowMs: 60_000,
    limit: 600,
    message: 'Too many requests, slow down.',
  }),
  auth: limiter({
    prefix: 'auth',
    windowMs: 15 * 60_000,
    limit: 30,
    message: 'Too many authentication attempts. Try again later.',
  }),
  refresh: limiter({
    prefix: 'refresh',
    windowMs: 60_000,
    limit: 30,
    message: 'Too many refresh attempts.',
  }),
  // Board changes per user. Reads are left to the global limit.
  writes: limiter({
    prefix: 'writes',
    windowMs: 60_000,
    limit: 300,
    keyGenerator: perUser,
    skip: (req) => READS.has(req.method),
    message: 'Too many changes, slow down.',
  }),
  bulk: limiter({
    prefix: 'bulk',
    windowMs: 15 * 60_000,
    limit: 30,
    keyGenerator: perUser,
    message: 'Too many imports. Try again in a few minutes.',
  }),
  sensitive: limiter({
    prefix: 'sensitive',
    windowMs: 60 * 60_000,
    limit: 60,
    message: 'Too many requests for this action. Try again later.',
  }),
});

module.exports = { createLimiters };
