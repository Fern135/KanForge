#!/usr/bin/env node
// Cross-platform launcher (macOS, Linux, Windows). Needs only Docker and Node 18+.
//
//   node scripts/run.mjs dev      hot-reload stack at http://localhost:5173
//   node scripts/run.mjs prod     hardened stack at APP_ORIGIN (https://localhost:8443)
//   node scripts/run.mjs down     stop whichever mode is running (data is kept)
//   node scripts/run.mjs logs [service]
//   node scripts/run.mjs status
//   node scripts/run.mjs seed     demo user + sample board
//   node scripts/run.mjs admin <email>   make an account platform admin
//   node scripts/run.mjs demo [remove]   made-up accounts for the admin dashboard
//   node scripts/run.mjs migrate [up|down|status]
//   node scripts/run.mjs test     backend test suite (isolated test database)
//   node scripts/run.mjs setup    only generate .env and the TLS certificate
//
// Or use the wrappers: ./run.sh <cmd> (macOS/Linux) or .\run <cmd> (Windows).
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);

const isWindows = process.platform === 'win32';
// A build on top of Kanforge (a hosted service, say) can add its own compose files:
// KANFORGE_EXTRA_COMPOSE for both modes, KANFORGE_EXTRA_COMPOSE_DEV for dev only.
// Paths inside them are relative to this repo's root.
const extra = (name) => (process.env[name] ? process.env[name].split(',').flatMap((f) => ['-f', f.trim()]) : []);
const PROD = ['compose', '-f', 'docker-compose.yml', ...extra('KANFORGE_EXTRA_COMPOSE')];
const DEV = [...PROD, '-f', 'docker-compose.dev.yml', ...extra('KANFORGE_EXTRA_COMPOSE_DEV')];
const CERT_DIR = join('docker', 'nginx', 'certs');

const color = (code) => (s) => (process.stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : s);
const green = color('32');
const red = color('31');
const bold = color('1');

function fail(msg) {
  console.error(red(`\n  ${msg}\n`));
  process.exit(1);
}

function run(cmd, args, { quiet = false, allowFail = false } = {}) {
  const res = spawnSync(cmd, args, { stdio: quiet ? 'ignore' : 'inherit' });
  if (res.error?.code === 'ENOENT') return { ok: false, missing: true };
  const ok = res.status === 0;
  if (!ok && !allowFail) process.exit(res.status ?? 1);
  return { ok };
}

const docker = (args, opts) => run('docker', args, opts);

function requireDocker() {
  const v = docker(['compose', 'version'], { quiet: true, allowFail: true });
  if (v.missing) fail('Docker is not installed. Get Docker Desktop: https://docs.docker.com/get-docker/');
  if (!v.ok) fail('Docker Compose v2 is required ("docker compose"). Update Docker Desktop / Docker Engine.');
  if (!docker(['info'], { quiet: true, allowFail: true }).ok) fail('Docker is not running. Start Docker Desktop and try again.');
}

function readEnv() {
  const env = {};
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

function setupEnv() {
  if (existsSync('.env')) {
    console.log('.env already exists, leaving it untouched.');
    return;
  }
  const rand = (bytes) => randomBytes(bytes).toString('hex');
  const content = `COMPOSE_PROJECT_NAME=kanforge
HTTP_PORT=8080
HTTPS_PORT=8443
APP_ORIGIN=https://localhost:8443

MONGO_ROOT_USER=root
MONGO_ROOT_PASSWORD=${rand(32)}
MONGO_APP_DB=kanforge
MONGO_APP_USER=kanforge_app
MONGO_APP_PASSWORD=${rand(32)}
MONGO_MIGRATE_USER=kanforge_migrate
MONGO_MIGRATE_PASSWORD=${rand(32)}

REDIS_PASSWORD=${rand(32)}

JWT_ACCESS_SECRET=${rand(64)}
ACCESS_TOKEN_TTL_SECONDS=600
REFRESH_TOKEN_TTL_DAYS=14
LOG_LEVEL=info
`;
  writeFileSync('.env', content, { mode: 0o600 });
  console.log('Created .env with freshly generated secrets (mode 600).');
}

function setupCert() {
  if (existsSync(join(CERT_DIR, 'tls.crt'))) {
    console.log('TLS certificate already exists.');
    return;
  }
  mkdirSync(CERT_DIR, { recursive: true });
  const req = (dir) => [
    'req', '-x509', '-nodes', '-newkey', 'rsa:2048', '-days', '825',
    '-keyout', `${dir}/tls.key`, '-out', `${dir}/tls.crt`,
    '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
  ];
  // Use a local openssl if there is one (macOS, Linux, Git for Windows),
  // otherwise run it in a throwaway container.
  let res = run('openssl', req(CERT_DIR), { quiet: true, allowFail: true });
  if (!res.ok) {
    requireDocker();
    res = docker(['run', '--rm', '-v', `${resolve(CERT_DIR)}:/certs`, 'alpine/openssl', ...req('/certs')], { quiet: true, allowFail: true });
  }
  if (!res.ok) fail('Could not generate the TLS certificate (openssl failed).');
  // nginx reads these as its own user (uid 101) inside the container, so the key
  // has to be readable by others. That's fine for this throwaway localhost
  // certificate; the README shows how to lock down a real one (group 101, mode 640).
  if (!isWindows) {
    chmodSync(join(CERT_DIR, 'tls.key'), 0o644);
    chmodSync(join(CERT_DIR, 'tls.crt'), 0o644);
  }
  console.log(`Generated self-signed certificate in ${CERT_DIR} (replace with a real one in production).`);
}

function setup() {
  setupEnv();
  setupCert();
}

const commands = {
  setup,

  dev() {
    requireDocker();
    setup();
    // The prod nginx isn't part of dev mode; stop it so only one frontend runs.
    docker([...PROD, 'rm', '-sf', 'web'], { quiet: true, allowFail: true });
    docker([...DEV, 'up', '-d', '--build', '--wait', 'mongo', 'redis', 'migrate', 'api', 'web-dev']);
    console.log(green(`\n  ${bold('Dev mode')} running with hot reload: http://localhost:5173\n`));
  },

  prod() {
    requireDocker();
    setup();
    // --remove-orphans drops the dev-only web-dev container if it is running.
    docker([...PROD, 'up', '-d', '--build', '--wait', '--remove-orphans']);
    const origin = readEnv().APP_ORIGIN || 'https://localhost:8443';
    console.log(green(`\n  ${bold('Production mode')} running at ${origin}`));
    console.log('  (self-signed certificate locally: accept the browser warning)\n');
  },

  down() {
    requireDocker();
    docker([...DEV, '--profile', 'prod-only', 'down', '--remove-orphans']);
  },

  logs(service) {
    requireDocker();
    docker([...DEV, '--profile', 'prod-only', 'logs', '-f', '--tail=200', ...(service ? [service] : [])]);
  },

  status() {
    requireDocker();
    docker([...DEV, '--profile', 'prod-only', 'ps']);
  },

  seed() {
    requireDocker();
    setup();
    docker([...PROD, 'up', '-d', '--wait', 'mongo']);
    docker([...PROD, 'run', '--rm', '-e', 'ALLOW_SEED=true', '--entrypoint', 'node', 'migrate', 'scripts/seed.js']);
  },

  admin(email) {
    if (!email) fail('Usage: admin <the email you signed up with>');
    requireDocker();
    setup();
    docker([...PROD, 'up', '-d', '--wait', 'mongo', 'redis']);
    docker([...PROD, 'run', '--rm', '--build', '--entrypoint', 'node', 'migrate', 'scripts/make-admin.js', email]);
  },

  // Made-up accounts and workspaces for the super admin dashboard (dev database).
  demo(action) {
    if (action && action !== 'remove') fail('Usage: demo [remove]');
    requireDocker();
    setup();
    docker([...DEV, 'up', '-d', '--wait', 'mongo', 'redis']);
    docker([...DEV, 'run', '--rm', '--build', '--no-deps', 'api', 'node', 'scripts/demo-data.js', ...(action ? [action] : [])]);
  },

  migrate(action = 'up') {
    if (!['up', 'down', 'status'].includes(action)) fail('Usage: migrate [up|down|status]');
    requireDocker();
    setup();
    docker([...PROD, 'up', '-d', '--wait', 'mongo']);
    docker([...PROD, 'run', '--rm', 'migrate', action, '-f', 'migrate-mongo-config.js']);
  },

  test() {
    requireDocker();
    setup();
    docker([...PROD, '--profile', 'test', 'build', 'api-test']);
    docker([...PROD, 'up', '-d', '--wait', 'mongo', 'redis']);
    docker([...PROD, '--profile', 'test', 'run', '--rm', 'api-test']);
  },
};

function help() {
  console.log(`
${bold('Usage:')} node scripts/run.mjs <command>   (or ./run.sh <command>, or .\\run <command> on Windows)

  ${bold('dev')}             Start with hot reload at http://localhost:5173
  ${bold('prod')}            Start the hardened production stack (HTTPS)
  ${bold('down')}            Stop the stack (data is kept)
  ${bold('logs')} [service]  Follow logs, e.g. "logs api"
  ${bold('status')}          Show container status
  ${bold('admin')} <email>   Make an existing account platform admin
  ${bold('seed')}            Add a demo user and sample board (prints the login)
  ${bold('demo')} [remove]   Add (or remove) made-up accounts and workspaces for the admin dashboard
  ${bold('migrate')} [up|down|status]  Apply, roll back or list database migrations
  ${bold('test')}            Run the backend test suite (isolated test database)
  ${bold('setup')}           Only generate .env secrets and the TLS certificate
`);
}

const [cmd, ...args] = process.argv.slice(2);
if (!cmd || cmd === 'help' || cmd === '-h' || cmd === '--help') {
  help();
} else if (Object.hasOwn(commands, cmd)) {
  commands[cmd](...args);
} else {
  help();
  fail(`Unknown command "${cmd}".`);
}
