'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const Workspace = require('../src/core/models/Workspace');
const User = require('../src/core/models/User');
const Membership = require('../src/core/models/Membership');
const Board = require('../src/apps/boards/models/Board');
const Note = require('../src/apps/notes/models/Note');
const { makeAdmin } = require('../scripts/make-admin');
const {
  setup, teardown, api, registerUser, auth, joinWorkspace, TEST_WORKSPACE,
} = require('./helpers');

// People on a self-hosted install (the test environment's DEFAULT_PLAN).
describe('people and app access', () => {
  let admin;
  let member;
  let workspaceId;
  const signIn = async (email, password) => (await api().post('/api/auth/login').send({ email, password }).expect(200)).body;

  before(async () => {
    await setup();
    admin = await registerUser();
    member = await registerUser();
    await makeAdmin(admin.email);
    workspaceId = String((await Workspace.findOne({ slug: TEST_WORKSPACE }).lean())._id);
  });
  after(teardown);

  it('keeps People to platform admins, and asks for the password before changes', async () => {
    await api().get('/api/admin/people').set(auth(member.token)).expect(403);
    const { body } = await api().get('/api/admin/people').set(auth(admin.token)).expect(200);
    assert.deepEqual(body.apps.map((a) => a.id), ['boards', 'notes', 'office']);
    assert.ok(body.workspaces.some((w) => w.id === workspaceId));
    const me = body.people.find((p) => p.id === admin.user.id);
    assert.deepEqual({ role: me.role, access: me.access, workspaces: me.workspaces }, { role: 'admin', access: {}, workspaces: ['Test'] });
    assert.equal((await api().get('/api/admin/stats').set(auth(admin.token)).expect(200)).body.selfHosted, true);

    const add = await api().post('/api/admin/people').set(auth(admin.token)).send({ name: 'Early', email: 'early@test.dev', workspaceId });
    assert.equal(add.body.error.code, 'REAUTH_REQUIRED');
    await api().post('/api/admin/confirm').set(auth(admin.token)).send({ password: admin.password }).expect(204);
  });

  it('adds someone with a temporary password they must replace first', async () => {
    const { body } = await api().post('/api/admin/people').set(auth(admin.token))
      .send({ name: 'Nia', email: 'NIA@test.dev', workspaceId, access: { notes: 'view', office: 'none', boards: 'edit' } }).expect(201);
    assert.match(body.password, /^([A-Za-z0-9]{4}-){3}[A-Za-z0-9]{4}$/);
    assert.deepEqual(body.person.access, { notes: 'view', office: 'none' });
    assert.equal(body.person.mustChangePassword, true);
    assert.deepEqual(body.person.workspaces, ['Test']);

    const first = await signIn('nia@test.dev', body.password);
    assert.equal(first.user.mustChangePassword, true);
    const locked = await api().get('/api/boards').set(auth(first.accessToken)).expect(403);
    assert.equal(locked.body.error.code, 'PASSWORD_CHANGE_REQUIRED');
    assert.equal((await api().get('/api/auth/me').set(auth(first.accessToken)).expect(200)).body.user.mustChangePassword, true);

    const same = await api().post('/api/auth/change-password').set(auth(first.accessToken)).send({ currentPassword: body.password, newPassword: body.password });
    assert.equal(same.body.error.code, 'SAME_PASSWORD');
    const changed = await api().post('/api/auth/change-password').set(auth(first.accessToken))
      .send({ currentPassword: body.password, newPassword: 'a brand new passphrase' }).expect(200);
    assert.equal(changed.body.user.mustChangePassword, undefined);
    await api().get('/api/boards').set(auth(changed.body.accessToken)).expect(200);

    const dup = await api().post('/api/admin/people').set(auth(admin.token)).send({ name: 'Nia', email: 'nia@test.dev', workspaceId });
    assert.equal(dup.body.error.code, 'EMAIL_TAKEN');
    await api().post('/api/admin/people').set(auth(admin.token)).send({ name: 'X', email: 'x@test.dev', workspaceId: 'aaaaaaaaaaaaaaaaaaaaaaaa' }).expect(404);
    await api().post('/api/admin/people').set(auth(admin.token)).send({ name: 'X', email: 'x@test.dev', workspaceId, access: { mail: 'view' } }).expect(400);
    await api().post('/api/admin/people').set(auth(admin.token)).send({ name: 'X', email: 'x@test.dev', workspaceId, access: { notes: 'write' } }).expect(400);
  });

  it('hides apps with no access and makes view-only apps read-only, on the server', async () => {
    const set = (access) => api().patch(`/api/admin/people/${member.user.id}`).set(auth(admin.token)).send({ access });
    const apps = async () => (await api().get('/api/apps').set(auth(member.token)).expect(200)).body.apps;

    assert.deepEqual((await set({ notes: 'none' }).expect(200)).body.access, { notes: 'none' });
    assert.equal((await api().get('/api/notes').set(auth(member.token)).expect(403)).body.error.code, 'NO_ACCESS');
    assert.deepEqual((await apps()).map((a) => a.id), ['boards', 'office']);

    await set({ notes: 'view' }).expect(200);
    await api().get('/api/notes').set(auth(member.token)).expect(200);
    assert.equal((await api().post('/api/notes').set(auth(member.token)).send({ title: 'Nope' }).expect(403)).body.error.code, 'READ_ONLY');
    assert.equal((await apps()).find((a) => a.id === 'notes').access, 'view');
    const ws = (await api().get('/api/workspace').set(auth(member.token)).expect(200)).body;
    assert.equal(ws.apps.find((a) => a.id === 'notes').access, 'view');
    assert.equal(ws.apps.find((a) => a.id === 'boards').access, 'edit');

    // Changes merge, and setting everything back to edit clears the restrictions.
    assert.deepEqual((await set({ boards: 'view' }).expect(200)).body.access, { notes: 'view', boards: 'view' });
    assert.deepEqual((await set({ notes: 'edit', boards: 'edit' }).expect(200)).body.access, {});
    await api().post('/api/notes').set(auth(member.token)).send({ title: 'Yes' }).expect(201);

    // Platform admins always have full access.
    assert.equal((await api().patch(`/api/admin/people/${admin.user.id}`).set(auth(admin.token)).send({ access: { notes: 'none' } })).body.error.code, 'ADMIN_FULL_ACCESS');
    await set({ notes: 'none' }).expect(200);
    await api().post('/api/notes').set(auth(admin.token)).send({ title: 'Mine' }).expect(201);
    await set({ notes: 'edit' }).expect(200);
    await api().patch(`/api/admin/people/${member.user.id}`).set(auth(member.token)).send({ access: {} }).expect(403);
  });

  it('makes invite links that join a workspace with the chosen access', async () => {
    const { body } = await api().post('/api/admin/people/invite').set(auth(admin.token))
      .send({ workspaceId, access: { office: 'none', notes: 'edit' } }).expect(201);
    assert.equal(body.workspace.slug, TEST_WORKSPACE);
    const joiner = await registerUser({}, { joinTestWorkspace: false });
    await api().post('/api/invites/accept').set(auth(joiner.token, null)).send({ token: body.token }).expect(201);
    assert.equal((await api().get('/api/office/documents').set(auth(joiner.token)).expect(403)).body.error.code, 'NO_ACCESS');
    await api().get('/api/notes').set(auth(joiner.token)).expect(200);
    // Single use by default.
    const late = await registerUser({}, { joinTestWorkspace: false });
    await api().post('/api/invites/accept').set(auth(late.token, null)).send({ token: body.token }).expect(404);
    // Workspace admins' own invite links can't set access.
    await api().post('/api/workspaces').set(auth(admin.token, null)).send({ name: 'Own', slug: 'own-space' }).expect(201);
    await api().post('/api/workspace/invites').set(auth(admin.token, 'own-space')).send({ access: { notes: 'none' } }).expect(400);
  });

  it('resets a password to a new temporary one and signs the person out', async () => {
    const target = await registerUser();
    const { body } = await api().post(`/api/admin/people/${target.user.id}/reset-password`).set(auth(admin.token)).expect(200);
    await api().get('/api/boards').set(auth(target.token)).expect(401);
    await api().post('/api/auth/login').send({ email: target.email, password: target.password }).expect(401);
    assert.equal((await signIn(target.email, body.password)).user.mustChangePassword, true);
    assert.equal((await api().post(`/api/admin/people/${admin.user.id}/reset-password`).set(auth(admin.token))).body.error.code, 'OWN_ACCOUNT');
    await api().post('/api/admin/people/aaaaaaaaaaaaaaaaaaaaaaaa/reset-password').set(auth(admin.token)).expect(404);
  });

  it('disables an account: signed out everywhere, and no way back in until enabled', async () => {
    const target = await registerUser();
    const set = (disabled) => api().patch(`/api/admin/people/${target.user.id}`).set(auth(admin.token)).send({ disabled });
    assert.deepEqual((await set(true).expect(200)).body, { disabled: true });

    await api().get('/api/boards').set(auth(target.token)).expect(401);
    const csrf = target.cookies.csrf;
    await api().post('/api/auth/refresh').set('Cookie', `rt=${target.cookies.rt}; csrf=${csrf}`).set('X-CSRF-Token', csrf).expect(401);
    // Only the right password learns that the account is disabled.
    assert.equal((await api().post('/api/auth/login').send({ email: target.email, password: 'not the password' })).body.error.code, 'BAD_CREDENTIALS');
    assert.equal((await api().post('/api/auth/login').send({ email: target.email, password: target.password }).expect(403)).body.error.code, 'ACCOUNT_DISABLED');
    const listed = (await api().get('/api/admin/people').set(auth(admin.token)).expect(200)).body.people.find((p) => p.id === target.user.id);
    assert.equal(listed.disabled, true);

    await set(false).expect(200);
    const back = await api().post('/api/auth/login').send({ email: target.email, password: target.password }).expect(200);
    await api().get('/api/boards').set(auth(back.body.accessToken)).expect(200);

    assert.equal((await api().patch(`/api/admin/people/${admin.user.id}`).set(auth(admin.token)).send({ disabled: true })).body.error.code, 'ADMIN_FULL_ACCESS');
    await api().patch(`/api/admin/people/${target.user.id}`).set(auth(admin.token)).send({}).expect(400);
  });

  it('deletes an account: boards pass on, private notes go, and no one is left alone', async () => {
    const leaving = await registerUser();
    const board = (await api().post('/api/boards').set(auth(leaving.token)).send({ title: 'Roadmap' }).expect(201)).body.board;
    await api().post('/api/notes').set(auth(leaving.token)).send({ title: 'Private' }).expect(201);
    await api().post('/api/workspaces').set(auth(leaving.token, null)).send({ name: 'Solo', slug: 'solo-space' }).expect(201);

    const alone = await api().delete(`/api/admin/people/${leaving.user.id}`).set(auth(admin.token)).expect(409);
    assert.equal(alone.body.error.code, 'ONLY_MEMBER');
    assert.ok(await User.exists({ _id: leaving.user.id }));

    const partner = await registerUser({}, { joinTestWorkspace: false });
    await joinWorkspace(leaving, 'solo-space', partner);
    await api().delete(`/api/admin/people/${leaving.user.id}`).set(auth(admin.token)).expect(204);

    assert.equal(await User.exists({ _id: leaving.user.id }), null);
    assert.equal(await Membership.countDocuments({ user: leaving.user.id }), 0);
    assert.equal(await Note.countDocuments({ owner: leaving.user.id }).setOptions({ allWorkspaces: true }), 0);
    const kept = await Board.findById(board.id).setOptions({ allWorkspaces: true }).lean();
    assert.ok(kept, 'the board stays');
    assert.ok(!kept.members.some((m) => String(m.user) === leaving.user.id));
    assert.equal(kept.members.filter((m) => m.role === 'owner').length, 1);
    // Solo's only other member takes over as its admin.
    const solo = await Workspace.findOne({ slug: 'solo-space' }).lean();
    assert.equal((await Membership.findOne({ workspace: solo._id, user: partner.user.id }).lean()).role, 'admin');
    await api().post('/api/auth/login').send({ email: leaving.email, password: leaving.password }).expect(401);
    await api().get('/api/boards').set(auth(leaving.token)).expect(401);

    await api().delete(`/api/admin/people/${admin.user.id}`).set(auth(admin.token)).expect(400);
    await api().delete(`/api/admin/people/${leaving.user.id}`).set(auth(admin.token)).expect(404);
  });
});
