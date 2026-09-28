'use strict';

// Creates the notes collection (Notes app) with its validator and indexes.
// Notes in the trash are deleted automatically 30 days after trashedAt.

const TRASH_DAYS = 30;

const validator = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['owner', 'content', 'version'],
    properties: {
      owner: { bsonType: 'objectId' },
      title: { bsonType: 'string', maxLength: 200 },
      content: { bsonType: 'object' },
      text: { bsonType: 'string', maxLength: 150000 },
      tags: { bsonType: 'array', maxItems: 20, items: { bsonType: 'string', minLength: 1, maxLength: 30 } },
      pinned: { bsonType: 'bool' },
      archived: { bsonType: 'bool' },
      trashedAt: { bsonType: ['date', 'null'] },
      version: { bsonType: ['int', 'long', 'double'] },
    },
  },
};

const indexes = [
  { key: { owner: 1, trashedAt: 1, archived: 1, pinned: -1, updatedAt: -1 }, name: 'owner_list' },
  { key: { owner: 1, tags: 1 }, name: 'owner_tags' },
  { key: { trashedAt: 1 }, name: 'trashedAt_ttl', expireAfterSeconds: TRASH_DAYS * 24 * 60 * 60 },
];

module.exports = {
  async up(db) {
    const exists = (await db.listCollections({ name: 'notes' }, { nameOnly: true }).toArray()).length > 0;
    const opts = { validator, validationLevel: 'strict', validationAction: 'error' };
    if (exists) await db.command({ collMod: 'notes', ...opts });
    else await db.createCollection('notes', opts);
    await db.collection('notes').createIndexes(indexes);
  },

  async down(db) {
    await db.collection('notes').drop().catch(() => {});
  },
};
