'use strict';

// Creates every collection with a server-side $jsonSchema validator (the database
// rejects malformed documents even if application validation were bypassed) and
// all indexes the queries rely on.

const objectId = { bsonType: 'objectId' };
const date = { bsonType: 'date' };
const str = (maxLength, minLength = 0) => ({ bsonType: 'string', minLength, maxLength });

const collections = {
  users: {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        required: ['email', 'name', 'passwordHash'],
        properties: {
          email: str(254, 3),
          name: str(60, 1),
          passwordHash: { bsonType: 'string', pattern: '^\\$argon2id\\$' },
          tokenVersion: { bsonType: ['int', 'long', 'double'] },
        },
      },
    },
    indexes: [{ key: { email: 1 }, name: 'email_unique', unique: true }],
  },
  sessions: {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        required: ['user', 'tokenHash', 'family', 'expiresAt'],
        properties: { user: objectId, tokenHash: str(64, 64), family: str(64, 8), expiresAt: date },
      },
    },
    indexes: [
      { key: { tokenHash: 1 }, name: 'tokenHash_unique', unique: true },
      { key: { user: 1 }, name: 'user' },
      { key: { family: 1 }, name: 'family' },
      // Expired sessions are purged automatically.
      { key: { expiresAt: 1 }, name: 'expiresAt_ttl', expireAfterSeconds: 0 },
    ],
  },
  boards: {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        required: ['title', 'members'],
        properties: { title: str(100, 1), members: { bsonType: 'array', maxItems: 100 }, labels: { bsonType: 'array', maxItems: 30 } },
      },
    },
    indexes: [{ key: { 'members.user': 1, updatedAt: -1 }, name: 'member_boards' }],
  },
  lists: {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        required: ['board', 'title', 'position'],
        properties: { board: objectId, title: str(100, 1) },
      },
    },
    indexes: [{ key: { board: 1, position: 1 }, name: 'board_position' }],
  },
  cards: {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        required: ['board', 'list', 'title', 'position', 'createdBy'],
        properties: {
          board: objectId,
          list: objectId,
          title: str(200, 1),
          description: str(5000),
          checklist: { bsonType: 'array', maxItems: 100 },
          labels: { bsonType: 'array', maxItems: 30 },
        },
      },
    },
    indexes: [
      { key: { list: 1, position: 1 }, name: 'list_position' },
      { key: { board: 1, position: 1 }, name: 'board_position' },
    ],
  },
  comments: {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        required: ['board', 'card', 'author', 'text'],
        properties: { board: objectId, card: objectId, author: objectId, text: str(2000, 1) },
      },
    },
    indexes: [
      { key: { card: 1, createdAt: -1 }, name: 'card_recent' },
      { key: { board: 1 }, name: 'board' },
    ],
  },
};

module.exports = {
  async up(db) {
    const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
    for (const [name, { validator, indexes }] of Object.entries(collections)) {
      if (existing.has(name)) {
        await db.command({ collMod: name, validator, validationLevel: 'strict', validationAction: 'error' });
      } else {
        await db.createCollection(name, { validator, validationLevel: 'strict', validationAction: 'error' });
      }
      await db.collection(name).createIndexes(indexes);
    }
  },

  async down(db) {
    for (const [name, { indexes }] of Object.entries(collections)) {
      for (const idx of indexes) {
        await db.collection(name).dropIndex(idx.name).catch(() => {});
      }
      await db.command({ collMod: name, validator: {}, validationLevel: 'off' }).catch(() => {});
    }
  },
};
