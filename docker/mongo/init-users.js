// Runs once, when the MongoDB volume is first initialized. Creates least-privilege
// users: the API gets readWrite only, and migrations get readWrite + dbAdmin.
const dbName = process.env.MONGO_APP_DB;
const appDb = db.getSiblingDB(dbName);

appDb.createUser({
  user: process.env.MONGO_APP_USER,
  pwd: process.env.MONGO_APP_PASSWORD,
  roles: [{ role: 'readWrite', db: dbName }],
});

appDb.createUser({
  user: process.env.MONGO_MIGRATE_USER,
  pwd: process.env.MONGO_MIGRATE_PASSWORD,
  roles: [
    { role: 'readWrite', db: dbName },
    { role: 'dbAdmin', db: dbName },
  ],
});
