'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { mongoose } = require('../src/core/db/mongo');
const Workspace = require('../src/core/models/Workspace');
const { makeAdmin } = require('../scripts/make-admin');
const { weekStart } = require('../src/core/services/platformStats');
const { setup, teardown, api, registerUser, auth, joinWorkspace } = require('./helpers');

const DAY = 86_400_000;

describe('platform stats', () => {
  let admin;

  before(async () => {
    await setup();
    admin = await registerUser();
    await makeAdmin(admin.email);
  });
  after(teardown);

  const stats = async () => (await api().get('/api/admin/stats').set(auth(admin.token)).expect(200)).body.stats;

  it('counts accounts, activity, seats, plans and estimated revenue', async () => {
    // Two paying workspaces: Standard with 3 seats ($5 each), Plus with 2 ($9 each).
    const owner = await registerUser({}, { joinTestWorkspace: false });
    const [a, b, c] = await Promise.all([1, 2, 3].map(() => registerUser({}, { joinTestWorkspace: false })));
    for (const [slug, plan, people] of [['std-co', 'standard', [a, b]], ['plus-co', 'plus', [c]]]) {
      await api().post('/api/workspaces').set(auth(owner.token, null)).send({ name: slug, slug }).expect(201);
      await Workspace.updateOne({ slug }, { $set: { plan } });
      for (const p of people) await joinWorkspace(owner, slug, p);
    }
    // Someone who hasn't been around for 40 days.
    const users = mongoose.connection.db.collection('users');
    await users.updateOne({ _id: new mongoose.Types.ObjectId(c.user.id) }, { $set: { lastActiveAt: new Date(Date.now() - 40 * DAY) } });

    const s = await stats();
    // The admin, the owner and three people.
    assert.equal(s.accounts, 5);
    // The test workspace is Self-hosted, so it's left out: only the two paying ones count.
    assert.equal(s.workspaces, 2);
    assert.equal(s.seats, 5);
    assert.deepEqual(s.plans.map((p) => p.plan), ['standard', 'plus']);
    const plan = (id) => s.plans.find((p) => p.plan === id);
    assert.deepEqual({ ws: plan('standard').workspaces, seats: plan('standard').seats, mrr: plan('standard').monthlyRevenue }, { ws: 1, seats: 3, mrr: 15 });
    assert.deepEqual({ ws: plan('plus').workspaces, seats: plan('plus').seats, mrr: plan('plus').monthlyRevenue }, { ws: 1, seats: 2, mrr: 18 });
    assert.equal(s.monthlyRevenue, 33);
    assert.equal(s.yearlyRevenue, 396);
    assert.ok(s.active7 >= 1 && s.active7 < s.accounts, 'the long-gone account is not active');
    assert.ok(s.active30 >= s.active7);
  });

  it('counts sign-ups by week for the last 12 weeks', async () => {
    const users = mongoose.connection.db.collection('users');
    const threeWeeksAgo = new Date(weekStart(Date.now()) - 3 * 7 * DAY + DAY);
    await users.insertOne({ email: 'old@test.dev', name: 'Old', passwordHash: '$argon2id$x', createdAt: threeWeeksAgo, updatedAt: threeWeeksAgo });
    const { signups } = await stats();
    assert.equal(signups.length, 12);
    assert.equal(new Date(signups[11].weekStart).getUTCDay(), 1, 'weeks start on Monday');
    assert.equal(signups[8].signups, 1);
    assert.equal(signups[11].signups, 5);
  });

  it('never includes names, emails or workspace content', async () => {
    const text = JSON.stringify(await stats());
    assert.ok(!/@/.test(text), 'no email addresses');
    assert.ok(!text.includes('User '), 'no account names');
  });
});
