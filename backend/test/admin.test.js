'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const User = require('../src/core/models/User');
const Settings = require('../src/core/models/Settings');
const { setup, teardown, api, registerUser, auth } = require('./helpers');

describe('admin and apps', () => {
  let admin;
  let member;

  before(async () => {
    await setup();
    admin = await registerUser();
    member = await registerUser();
  });
  after(teardown);

  it('makes the first account admin and nobody after it', async () => {
    assert.equal(admin.res.body.user.role, 'admin');
    assert.equal(member.res.body.user.role, 'user');
    const me = await api().get('/api/auth/me').set(auth(member.token)).expect(200);
    assert.equal(me.body.user.role, 'user');
  });

  it('keeps the admin API to admins', async () => {
    await api().get('/api/admin/apps').expect(401);
    await api().get('/api/admin/apps').set(auth(member.token)).expect(403);
    await api().patch('/api/admin/apps/boards').set(auth(member.token)).send({ enabled: false }).expect(403);
    await api().get('/api/admin/users').set(auth(member.token)).expect(403);
    await api().get('/api/admin/users').set(auth(admin.token)).expect(200);
  });

  it('turns an app off for everyone, and back on', async () => {
    const listed = await api().get('/api/apps').set(auth(member.token)).expect(200);
    assert.deepEqual(listed.body.apps.map((a) => a.id), ['boards', 'notes', 'office']);

    const off = await api().patch('/api/admin/apps/boards').set(auth(admin.token)).send({ enabled: false }).expect(200);
    assert.equal(off.body.apps.find((a) => a.id === 'boards').enabled, false);
    const blocked = await api().get('/api/boards').set(auth(member.token));
    assert.equal(blocked.status, 404);
    assert.equal(blocked.body.error.code, 'APP_DISABLED');
    assert.deepEqual((await api().get('/api/apps').set(auth(member.token))).body.apps.map((a) => a.id), ['notes', 'office']);

    await api().patch('/api/admin/apps/boards').set(auth(admin.token)).send({ enabled: true }).expect(200);
    await api().get('/api/boards').set(auth(member.token)).expect(200);
  });

  it('validates app changes', async () => {
    await api().patch('/api/admin/apps/nope').set(auth(admin.token)).send({ enabled: false }).expect(404);
    await api().patch('/api/admin/apps/boards').set(auth(admin.token)).send({ enabled: 'no' }).expect(400);
    await api().patch('/api/admin/apps/boards').set(auth(admin.token)).send({ enabled: true, extra: 1 }).expect(400);
  });

  it('promotes and demotes, and never removes the last admin', async () => {
    await api().patch(`/api/admin/users/${member.res.body.user.id}`).set(auth(admin.token)).send({ role: 'admin' }).expect(200);
    await api().get('/api/admin/apps').set(auth(member.token)).expect(200);

    await api().patch(`/api/admin/users/${member.res.body.user.id}`).set(auth(admin.token)).send({ role: 'user' }).expect(200);
    await api().get('/api/admin/apps').set(auth(member.token)).expect(403);

    const last = await api().patch(`/api/admin/users/${admin.res.body.user.id}`).set(auth(admin.token)).send({ role: 'user' });
    assert.equal(last.status, 409);
    assert.equal(last.body.error.code, 'LAST_ADMIN');
    await api().get('/api/admin/apps').set(auth(admin.token)).expect(200);

    await api().patch('/api/admin/users/bad-id').set(auth(admin.token)).send({ role: 'user' }).expect(400);
    await api().patch('/api/admin/users/aaaaaaaaaaaaaaaaaaaaaaaa').set(auth(admin.token)).send({ role: 'user' }).expect(404);
    await api().patch(`/api/admin/users/${member.res.body.user.id}`).set(auth(admin.token)).send({ role: 'owner' }).expect(400);
  });

  it('gives admin to exactly one of two sign-ups racing on a new install', async () => {
    await Settings.deleteMany({});
    await User.updateMany({}, { $set: { role: 'user' } });
    const [a, b] = await Promise.all([registerUser(), registerUser()]);
    const roles = [a.res.body.user.role, b.res.body.user.role].sort();
    assert.deepEqual(roles, ['admin', 'user']);
  });
});
