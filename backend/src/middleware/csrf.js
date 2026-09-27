'use strict';

const crypto = require('node:crypto');
const config = require('../config');
const AppError = require('../utils/AppError');

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

// Defense in depth: a browser that sends an Origin header must be sending it
// from our own origin on any state-changing request.
function originCheck(req, _res, next) {
  if (SAFE.has(req.method)) return next();
  const origin = req.get('origin');
  if (origin && origin !== config.appOrigin) {
    throw AppError.forbidden('Cross-origin request blocked', 'BAD_ORIGIN');
  }
  next();
}

// Double-submit token for the cookie-authenticated endpoints (refresh/logout).
// Only our own origin can read the csrf cookie and echo it back in the header.
function requireCsrf(req, _res, next) {
  const cookie = req.cookies?.[config.refresh.csrfCookieName];
  const header = req.get('x-csrf-token');
  if (
    typeof cookie !== 'string' ||
    typeof header !== 'string' ||
    cookie.length !== header.length ||
    cookie.length < 32 ||
    !crypto.timingSafeEqual(Buffer.from(cookie), Buffer.from(header))
  ) {
    throw AppError.forbidden('CSRF validation failed', 'CSRF');
  }
  next();
}

module.exports = { originCheck, requireCsrf };
