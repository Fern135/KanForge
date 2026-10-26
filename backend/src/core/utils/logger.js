'use strict';

const pino = require('pino');
const config = require('../config');

// Routes that work without signing in carry their token in the path
// (/api/public/<app>/<route>/<token>/...). Whoever holds one can open what it
// points to, so request logs show [token] instead.
const hideTokens = (url) => String(url).replace(/^(\/api\/public\/[^/?#]+\/[^/?#]+\/)[^/?#]+/, '$1[token]');

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
      '*.pin',
      '*.token',
    ],
    censor: '[REDACTED]',
  },
});

module.exports.hideTokens = hideTokens;
