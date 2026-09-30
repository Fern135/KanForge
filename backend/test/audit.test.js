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
    await api().post('/api/workspaces').set(auth(u.token, null)).send({ name: 'Logged', slug: 'logged' }).expect(201);
    await api().post('/api/workspace/invites').set(auth(u.token, 'logged')).send({}).expect(201);

    const names = events.map((e) => e.event);
    for (const name of ['account.created', 'signin.failed', 'signin.succeeded', 'invite.created']) assert.ok(names.includes(name), name);
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
});
