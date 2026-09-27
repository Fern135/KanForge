'use strict';

// Migrations run with a dedicated user that holds dbAdmin (needed for indexes and
// validators). The API itself connects with a readWrite-only user.
const url = process.env.MONGO_MIGRATE_URI || process.env.MONGO_URI;
if (!url) {
  // eslint-disable-next-line no-console
  console.error('MONGO_MIGRATE_URI (or MONGO_URI) must be set');
  process.exit(1);
}

module.exports = {
  mongodb: { url, options: {} },
  migrationsDir: 'migrations',
  changelogCollectionName: 'changelog',
  lockCollectionName: 'changelog_lock',
  lockTtl: 300,
  migrationFileExtension: '.js',
  useFileHash: false,
  moduleSystem: 'commonjs',
};
