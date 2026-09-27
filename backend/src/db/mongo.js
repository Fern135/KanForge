'use strict';

const mongoose = require('mongoose');
const config = require('../config');
const logger = require('../utils/logger');

// Reject query operators ($gt, $where, ...) smuggled in through user input.
mongoose.set('sanitizeFilter', true);
mongoose.set('strictQuery', true);
// Collections, validators and indexes are owned by migrations, not created implicitly at runtime.
mongoose.set('autoIndex', false);
mongoose.set('autoCreate', false);

async function connectMongo() {
  await mongoose.connect(config.mongoUri, {
    maxPoolSize: 20,
    serverSelectionTimeoutMS: 10_000,
  });
  logger.info('MongoDB connected');
}

async function disconnectMongo() {
  await mongoose.disconnect();
}

module.exports = { connectMongo, disconnectMongo, mongoose };
