'use strict';

// Multi-tenancy: workspaces and memberships, and a required workspace on every
// document people create. An install that already has accounts gets one
// workspace, "Main", holding all existing data. Everyone joins it, platform
// admins as its admins, and the old instance-wide app switches move onto it.
// On a self-hosted install it also takes in future sign-ups (autoJoin), so it
// keeps working the way it did before.

const objectId = { bsonType: 'objectId' };
const PLANS = ['self-hosted', 'standard', 'plus'];

const TENANT_COLLECTIONS = [
  'boards', 'lists', 'cards', 'comments',
  'notes', 'note_folders',
  'office_documents', 'office_folders', 'office_images',
];

// Folder names are unique among siblings, now per workspace.
const FOLDER_COLLECTIONS = ['note_folders', 'office_folders'];
const OLD_FOLDER_UNIQUE = { key: { owner: 1, parent: 1, nameKey: 1 }, name: 'owner_parent_name_unique', unique: true };
const NEW_FOLDER_UNIQUE = { key: { workspace: 1, owner: 1, parent: 1, nameKey: 1 }, name: 'workspace_owner_parent_name_unique', unique: true };

const collections = {
  workspaces: {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        required: ['name', 'slug', 'plan'],
        properties: {
          name: { bsonType: 'string', minLength: 1, maxLength: 60 },
          slug: { bsonType: 'string', pattern: '^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){2,39}$' },
          plan: { enum: PLANS },
          apps: { bsonType: 'object' },
          autoJoin: { bsonType: 'bool' },
          createdBy: objectId,
        },
      },
    },
    indexes: [
      { key: { slug: 1 }, name: 'slug_unique', unique: true },
      { key: { autoJoin: 1 }, name: 'autoJoin', partialFilterExpression: { autoJoin: true } },
      { key: { createdBy: 1 }, name: 'createdBy' },
      { key: { createdAt: 1 }, name: 'createdAt' },
    ],
  },
  memberships: {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        required: ['workspace', 'user', 'role'],
        properties: {
          workspace: objectId,
          user: objectId,
          role: { enum: ['admin', 'member'] },
        },
      },
    },
    indexes: [
      { key: { workspace: 1, user: 1 }, name: 'workspace_user_unique', unique: true },
      { key: { user: 1 }, name: 'user' },
      { key: { workspace: 1, role: 1 }, name: 'workspace_role' },
      { key: { createdAt: 1 }, name: 'createdAt' },
    ],
  },
};

async function schemaOf(db, name) {
  const [info] = await db.listCollections({ name }).toArray();
  return info?.options?.validator?.$jsonSchema;
}

async function setWorkspaceRequired(db, name, on) {
  const schema = await schemaOf(db, name);
  if (!schema) return;
  const properties = { ...schema.properties };
  let required = (schema.required || []).filter((f) => f !== 'workspace');
  if (on) {
    properties.workspace = objectId;
    required = [...required, 'workspace'];
  } else {
    delete properties.workspace;
  }
  await db.command({ collMod: name, validator: { $jsonSchema: { ...schema, properties, required } } });
}

module.exports = {
  async up(db) {
    const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
    for (const [name, { validator, indexes }] of Object.entries(collections)) {
      const opts = { validator, validationLevel: 'strict', validationAction: 'error' };
      if (existing.has(name)) await db.command({ collMod: name, ...opts });
      else await db.createCollection(name, opts);
      await db.collection(name).createIndexes(indexes);
    }

    const users = db.collection('users');
    if (await users.countDocuments()) {
      const plan = PLANS.includes(process.env.DEFAULT_PLAN) ? process.env.DEFAULT_PLAN : 'self-hosted';
      const settings = await db.collection('settings').findOne({ _id: 'instance' });
      const firstAdmin = await users.findOne({ role: 'admin' }, { sort: { createdAt: 1 }, projection: { _id: 1 } });
      const now = new Date();

      let ws = await db.collection('workspaces').findOne({ slug: 'main' });
      if (!ws) {
        const doc = {
          name: 'Main',
          slug: 'main',
          plan,
          autoJoin: plan === 'self-hosted',
          createdAt: now,
          updatedAt: now,
        };
        if (settings?.apps) doc.apps = settings.apps;
        if (firstAdmin) doc.createdBy = firstAdmin._id;
        const { insertedId } = await db.collection('workspaces').insertOne(doc);
        ws = { _id: insertedId };
      }

      const all = await users.find({}, { projection: { _id: 1, role: 1, createdAt: 1 } }).toArray();
      await db.collection('memberships').bulkWrite(
        all.map((u) => ({
          updateOne: {
            filter: { workspace: ws._id, user: u._id },
            update: {
              $setOnInsert: {
                role: u.role === 'admin' ? 'admin' : 'member',
                createdAt: u.createdAt || now,
                updatedAt: now,
              },
            },
            upsert: true,
          },
        })),
        { ordered: false },
      );

      for (const name of TENANT_COLLECTIONS) {
        if (existing.has(name)) {
          await db.collection(name).updateMany({ workspace: { $exists: false } }, { $set: { workspace: ws._id } });
        }
      }
    }

    for (const name of TENANT_COLLECTIONS) {
      if (!existing.has(name)) continue;
      await setWorkspaceRequired(db, name, true);
      await db.collection(name).createIndex({ workspace: 1 }, { name: 'workspace' });
    }
    for (const name of FOLDER_COLLECTIONS) {
      if (!existing.has(name)) continue;
      await db.collection(name).createIndex(NEW_FOLDER_UNIQUE.key, { name: NEW_FOLDER_UNIQUE.name, unique: true });
      await db.collection(name).dropIndex(OLD_FOLDER_UNIQUE.name).catch(() => {});
    }
    // App switches live on each workspace now.
    await db.collection('settings').updateOne({ _id: 'instance' }, { $unset: { apps: '' } }).catch(() => {});
  },

  // Rolls back to a single shared space. Data from every workspace is merged, and
  // folder names that clash across workspaces make the old unique index fail.
  async down(db) {
    const main = await db.collection('workspaces').findOne({ slug: 'main' });
    if (main?.apps) {
      await db.collection('settings').updateOne({ _id: 'instance' }, { $set: { apps: main.apps } }, { upsert: true });
    }
    for (const name of FOLDER_COLLECTIONS) {
      await db.collection(name).createIndex(OLD_FOLDER_UNIQUE.key, { name: OLD_FOLDER_UNIQUE.name, unique: true });
      await db.collection(name).dropIndex(NEW_FOLDER_UNIQUE.name).catch(() => {});
    }
    for (const name of TENANT_COLLECTIONS) {
      await setWorkspaceRequired(db, name, false);
      await db.collection(name).dropIndex('workspace').catch(() => {});
      await db.collection(name).updateMany({}, { $unset: { workspace: '' } });
    }
    await db.collection('memberships').drop().catch(() => {});
    await db.collection('workspaces').drop().catch(() => {});
  },
};
