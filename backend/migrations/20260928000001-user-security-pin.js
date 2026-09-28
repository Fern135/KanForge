'use strict';

// Adds the optional sign-in PIN hash to the users validator. Existing users need
// no backfill: a missing pinHash means the PIN is off.

const properties = {
  pinHash: { bsonType: 'string', pattern: '^\\$argon2id\\$' },
};

async function usersSchema(db) {
  const [info] = await db.listCollections({ name: 'users' }).toArray();
  return info.options.validator.$jsonSchema;
}

module.exports = {
  async up(db) {
    const schema = await usersSchema(db);
    schema.properties = { ...schema.properties, ...properties };
    await db.command({ collMod: 'users', validator: { $jsonSchema: schema } });
  },

  async down(db) {
    const schema = await usersSchema(db);
    for (const key of Object.keys(properties)) delete schema.properties[key];
    await db.command({ collMod: 'users', validator: { $jsonSchema: schema } });
    await db.collection('users').updateMany({ pinHash: { $exists: true } }, { $unset: { pinHash: '' } });
  },
};
