'use strict';

const { Redis } = require('ioredis');
const config = require('../config');
const logger = require('../utils/logger');

const redis = new Redis(config.redisUrl, {
  lazyConnect: true,
  maxRetriesPerRequest: 3,
  enableAutoPipelining: true,
});

redis.on('error', (err) => logger.error({ err: err.message }, 'Redis error'));

async function connectRedis() {
  await redis.connect();
  logger.info('Redis connected');
}

async function disconnectRedis() {
  await redis.quit();
}

module.exports = { redis, connectRedis, disconnectRedis };
