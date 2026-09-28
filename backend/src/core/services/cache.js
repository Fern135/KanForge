'use strict';

const { redis } = require('../db/redis');
const logger = require('../utils/logger');

const USER_TTL = 300;
const userKey = (id) => `user:${id}`;

// The cache is an accelerator only. A Redis failure must never fail a request,
// so every call degrades to a miss.
async function safe(fn, fallback = null) {
  try {
    return await fn();
  } catch (err) {
    logger.warn({ err: err.message }, 'cache operation failed');
    return fallback;
  }
}

async function getJSON(key) {
  const raw = await safe(() => redis.get(key));
  return raw ? JSON.parse(raw) : null;
}

const setJSON = (key, value, ttl) => safe(() => redis.set(key, JSON.stringify(value), 'EX', ttl));
const del = (key) => safe(() => redis.del(key));

module.exports = {
  getJSON,
  setJSON,
  del,

  getUser: (id) => getJSON(userKey(id)),
  setUser: (id, user) => setJSON(userKey(id), user, USER_TTL),
  invalidateUser: (id) => del(userKey(id)),
};
