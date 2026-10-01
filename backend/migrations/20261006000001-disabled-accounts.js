'use strict';

// Platform admins on a self-hosted install can disable an account: it can't sign
// in until it's enabled again.

const properties = { disabled: { bsonType: 'bool' } };

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
    await db.collection('users').updateMany({ disabled: { $exists: true } }, { $unset: { disabled: '' } });
  },
};
