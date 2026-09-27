'use strict';

const { rateLimit } = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const { redis } = require('../db/redis');

// Limits are stored in Redis so they hold across API replicas and restarts.
function limiter({ prefix, windowMs, limit, message }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    store: new RedisStore({
      prefix: `rl:${prefix}:`,
      sendCommand: (command, ...args) => redis.call(command, ...args),
    }),
    handler: (_req, res) => {
      res.status(429).json({ error: { code: 'RATE_LIMITED', message } });
    },
  });
}

const createLimiters = () => ({
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
  sensitive: limiter({
    prefix: 'sensitive',
    windowMs: 60 * 60_000,
    limit: 60,
    message: 'Too many requests for this action. Try again later.',
  }),
});

module.exports = { createLimiters };
