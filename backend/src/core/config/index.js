'use strict';

const { z } = require('zod');
const { PLAN_IDS } = require('../plans');

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
  // The plan new workspaces start on. Self-hosted installs get every app with no
  // limits. The hosted service sets this to "standard".
  DEFAULT_PLAN: z.enum(PLAN_IDS).default('self-hosted'),
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
const appOrigin = new URL(env.APP_ORIGIN).origin;

// In development the dev server answers on localhost and 127.0.0.1 alike, and
// browsers treat those as different origins. Accept both there, and only there.
function devAliases(origin) {
  const url = new URL(origin);
  if (env.NODE_ENV !== 'development' || url.hostname !== 'localhost') return [];
  url.hostname = '127.0.0.1';
  return [url.origin];
}

module.exports = Object.freeze({
  env: env.NODE_ENV,
  isProd: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',
  port: env.PORT,
  mongoUri: env.MONGO_URI,
  redisUrl: env.REDIS_URL,
  appOrigin,
  // Origins allowed to make state-changing requests.
  appOrigins: Object.freeze([appOrigin, ...devAliases(appOrigin)]),
  trustProxy: env.TRUST_PROXY,
  logLevel: env.LOG_LEVEL,
  boardCacheTtl: env.BOARD_CACHE_TTL_SECONDS,
  defaultPlan: env.DEFAULT_PLAN,
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
  // Marks a browser that has signed in to an account before. Such browsers skip the
  // account-wide lockout (not the per-IP one), so strangers can't lock people out.
  knownDevice: Object.freeze({
    cookieName: 'kd',
    ttlMs: 180 * 24 * 60 * 60 * 1000,
  }),
  lockout: Object.freeze({
    maxAttempts: 5,
    windowSeconds: 15 * 60,
    lockSeconds: 15 * 60,
  }),
});
