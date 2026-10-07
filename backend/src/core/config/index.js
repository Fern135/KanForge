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
  // Where the Files app keeps file contents: any S3-compatible object store.
  // docker-compose runs Garage for this on the same machine (nothing to pay for).
  // A hosted provider (Backblaze B2, Cloudflare R2, AWS S3...) works by pointing
  // these at it instead. Without them, the Files app answers "storage not set up".
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().min(1).default('garage'),
  S3_BUCKET: z.string().min(3).max(63).optional(),
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  // Garage (and most self-hosted stores) need bucket-in-path URLs.
  S3_FORCE_PATH_STYLE: bool.default(true),
  // Prepended to every object key, so several installs (or the tests) can share a bucket.
  S3_KEY_PREFIX: z.string().max(100).regex(/^[a-z0-9/_-]*$/).default(''),
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
  // A self-hosted install (not the hosted service): platform admins manage its
  // people and what each of them can use.
  selfHosted: env.DEFAULT_PLAN === 'self-hosted',
  // Object storage for the Files app (see the S3_* settings above). null when not configured.
  storage: env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
    ? Object.freeze({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      bucket: env.S3_BUCKET,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      keyPrefix: env.S3_KEY_PREFIX,
    })
    : null,
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
  // A random id naming this browser, so signing in again replaces its session
  // instead of adding another to the device list. 400 days: browsers' cookie cap.
  browserDevice: Object.freeze({
    cookieName: 'bd',
    ttlMs: 400 * 24 * 60 * 60 * 1000,
  }),
  lockout: Object.freeze({
    maxAttempts: 5,
    windowSeconds: 15 * 60,
    lockSeconds: 15 * 60,
  }),
});
