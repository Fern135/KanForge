'use strict';

const { limiter, perUser } = require('../middleware/rateLimit');
const AppError = require('../utils/AppError');

// Search is a case-insensitive "contains" match on an item's title and a plain-text
// copy of its content. To keep one search from making the database read gigabytes,
// only the first SEARCH_TEXT_MAX characters of the content are kept for searching,
// each search stops after SEARCH_TIME_MS, and each person can search
// SEARCH_PER_MINUTE times a minute.
const SEARCH_TEXT_MAX = 20_000;
const SEARCH_TIME_MS = 2_000;
const SEARCH_PER_MINUTE = 60;

const searchable = (text) => (text || '').slice(0, SEARCH_TEXT_MAX);

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Filter clause for a search, matching the title or the searchable text.
const searchClause = (q) => {
  const re = new RegExp(escapeRegex(q), 'i');
  return [{ title: re }, { text: re }];
};

// Only list requests with ?q= count towards the limit.
const searchLimiter = (prefix) => limiter({
  prefix,
  windowMs: 60_000,
  limit: SEARCH_PER_MINUTE,
  keyGenerator: perUser,
  skip: (req) => !req.query?.q,
  message: 'Too many searches. Wait a moment and try again.',
});

// Runs a find() query, turning a search that ran out of time into a clear error.
async function runSearch(query, searching) {
  if (!searching) return query;
  try {
    return await query.maxTimeMS(SEARCH_TIME_MS);
  } catch (err) {
    if (err?.code === 50 || err?.codeName === 'MaxTimeMSExpired') {
      throw AppError.badRequest('Search took too long. Try more specific words.', 'SEARCH_TIMEOUT');
    }
    throw err;
  }
}

module.exports = { SEARCH_TEXT_MAX, SEARCH_TIME_MS, searchable, searchClause, searchLimiter, runSearch };
