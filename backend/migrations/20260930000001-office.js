'use strict';

// Collections for the Office app: documents, their folders, and the images
// placed in documents. Documents in the trash are deleted 30 days after trashedAt.

const TRASH_DAYS = 30;
const objectId = { bsonType: 'objectId' };

const collections = {
  office_documents: {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        required: ['owner', 'kind', 'content', 'version'],
        properties: {
          owner: objectId,
          kind: { enum: ['doc', 'sheet', 'slides'] },
          title: { bsonType: 'string', maxLength: 200 },
          content: { bsonType: 'object' },
          text: { bsonType: 'string', maxLength: 1_200_000 },
          settings: { bsonType: 'object' },
          imageIds: { bsonType: 'array', maxItems: 5000, items: objectId },
          folder: { bsonType: ['objectId', 'null'] },
          trashedAt: { bsonType: ['date', 'null'] },
          version: { bsonType: ['int', 'long', 'double'] },
          size: { bsonType: ['int', 'long', 'double'] },
        },
      },
    },
    indexes: [
      { key: { owner: 1, trashedAt: 1, updatedAt: -1 }, name: 'owner_list' },
      { key: { owner: 1, folder: 1 }, name: 'owner_folder' },
      { key: { owner: 1, imageIds: 1 }, name: 'owner_images' },
      { key: { trashedAt: 1 }, name: 'trashedAt_ttl', expireAfterSeconds: TRASH_DAYS * 24 * 60 * 60 },
    ],
  },
  office_folders: {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        required: ['owner', 'name', 'nameKey', 'path'],
        properties: {
          owner: objectId,
          name: { bsonType: 'string', minLength: 1, maxLength: 100 },
          nameKey: { bsonType: 'string', minLength: 1, maxLength: 100 },
          parent: { bsonType: ['objectId', 'null'] },
          path: { bsonType: 'array', maxItems: 10, items: objectId },
        },
      },
    },
    indexes: [
      { key: { owner: 1, parent: 1, nameKey: 1 }, name: 'owner_parent_name_unique', unique: true },
      { key: { owner: 1, path: 1 }, name: 'owner_path' },
    ],
  },
  office_images: {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        required: ['owner', 'mime', 'data', 'size'],
        properties: {
          owner: objectId,
          mime: { enum: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] },
          data: { bsonType: 'binData' },
          size: { bsonType: ['int', 'long', 'double'], minimum: 1, maximum: 5 * 1024 * 1024 },
        },
      },
    },
    indexes: [{ key: { owner: 1, createdAt: 1 }, name: 'owner_created' }],
  },
};

module.exports = {
  async up(db) {
    const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
    for (const [name, { validator, indexes }] of Object.entries(collections)) {
      const opts = { validator, validationLevel: 'strict', validationAction: 'error' };
      if (existing.has(name)) await db.command({ collMod: name, ...opts });
      else await db.createCollection(name, opts);
      await db.collection(name).createIndexes(indexes);
    }
  },

  async down(db) {
    for (const name of Object.keys(collections)) {
      await db.collection(name).drop().catch(() => {});
    }
  },
};
