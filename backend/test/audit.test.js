'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { auditLog } = require('../src/core/utils/audit');
const { setup, teardown, api, registerUser, auth, flushRedis } = require('./helpers');

describe('security audit log', () => {
  const events = [];
  let original;

  before(async () => {
    await setup();
    original = auditLog.info;
    auditLog.info = (fields) => events.push(fields);
  });
  after(async () => {
    auditLog.info = original;
    await teardown();
  });

  it('records sign-ins, failures and invite use, without logging emails', async () => {
    const u = await registerUser();
    await api().post('/api/auth/login').send({ email: u.email, password: 'wrong password!!' }).expect(401);
    await api().post('/api/auth/login').send({ email: 'nobody@test.dev', password: 'wrong password!!' }).expect(401);
    await api().post('/api/auth/login').send({ email: u.email, password: u.password }).expect(200);
    await api().post('/api/auth/register').send({ email: u.email, name: 'Again', password: u.password }).expect(409);
    await api().post('/api/workspaces').set(auth(u.token, null)).send({ name: 'Logged', slug: 'logged' }).expect(201);
    await api().post('/api/workspace/invites').set(auth(u.token, 'logged')).send({}).expect(201);

    const names = events.map((e) => e.event);
    for (const name of ['account.created', 'signin.failed', 'signin.succeeded', 'signup.email_taken', 'invite.created']) assert.ok(names.includes(name), name);
    assert.match(events.find((e) => e.event === 'signup.email_taken').emailHash, /^[a-f0-9]{16}$/);
    const [knownFail, unknownFail] = events.filter((e) => e.event === 'signin.failed');
    assert.equal(knownFail.user, u.user.id);
    assert.equal(unknownFail.unknownAccount, true);
    assert.match(unknownFail.emailHash, /^[a-f0-9]{16}$/);
    const invite = events.find((e) => e.event === 'invite.created');
    assert.equal(invite.actor, u.user.id);
    assert.ok(invite.workspace);

    const logged = JSON.stringify(events);
    assert.ok(!logged.includes(u.email) && !logged.includes('nobody@test.dev'), 'no email addresses in the audit log');
    assert.ok(!logged.includes(u.password), 'no passwords in the audit log');
    await flushRedis();
  });

  it('records sharing, public links and workspace changes', async () => {
    const owner = await registerUser();
    const friend = await registerUser();
    const as = (u, ws) => auth(u.token, ws);
    const { item: box } = (await api().post('/api/files/folders').set(as(owner)).send({ name: 'Shared box' }).expect(201)).body;
    await api().post(`/api/files/nodes/${box.id}/shares`).set(as(owner)).send({ userId: friend.user.id, role: 'view' }).expect(201);
    const { people } = (await api().get(`/api/files/nodes/${box.id}/shares`).set(as(owner)).expect(200)).body;
    await api().patch(`/api/files/shares/${people[0].id}`).set(as(owner)).send({ role: 'edit' }).expect(200);
    await api().post(`/api/files/nodes/${box.id}/link`).set(as(owner)).expect(201);
    await api().delete(`/api/files/nodes/${box.id}/link`).set(as(owner)).expect(200);
    await api().delete(`/api/files/shares/${people[0].id}`).set(as(owner)).expect(204);
    await api().post('/api/workspaces').set(as(owner, null)).send({ name: 'Audited', slug: 'audited' }).expect(201);
    await api().patch('/api/workspace').set(as(owner, 'audited')).send({ name: 'Renamed' }).expect(200);
    await api().patch('/api/workspace/apps/notes').set(as(owner, 'audited')).send({ enabled: false }).expect(200);

    const mine = events.filter((e) => e.actor === owner.user.id);
    const names = mine.map((e) => e.event);
    for (const name of ['files.shared', 'files.share_changed', 'files.link_enabled', 'files.link_disabled', 'files.share_removed', 'workspace.renamed', 'workspace.app_toggled']) {
      assert.ok(names.includes(name), name);
    }
    assert.deepEqual(
      (({ node, grantee, role }) => ({ node, grantee, role }))(mine.find((e) => e.event === 'files.shared')),
      { node: box.id, grantee: friend.user.id, role: 'view' },
    );
    assert.deepEqual((({ app, enabled }) => ({ app, enabled }))(mine.find((e) => e.event === 'workspace.app_toggled')), { app: 'notes', enabled: false });
    const logged = JSON.stringify(mine);
    assert.ok(!logged.includes('Shared box') && !logged.includes(friend.email), 'no file names or emails');
    await flushRedis();
  });
});

describe('request logs', () => {
  it('hide the tokens in links that work without signing in', () => {
    const { hideTokens } = require('../src/core/utils/logger');
    assert.equal(hideTokens('/api/public/files/download/eyJ3.c2ln'), '/api/public/files/download/[token]');
    assert.equal(hideTokens('/api/public/files/links/abc/download/0123456789abcdef01234567?inline=1'),
      '/api/public/files/links/[token]/download/0123456789abcdef01234567?inline=1');
    assert.equal(hideTokens('/api/files/browse?folder=x'), '/api/files/browse?folder=x');
  });
});
