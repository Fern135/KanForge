'use strict';

const crypto = require('node:crypto');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const pinoHttp = require('pino-http');
const config = require('./config');
const logger = require('./utils/logger');
const { mongoose } = require('./db/mongo');
const { redis } = require('./db/redis');
const { createLimiters } = require('./middleware/rateLimit');
const { originCheck } = require('./middleware/csrf');
const { requireAuth } = require('./middleware/auth');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const authRouter = require('./routes/auth');
const boardsRouter = require('./routes/boards');

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);

function createApp() {
  const app = express();
  const limiters = createLimiters();

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
  // Bulk imports carry many items per request, so they get a larger (still bounded) limit.
  app.use(
    ['/api/boards/:boardId/cards/bulk', '/api/boards/:boardId/cards/:cardId/checklist/bulk'],
    express.json({ limit: '256kb', strict: true }),
  );
  app.use(express.json({ limit: '32kb', strict: true }));
  app.use(cookieParser());
  app.use(originCheck);

  app.use('/api/auth', authRouter(limiters));
  app.use('/api/boards', requireAuth, limiters.writes, boardsRouter(limiters));

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
