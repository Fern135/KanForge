'use strict';

// Sign-up turned off (the default). Set before config loads; node --test runs
// each file in its own process, so the other files keep sign-up on.
process.env.ALLOW_REGISTRATION = 'false';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, teardown, api } = require('./helpers');
const { makeAdmin } = require('../scripts/make-admin');

describe('registration turned off', () => {
  before(setup);
  after(teardown);

  it('says sign-up is closed and refuses to create accounts', async () => {
    const { body } = await api().get('/api/auth/registration').expect(200);
    assert.deepEqual(body, { open: false });
    const res = await api().post('/api/auth/register')
      .send({ email: 'stranger@test.dev', name: 'Stranger', password: 'correct horse battery staple' })
      .expect(403);
    assert.equal(res.body.error.code, 'REGISTRATION_CLOSED');
    await api().post('/api/auth/login').send({ email: 'stranger@test.dev', password: 'correct horse battery staple' }).expect(401);
  });

  it('lets make admin create the first account, which must choose its own password', async () => {
    const admin = await makeAdmin('Owner@Test.dev');
    assert.equal(admin.email, 'owner@test.dev');
    assert.equal(admin.role, 'admin');
    assert.match(admin.password, /^[A-Za-z0-9]{4}(-[A-Za-z0-9]{4}){3}$/);

    const { body } = await api().post('/api/auth/login').send({ email: 'owner@test.dev', password: admin.password }).expect(200);
    assert.equal(body.user.role, 'admin');
    assert.equal(body.user.mustChangePassword, true);

    // Run again for the same email: still admin, and no new password is made.
    const again = await makeAdmin('owner@test.dev');
    assert.equal(again.role, 'admin');
    assert.equal(again.password, undefined);
  });
});
