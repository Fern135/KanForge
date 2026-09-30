'use strict';

// People on a self-hosted install: what each person can use in each app (set by
// a platform admin, directly or through an invite link), and accounts made with
// a temporary password that must be replaced at first sign-in.

const access = { bsonType: 'object', additionalProperties: { enum: ['none', 'view', 'edit'] } };
const CHANGES = {
  users: { access, mustChangePassword: { bsonType: 'bool' } },
  invites: { access },
};

async function schemaOf(db, name) {
  const [info] = await db.listCollections({ name }).toArray();
  return info.options.validator.$jsonSchema;
}

module.exports = {
  async up(db) {
    for (const [name, properties] of Object.entries(CHANGES)) {
      const schema = await schemaOf(db, name);
      schema.properties = { ...schema.properties, ...properties };
      await db.command({ collMod: name, validator: { $jsonSchema: schema } });
    }
  },

  async down(db) {
    for (const [name, properties] of Object.entries(CHANGES)) {
      const schema = await schemaOf(db, name);
      for (const key of Object.keys(properties)) delete schema.properties[key];
      await db.command({ collMod: name, validator: { $jsonSchema: schema } });
      const unset = Object.fromEntries(Object.keys(properties).map((k) => [k, '']));
      await db.collection(name).updateMany({}, { $unset: unset });
    }
  },
};
