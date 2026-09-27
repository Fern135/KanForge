'use strict';

const { ZodError } = require('zod');
const { mongoose } = require('../db/mongo');
const logger = require('../utils/logger');

function notFound(_req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
}

// Never leaks stack traces, query details or internal messages to the client.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  if (err instanceof ZodError) {
    const details = err.issues.slice(0, 10).map((i) => ({ path: i.path.join('.'), message: i.message }));
    return res.status(400).json({ error: { code: 'VALIDATION', message: 'Invalid input', details } });
  }
  if (err instanceof mongoose.Error.CastError) {
    return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid identifier' } });
  }
  if (err instanceof mongoose.Error.ValidationError) {
    return res.status(400).json({ error: { code: 'VALIDATION', message: 'Invalid input' } });
  }
  if (err?.code === 11000) {
    return res.status(409).json({ error: { code: 'CONFLICT', message: 'Resource already exists' } });
  }
  // body-parser errors (malformed JSON, payload too large) carry a status and type.
  if (err?.type && err.status >= 400 && err.status < 500) {
    return res.status(err.status).json({ error: { code: 'BAD_REQUEST', message: 'Malformed request' } });
  }
  if (err?.expose && err.status) {
    return res.status(err.status).json({ error: { code: err.code || 'ERROR', message: err.message } });
  }

  logger.error({ err, reqId: req.id }, 'Unhandled error');
  return res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong' } });
}

module.exports = { notFound, errorHandler };
