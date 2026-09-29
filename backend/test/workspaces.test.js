'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { trusted } = require('mongoose');
const { mongoose } = require('../src/core/db/mongo');
const Board = require('../src/apps/boards/models/Board');
const Note = require('../src/apps/notes/models/Note');
const Workspace = require('../src/core/models/Workspace');
const { runInWorkspace } = require('../src/core/tenancy');
const { setup, teardown, api, registerUser, auth, migrations } = require('./helpers');

describe('workspaces and tenant isolation', () => {
  let alice;
  let bob;
  let carol;
  const as = (u, ws) => ({
    get: (p) => api().get(p).set(auth(u.token, ws)),
    post: (p) => api().post(p).set(auth(u.token, ws)),
    patch: (p) => api().patch(p).set(auth(u.token, ws)),
    del: (p) => api().delete(p).set(auth(u.token, ws)),
  });
  const createWorkspace = async (u, name, slug) =>
    (await as(u, null).post('/api/workspaces').send({ name, slug }).expect(201)).body.workspace;

  before(async () => {
    await setup();
    alice = await registerUser({ name: 'Alice' });
    bob = await registerUser({ name: 'Bob' });
    carol = await registerUser({ name: 'Carol' });
  });
  after(teardown);

  it('creates workspaces with the creator as admin and validates addresses', async () => {
    const acme = await createWorkspace(alice, 'Acme', 'acme');
    assert.equal(acme.role, 'admin');
    assert.equal(acme.plan, 'self-hosted');
    const { workspaces } = (await as(alice, null).get('/api/workspaces').expect(200)).body;
    assert.deepEqual(workspaces.map((w) => w.slug).sort(), ['acme', 'test-space']);

    const taken = await as(bob, null).post('/api/workspaces').send({ name: 'Acme 2', slug: 'ACME' });
    assert.equal(taken.status, 409);
    assert.equal(taken.body.error.code, 'SLUG_TAKEN');
    for (const slug of ['ab', '-acme', 'acme-', 'ac--me', 'ac me', 'a'.repeat(41)]) {
      await as(bob, null).post('/api/workspaces').send({ name: 'X', slug }).expect(400);
    }
  });

  it('requires a workspace the caller belongs to, without revealing others', async () => {
    const none = await as(alice, null).get('/api/boards');
    assert.equal(none.status, 400);
    assert.equal(none.body.error.code, 'WORKSPACE_REQUIRED');
    const foreign = await as(bob, 'acme').get('/api/boards');
    assert.equal(foreign.status, 404);
    assert.equal(foreign.body.error.code, 'WORKSPACE_NOT_FOUND');
    const missing = await as(bob, 'no-such-space').get('/api/boards');
    assert.deepEqual(missing.body, foreign.body);
  });

  it('keeps boards, notes and documents inside their workspace', async () => {
    const { board } = (await as(alice, 'acme').post('/api/boards').send({ title: 'Acme roadmap' }).expect(201)).body;
    const { note } = (await as(alice, 'acme').post('/api/notes').send({ title: 'Acme secrets' }).expect(201)).body;
    const { document } = (await as(alice, 'acme').post('/api/office/documents').send({ kind: 'doc', title: 'Acme plan' }).expect(201)).body;

    // Same person, other workspace: nothing from Acme shows up or can be reached by id.
    assert.equal((await as(alice).get('/api/boards')).body.boards.length, 0);
    assert.equal((await as(alice).get('/api/notes')).body.notes.length, 0);
    assert.equal((await as(alice).get('/api/office/documents')).body.documents.length, 0);
    await as(alice).get(`/api/boards/${board.id}`).expect(404);
    await as(alice).patch(`/api/boards/${board.id}`).send({ title: 'Moved?' }).expect(404);
    await as(alice).get(`/api/notes/${note.id}`).expect(404);
    await as(alice).get(`/api/office/documents/${document.id}`).expect(404);

    // Folder names only clash within one workspace.
    await as(alice, 'acme').post('/api/notes/folders').send({ name: 'Work' }).expect(201);
    await as(alice).post('/api/notes/folders').send({ name: 'Work' }).expect(201);
    await as(alice, 'acme').post('/api/office/folders').send({ name: 'Work' }).expect(201);
    await as(alice).post('/api/office/folders').send({ name: 'Work' }).expect(201);
  });

  it('only lets boards be shared with people in the same workspace', async () => {
    const { board } = (await as(alice, 'acme').post('/api/boards').send({ title: 'Team' }).expect(201)).body;
    const outsider = await as(alice, 'acme').post(`/api/boards/${board.id}/members`).send({ email: bob.email });
    const unknown = await as(alice, 'acme').post(`/api/boards/${board.id}/members`).send({ email: 'nobody@test.dev' });
    assert.equal(outsider.status, 404);
    assert.deepEqual(outsider.body, unknown.body);

    await as(alice, 'acme').post('/api/workspace/members').send({ email: bob.email }).expect(201);
    await as(alice, 'acme').post(`/api/boards/${board.id}/members`).send({ email: bob.email }).expect(201);
    await as(bob, 'acme').get(`/api/boards/${board.id}`).expect(200);
  });

  it('lets admins manage members, and always keeps an admin', async () => {
    const members = (await as(bob, 'acme').get('/api/workspace/members').expect(200)).body.members;
    assert.deepEqual(members.map((m) => [m.name, m.role]), [['Alice', 'admin'], ['Bob', 'member']]);

    await as(bob, 'acme').post('/api/workspace/members').send({ email: carol.email }).expect(403);
    await as(bob, 'acme').patch('/api/workspace').send({ name: 'Mine now' }).expect(403);
    await as(alice, 'acme').post('/api/workspace/members').send({ email: bob.email }).expect(409);
    const unknown = await as(alice, 'acme').post('/api/workspace/members').send({ email: 'nobody@test.dev' });
    assert.equal(unknown.body.error.code, 'USER_NOT_FOUND');

    const last = await as(alice, 'acme').patch(`/api/workspace/members/${alice.user.id}`).send({ role: 'member' });
    assert.equal(last.body.error.code, 'LAST_ADMIN');
    const leave = await as(alice, 'acme').del(`/api/workspace/members/${alice.user.id}`);
    assert.equal(leave.body.error.code, 'LAST_ADMIN');

    await as(alice, 'acme').patch('/api/workspace').send({ name: 'Acme Inc' }).expect(200);
    assert.equal((await as(bob, 'acme').get('/api/workspace')).body.workspace.name, 'Acme Inc');
  });

  it('removes access at once and hands owned boards to the admin', async () => {
    await as(alice, 'acme').post('/api/workspace/members').send({ email: carol.email }).expect(201);
    const { board } = (await as(carol, 'acme').post('/api/boards').send({ title: "Carol's" }).expect(201)).body;

    await as(bob, 'acme').del(`/api/workspace/members/${carol.user.id}`).expect(403);
    await as(alice, 'acme').del(`/api/workspace/members/${carol.user.id}`).expect(204);
    await as(carol, 'acme').get('/api/boards').expect(404);
    const inherited = (await as(alice, 'acme').get(`/api/boards/${board.id}`).expect(200)).body.board;
    assert.deepEqual(inherited.members.map((m) => [m.name, m.role]), [['Alice', 'owner']]);

    // Leaving works for members.
    await as(bob, 'acme').del(`/api/workspace/members/${bob.user.id}`).expect(204);
    await as(bob, 'acme').get('/api/workspace').expect(404);
  });

  it('gates apps by plan, and lets workspace admins turn included apps off', async () => {
    const ws = await Workspace.findOne({ slug: 'acme' });
    await Workspace.updateOne({ _id: ws._id }, { $set: { plan: 'standard' } });

    const office = await as(alice, 'acme').get('/api/office/documents');
    assert.equal(office.status, 403);
    assert.equal(office.body.error.code, 'PLAN_REQUIRED');
    const { apps, locked } = (await as(alice, 'acme').get('/api/apps').expect(200)).body;
    assert.deepEqual(apps.map((a) => a.id), ['boards', 'notes']);
    assert.deepEqual(locked.map((a) => a.id), ['office']);
    assert.deepEqual((await as(alice, 'acme').get('/api/workspace')).body.limits, { maxBoardsPerUser: 100 });
    await as(alice, 'acme').patch('/api/workspace/apps/office').send({ enabled: true }).expect(403);

    await as(alice, 'acme').patch('/api/workspace/apps/notes').send({ enabled: false }).expect(200);
    const off = await as(alice, 'acme').get('/api/notes');
    assert.equal(off.body.error.code, 'APP_DISABLED');
    // Other workspaces aren't affected.
    await as(alice).get('/api/notes').expect(200);
    await as(alice, 'acme').patch('/api/workspace/apps/notes').send({ enabled: true }).expect(200);
    await as(alice, 'acme').patch('/api/workspace/apps/nope').send({ enabled: true }).expect(404);

    await Workspace.updateOne({ _id: ws._id }, { $set: { plan: 'plus' } });
    await as(alice, 'acme').get('/api/office/documents').expect(200);
  });

  it('fails closed when tenant data is touched outside a workspace', async () => {
    await assert.rejects(() => Board.find().lean(), { code: 'NO_WORKSPACE_CONTEXT' });
    await assert.rejects(() => Note.countDocuments(), { code: 'NO_WORKSPACE_CONTEXT' });
    await assert.rejects(() => Board.create({ title: 'Orphan', members: [] }), { code: 'NO_WORKSPACE_CONTEXT' });
    await assert.rejects(() => Board.aggregate([{ $match: {} }]), { code: 'NO_WORKSPACE_CONTEXT' });

    // Inside a workspace, even an unfiltered query only sees that workspace.
    await as(alice).post('/api/boards').send({ title: 'Test-space board' }).expect(201);
    const acme = await Workspace.findOne({ slug: 'acme' }).lean();
    const titles = await runInWorkspace(acme._id, async () => Board.find().distinct('title').exec());
    assert.ok(titles.includes('Acme roadmap'));
    assert.ok(!titles.includes('Test-space board'));
    const everywhere = await Board.find().setOptions({ allWorkspaces: true }).distinct('workspace');
    assert.ok(everywhere.length >= 2);
    // A document can't be saved into another workspace.
    const other = await Board.findOne({ workspace: trusted({ $ne: acme._id }) }).setOptions({ allWorkspaces: true });
    await runInWorkspace(acme._id, async () => {
      other.title = 'Hijacked';
      await assert.rejects(() => other.save(), /another workspace/);
    });
  });

  // Last, because it rolls the workspaces migration back and forward again.
  it('moves an existing install into one "Main" workspace', async () => {
    // An install as it was before workspaces existed.
    const db = mongoose.connection.db;
    const workspacesMigration = migrations.at(-1);
    await db.dropDatabase();
    for (const m of migrations.slice(0, -1)) await m.up(db);
    await db.collection('settings').updateOne({ _id: 'instance' }, { $set: { apps: { office: false } } }, { upsert: true });

    const now = new Date();
    const [admin, user] = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];
    await db.collection('users').insertMany([
      { _id: admin, email: 'a@test.dev', name: 'A', role: 'admin', passwordHash: '$argon2id$x', tokenVersion: 0, createdAt: now, updatedAt: now },
      { _id: user, email: 'u@test.dev', name: 'U', role: 'user', passwordHash: '$argon2id$x', tokenVersion: 0, createdAt: now, updatedAt: now },
    ]);
    await db.collection('boards').insertOne({ title: 'Old board', members: [{ user: admin, role: 'owner' }], labels: [], createdAt: now, updatedAt: now });
    await db.collection('note_folders').insertOne({ owner: user, name: 'Work', nameKey: 'work', parent: null, path: [], createdAt: now, updatedAt: now });

    await workspacesMigration.up(db);

    const main = await db.collection('workspaces').findOne({ slug: 'main' });
    assert.equal(main.plan, 'self-hosted');
    assert.equal(main.autoJoin, true);
    assert.deepEqual(main.apps, { office: false });
    const mainOnly = await db.collection('memberships').distinct('workspace');
    assert.deepEqual(mainOnly.map(String), [String(main._id)]);
    const roleOf = async (id) => (await db.collection('memberships').findOne({ workspace: main._id, user: id }))?.role;
    assert.equal(await roleOf(admin), 'admin');
    assert.equal(await roleOf(user), 'member');
    assert.equal(await db.collection('memberships').countDocuments(), await db.collection('users').countDocuments());
    for (const name of ['boards', 'lists', 'cards', 'notes', 'note_folders', 'office_documents', 'office_folders']) {
      assert.equal(await db.collection(name).countDocuments({ workspace: { $ne: main._id } }), 0, name);
    }
    assert.equal((await db.collection('settings').findOne({ _id: 'instance' })).apps, undefined);

    // New documents without a workspace are rejected by the validator.
    await assert.rejects(() => db.collection('boards').insertOne({ title: 'No workspace', members: [], labels: [] }));

    // Running it again changes nothing.
    await workspacesMigration.up(db);
    assert.equal(await db.collection('workspaces').countDocuments(), 1);
    assert.equal(await db.collection('memberships').countDocuments(), await db.collection('users').countDocuments());

    // And it rolls back.
    await workspacesMigration.down(db);
    assert.equal(await db.collection('boards').countDocuments({ workspace: { $exists: true } }), 0);
    assert.deepEqual((await db.collection('settings').findOne({ _id: 'instance' })).apps, { office: false });
    await db.collection('boards').insertOne({ title: 'No workspace again', members: [], labels: [] });
  });
});
