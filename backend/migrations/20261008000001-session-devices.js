'use strict';

// Sessions remember which browser they belong to (a hash of a random per-browser
// id), so signing in again on the same browser replaces its session and the
// device list shows each browser once.

const properties = { device: { bsonType: 'string', minLength: 64, maxLength: 64 } };
const INDEX = { key: { user: 1, device: 1 }, name: 'user_device', partialFilterExpression: { device: { $exists: true } } };

async function sessionsSchema(db) {
  const [info] = await db.listCollections({ name: 'sessions' }).toArray();
  return info.options.validator.$jsonSchema;
}

module.exports = {
  async up(db) {
    const schema = await sessionsSchema(db);
    schema.properties = { ...schema.properties, ...properties };
    await db.command({ collMod: 'sessions', validator: { $jsonSchema: schema } });
    await db.collection('sessions').createIndex(INDEX.key, { name: INDEX.name, partialFilterExpression: INDEX.partialFilterExpression });
  },

  async down(db) {
    await db.collection('sessions').dropIndex(INDEX.name).catch(() => {});
    const schema = await sessionsSchema(db);
    for (const key of Object.keys(properties)) delete schema.properties[key];
    await db.command({ collMod: 'sessions', validator: { $jsonSchema: schema } });
    await db.collection('sessions').updateMany({ device: { $exists: true } }, { $unset: { device: '' } });
  },
};
