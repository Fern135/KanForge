'use strict';

// Invite links replace auto-join. Signing up no longer puts anyone in a
// workspace: people join through a link a workspace admin created. Only a
// SHA-256 hash of each link's token is stored, and expired links are deleted
// by a TTL index.

const objectId = { bsonType: 'objectId' };

const invites = {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['workspace', 'tokenHash', 'role', 'expiresAt', 'uses'],
      properties: {
        workspace: objectId,
        tokenHash: { bsonType: 'string', pattern: '^[a-f0-9]{64}$' },
        role: { enum: ['admin', 'member'] },
        createdBy: objectId,
        expiresAt: { bsonType: 'date' },
        maxUses: { bsonType: ['int', 'long', 'double', 'null'], minimum: 1 },
        uses: { bsonType: ['int', 'long', 'double'], minimum: 0 },
      },
    },
  },
  indexes: [
    { key: { tokenHash: 1 }, name: 'tokenHash_unique', unique: true },
    { key: { workspace: 1, createdAt: -1 }, name: 'workspace_createdAt' },
    { key: { expiresAt: 1 }, name: 'expiresAt_ttl', expireAfterSeconds: 0 },
  ],
};

module.exports = {
  async up(db) {
    const exists = (await db.listCollections({ name: 'invites' }).toArray()).length > 0;
    const opts = { validator: invites.validator, validationLevel: 'strict', validationAction: 'error' };
    if (exists) await db.command({ collMod: 'invites', ...opts });
    else await db.createCollection('invites', opts);
    await db.collection('invites').createIndexes(invites.indexes);

    await db.collection('workspaces').updateMany({ autoJoin: { $exists: true } }, { $unset: { autoJoin: '' } });
    await db.collection('workspaces').dropIndex('autoJoin').catch(() => {});
  },

  // Puts auto-join back on the "Main" workspace of a self-hosted install, as
  // the workspaces migration left it.
  async down(db) {
    await db.collection('workspaces').createIndex({ autoJoin: 1 }, { name: 'autoJoin', partialFilterExpression: { autoJoin: true } });
    await db.collection('workspaces').updateOne({ slug: 'main', plan: 'self-hosted' }, { $set: { autoJoin: true } });
    await db.collection('invites').drop().catch(() => {});
  },
};
