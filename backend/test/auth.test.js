'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { trusted } = require('mongoose');
const Session = require('../src/models/Session');
const { setup, teardown, api, registerUser, auth, cookiesFrom, flushRedis } = require('./helpers');

const refresh = (cookies) =>
  api()
    .post('/api/auth/refresh')
    .set('Cookie', [`rt=${cookies.rt}`, `csrf=${cookies.csrf}`])
    .set('X-CSRF-Token', cookies.csrf);

describe('auth', () => {
  before(setup);
  after(teardown);

  it('registers and sets hardened cookies', async () => {
    const { res, token } = await registerUser();
    assert.ok(token);
    const rt = res.headers['set-cookie'].find((c) => c.startsWith('rt='));
    assert.match(rt, /HttpOnly/);
    assert.match(rt, /SameSite=Strict/);
    assert.match(rt, /Path=\/api\/auth/);
    assert.equal(res.body.user.passwordHash, undefined);
  });

  it('rejects weak passwords and unknown fields (mass assignment)', async () => {
    await api().post('/api/auth/register').send({ email: 'a@b.co', name: 'x', password: 'short' }).expect(400);
    await api()
      .post('/api/auth/register')
      .send({ email: 'mass@b.co', name: 'x', password: 'long enough password', tokenVersion: 5, role: 'admin' })
      .expect(400);
  });

  it('rejects duplicate emails', async () => {
    const u = await registerUser();
    const res = await api().post('/api/auth/register').send({ email: u.email, name: 'x', password: u.password });
    assert.equal(res.status, 409);
  });

  it('blocks NoSQL operator injection in login', async () => {
    await api().post('/api/auth/login').send({ email: { $gt: '' }, password: { $gt: '' } }).expect(400);
  });

  it('logs in and serves /me; rejects tampered tokens', async () => {
    const u = await registerUser();
    const res = await api().post('/api/auth/login').send({ email: u.email, password: u.password }).expect(200);
    const me = await api().get('/api/auth/me').set(auth(res.body.accessToken)).expect(200);
    assert.equal(me.body.user.email, u.email);

    const [h, p] = res.body.accessToken.split('.');
    await api().get('/api/auth/me').set(auth(`${h}.${p}.forged`)).expect(401);
    const none = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    await api().get('/api/auth/me').set(auth(`${none}.${p}.`)).expect(401);
    await api().get('/api/auth/me').expect(401);
  });

  it('locks out after repeated failures', async () => {
    const u = await registerUser();
    for (let i = 0; i < 5; i += 1) {
      await api().post('/api/auth/login').send({ email: u.email, password: 'wrong password!!' }).expect(401);
    }
    const res = await api().post('/api/auth/login').send({ email: u.email, password: u.password });
    assert.equal(res.status, 429);
    assert.equal(res.body.error.code, 'LOCKED');
    await flushRedis();
  });

  it('requires CSRF token to refresh, and rotates the refresh token', async () => {
    const u = await registerUser();
    await api().post('/api/auth/refresh').set('Cookie', [`rt=${u.cookies.rt}`]).expect(403);
    await api()
      .post('/api/auth/refresh')
      .set('Cookie', [`rt=${u.cookies.rt}`, `csrf=${u.cookies.csrf}`])
      .set('X-CSRF-Token', 'x'.repeat(u.cookies.csrf.length))
      .expect(403);

    const res = await refresh(u.cookies).expect(200);
    const next = cookiesFrom(res);
    assert.ok(res.body.accessToken);
    assert.notEqual(next.rt, u.cookies.rt);
  });

  it('detects refresh token reuse and revokes the whole family', async () => {
    const u = await registerUser();
    const first = cookiesFrom(await refresh(u.cookies).expect(200));

    // Concurrent replay inside the grace window is refused without revoking.
    const race = await refresh(u.cookies);
    assert.equal(race.status, 401);
    assert.equal(race.body.error.code, 'REFRESH_RACE');

    // Replay after the grace window counts as theft: every session in the family dies.
    await Session.updateMany({ revokedAt: trusted({ $ne: null }) }, { $set: { revokedAt: new Date(Date.now() - 60_000) } });
    const replay = await refresh(u.cookies);
    assert.equal(replay.status, 401);
    assert.equal(replay.body.error.code, 'REFRESH_INVALID');
    await refresh(first).expect(401);
  });

  it('logout-all invalidates outstanding access tokens', async () => {
    const u = await registerUser();
    await api().post('/api/auth/logout-all').set(auth(u.token)).expect(204);
    await api().get('/api/auth/me').set(auth(u.token)).expect(401);
    await refresh(u.cookies).expect(401);
  });

  it('rejects cross-origin state-changing requests', async () => {
    const res = await api()
      .post('/api/auth/login')
      .set('Origin', 'https://evil.example')
      .send({ email: 'a@b.co', password: 'whatever' });
    assert.equal(res.status, 403);
  });

  it('rejects non-JSON bodies', async () => {
    const res = await api().post('/api/auth/login').type('form').send('email=a@b.co&password=x');
    assert.equal(res.status, 415);
  });
});
