'use strict';

// Creates a demo user in a "Demo" workspace with a sample board. Refuses to run
// in production unless ALLOW_SEED=true is set explicitly.
const crypto = require('node:crypto');
const argon2 = require('argon2');
const config = require('../src/core/config');
const { connectMongo, disconnectMongo } = require('../src/core/db/mongo');
const User = require('../src/core/models/User');
const Workspace = require('../src/core/models/Workspace');
const Membership = require('../src/core/models/Membership');
const { runInWorkspace } = require('../src/core/tenancy');
const Board = require('../src/apps/boards/models/Board');
const List = require('../src/apps/boards/models/List');
const Card = require('../src/apps/boards/models/Card');

async function main() {
  if (config.isProd && process.env.ALLOW_SEED !== 'true') {
    console.error('Refusing to seed in production. Set ALLOW_SEED=true to override.');
    process.exit(1);
  }
  await connectMongo();

  const email = 'demo@example.com';
  if (await User.exists({ email })) {
    console.log(`Seed user ${email} already exists, nothing to do.`);
    return;
  }
  const password = `Demo-${crypto.randomBytes(9).toString('base64url')}`;
  const user = await User.create({
    email,
    name: 'Demo User',
    passwordHash: await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 }),
  });

  let slug = 'demo';
  while (await Workspace.exists({ slug })) slug = `demo-${crypto.randomBytes(3).toString('hex')}`;
  const workspace = await Workspace.create({ name: 'Demo', slug, plan: config.defaultPlan, createdBy: user._id });
  await Membership.create({ workspace: workspace._id, user: user._id, role: 'admin' });
  await runInWorkspace(workspace._id, () => seedBoard(user));

  console.log('Seeded demo data:');
  console.log(`  email:     ${email}`);
  console.log(`  password:  ${password}`);
  console.log(`  workspace: /app/w/${slug}/`);
}

async function seedBoard(user) {
  const board = await Board.create({
    title: 'Product Launch',
    background: 'navy',
    members: [{ user: user._id, role: 'owner' }],
    labels: [
      { name: 'Frontend', color: 'green' },
      { name: 'Backend', color: 'navy' },
      { name: 'Urgent', color: 'red' },
      { name: 'Design', color: 'purple' },
    ],
  });
  const [fe, be, urgent, design] = board.labels.map((l) => l._id);

  const data = {
    'To Do': [
      { title: 'Write launch announcement', labels: [urgent] },
      { title: 'Design pricing page', labels: [design, fe] },
      { title: 'Set up monitoring alerts', labels: [be] },
    ],
    'In Progress': [
      {
        title: 'Build onboarding flow',
        labels: [fe],
        description: 'Three-step onboarding with progress indicator.',
        checklist: [{ text: 'Welcome screen', done: true }, { text: 'Profile step' }, { text: 'Invite team step' }],
      },
      { title: 'Rate-limit public API', labels: [be, urgent], dueDate: new Date(Date.now() + 2 * 86400000) },
    ],
    Review: [{ title: 'Accessibility audit', labels: [fe, design] }],
    Done: [{ title: 'Choose tech stack', labels: [be], dueComplete: true, dueDate: new Date(Date.now() - 86400000) }],
  };

  let lp = 0;
  for (const [title, cards] of Object.entries(data)) {
    lp += 1024;
    const list = await List.create({ board: board._id, title, position: lp });
    await Card.insertMany(
      cards.map((c, i) => ({ ...c, board: board._id, list: list._id, position: (i + 1) * 1024, createdBy: user._id })),
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => disconnectMongo());
