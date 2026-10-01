'use strict';

// PIN devices record which browser they belong to (a hash of its device id), so
// signing that browser out from the device list also ends its PIN sign-in.

async function usersSchema(db) {
  const [info] = await db.listCollections({ name: 'users' }).toArray();
  return info.options.validator.$jsonSchema;
}

const device = { bsonType: 'string', minLength: 64, maxLength: 64 };

module.exports = {
  async up(db) {
    const schema = await usersSchema(db);
    schema.properties.pinDevices.items.properties = { ...schema.properties.pinDevices.items.properties, device };
    await db.command({ collMod: 'users', validator: { $jsonSchema: schema } });
  },

  async down(db) {
    const schema = await usersSchema(db);
    delete schema.properties.pinDevices.items.properties.device;
    await db.command({ collMod: 'users', validator: { $jsonSchema: schema } });
    await db.collection('users').updateMany({ 'pinDevices.device': { $exists: true } }, { $unset: { 'pinDevices.$[].device': '' } });
  },
};
