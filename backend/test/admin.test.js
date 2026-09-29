'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const User = require('../src/core/models/User');
const Settings = require('../src/core/models/Settings');
const { setup, teardown, api, registerUser, auth } = require('./helpers');

describe('platform admin', () => {
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

  it('keeps the platform admin API to platform admins', async () => {
    await api().get('/api/admin/users').expect(401);
    await api().get('/api/admin/users').set(auth(member.token)).expect(403);
    await api().get('/api/admin/workspaces').set(auth(member.token)).expect(403);
    await api().patch('/api/admin/workspaces/aaaaaaaaaaaaaaaaaaaaaaaa').set(auth(member.token)).send({ plan: 'plus' }).expect(403);
    await api().get('/api/admin/users').set(auth(admin.token)).expect(200);
  });

  it('lists workspaces with seat counts only, and sets plans and auto-join', async () => {
    const { body } = await api().get('/api/admin/workspaces').set(auth(admin.token)).expect(200);
    const ws = body.workspaces.find((w) => w.slug === 'test-space');
    assert.deepEqual(Object.keys(ws).sort(), ['autoJoin', 'createdAt', 'id', 'name', 'plan', 'planName', 'seats', 'slug']);
    assert.ok(ws.seats >= 2);

    const { body: changed } = await api().patch(`/api/admin/workspaces/${ws.id}`).set(auth(admin.token)).send({ plan: 'standard' }).expect(200);
    assert.equal(changed.workspace.planName, 'Standard');
    await api().patch(`/api/admin/workspaces/${ws.id}`).set(auth(admin.token)).send({ plan: 'gold' }).expect(400);
    await api().patch(`/api/admin/workspaces/${ws.id}`).set(auth(admin.token)).send({}).expect(400);
    await api().patch(`/api/admin/workspaces/${ws.id}`).set(auth(admin.token)).send({ plan: 'self-hosted' }).expect(200);

    // With auto-join off, new sign-ups start with no workspace.
    await api().patch(`/api/admin/workspaces/${ws.id}`).set(auth(admin.token)).send({ autoJoin: false }).expect(200);
    const loner = await registerUser();
    const { body: mine } = await api().get('/api/workspaces').set(auth(loner.token, null)).expect(200);
    assert.deepEqual(mine.workspaces, []);
    await api().patch(`/api/admin/workspaces/${ws.id}`).set(auth(admin.token)).send({ autoJoin: true }).expect(200);
  });

  it('promotes and demotes, and never removes the last admin', async () => {
    await api().patch(`/api/admin/users/${member.res.body.user.id}`).set(auth(admin.token)).send({ role: 'admin' }).expect(200);
    await api().get('/api/admin/workspaces').set(auth(member.token)).expect(200);

    await api().patch(`/api/admin/users/${member.res.body.user.id}`).set(auth(admin.token)).send({ role: 'user' }).expect(200);
    await api().get('/api/admin/workspaces').set(auth(member.token)).expect(403);

    const last = await api().patch(`/api/admin/users/${admin.res.body.user.id}`).set(auth(admin.token)).send({ role: 'user' });
    assert.equal(last.status, 409);
    assert.equal(last.body.error.code, 'LAST_ADMIN');
    await api().get('/api/admin/workspaces').set(auth(admin.token)).expect(200);

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
