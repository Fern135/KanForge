'use strict';

const config = require('./core/config');
const logger = require('./core/utils/logger');
const { connectMongo, disconnectMongo } = require('./core/db/mongo');
const { connectRedis, disconnectRedis } = require('./core/db/redis');
const { createApp } = require('./app');

async function main() {
  await Promise.all([connectMongo(), connectRedis()]);

  const server = createApp().listen(config.port, () => {
    logger.info({ port: config.port, env: config.env }, 'API listening');
  });
  // Slowloris protection and bounded request lifetimes.
  server.headersTimeout = 15_000;
  server.requestTimeout = 30_000;
  server.keepAliveTimeout = 65_000;

  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down');
    const force = setTimeout(() => process.exit(1), 10_000).unref();
    server.close(async () => {
      await Promise.allSettled([disconnectMongo(), disconnectRedis()]);
      clearTimeout(force);
      process.exit(0);
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

process.on('unhandledRejection', (err) => {
  logger.fatal({ err }, 'Unhandled rejection');
  process.exit(1);
});

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start');
  process.exit(1);
});
