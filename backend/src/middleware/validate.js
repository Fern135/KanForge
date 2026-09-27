'use strict';

const { z } = require('zod');

const objectId = z.string().regex(/^[a-f0-9]{24}$/, 'Invalid id');

// Validates req.body against a strict schema (unknown keys are rejected, which
// blocks mass assignment) and replaces it with the parsed value.
const body = (schema) => (req, _res, next) => {
  req.body = schema.parse(req.body ?? {});
  next();
};

// Validates every route param named in `names` as an ObjectId.
const ids = (...names) => (req, _res, next) => {
  for (const name of names) objectId.parse(req.params[name]);
  next();
};

module.exports = { body, ids, objectId, z };
