'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { trusted } = require('mongoose');
const Session = require('../src/core/models/Session');
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

  it('keeps the owner signed in on their usual browser while strangers lock the account', async () => {
    const u = await registerUser();
    const kd = u.res.headers['set-cookie'].find((c) => c.startsWith('kd='));
    assert.match(kd, /HttpOnly/);
    assert.match(kd, /SameSite=Strict/);
    // Strangers fail from 4 addresses, 5 times each: the account-wide lock (20) kicks in.
    for (let ip = 1; ip <= 4; ip += 1) {
      for (let i = 0; i < 5; i += 1) {
        await api().post('/api/auth/login').set('X-Forwarded-For', `203.0.113.${ip}`)
          .send({ email: u.email, password: 'wrong password!!' }).expect(401);
      }
    }
    const login = (ip, cookie) => {
      const req = api().post('/api/auth/login').set('X-Forwarded-For', ip);
      if (cookie) req.set('Cookie', [cookie]);
      return req.send({ email: u.email, password: u.password });
    };
    // A browser that never signed in to this account is locked out, even with the right password.
    assert.equal((await login('198.51.100.7')).body.error.code, 'LOCKED');
    // The owner's browser still gets in.
    await login('198.51.100.8', `kd=${u.cookies.kd}`).expect(200);
    // Someone else's known-device cookie, or a made-up one, doesn't help.
    const other = await registerUser();
    assert.equal((await login('198.51.100.9', `kd=${other.cookies.kd}`)).body.error.code, 'LOCKED');
    assert.equal((await login('198.51.100.9', `kd=${'x'.repeat(43)}`)).body.error.code, 'LOCKED');
    await flushRedis();
  });

  it('locks password re-checks (change password, PIN) against guesses from many addresses', async () => {
    const u = await registerUser();
    const tries = [
      (ip, pw) => api().post('/api/auth/change-password').set(auth(u.token)).set('X-Forwarded-For', ip).send({ currentPassword: pw, newPassword: 'a brand new passphrase' }),
      (ip, pw) => api().put('/api/auth/pin').set(auth(u.token)).set('X-Forwarded-For', ip).send({ currentPassword: pw, pin: '480213' }),
    ];
    for (let n = 0; n < 20; n += 1) {
      const res = await tries[n % 2](`203.0.113.${1 + Math.floor(n / 5)}`, 'wrong password!!');
      assert.equal(res.body.error.code, 'BAD_CREDENTIALS');
    }
    const locked = await tries[0]('198.51.100.30', u.password);
    assert.equal(locked.body.error.code, 'LOCKED');
    await flushRedis();
  });

  it('stops the access token working as soon as you sign out', async () => {
    const u = await registerUser();
    await api().get('/api/auth/me').set(auth(u.token)).expect(200);
    await api().post('/api/auth/logout')
      .set('Cookie', [`rt=${u.cookies.rt}`, `csrf=${u.cookies.csrf}`])
      .set('X-CSRF-Token', u.cookies.csrf)
      .set(auth(u.token))
      .expect(204);
    const res = await api().get('/api/auth/me').set(auth(u.token)).expect(401);
    assert.equal(res.body.error.code, 'TOKEN_INVALID');
    // Other sessions of the same person keep working.
    const again = await api().post('/api/auth/login').send({ email: u.email, password: u.password }).expect(200);
    await api().get('/api/auth/me').set(auth(again.body.accessToken)).expect(200);
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

  describe('security PIN', () => {
    const PIN = '482913';
    const pinLogin = (pd, pin) => {
      const req = api().post('/api/auth/login-pin');
      if (pd) req.set('Cookie', [`pd=${pd}`]);
      return req.send({ pin });
    };
    const enablePin = async (u) => {
      const res = await api().put('/api/auth/pin').set(auth(u.token)).send({ currentPassword: u.password, pin: PIN }).expect(200);
      return cookiesFrom(res).pd;
    };

    it('is off for new accounts, and PIN login needs a remembered device', async () => {
      const u = await registerUser();
      const status = await api().get('/api/auth/pin').set(auth(u.token)).expect(200);
      assert.equal(status.body.enabled, false);
      assert.equal(u.cookies.pd, undefined);
      const res = await pinLogin(null, PIN);
      assert.equal(res.status, 401);
      assert.equal(res.body.error.code, 'PIN_DEVICE_UNKNOWN');
      await pinLogin('x'.repeat(43), PIN).expect(401);
      await api().post('/api/auth/login-pin').send({ email: u.email, pin: PIN }).expect(400);
    });

    it('requires the password and a strong PIN to turn it on', async () => {
      const u = await registerUser();
      await api().put('/api/auth/pin').set(auth(u.token)).send({ currentPassword: 'wrong', pin: PIN }).expect(400);
      for (const weak of ['1234', '111111', '123456', '87654321', 'abcdef']) {
        await api().put('/api/auth/pin').set(auth(u.token)).send({ currentPassword: u.password, pin: weak }).expect(400);
      }
      await api().put('/api/auth/pin').send({ currentPassword: u.password, pin: PIN }).expect(401);
    });

    it('signs in with the PIN alone on the remembered device', async () => {
      const u = await registerUser();
      const pd = await enablePin(u);
      assert.ok(pd);
      const changed = await api().put('/api/auth/pin').set(auth(u.token)).set('Cookie', [`pd=${pd}`])
        .send({ currentPassword: u.password, pin: PIN }).expect(200);
      const pdCookie = changed.headers['set-cookie'].find((c) => c.startsWith('pd='));
      assert.match(pdCookie, /HttpOnly/);
      assert.match(pdCookie, /SameSite=Strict/);

      const who = await api().get('/api/auth/pin-device').set('Cookie', [`pd=${pd}`]).expect(200);
      assert.equal(who.body.user, null, 'changing the PIN rotated the device token');

      const fresh = cookiesFrom(changed).pd;
      assert.equal((await api().get('/api/auth/pin-device').set('Cookie', [`pd=${fresh}`])).body.user.email, u.email);
      const res = await pinLogin(fresh, PIN).expect(200);
      assert.ok(res.body.accessToken);
      assert.equal(res.body.user.email, u.email);
      assert.equal(res.body.user.pinHash, undefined);
      const wrong = await pinLogin(fresh, '482914');
      assert.equal(wrong.status, 401);
      assert.equal(wrong.body.error.code, 'BAD_CREDENTIALS');
      await flushRedis();
    });

    it('remembers a device on password sign-in once the PIN is on', async () => {
      const u = await registerUser();
      await enablePin(u);
      const res = await api().post('/api/auth/login').send({ email: u.email, password: u.password }).expect(200);
      const pd = cookiesFrom(res).pd;
      await pinLogin(pd, PIN).expect(200);
      await api().post('/api/auth/pin-device/forget').set('Cookie', [`pd=${pd}`]).expect(204);
      await pinLogin(pd, PIN).expect(401);
    });

    it('turning it off or signing out everywhere forgets every device', async () => {
      const u = await registerUser();
      const pd = await enablePin(u);
      await api().post('/api/auth/pin/disable').set(auth(u.token)).send({ currentPassword: 'wrong' }).expect(400);
      await api().post('/api/auth/pin/disable').set(auth(u.token)).send({ currentPassword: u.password }).expect(200);
      await pinLogin(pd, PIN).expect(401);

      const again = await enablePin(u);
      await api().post('/api/auth/logout-all').set(auth(u.token)).expect(204);
      await pinLogin(again, PIN).expect(401);
    });

    it('locks PIN sign-in after repeated failures, separately from password login', async () => {
      const u = await registerUser();
      const pd = await enablePin(u);
      for (let i = 0; i < 5; i += 1) await pinLogin(pd, '000001').expect(401);
      const res = await pinLogin(pd, PIN);
      assert.equal(res.status, 429);
      assert.equal(res.body.error.code, 'LOCKED');
      await api().post('/api/auth/login').send({ email: u.email, password: u.password }).expect(200);
      await flushRedis();
    });
  });

  it('rejects non-JSON bodies', async () => {
    const res = await api().post('/api/auth/login').type('form').send('email=a@b.co&password=x');
    assert.equal(res.status, 415);
  });
});
