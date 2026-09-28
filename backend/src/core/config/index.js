'use strict';

const { z } = require('zod');

// Fail fast on boot if the environment is missing or weak. Never fall back to
// default secrets.
const bool = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  MONGO_URI: z.string().startsWith('mongodb'),
  REDIS_URL: z.string().startsWith('redis'),
  JWT_ACCESS_SECRET: z.string().min(64, 'JWT_ACCESS_SECRET must be at least 64 characters'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(600),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(30).default(14),
  COOKIE_SECURE: bool.default(true),
  APP_ORIGIN: z.string().url(),
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(1),
  BOARD_CACHE_TTL_SECONDS: z.coerce.number().int().min(5).max(3600).default(300),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration:');
  for (const issue of parsed.error.issues) {
    // eslint-disable-next-line no-console
    console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

const env = parsed.data;

module.exports = Object.freeze({
  env: env.NODE_ENV,
  isProd: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',
  port: env.PORT,
  mongoUri: env.MONGO_URI,
  redisUrl: env.REDIS_URL,
  appOrigin: new URL(env.APP_ORIGIN).origin,
  trustProxy: env.TRUST_PROXY,
  logLevel: env.LOG_LEVEL,
  boardCacheTtl: env.BOARD_CACHE_TTL_SECONDS,
  jwt: Object.freeze({
    secret: env.JWT_ACCESS_SECRET,
    ttlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
    issuer: 'kanforge-api',
    audience: 'kanforge-web',
  }),
  refresh: Object.freeze({
    ttlMs: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
    cookieName: 'rt',
    csrfCookieName: 'csrf',
    cookiePath: '/api/auth',
    cookieSecure: env.COOKIE_SECURE,
  }),
  // Remembers a device for PIN-only sign-in. HttpOnly, and scoped like the refresh cookie.
  pinDevice: Object.freeze({
    cookieName: 'pd',
    ttlMs: 90 * 24 * 60 * 60 * 1000,
    max: 10,
  }),
  lockout: Object.freeze({
    maxAttempts: 5,
    windowSeconds: 15 * 60,
    lockSeconds: 15 * 60,
  }),
});
