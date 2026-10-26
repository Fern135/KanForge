'use strict';

// Makes an account a platform admin: `make admin email=you@example.com`
// (or `./run.sh admin you@example.com`). Signing up never grants this role, so
// only someone who can run commands on the server can create the first admin.
// When no account uses the email yet (sign-up is off by default), one is created
// with a temporary password, printed once, that must be replaced at first sign-in.
// Later admins can also be made from Platform admin in the app.
const User = require('../src/core/models/User');
const cache = require('../src/core/services/cache');
const { temporaryPassword, hashPassword } = require('../src/core/services/passwords');

// Returns the admin's { email, name, role }, plus `password` when the account was just created.
async function makeAdmin(rawEmail) {
  const email = String(rawEmail || '').trim().toLowerCase();
  if (!email) throw new Error('Usage: make admin email=you@example.com');
  const user = await User.findOneAndUpdate({ email }, { $set: { role: 'admin' } }, { returnDocument: 'after' }).select('email name role').lean();
  if (user) {
    await cache.invalidateUser(String(user._id));
    return user;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error(`${email} isn't a valid email address.`);
  const password = temporaryPassword();
  const created = await User.create({
    email,
    name: email.split('@')[0].slice(0, 60),
    role: 'admin',
    passwordHash: await hashPassword(password),
    mustChangePassword: true,
  });
  return { email: created.email, name: created.name, role: created.role, password };
}

async function main() {
  const { connectMongo, disconnectMongo } = require('../src/core/db/mongo');
  const { connectRedis, disconnectRedis } = require('../src/core/db/redis');
  await Promise.all([connectMongo(), connectRedis()]);
  try {
    const user = await makeAdmin(process.argv[2]);
    console.log(`${user.name} (${user.email}) is now a platform admin.`);
    if (user.password) {
      console.log('No account used that email, so one was created. Sign in with this temporary password');
      console.log('(shown only now); you\'ll choose your own right after:');
      console.log(`  ${user.password}`);
    }
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
