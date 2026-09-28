'use strict';

// Adds remembered PIN devices to users: the validator entry and a sparse index
// for looking up a device token's hash at sign-in.

const properties = {
  pinDevices: {
    bsonType: 'array',
    maxItems: 10,
    items: {
      bsonType: 'object',
      required: ['tokenHash', 'createdAt'],
      properties: { tokenHash: { bsonType: 'string', minLength: 64, maxLength: 64 }, createdAt: { bsonType: 'date' } },
    },
  },
};
const INDEX = 'pinDevices_tokenHash';

async function usersSchema(db) {
  const [info] = await db.listCollections({ name: 'users' }).toArray();
  return info.options.validator.$jsonSchema;
}

module.exports = {
  async up(db) {
    const schema = await usersSchema(db);
    schema.properties = { ...schema.properties, ...properties };
    await db.command({ collMod: 'users', validator: { $jsonSchema: schema } });
    await db.collection('users').createIndex({ 'pinDevices.tokenHash': 1 }, { name: INDEX, sparse: true });
  },

  async down(db) {
    await db.collection('users').dropIndex(INDEX).catch(() => {});
    await db.collection('users').updateMany({ pinDevices: { $exists: true } }, { $unset: { pinDevices: '' } });
    const schema = await usersSchema(db);
    for (const key of Object.keys(properties)) delete schema.properties[key];
    await db.command({ collMod: 'users', validator: { $jsonSchema: schema } });
  },
};
