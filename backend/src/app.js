'use strict';

const crypto = require('node:crypto');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const pinoHttp = require('pino-http');
const config = require('./core/config');
const logger = require('./core/utils/logger');
const { mongoose } = require('./core/db/mongo');
const { redis } = require('./core/db/redis');
const { createLimiters } = require('./core/middleware/rateLimit');
const { originCheck } = require('./core/middleware/csrf');
const { requireAuth, requireAdmin, requireAppEnabled } = require('./core/middleware/auth');
const { notFound, errorHandler } = require('./core/middleware/errorHandler');
const { createAppState } = require('./core/services/appState');
const authRouter = require('./core/routes/auth');
const adminRouter = require('./core/routes/admin');
const appsRouter = require('./core/routes/apps');
const manifests = require('./apps');

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);

function createApp() {
  const app = express();
  const limiters = createLimiters();
  const appState = createAppState(manifests);

  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.set('query parser', 'simple');

  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'same-origin' },
      strictTransportSecurity: { maxAge: 63072000, includeSubDomains: true, preload: true },
    }),
  );
  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const id = crypto.randomUUID();
        res.setHeader('X-Request-Id', id);
        return id;
      },
      autoLogging: { ignore: (req) => req.url.startsWith('/api/health') },
    }),
  );

  // API responses are per-user and must never be stored by shared caches.
  app.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  // Health checks have their own in-memory limit, so they still answer when Redis is down.
  app.get('/api/health', limiters.health, (_req, res) => res.json({ status: 'ok' }));
  app.get('/api/ready', limiters.health, async (_req, res) => {
    const mongoOk = mongoose.connection.readyState === 1;
    const redisOk = await redis.ping().then((r) => r === 'PONG').catch(() => false);
    res.status(mongoOk && redisOk ? 200 : 503).json({ mongo: mongoOk, redis: redisOk });
  });

  // Every other request is counted before any body is parsed, including unknown paths.
  app.use(limiters.api);

  // Only accept JSON bodies. Anything else is refused before it's parsed.
  app.use((req, _res, next) => {
    const hasBody = Number(req.get('content-length') || 0) > 0 || req.get('transfer-encoding');
    if (BODY_METHODS.has(req.method) && hasBody && !req.is('application/json')) {
      return next(Object.assign(new Error('Unsupported media type'), { status: 415, expose: true, code: 'UNSUPPORTED_MEDIA' }));
    }
    next();
  });
  // Some app routes (bulk imports) carry many items, so they get a larger (still bounded) limit.
  const largeBodyPaths = manifests.flatMap((m) => (m.largeBodyPaths || []).map((p) => `/api/${m.id}${p}`));
  if (largeBodyPaths.length) app.use(largeBodyPaths, express.json({ limit: '256kb', strict: true }));
  app.use(express.json({ limit: '32kb', strict: true }));
  app.use(cookieParser());
  app.use(originCheck);

  app.use('/api/auth', authRouter(limiters));
  app.use('/api/apps', requireAuth, appsRouter({ appState }));
  app.use('/api/admin', requireAuth, requireAdmin, adminRouter({ limiters, appState }));
  for (const m of manifests) {
    app.use(`/api/${m.id}`, requireAuth, requireAppEnabled(appState, m.id), m.createRouter({ limiters }));
  }

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
