'use strict';

// Nested folders for the Notes app: the note_folders collection, and a folder
// reference on notes. Existing notes need no backfill: no folder means unfiled.

const folderValidator = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['owner', 'name', 'nameKey', 'path'],
    properties: {
      owner: { bsonType: 'objectId' },
      name: { bsonType: 'string', minLength: 1, maxLength: 100 },
      nameKey: { bsonType: 'string', minLength: 1, maxLength: 100 },
      parent: { bsonType: ['objectId', 'null'] },
      path: { bsonType: 'array', maxItems: 10, items: { bsonType: 'objectId' } },
    },
  },
};

const folderIndexes = [
  // Names are unique among siblings (a null parent means the top level).
  { key: { owner: 1, parent: 1, nameKey: 1 }, name: 'owner_parent_name_unique', unique: true },
  { key: { owner: 1, path: 1 }, name: 'owner_path' },
];

async function notesSchema(db) {
  const [info] = await db.listCollections({ name: 'notes' }).toArray();
  return info.options.validator.$jsonSchema;
}

module.exports = {
  async up(db) {
    const exists = (await db.listCollections({ name: 'note_folders' }, { nameOnly: true }).toArray()).length > 0;
    const opts = { validator: folderValidator, validationLevel: 'strict', validationAction: 'error' };
    if (exists) await db.command({ collMod: 'note_folders', ...opts });
    else await db.createCollection('note_folders', opts);
    await db.collection('note_folders').createIndexes(folderIndexes);

    const schema = await notesSchema(db);
    schema.properties = { ...schema.properties, folder: { bsonType: ['objectId', 'null'] } };
    await db.command({ collMod: 'notes', validator: { $jsonSchema: schema } });
    await db.collection('notes').createIndex({ owner: 1, folder: 1 }, { name: 'owner_folder' });
  },

  async down(db) {
    await db.collection('notes').dropIndex('owner_folder').catch(() => {});
    await db.collection('notes').updateMany({ folder: { $exists: true } }, { $unset: { folder: '' } });
    const schema = await notesSchema(db);
    delete schema.properties.folder;
    await db.command({ collMod: 'notes', validator: { $jsonSchema: schema } });
    await db.collection('note_folders').drop().catch(() => {});
  },
};
