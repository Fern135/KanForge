'use strict';

const pino = require('pino');
const config = require('../config');

// Redact anything that could carry credentials so it never reaches logs.
module.exports = pino({
  level: config.isTest ? 'silent' : config.logLevel,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-csrf-token"]',
      'res.headers["set-cookie"]',
      '*.password',
      '*.currentPassword',
      '*.newPassword',
      '*.token',
    ],
    censor: '[REDACTED]',
  },
});
