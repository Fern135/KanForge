'use strict';

const request = require('supertest');
const config = require('../src/config');
const { connectMongo, disconnectMongo, mongoose } = require('../src/db/mongo');
const { redis, connectRedis, disconnectRedis } = require('../src/db/redis');
const { createApp } = require('../src/app');
const migrations = [
  require('../migrations/20260926000001-initial-schema'),
  require('../migrations/20260927000001-card-checklist-settings'),
  require('../migrations/20260928000001-user-security-pin'),
  require('../migrations/20260928000002-pin-devices'),
];

if (!config.isTest || !new URL(config.mongoUri).pathname.endsWith('_test')) {
  throw new Error('Tests must run with NODE_ENV=test against a *_test database');
}

let app;

async function setup() {
  await Promise.all([connectMongo(), connectRedis()]);
  await mongoose.connection.db.dropDatabase();
  for (const m of migrations) await m.up(mongoose.connection.db);
  await flushRedis();
  app = createApp();
  return app;
}

// FLUSHDB is blocked by the Redis ACL, so delete keys with SCAN instead.
async function flushRedis() {
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'COUNT', 500);
    if (keys.length) await redis.del(...keys);
    cursor = next;
  } while (cursor !== '0');
}

async function teardown() {
  await Promise.allSettled([disconnectMongo(), disconnectRedis()]);
}

const api = () => request(app);

function cookiesFrom(res) {
  const out = {};
  for (const c of res.headers['set-cookie'] || []) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    out[pair.slice(0, i)] = pair.slice(i + 1);
  }
  return out;
}

let counter = 0;
async function registerUser(overrides = {}) {
  counter += 1;
  const creds = {
    email: `user${counter}-${Date.now()}@test.dev`,
    name: `User ${counter}`,
    password: 'correct horse battery staple',
    ...overrides,
  };
  const res = await api().post('/api/auth/register').send(creds).expect(201);
  return { ...creds, token: res.body.accessToken, user: res.body.user, cookies: cookiesFrom(res), res };
}

const auth = (token) => ({ Authorization: `Bearer ${token}` });

module.exports = { setup, teardown, api, registerUser, auth, cookiesFrom, flushRedis };
