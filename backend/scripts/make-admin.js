'use strict';

// Makes an existing account a platform admin: `make admin email=you@example.com`
// (or `./run.sh admin you@example.com`). Signing up never grants this role, so
// only someone who can run commands on the server can create the first admin.
// Later admins can also be made from Platform admin in the app.
const User = require('../src/core/models/User');
const cache = require('../src/core/services/cache');

async function makeAdmin(rawEmail) {
  const email = String(rawEmail || '').trim().toLowerCase();
  if (!email) throw new Error('Usage: make admin email=you@example.com');
  const user = await User.findOneAndUpdate({ email }, { $set: { role: 'admin' } }, { new: true }).select('email name role').lean();
  if (!user) throw new Error(`No account uses ${email}. Sign up in the app first, then run this again.`);
  await cache.invalidateUser(String(user._id));
  return user;
}

async function main() {
  const { connectMongo, disconnectMongo } = require('../src/core/db/mongo');
  const { connectRedis, disconnectRedis } = require('../src/core/db/redis');
  await Promise.all([connectMongo(), connectRedis()]);
  try {
    const user = await makeAdmin(process.argv[2]);
    console.log(`${user.name} (${user.email}) is now a platform admin.`);
  } finally {
    await Promise.allSettled([disconnectMongo(), disconnectRedis()]);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}

module.exports = { makeAdmin };
