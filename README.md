<p align="center">
  <img src="frontend/public/favicon.svg" width="72" height="72" alt="Kanforge logo">
</p>

<h1 align="center">Kanforge</h1>

<p align="center">
  Open-source, self-hosted kanban boards that you run on your own machine or server.<br>
  Boards, lists and drag-and-drop cards, with a hardened security setup.
</p>

---

## Features

- **Boards, lists and cards** with drag and drop that works with a mouse, touch or keyboard
- **Cards** with descriptions, colored labels, due dates (overdue and due-soon badges), checklists and comments
- **Sharing:** invite people to a board by email. The owner manages members, and members can leave
- **Six board backgrounds.** Mobile-first navy, light green and gray theme
- **Accounts:** email and password sign-in, profile, password change, "sign out everywhere"
- **Security first:** Argon2id, rotating refresh tokens, CSRF protection, rate limits, strict CSP, and non-root read-only containers. See [Security](#security)

**Stack:**
- Node.js 22 (Express 5), MongoDB 8.2, Redis 7
- React 19 (Vite, JavaScript), Bootstrap 5, Axios, Font Awesome Free, @hello-pangea/dnd
- nginx, with everything running in Docker

---

## Quick start

### 1. Install the requirements

| | Why |
| --- | --- |
| [Docker Desktop](https://docs.docker.com/get-docker/) (macOS / Windows), or Docker Engine + Compose v2 (Linux) | Runs the whole app |
| [Node.js 18+](https://nodejs.org) | Runs the cross-platform launcher script. Nothing gets installed with npm |

Make sure Docker is **running** before you continue.

### 2. Start Kanforge

```bash
git clone <this-repo-url> kanforge
cd kanforge
```

| | macOS / Linux | Windows (PowerShell or cmd) |
| --- | --- | --- |
| **Start** | `./run.sh prod` | `.\run prod` |

The first start takes a few minutes while Docker builds the images. Later starts take seconds.

On the first run, the launcher also does this automatically:
- creates `.env` with strong random passwords and secrets
- creates a self-signed TLS certificate for `localhost`
- applies the database migrations

### 3. Open it

Go to **https://localhost:8443** and create an account.

> The local certificate is self-signed, so your browser shows a warning the first time.
> Click **Advanced → Proceed to localhost**. This is expected locally. For a real server, see [Deploying to a server](#deploying-to-a-server).

Want sample data? Run `./run.sh seed` (Windows: `.\run seed`). It creates a demo board and prints a demo login.

---

## Everyday commands

On macOS and Linux, use `./run.sh <command>`. On Windows, use `.\run <command>`. `node scripts/run.mjs <command>` works everywhere.

| Command | What it does |
| --- | --- |
| `prod` | Start the production stack at https://localhost:8443 |
| `dev` | Start dev mode with hot reload at http://localhost:5173 |
| `down` | Stop everything. Your data is kept |
| `status` | Show which containers are running and healthy |
| `logs [service]` | Follow the logs, for example `logs api`. Press Ctrl+C to stop |
| `seed` | Add a demo user and sample board (prints the login) |
| `migrate [up\|down\|status]` | Apply, roll back or list database migrations |
| `test` | Run the backend test suite against an isolated test database |
| `setup` | Only generate `.env` and the TLS certificate |

Running `prod` or `dev` switches modes directly, so you don't need `down` in between. Services are `web`, `web-dev`, `api`, `mongo`, `redis` and `migrate`.

### Dev mode

`dev` runs the Vite dev server with hot reload at **http://localhost:5173**. The API also restarts on save.
- Edits in `frontend/src/` and `backend/src/` show up immediately. There's nothing to rebuild.
- Dev mode uses the same database as production mode, so your boards appear in both.
- If you change `package.json` in either app, run `dev` again to rebuild the image.

### Extra commands (Makefile, macOS / Linux)

`make help` lists them all. These ones have no `run` equivalent:

| Command | What it does |
| --- | --- |
| `make migrate-create name=add-x` | Scaffold a new migration in `backend/migrations/` |
| `make backup` | Dump MongoDB to `backups/mongo-<timestamp>.archive.gz` |
| `make restore file=backups/….archive.gz` | Restore a dump (replaces the current data, asks first) |
| `make mongo-shell` / `make redis-cli` | Open a shell as the least-privilege app users |
| `make rotate-jwt` | Rotate the JWT signing secret (everyone must sign in again) |
| `make certs` | Regenerate the local TLS certificate |
| `make audit` | `npm audit` for both apps |
| `make clean` | Delete all containers **and all data** (asks first) |

---

## Configuration

Settings live in `.env`, which is created on the first run. It's git-ignored and only readable by you (mode 600). `.env.example` shows the format. To apply a change, run `prod` again.

| Variable | Default | Meaning |
| --- | --- | --- |
| `APP_ORIGIN` | `https://localhost:8443` | The public URL people use. It's used for CORS, origin checks and cookies |
| `HTTP_PORT` / `HTTPS_PORT` | `8080` / `8443` | Ports on the host. HTTP only redirects to HTTPS |
| `ACCESS_TOKEN_TTL_SECONDS` | `600` | Access token lifetime |
| `REFRESH_TOKEN_TTL_DAYS` | `7` | How long you stay signed in without activity |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error` |
| `COMPOSE_PROJECT_NAME` | `kanforge` | Prefix for container and volume names |
| `MONGO_*`, `REDIS_PASSWORD`, `JWT_ACCESS_SECRET` | random | Generated secrets. Don't reuse them anywhere else |

> Changing `COMPOSE_PROJECT_NAME` or the `MONGO_*` users after the first run points to new, empty volumes. Back up first.

---

## Deploying to a server

1. Point a domain at the server and open ports 80 and 443.
2. In `.env`, set `APP_ORIGIN=https://boards.example.com`, `HTTP_PORT=80` and `HTTPS_PORT=443`.
3. Replace `docker/nginx/certs/tls.crt` and `tls.key` with a real certificate, for example from Let's Encrypt. `tls.crt` should be the full chain.
4. Run `./run.sh prod`. Containers restart automatically after a reboot.
5. Schedule `make backup` (for example with a daily cron job) and copy the dumps somewhere safe and encrypted.
6. Run `make audit` from time to time, and pull and restart to pick up updates.

If another proxy or load balancer sits in front of nginx, adjust `TRUST_PROXY` in `docker-compose.yml` and nginx's `X-Forwarded-For` handling so rate limits see real client IPs.

---

## Troubleshooting

| Problem | Fix |
| --- | --- |
| "Docker is not running" | Start Docker Desktop, wait until it says *running*, then try again |
| "port is already allocated" | Something else is using 8080, 8443 or 5173. Stop it, or change `HTTP_PORT` / `HTTPS_PORT` in `.env` |
| Browser warns about the certificate | Expected with the local self-signed certificate. Choose *Proceed to localhost* |
| `./run.sh: Permission denied` | Run `chmod +x run.sh` |
| PowerShell: "run is not recognized" | Type `.\run prod`, not `run prod` |
| Signed out after `make rotate-jwt` or changing a password | Expected: all sessions are revoked |
| Anything else | Run `./run.sh status` and `./run.sh logs api`, and check which service isn't healthy |

---

## Project structure

```
├── run.sh / run.cmd          Launchers (macOS/Linux / Windows)
├── scripts/run.mjs           Cross-platform launcher logic
├── Makefile                  Extra commands (macOS/Linux)
├── docker-compose.yml        Production stack
├── docker-compose.dev.yml    Dev overlay (hot reload)
├── docker/                   MongoDB user init, TLS certificates
├── backend/                  Express API
│   ├── src/                  config, db, models, middleware, routes, services
│   ├── migrations/           migrate-mongo migrations
│   ├── scripts/seed.js       Demo data
│   └── test/                 Integration and security tests
└── frontend/                 React app
    ├── src/                  api, context, components, pages, styles
    └── nginx/                Production web server config
```

### How it fits together

```
browser ──HTTPS──▶ nginx (web) ──▶ api (Express) ──▶ mongo
                   static SPA         │  internal network, no egress
                                      └────────────▶ redis
```

- Only nginx publishes ports. MongoDB and Redis sit on an `internal` Docker network with no route out.
- Redis caches board payloads and user lookups. The caches are invalidated on every write, including when a member changes their name. Redis also stores rate-limit counters and login-lockout state.
- Cards and lists use fractional positions, so a drag writes a single document. The server renumbers a list only when gaps run out.
- The UI updates immediately on drag. Moves are queued and sent in order, and on error the board reloads from the server.

---

## Security

**Authentication**
- Passwords are hashed with Argon2id (OWASP parameters) and must be at least 12 characters. They're rehashed automatically when the parameters change.
- Login takes the same time whether or not the email exists (a dummy hash is verified), so timing doesn't reveal accounts.
- Access tokens are HS256 JWTs that last 10 minutes. The algorithm, issuer and audience are pinned. Tokens are kept only in memory, never in localStorage.
- Refresh tokens are 384-bit random values in an `HttpOnly; Secure; SameSite=Strict` cookie scoped to `/api/auth`. Only their SHA-256 hash is stored.
- Refresh tokens rotate on every use, with reuse detection: replaying an old token revokes the whole session family.
- Cookie endpoints require a double-submit CSRF token, and state-changing requests from a foreign `Origin` are rejected.
- Signing out everywhere or changing your password immediately invalidates every outstanding access token.

**Abuse protection**
- nginx rate-limits per IP, and the API adds per-route rate limits stored in Redis.
- Login locks out per email+IP (after 5 failures) and per account (after 20).
- Payloads are capped at 32 KB, requests must be JSON, and there are per-board and per-list count limits.

**Authorization**
- Every board-scoped query filters by a board the caller is a member of, so IDs from other boards don't work (IDOR).
- Non-members get 404, not 403, so board IDs can't be probed.
- Owner-only actions are enforced on the server.

**Input and output**
- Strict Zod schemas reject unknown keys, which blocks mass assignment and `__proto__` payloads.
- Mongoose `sanitizeFilter` stops NoSQL operator injection, and MongoDB `$jsonSchema` validators enforce document shape in the database too.
- Responses use allow-list serializers. Errors are generic, with no stack traces, and logs redact credentials.
- User content is rendered only as text, never as HTML.

**Infrastructure**
- MongoDB has separate least-privilege users: the API gets `readWrite` only, and migrations get `dbAdmin`.
- Redis uses an ACL: the default user is disabled and `@dangerous` commands (FLUSHALL, CONFIG, KEYS, …) are blocked.
- Containers run as non-root with read-only root filesystems, `no-new-privileges` and every Linux capability dropped.
- TLS 1.2/1.3 only, HTTP redirects to HTTPS, and HSTS is on.
- A strict CSP allows no inline scripts. There's also `frame-ancestors 'none'`, nosniff, a no-referrer policy, COOP/CORP and a locked-down Permissions-Policy.

**Known trade-offs**
- Registration reveals whether an email is already registered. It's rate-limited, and this is standard UX.
- The CSP allows inline *styles*, which the drag-and-drop library needs. Scripts stay strictly `'self'`.

Found a vulnerability? Please report it privately to the maintainer instead of opening a public issue.

---

## Contributing

1. Start dev mode with `./run.sh dev`.
2. Make your change. Schema changes go in a new migration (`make migrate-create name=...`).
3. Run `./run.sh test` and check that everything passes.
4. Open a pull request.

## License

[MIT](LICENSE). The logo uses the Font Awesome Free hammer icon ([CC BY 4.0](https://fontawesome.com/license/free)).
