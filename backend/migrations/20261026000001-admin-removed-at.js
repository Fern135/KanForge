'use strict';

// When someone stopped being a platform admin. Their password can't be reset by
// another admin for a while after (routes/admin.js), so removing an admin's role
// can't be the first step to signing in as them.

const properties = { adminRemovedAt: { bsonType: 'date' } };

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
    await db.collection('users').updateMany({ adminRemovedAt: { $exists: true } }, { $unset: { adminRemovedAt: '' } });
  },
};
