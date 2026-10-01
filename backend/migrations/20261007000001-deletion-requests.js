'use strict';

// People can ask a platform admin to delete their account. The request is kept
// on the account until it's carried out or withdrawn.

const properties = { deletionRequestedAt: { bsonType: 'date' } };
const INDEX = { key: { deletionRequestedAt: 1 }, name: 'deletionRequestedAt', sparse: true };

async function usersSchema(db) {
  const [info] = await db.listCollections({ name: 'users' }).toArray();
  return info.options.validator.$jsonSchema;
}

module.exports = {
  async up(db) {
    const schema = await usersSchema(db);
    schema.properties = { ...schema.properties, ...properties };
    await db.command({ collMod: 'users', validator: { $jsonSchema: schema } });
    await db.collection('users').createIndex(INDEX.key, { name: INDEX.name, sparse: true });
  },

  async down(db) {
    await db.collection('users').dropIndex(INDEX.name).catch(() => {});
    const schema = await usersSchema(db);
    for (const key of Object.keys(properties)) delete schema.properties[key];
    await db.command({ collMod: 'users', validator: { $jsonSchema: schema } });
    await db.collection('users').updateMany({ deletionRequestedAt: { $exists: true } }, { $unset: { deletionRequestedAt: '' } });
  },
};
