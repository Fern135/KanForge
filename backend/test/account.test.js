'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const User = require('../src/core/models/User');
const Session = require('../src/core/models/Session');
const Workspace = require('../src/core/models/Workspace');
const Note = require('../src/apps/notes/models/Note');
const { makeAdmin } = require('../scripts/make-admin');
const {
  setup, teardown, api, registerUser, auth, cookiesFrom,
} = require('./helpers');

const refresh = (cookies) => api().post('/api/auth/refresh')
  .set('Cookie', [`rt=${cookies.rt}`, `csrf=${cookies.csrf}`]).set('X-CSRF-Token', cookies.csrf);

describe('account: devices and deletion requests', () => {
  before(setup);
  after(teardown);

  it('lists the devices signed in, and signs one out at once', async () => {
    const laptop = await registerUser();
    const phoneRes = await api().post('/api/auth/login').set('User-Agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1')
      .send({ email: laptop.email, password: laptop.password }).expect(200);
    const phone = { token: phoneRes.body.accessToken, cookies: cookiesFrom(phoneRes) };

    const { sessions } = (await api().get('/api/auth/sessions').set(auth(laptop.token)).expect(200)).body;
    assert.equal(sessions.length, 2);
    assert.equal(sessions.filter((s) => s.current).length, 1);
    const other = sessions.find((s) => !s.current);
    assert.match(other.userAgent, /iPhone/);
    assert.ok(other.signedInAt && other.lastActiveAt && 'ip' in other);

    // Refreshing keeps it one device, not a new one.
    await refresh(phone.cookies).expect(200);
    assert.equal((await api().get('/api/auth/sessions').set(auth(laptop.token)).expect(200)).body.sessions.length, 2);

    await api().delete(`/api/auth/sessions/${other.id}`).set(auth(laptop.token)).expect(204);
    await api().get('/api/boards').set(auth(phone.token)).expect(401);
    await refresh(phone.cookies).expect(401);
    await api().get('/api/boards').set(auth(laptop.token)).expect(200);
    assert.equal((await api().get('/api/auth/sessions').set(auth(laptop.token)).expect(200)).body.sessions.length, 1);

    // Signing in again on the same browser (its device cookie) replaces its session.
    const again = await api().post('/api/auth/login').set('Cookie', [`bd=${laptop.cookies.bd}`])
      .send({ email: laptop.email, password: laptop.password }).expect(200);
    await api().get('/api/boards').set(auth(laptop.token)).expect(401);
    laptop.token = again.body.accessToken;
    const listed = (await api().get('/api/auth/sessions').set(auth(laptop.token)).expect(200)).body.sessions;
    assert.equal(listed.length, 1);
    assert.equal(listed[0].current, true);
    // A browser without the cookie is a new device.
    const tablet = await api().post('/api/auth/login').send({ email: laptop.email, password: laptop.password }).expect(200);
    assert.equal((await api().get('/api/auth/sessions').set(auth(laptop.token)).expect(200)).body.sessions.length, 2);
    await api().delete(`/api/auth/sessions/${(await api().get('/api/auth/sessions').set(auth(laptop.token))).body.sessions.find((s) => !s.current).id}`)
      .set(auth(laptop.token)).expect(204);
    await api().get('/api/boards').set(auth(tablet.body.accessToken)).expect(401);

    const mine = listed[0].id;
    assert.equal((await api().delete(`/api/auth/sessions/${mine}`).set(auth(laptop.token)).expect(400)).body.error.code, 'CURRENT_SESSION');
    await api().delete(`/api/auth/sessions/${other.id}`).set(auth(laptop.token)).expect(404);
    await api().delete('/api/auth/sessions/not-a-session').set(auth(laptop.token)).expect(404);
    // Someone else's session can't be touched.
    const stranger = await registerUser();
    await api().delete(`/api/auth/sessions/${mine}`).set(auth(stranger.token)).expect(404);
    await api().get('/api/boards').set(auth(laptop.token)).expect(200);
  });

  it('keeps at most 50 browsers signed in, signing out the least recently used', async () => {
    const tokens = require('../src/core/services/tokens');
    const u = await registerUser();
    // 50 more browsers (sessions written directly, as if from earlier sign-ins).
    const now = Date.now();
    await Session.insertMany(Array.from({ length: tokens.MAX_DEVICES }, (_, i) => ({
      user: u.user.id, tokenHash: tokens.sha256(`t${i}-${now}`), family: `fam${String(i).padStart(19, '0')}`,
      device: tokens.sha256(`d${i}-${now}`), userAgent: 'Old', expiresAt: new Date(now + 86400000), createdAt: new Date(now - (i + 1) * 60000),
    })));
    // The least recently used browser also had PIN sign-in.
    const oldest = tokens.sha256(`d${tokens.MAX_DEVICES - 1}-${now}`);
    await User.updateOne({ _id: u.user.id }, { $set: { pinDevices: [{ tokenHash: tokens.sha256(`p-${now}`), createdAt: new Date(), device: oldest }] } });
    const fresh = await api().post('/api/auth/login').send({ email: u.email, password: u.password }).expect(200);
    const { sessions } = (await api().get('/api/auth/sessions').set(auth(fresh.body.accessToken)).expect(200)).body;
    assert.equal(sessions.length, tokens.MAX_DEVICES);
    assert.ok(sessions.some((x) => x.current));
    // The oldest ones went.
    assert.ok(!sessions.some((x) => x.id === `fam${String(tokens.MAX_DEVICES - 1).padStart(19, '0')}`));
    // ...and its PIN sign-in went with it.
    assert.deepEqual((await User.findById(u.user.id).select('+pinDevices').lean()).pinDevices, []);
  });

  it('takes PIN sign-in away from a device that is signed out', async () => {
    const laptop = await registerUser();
    const pinRes = await api().put('/api/auth/pin').set(auth(laptop.token)).set('Cookie', [`bd=${laptop.cookies.bd}`])
      .send({ currentPassword: laptop.password, pin: '482916' }).expect(200);
    const laptopPin = cookiesFrom(pinRes).pd;
    const phoneRes = await api().post('/api/auth/login').set('User-Agent', 'Phone/1.0').send({ email: laptop.email, password: laptop.password }).expect(200);
    const phone = cookiesFrom(phoneRes);
    assert.ok(phone.pd && phone.bd);
    const pinLogin = (c) => api().post('/api/auth/login-pin').set('Cookie', [`pd=${c.pd}`, `bd=${c.bd}`]).send({ pin: '482916' });

    const { sessions } = (await api().get('/api/auth/sessions').set(auth(laptop.token)).expect(200)).body;
    const phoneSession = sessions.find((x) => x.userAgent === 'Phone/1.0');
    await api().delete(`/api/auth/sessions/${phoneSession.id}`).set(auth(laptop.token)).expect(204);

    assert.equal((await pinLogin(phone)).body.error.code, 'PIN_DEVICE_UNKNOWN');
    // The laptop's own PIN sign-in is untouched.
    await pinLogin({ pd: laptopPin, bd: laptop.cookies.bd }).expect(200);
  });

  it('shows sessions from before device ids once per browser, and replaces them at the next sign-in', async () => {
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/154.0.0.0 Safari/537.36';
    const u = await registerUser();
    for (const ip of ['::ffff:172.23.0.3', '::ffff:172.19.0.3']) {
      await api().post('/api/auth/login').set('User-Agent', ua).set('X-Forwarded-For', ip.replace('::ffff:', ''))
        .send({ email: u.email, password: u.password }).expect(200);
    }
    // Make them look like sessions from before device ids existed.
    await Session.updateMany({ user: u.user.id, userAgent: ua }, { $unset: { device: '' } });
    const list = async () => (await api().get('/api/auth/sessions').set(auth(u.token)).expect(200)).body.sessions;
    assert.equal((await list()).filter((s) => s.userAgent === ua).length, 1);

    const back = await api().post('/api/auth/login').set('User-Agent', ua).send({ email: u.email, password: u.password }).expect(200);
    const after = (await api().get('/api/auth/sessions').set(auth(back.body.accessToken)).expect(200)).body.sessions;
    assert.equal(after.filter((s) => s.userAgent === ua).length, 1);
    assert.ok(!after.some((s) => s.ip.startsWith('::ffff:')));
  });

  it('asks for deletion with the password, can withdraw it, and an admin carries it out', async () => {
    const admin = await registerUser();
    await makeAdmin(admin.email);
    const leaving = await registerUser();
    const status = async () => (await api().get('/api/auth/deletion-request').set(auth(leaving.token)).expect(200)).body.requestedAt;

    assert.equal(await status(), null);
    await api().post('/api/auth/deletion-request').set(auth(leaving.token)).send({ currentPassword: 'wrong password!!' }).expect(400);
    assert.equal(await status(), null);
    const asked = (await api().post('/api/auth/deletion-request').set(auth(leaving.token)).send({ currentPassword: leaving.password }).expect(201)).body.requestedAt;
    assert.equal(await status(), asked);
    await api().delete('/api/auth/deletion-request').set(auth(leaving.token)).expect(204);
    assert.equal(await status(), null);

    // Their own workspace, with a note in it, goes with them; the shared one stays.
    await api().post('/api/workspaces').set(auth(leaving.token, null)).send({ name: 'Mine', slug: 'mine-space' }).expect(201);
    await api().post('/api/notes').set(auth(leaving.token, 'mine-space')).send({ title: 'Diary' }).expect(201);
    await api().post('/api/auth/deletion-request').set(auth(leaving.token)).send({ currentPassword: leaving.password }).expect(201);

    await api().get('/api/admin/deletion-requests').set(auth(leaving.token)).expect(403);
    const { requests } = (await api().get('/api/admin/deletion-requests').set(auth(admin.token)).expect(200)).body;
    assert.deepEqual(requests.map((r) => ({ id: r.id, solo: r.soloWorkspaces })), [{ id: leaving.user.id, solo: ['Mine'] }]);

    const go = () => api().delete(`/api/admin/deletion-requests/${leaving.user.id}`).set(auth(admin.token));
    assert.equal((await go()).body.error.code, 'REAUTH_REQUIRED');
    await api().post('/api/admin/confirm').set(auth(admin.token)).send({ password: admin.password }).expect(204);
    await go().expect(204);

    assert.equal(await User.exists({ _id: leaving.user.id }), null);
    assert.equal(await Workspace.exists({ slug: 'mine-space' }), null);
    assert.equal(await Note.countDocuments({ title: 'Diary' }).setOptions({ allWorkspaces: true }), 0);
    assert.ok(await Workspace.exists({ slug: 'test-space' }));
    assert.equal((await api().get('/api/admin/deletion-requests').set(auth(admin.token)).expect(200)).body.requests.length, 0);
    await go().expect(404);

    // Platform admins can't ask; they stop being admin first.
    assert.equal((await api().post('/api/auth/deletion-request').set(auth(admin.token)).send({ currentPassword: admin.password })).body.error.code, 'ADMIN_ACCOUNT');
  });
});
