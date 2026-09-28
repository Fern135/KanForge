'use strict';

const logger = require('../utils/logger');

// In-process events so core can tell apps about account changes without
// depending on them. Apps subscribe when their module loads.
//   user.renamed  (userId)  cached copies of the user's name are stale
const handlers = new Map();

function on(event, handler) {
  if (!handlers.has(event)) handlers.set(event, []);
  handlers.get(event).push(handler);
}

// Runs every handler. One failing handler is logged and doesn't stop the others.
async function emit(event, ...args) {
  const results = await Promise.allSettled((handlers.get(event) || []).map((h) => h(...args)));
  for (const r of results) {
    if (r.status === 'rejected') logger.error({ err: r.reason, event }, 'event handler failed');
  }
}

module.exports = { on, emit };
