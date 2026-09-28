'use strict';

// Adds the admin role to users and the instance settings collection (app
// on/off switches, whether admin has been claimed). On an install that already
// has accounts, the earliest one becomes admin (skipping the seeded demo user
// when there's anyone else), so the instance never ends up without an admin.

const SEED_EMAIL = 'demo@example.com';

const settingsValidator = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['_id'],
    properties: {
      _id: { bsonType: 'string', maxLength: 32 },
      adminClaimed: { bsonType: 'bool' },
      apps: { bsonType: 'object' },
    },
  },
};

async function usersSchema(db) {
  const [info] = await db.listCollections({ name: 'users' }).toArray();
  return info.options.validator.$jsonSchema;
}

module.exports = {
  async up(db) {
    const schema = await usersSchema(db);
    schema.properties = { ...schema.properties, role: { enum: ['user', 'admin'] } };
    await db.command({ collMod: 'users', validator: { $jsonSchema: schema } });
    await db.collection('users').createIndex({ role: 1 }, { name: 'role' });

    const exists = (await db.listCollections({ name: 'settings' }, { nameOnly: true }).toArray()).length > 0;
    if (exists) {
      await db.command({ collMod: 'settings', validator: settingsValidator, validationLevel: 'strict', validationAction: 'error' });
    } else {
      await db.createCollection('settings', { validator: settingsValidator, validationLevel: 'strict', validationAction: 'error' });
    }

    const users = db.collection('users');
    if (!(await users.countDocuments())) return;
    if (!(await users.countDocuments({ role: 'admin' }))) {
      const oldest = { sort: { createdAt: 1, _id: 1 }, projection: { _id: 1 } };
      const first = (await users.findOne({ email: { $ne: SEED_EMAIL } }, oldest)) || (await users.findOne({}, oldest));
      await users.updateOne({ _id: first._id }, { $set: { role: 'admin' } });
    }
    await db.collection('settings').updateOne({ _id: 'instance' }, { $set: { adminClaimed: true } }, { upsert: true });
  },

  async down(db) {
    await db.collection('users').dropIndex('role').catch(() => {});
    await db.collection('users').updateMany({ role: { $exists: true } }, { $unset: { role: '' } });
    const schema = await usersSchema(db);
    delete schema.properties.role;
    await db.command({ collMod: 'users', validator: { $jsonSchema: schema } });
    await db.collection('settings').drop().catch(() => {});
  },
};
