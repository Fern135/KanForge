'use strict';

// Adds the per-card checklist title and "hide completed items" setting to the
// cards validator. Existing cards need no backfill: missing fields read as the defaults.

const properties = {
  checklistTitle: { bsonType: 'string', minLength: 1, maxLength: 100 },
  checklistHideDone: { bsonType: 'bool' },
};

async function cardsSchema(db) {
  const [info] = await db.listCollections({ name: 'cards' }).toArray();
  return info.options.validator.$jsonSchema;
}

module.exports = {
  async up(db) {
    const schema = await cardsSchema(db);
    schema.properties = { ...schema.properties, ...properties };
    await db.command({ collMod: 'cards', validator: { $jsonSchema: schema } });
  },

  async down(db) {
    const schema = await cardsSchema(db);
    for (const key of Object.keys(properties)) delete schema.properties[key];
    await db.command({ collMod: 'cards', validator: { $jsonSchema: schema } });
  },
};
