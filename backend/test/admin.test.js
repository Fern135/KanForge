'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const Workspace = require('../src/core/models/Workspace');
const { makeAdmin } = require('../scripts/make-admin');
const { setup, teardown, api, registerUser, auth, flushRedis } = require('./helpers');

describe('platform admin', () => {
  let admin;
  let member;

  before(async () => {
    await setup();
    admin = await registerUser();
    member = await registerUser();
    await makeAdmin(admin.email);
    await api().post('/api/admin/confirm').set(auth(admin.token)).send({ password: admin.password }).expect(204);
  });
  after(teardown);

  it('never makes anyone admin by signing up, even the first account', async () => {
    assert.equal(admin.res.body.user.role, 'user');
    assert.equal(member.res.body.user.role, 'user');
    assert.equal((await api().get('/api/auth/me').set(auth(member.token)).expect(200)).body.user.role, 'user');
    // The server command made the first admin, and it applies at once.
    assert.equal((await api().get('/api/auth/me').set(auth(admin.token)).expect(200)).body.user.role, 'admin');
  });

  it('keeps the platform admin API to platform admins', async () => {
    await api().get('/api/admin/stats').expect(401);
    for (const path of ['/api/admin/stats', '/api/admin/admins', '/api/admin/workspaces']) {
      await api().get(path).set(auth(member.token)).expect(403);
      await api().get(path).set(auth(admin.token)).expect(200);
    }
    await api().patch('/api/admin/workspaces/aaaaaaaaaaaaaaaaaaaaaaaa').set(auth(member.token)).send({ plan: 'plus' }).expect(403);
    await api().post('/api/admin/admins').set(auth(member.token)).send({ email: member.email }).expect(403);
    // The old server-wide list of every account (with emails) is gone.
    await api().get('/api/admin/users').set(auth(admin.token)).expect(404);
  });

  it('lists workspaces with seat counts only, and sets plans', async () => {
    // Self-hosted workspaces are private: not listed, and their plan can't be changed here.
    const hidden = await Workspace.findOne({ slug: 'test-space' }).lean();
    assert.equal(hidden.plan, 'self-hosted');
    assert.ok(!(await api().get('/api/admin/workspaces').set(auth(admin.token)).expect(200)).body.workspaces.some((w) => w.slug === 'test-space'));
    await api().patch(`/api/admin/workspaces/${hidden._id}`).set(auth(admin.token)).send({ plan: 'plus' }).expect(404);

    await Workspace.updateOne({ _id: hidden._id }, { $set: { plan: 'plus' } });
    const { body } = await api().get('/api/admin/workspaces').set(auth(admin.token)).expect(200);
    const ws = body.workspaces.find((w) => w.slug === 'test-space');
    assert.deepEqual(Object.keys(ws).sort(), ['createdAt', 'id', 'name', 'plan', 'planName', 'seats', 'slug']);
    assert.ok(ws.seats >= 2);

    const { body: changed } = await api().patch(`/api/admin/workspaces/${ws.id}`).set(auth(admin.token)).send({ plan: 'standard' }).expect(200);
    assert.equal(changed.workspace.planName, 'Standard');
    await api().patch(`/api/admin/workspaces/${ws.id}`).set(auth(admin.token)).send({ plan: 'gold' }).expect(400);
    await api().patch(`/api/admin/workspaces/${ws.id}`).set(auth(admin.token)).send({}).expect(400);
    await api().patch(`/api/admin/workspaces/${ws.id}`).set(auth(admin.token)).send({ plan: 'self-hosted' }).expect(400);
    // Auto-join is gone: people join through invite links.
    await api().patch(`/api/admin/workspaces/${ws.id}`).set(auth(admin.token)).send({ autoJoin: true }).expect(400);
  });

  it('asks for the password again before changes, per sign-in session', async () => {
    // A second sign-in of the same admin (another device, or a stolen session) can look but not change.
    const other = await api().post('/api/auth/login').send({ email: admin.email, password: admin.password }).expect(200);
    const token = other.body.accessToken;
    const ws = (await api().get('/api/admin/workspaces').set(auth(token)).expect(200)).body.workspaces[0];
    const change = () => api().patch(`/api/admin/workspaces/${ws.id}`).set(auth(token)).send({ plan: ws.plan });
    assert.equal((await change()).body.error.code, 'REAUTH_REQUIRED');
    assert.equal((await api().post('/api/admin/admins').set(auth(token)).send({ email: member.email })).body.error.code, 'REAUTH_REQUIRED');
    assert.equal((await api().delete(`/api/admin/admins/${admin.user.id}`).set(auth(token))).body.error.code, 'REAUTH_REQUIRED');

    const wrong = await api().post('/api/admin/confirm').set(auth(token)).send({ password: 'not my password' });
    assert.equal(wrong.body.error.code, 'BAD_CREDENTIALS');
    await change().expect(403);
    await api().post('/api/admin/confirm').set(auth(member.token)).send({ password: member.password }).expect(403);

    await api().post('/api/admin/confirm').set(auth(token)).send({ password: admin.password }).expect(204);
    await change().expect(200);
  });

  it('locks the password prompt against guesses from many addresses', async () => {
    const lone = await registerUser();
    await makeAdmin(lone.email);
    for (let ip = 1; ip <= 4; ip += 1) {
      for (let i = 0; i < 5; i += 1) {
        await api().post('/api/admin/confirm').set(auth(lone.token)).set('X-Forwarded-For', `203.0.113.${ip}`)
          .send({ password: 'wrong password!!' }).expect(400);
      }
    }
    const res = await api().post('/api/admin/confirm').set(auth(lone.token)).set('X-Forwarded-For', '198.51.100.20').send({ password: lone.password });
    assert.equal(res.body.error.code, 'LOCKED');
    // Clears the lockout (and the main admin's confirmation with it, so confirm again).
    await flushRedis();
    await api().post('/api/admin/confirm').set(auth(admin.token)).send({ password: admin.password }).expect(204);
    await api().delete(`/api/admin/admins/${lone.user.id}`).set(auth(admin.token)).expect(204);
  });

  it('lists only admins by name, adds them by email and never removes the last one', async () => {
    const list = async () => (await api().get('/api/admin/admins').set(auth(admin.token)).expect(200)).body.admins;
    assert.deepEqual((await list()).map((a) => a.email), [admin.email]);
    assert.deepEqual(Object.keys((await list())[0]).sort(), ['createdAt', 'email', 'id', 'name']);

    const added = (await api().post('/api/admin/admins').set(auth(admin.token)).send({ email: member.email.toUpperCase() }).expect(201)).body.admin;
    assert.equal(added.id, member.user.id);
    await api().get('/api/admin/stats').set(auth(member.token)).expect(200);
    assert.equal((await api().post('/api/admin/admins').set(auth(admin.token)).send({ email: member.email })).body.error.code, 'ALREADY_ADMIN');
    assert.equal((await api().post('/api/admin/admins').set(auth(admin.token)).send({ email: 'nobody@test.dev' })).body.error.code, 'USER_NOT_FOUND');
    await api().post('/api/admin/admins').set(auth(admin.token)).send({ email: 'not an email' }).expect(400);

    await api().delete(`/api/admin/admins/${member.user.id}`).set(auth(admin.token)).expect(204);
    await api().get('/api/admin/stats').set(auth(member.token)).expect(403);
    await api().delete(`/api/admin/admins/${member.user.id}`).set(auth(admin.token)).expect(404);

    const last = await api().delete(`/api/admin/admins/${admin.user.id}`).set(auth(admin.token));
    assert.equal(last.status, 409);
    assert.equal(last.body.error.code, 'LAST_ADMIN');
    await api().get('/api/admin/workspaces').set(auth(admin.token)).expect(200);
    await api().delete('/api/admin/admins/bad-id').set(auth(admin.token)).expect(400);
  });

  it('makes admins from the command line only for existing accounts', async () => {
    await assert.rejects(() => makeAdmin('nobody@test.dev'), /No account uses nobody@test.dev/);
    await assert.rejects(() => makeAdmin(''), /Usage/);
    const later = await registerUser();
    const made = await makeAdmin(`  ${later.email.toUpperCase()} `);
    assert.equal(made.role, 'admin');
    await api().get('/api/admin/workspaces').set(auth(later.token)).expect(200);
  });
});
