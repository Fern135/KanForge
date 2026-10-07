'use strict';

// Collections for the Files app: files and folders (file_nodes), sharing
// (file_shares), stored contents waiting to be deleted (file_garbage), and the
// platform admin's storage settings (files_settings, file_quotas). File contents
// themselves live in the object store, not here. Folders nest without a depth
// limit, so `path` has no maximum length.

const objectId = { bsonType: 'objectId' };
const number = { bsonType: ['int', 'long', 'double'] };

const collections = {
  file_nodes: {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        required: ['workspace', 'owner', 'kind', 'name', 'nameKey', 'path'],
        properties: {
          workspace: objectId,
          owner: objectId,
          kind: { enum: ['folder', 'file'] },
          name: { bsonType: 'string', minLength: 1, maxLength: 255 },
          nameKey: { bsonType: 'string', minLength: 1, maxLength: 255 },
          parent: { bsonType: ['objectId', 'null'] },
          path: { bsonType: 'array', items: objectId },
          size: { ...number, minimum: 0 },
          mime: { bsonType: 'string', maxLength: 255 },
          storageKey: { bsonType: 'string', maxLength: 300 },
          status: { enum: ['uploading', 'ready'] },
          uploadId: { bsonType: 'string', maxLength: 1024 },
          partSize: { ...number, minimum: 1 },
          uploadedBy: objectId,
          trashedAt: { bsonType: ['date', 'null'] },
          trashRoot: { bsonType: ['objectId', 'null'] },
        },
      },
    },
    indexes: [
      // The top of someone's drive (parent null), folders first then by name.
      { key: { owner: 1, parent: 1, kind: -1, nameKey: 1 }, name: 'owner_parent_list' },
      // A folder's contents.
      { key: { parent: 1, kind: -1, nameKey: 1 }, name: 'parent_list' },
      // Everything inside a folder, at any depth.
      { key: { path: 1 }, name: 'path' },
      // Storage used, and the item count per person.
      { key: { owner: 1, kind: 1 }, name: 'owner_kind' },
      // Recent files.
      { key: { owner: 1, updatedAt: -1 }, name: 'owner_recent' },
      // Search by name.
      { key: { owner: 1, nameKey: 1 }, name: 'owner_name' },
      // What went to the trash together.
      { key: { trashRoot: 1 }, name: 'trash_root', partialFilterExpression: { trashRoot: { $type: 'objectId' } } },
      // The sweeper: trash older than 30 days, and abandoned uploads.
      { key: { trashedAt: 1 }, name: 'trashed', partialFilterExpression: { trashedAt: { $type: 'date' } } },
      { key: { updatedAt: 1 }, name: 'uploading', partialFilterExpression: { status: 'uploading' } },
    ],
  },
  file_shares: {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        required: ['workspace', 'node', 'owner', 'role', 'createdBy'],
        properties: {
          workspace: objectId,
          node: objectId,
          owner: objectId,
          grantee: { bsonType: ['objectId', 'null'] },
          role: { enum: ['view', 'edit'] },
          createdBy: objectId,
        },
      },
    },
    indexes: [
      // One share per person per item, and one public link (grantee null).
      { key: { node: 1, grantee: 1 }, name: 'node_grantee_unique', unique: true },
      { key: { grantee: 1, createdAt: -1 }, name: 'grantee' },
      { key: { owner: 1 }, name: 'owner' },
    ],
  },
  file_garbage: {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        required: ['key'],
        properties: {
          key: { bsonType: 'string', maxLength: 300 },
          uploadId: { bsonType: 'string', maxLength: 1024 },
          attempts: number,
        },
      },
    },
    indexes: [{ key: { attempts: 1, createdAt: 1 }, name: 'queue' }],
  },
  files_settings: {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        properties: {
          linkSharing: { bsonType: 'bool' },
          defaultQuotaBytes: { bsonType: ['int', 'long', 'double', 'null'], minimum: 0 },
          maxFileBytes: { bsonType: ['int', 'long', 'double', 'null'], minimum: 1 },
        },
      },
    },
    indexes: [],
  },
  file_quotas: {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        properties: {
          bytes: { bsonType: ['int', 'long', 'double', 'null'], minimum: 0 },
        },
      },
    },
    indexes: [],
  },
};

module.exports = {
  async up(db) {
    const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
    for (const [name, { validator, indexes }] of Object.entries(collections)) {
      const opts = { validator, validationLevel: 'strict', validationAction: 'error' };
      if (existing.has(name)) await db.command({ collMod: name, ...opts });
      else await db.createCollection(name, opts);
      if (indexes.length) await db.collection(name).createIndexes(indexes);
    }
  },

  async down(db) {
    for (const name of Object.keys(collections)) {
      await db.collection(name).drop().catch(() => {});
    }
  },
};
