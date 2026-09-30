'use strict';

const crypto = require('node:crypto');
const logger = require('./logger');

// Security events (sign-ins, lockouts, role and plan changes, invites), one JSON
// line each in the API log with "audit": true, so they can be filtered and kept:
//   docker compose logs api | grep '"audit":true'
// Accounts are named by id. Emails aren't logged; a failed sign-in for an email
// with no account logs a short hash of it, enough to spot repeated guesses.
const auditLog = logger.child({ audit: true });

const emailHash = (email) => crypto.createHash('sha256').update(String(email)).digest('hex').slice(0, 16);

function audit(req, event, fields = {}) {
  auditLog.info({
    event,
    actor: req.user?.id ?? null,
    ip: req.ip,
    reqId: req.id,
    ...(req.workspace ? { workspace: req.workspace.id } : {}),
    ...fields,
  }, 'security event');
}

module.exports = { audit, emailHash, auditLog };
