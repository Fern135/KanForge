'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const Invite = require('../src/core/models/Invite');
const { mongoose } = require('../src/core/db/mongo');
const { setup, teardown, api, registerUser, auth, joinWorkspace } = require('./helpers');

describe('invite links', () => {
  let owner;
  let member;
  let stranger;
  const as = (u, ws = null) => ({
    get: (p) => api().get(p).set(auth(u.token, ws)),
    post: (p) => api().post(p).set(auth(u.token, ws)),
    del: (p) => api().delete(p).set(auth(u.token, ws)),
  });
  const createInvite = async (body = {}) => (await as(owner, 'crew').post('/api/workspace/invites').send(body).expect(201)).body;

  before(async () => {
    await setup();
    owner = await registerUser({}, { joinTestWorkspace: false });
    member = await registerUser({}, { joinTestWorkspace: false });
    stranger = await registerUser({}, { joinTestWorkspace: false });
    await as(owner).post('/api/workspaces').send({ name: 'Crew', slug: 'crew' }).expect(201);
    await joinWorkspace(owner, 'crew', member);
  });
  after(teardown);

  it('puts a new sign-up in no workspace', async () => {
    const { workspaces } = (await as(stranger).get('/api/workspaces').expect(200)).body;
    assert.deepEqual(workspaces, []);
  });

  it('has no way to add people directly by email', async () => {
    for (const email of [stranger.email, 'nobody@test.dev']) {
      await as(owner, 'crew').post('/api/workspace/members').send({ email }).expect(404);
    }
    await as(stranger, 'crew').get('/api/workspace').expect(404);
  });

  it('lets only workspace admins create, list and revoke links, and stores only a hash', async () => {
    await as(member, 'crew').post('/api/workspace/invites').send({}).expect(403);
    await as(member, 'crew').get('/api/workspace/invites').expect(403);

    const { invite, token } = await createInvite({ expiresInDays: 3, maxUses: 5 });
    assert.match(token, /^[A-Za-z0-9_-]{32}$/);
    assert.deepEqual({ role: invite.role, maxUses: invite.maxUses, uses: invite.uses }, { role: 'member', maxUses: 5, uses: 0 });
    const stored = await Invite.findById(invite.id).lean();
    assert.notEqual(stored.tokenHash, token);
    assert.ok(!JSON.stringify(stored).includes(token));

    const { invites } = (await as(owner, 'crew').get('/api/workspace/invites').expect(200)).body;
    assert.deepEqual(invites.map((i) => i.id), [invite.id]);
    assert.ok(!JSON.stringify(invites).includes(token), 'the token is only shown once');

    await as(owner, 'crew').post('/api/workspace/invites').send({ expiresInDays: 31 }).expect(400);
    await as(owner, 'crew').post('/api/workspace/invites').send({ role: 'owner' }).expect(400);
    await as(owner, 'crew').del(`/api/workspace/invites/${invite.id}`).expect(204);
    await as(owner, 'crew').del(`/api/workspace/invites/${invite.id}`).expect(404);
  });

  it('joins a workspace through a link, with the link\'s role', async () => {
    const { token } = await createInvite({ role: 'admin' });
    await api().post('/api/invites/preview').send({ token }).expect(401);

    const preview = (await as(stranger).post('/api/invites/preview').send({ token }).expect(200)).body;
    assert.deepEqual(preview, { workspace: { name: 'Crew', slug: 'crew' }, role: 'admin', member: false });
    await as(stranger, 'crew').get('/api/workspace').expect(404);

    const joined = (await as(stranger).post('/api/invites/accept').send({ token }).expect(201)).body.workspace;
    assert.deepEqual({ slug: joined.slug, role: joined.role }, { slug: 'crew', role: 'admin' });
    await as(stranger, 'crew').get('/api/workspace').expect(200);

    // Accepting again is harmless and doesn't use the link up.
    await as(stranger).post('/api/invites/accept').send({ token }).expect(200);
    assert.equal((await Invite.findOne({}).sort({ createdAt: -1 }).lean()).uses, 1);
    await as(owner, 'crew').del(`/api/workspace/members/${stranger.user.id}`).expect(204);
  });

  it('refuses unknown, revoked, expired and used-up links alike', async () => {
    const check = async (token) => {
      const res = await as(stranger).post('/api/invites/accept').send({ token });
      assert.equal(res.status, 404);
      assert.equal(res.body.error.code, 'INVITE_INVALID');
      await as(stranger).post('/api/invites/preview').send({ token }).expect(404);
    };
    await check('x'.repeat(32));
    await check('not-a-token');

    const revoked = await createInvite();
    await as(owner, 'crew').del(`/api/workspace/invites/${revoked.invite.id}`).expect(204);
    await check(revoked.token);

    const expired = await createInvite();
    await Invite.updateOne({ _id: expired.invite.id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    await check(expired.token);

    const once = await createInvite({ maxUses: 1 });
    await as(stranger).post('/api/invites/accept').send({ token: once.token }).expect(201);
    const latecomer = await registerUser({}, { joinTestWorkspace: false });
    const res = await as(latecomer).post('/api/invites/accept').send({ token: once.token });
    assert.equal(res.body.error.code, 'INVITE_INVALID');
    await as(latecomer, 'crew').get('/api/workspace').expect(404);
  });

  it('never lets a single-use link in twice, even when used at the same moment', async () => {
    const { token } = await createInvite({ maxUses: 1 });
    const people = await Promise.all([1, 2, 3].map(() => registerUser({}, { joinTestWorkspace: false })));
    const results = await Promise.all(people.map((p) => as(p).post('/api/invites/accept').send({ token })));
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 404, 404]);
  });

  it('stops links working once the admin who made them is demoted or removed', async () => {
    const second = await registerUser({}, { joinTestWorkspace: false });
    await joinWorkspace(owner, 'crew', second, 'admin');
    const make = async () => (await as(second, 'crew').post('/api/workspace/invites').send({}).expect(201)).body.token;
    const ownersLink = (await createInvite()).token;

    const beforeDemotion = await make();
    await api().patch(`/api/workspace/members/${second.user.id}`).set(auth(owner.token, 'crew')).send({ role: 'member' }).expect(200);
    const late = await registerUser({}, { joinTestWorkspace: false });
    assert.equal((await as(late).post('/api/invites/accept').send({ token: beforeDemotion })).body.error.code, 'INVITE_INVALID');

    await api().patch(`/api/workspace/members/${second.user.id}`).set(auth(owner.token, 'crew')).send({ role: 'admin' }).expect(200);
    const beforeRemoval = await make();
    await as(owner, 'crew').del(`/api/workspace/members/${second.user.id}`).expect(204);
    assert.equal((await as(late).post('/api/invites/accept').send({ token: beforeRemoval })).body.error.code, 'INVITE_INVALID');

    // Links other admins made keep working.
    await as(late).post('/api/invites/accept').send({ token: ownersLink }).expect(201);
  });

  it('turns auto-join off on existing installs, and rolls back', async () => {
    const migration = require('../migrations/20261002000001-invites');
    const workspaces = mongoose.connection.db.collection('workspaces');
    await workspaces.insertOne({ name: 'Main', slug: 'main', plan: 'self-hosted', autoJoin: true, createdAt: new Date(), updatedAt: new Date() });
    await migration.up(mongoose.connection.db);
    assert.equal(await workspaces.countDocuments({ autoJoin: { $exists: true } }), 0);
    await migration.down(mongoose.connection.db);
    assert.equal((await workspaces.findOne({ slug: 'main' })).autoJoin, true);
    await migration.up(mongoose.connection.db);
    assert.equal(await workspaces.countDocuments({ autoJoin: { $exists: true } }), 0);
  });
});
