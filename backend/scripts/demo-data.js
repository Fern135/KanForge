'use strict';

// Fills a development database with made-up accounts and workspaces, so the
// super admin dashboard has something to show:
//   ./run.sh demo           (or make demo)          adds them
//   ./run.sh demo remove    (or make demo-remove)   takes them out again
// Demo accounts use @demo.kanforge.test emails and can't sign in (their password
// is random and never shown). Demo workspaces have addresses starting "demo-".
// Refuses to run in production unless ALLOW_DEMO=true.
const crypto = require('node:crypto');
const argon2 = require('argon2');
const config = require('../src/core/config');
const { connectMongo, disconnectMongo, mongoose } = require('../src/core/db/mongo');

const EMAIL_DOMAIN = 'demo.kanforge.test';
const SLUG_PREFIX = 'demo-';
const DAY = 24 * 60 * 60 * 1000;
const ACCOUNTS = 180;
const WEEKS = 14;

const FIRST = ['Ava', 'Ben', 'Chloe', 'Diego', 'Elena', 'Farah', 'Gabe', 'Hana', 'Ivan', 'Jade', 'Kofi', 'Lena', 'Mateo', 'Nora', 'Omar', 'Priya', 'Quinn', 'Rosa', 'Sam', 'Tariq', 'Uma', 'Vic', 'Wen', 'Yusuf', 'Zoe'];
const LAST = ['Adams', 'Baker', 'Chen', 'Diaz', 'Evans', 'Fischer', 'Garcia', 'Haddad', 'Ito', 'Jensen', 'Khan', 'Lopez', 'Moreau', 'Novak', 'Okafor', 'Patel', 'Rossi', 'Silva', 'Tanaka', 'Weber'];
const COMPANIES = [
  'Acme Studio', 'Blue Harbor', 'Cedar Labs', 'Driftwood Co', 'Ember Design', 'Foxglove Health', 'Granite Legal',
  'Hilltop Farms', 'Ironbark Build', 'Juniper Media', 'Kestrel Air', 'Lumen Energy', 'Maple Finance', 'Northwind Retail',
  'Orchid Events', 'Pinecrest School', 'Quarry Works', 'Riverbend Clinic', 'Summit Outdoors', 'Tidewater Foods',
  'Umbra Security', 'Vantage Realty', 'Willow Bakery', 'Yellowfin Travel', 'Zephyr Robotics', 'Copper Kettle',
  'Solstice Yoga', 'Beacon Nonprofit',
];

const rand = (n) => crypto.randomInt(n);
const pick = (list) => list[rand(list.length)];
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Sign-ups grow over time: more recent weeks get more of them.
function signupDate(now) {
  const week = Math.floor(Math.sqrt(Math.random()) * WEEKS);
  return new Date(now - (WEEKS - 1 - week) * 7 * DAY - rand(7 * DAY));
}

// Most people used it this week, some this month, a few not for a while.
function lastActive(now, createdAt) {
  const roll = Math.random();
  const ago = roll < 0.65 ? rand(7 * DAY) : roll < 0.85 ? 7 * DAY + rand(23 * DAY) : 30 * DAY + rand(60 * DAY);
  return new Date(Math.max(createdAt.getTime(), now - ago));
}

async function remove(db) {
  const users = await db.collection('users').find({ email: { $regex: `@${EMAIL_DOMAIN.replace(/\./g, '\\.')}$` } }).project({ _id: 1 }).toArray();
  const workspaces = await db.collection('workspaces').find({ slug: { $regex: `^${SLUG_PREFIX}` } }).project({ _id: 1 }).toArray();
  const userIds = users.map((u) => u._id);
  const wsIds = workspaces.map((w) => w._id);
  const m = await db.collection('memberships').deleteMany({ $or: [{ user: { $in: userIds } }, { workspace: { $in: wsIds } }] });
  await db.collection('invites').deleteMany({ workspace: { $in: wsIds } });
  await db.collection('workspaces').deleteMany({ _id: { $in: wsIds } });
  await db.collection('users').deleteMany({ _id: { $in: userIds } });
  console.log(`Removed ${userIds.length} demo accounts, ${wsIds.length} demo workspaces and ${m.deletedCount} memberships.`);
}

async function add(db) {
  if (await db.collection('users').findOne({ email: { $regex: `@${EMAIL_DOMAIN.replace(/\./g, '\\.')}$` } })) {
    console.log('Demo data is already there. Run "demo remove" first to make a fresh set.');
    return;
  }
  const now = Date.now();
  // One hash of a random password nobody knows: demo accounts can't sign in.
  const passwordHash = await argon2.hash(crypto.randomBytes(32).toString('hex'), { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });

  const users = Array.from({ length: ACCOUNTS }, (_, i) => {
    const createdAt = signupDate(now);
    const first = pick(FIRST);
    const last = pick(LAST);
    return {
      _id: new mongoose.Types.ObjectId(),
      email: `${slugify(first)}.${slugify(last)}.${i + 1}@${EMAIL_DOMAIN}`,
      name: `${first} ${last}`,
      passwordHash,
      role: 'user',
      tokenVersion: 0,
      createdAt,
      updatedAt: createdAt,
      lastActiveAt: lastActive(now, createdAt),
    };
  });
  await db.collection('users').insertMany(users);

  // Plans: mostly Standard, a good share of Plus.
  const plans = ['standard', 'standard', 'standard', 'plus', 'plus'];
  const byAge = [...users].sort((a, b) => a.createdAt - b.createdAt);
  const workspaces = [];
  const memberships = [];
  COMPANIES.forEach((name, i) => {
    const creator = byAge[Math.floor((i / COMPANIES.length) * byAge.length * 0.8)];
    const createdAt = new Date(creator.createdAt.getTime() + rand(DAY));
    const ws = { _id: new mongoose.Types.ObjectId(), name, slug: `${SLUG_PREFIX}${slugify(name)}`, plan: pick(plans), createdBy: creator._id, createdAt, updatedAt: createdAt };
    workspaces.push(ws);
    const size = 2 + rand(14);
    const people = new Set([creator]);
    while (people.size < size) people.add(pick(users.filter((u) => u.createdAt >= creator.createdAt)));
    [...people].forEach((u, j) => {
      const joined = new Date(Math.max(createdAt.getTime(), u.createdAt.getTime()) + rand(3 * DAY));
      memberships.push({ workspace: ws._id, user: u._id, role: j === 0 ? 'admin' : 'member', createdAt: joined, updatedAt: joined });
    });
  });
  await db.collection('workspaces').insertMany(workspaces);
  await db.collection('memberships').insertMany(memberships);
  console.log(`Added ${users.length} demo accounts, ${workspaces.length} demo workspaces and ${memberships.length} memberships.`);
  console.log('Open Platform admin in the app to see them. Remove them with "demo remove".');
}

async function main() {
  if (config.isProd && process.env.ALLOW_DEMO !== 'true') {
    console.error('Refusing to add demo data in production. Set ALLOW_DEMO=true to override.');
    process.exitCode = 1;
    return;
  }
  await connectMongo();
  try {
    const { db } = mongoose.connection;
    if (process.argv[2] === 'remove') await remove(db);
    else await add(db);
  } finally {
    await disconnectMongo();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
