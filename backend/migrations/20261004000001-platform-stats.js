'use strict';

// The super admin dashboard: when each account was last active (recorded at most
// once an hour), and indexes for counting sign-ups and active accounts. (Admins
// are found with the role index added in 20260928000003.)

const properties = {
  lastActiveAt: { bsonType: 'date' },
};
const INDEXES = [
  { key: { createdAt: 1 }, name: 'createdAt' },
  { key: { lastActiveAt: 1 }, name: 'lastActiveAt', sparse: true },
];

async function usersSchema(db) {
  const [info] = await db.listCollections({ name: 'users' }).toArray();
  return info.options.validator.$jsonSchema;
}

module.exports = {
  async up(db) {
    const schema = await usersSchema(db);
    schema.properties = { ...schema.properties, ...properties };
    await db.command({ collMod: 'users', validator: { $jsonSchema: schema } });
    await db.collection('users').createIndexes(INDEXES);
  },

  async down(db) {
    for (const { name } of INDEXES) await db.collection('users').dropIndex(name).catch(() => {});
    const schema = await usersSchema(db);
    for (const key of Object.keys(properties)) delete schema.properties[key];
    await db.command({ collMod: 'users', validator: { $jsonSchema: schema } });
    await db.collection('users').updateMany({ lastActiveAt: { $exists: true } }, { $unset: { lastActiveAt: '' } });
  },
};
