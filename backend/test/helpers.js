'use strict';

const request = require('supertest');
const config = require('../src/core/config');
const { connectMongo, disconnectMongo, mongoose } = require('../src/core/db/mongo');
const { redis, connectRedis, disconnectRedis } = require('../src/core/db/redis');
const { createApp } = require('../src/app');
const Workspace = require('../src/core/models/Workspace');
const migrations = [
  require('../migrations/20260926000001-initial-schema'),
  require('../migrations/20260927000001-card-checklist-settings'),
  require('../migrations/20260928000001-user-security-pin'),
  require('../migrations/20260928000002-pin-devices'),
  require('../migrations/20260928000003-admin-and-settings'),
  require('../migrations/20260929000001-notes'),
  require('../migrations/20260929000002-note-folders'),
  require('../migrations/20260930000001-office'),
  require('../migrations/20261001000001-workspaces'),
];

if (!config.isTest || !new URL(config.mongoUri).pathname.endsWith('_test')) {
  throw new Error('Tests must run with NODE_ENV=test against a *_test database');
}

let app;

// Every test account joins this workspace (it auto-joins sign-ups), and auth()
// sends it by default, so app tests run inside a workspace like the real client.
const TEST_WORKSPACE = 'test-space';

async function setup() {
  await Promise.all([connectMongo(), connectRedis()]);
  await mongoose.connection.db.dropDatabase();
  for (const m of migrations) await m.up(mongoose.connection.db);
  await flushRedis();
  await Workspace.create({ name: 'Test', slug: TEST_WORKSPACE, plan: 'self-hosted', autoJoin: true });
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

// workspace: a slug to send in X-Workspace, or null to send none.
const auth = (token, workspace = TEST_WORKSPACE) => ({
  Authorization: `Bearer ${token}`,
  ...(workspace ? { 'X-Workspace': workspace } : {}),
});

module.exports = { setup, teardown, api, registerUser, auth, cookiesFrom, flushRedis, migrations, TEST_WORKSPACE };
