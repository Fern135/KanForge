<p align="center">
  <img src="frontend/public/favicon.svg" width="72" height="72" alt="Kanforge logo">
</p>

<h1 align="center">Kanforge</h1>

<p align="center">
  An open-source, self-hosted suite of apps that you run on your own machine or server.<br>
  Boards, Notes and a lightweight office suite behind one sign-in, with a hardened security setup.
</p>

---

## Features

**Apps**
- Kanforge is a set of apps behind one sign-in. The home screen shows a tile for each app, and the navbar's app switcher moves between them
- Apps so far: Boards, Notes and Office (Docs, Sheets and Slides). More are planned (files, mail)
- Admins can turn each app on or off for everyone. A turned-off app is hidden and its data is kept

**Workspaces**
- Everything lives in a workspace (a team or company). One account can belong to several, and the navbar's workspace menu switches between them. Each workspace has its own address, `/app/w/<name>/`
- Workspace admins invite people with invite links (people are never added directly), choose who's an admin, rename the workspace and turn its apps on or off. There's always at least one admin. When someone leaves or is removed, their boards pass to an admin
- Boards can only be shared with people in the same workspace, and nothing is visible across workspaces
- Each workspace has a plan: **Self-hosted** (every app, no limits), **Standard** (Boards and Notes, up to 100 boards per person) or **Plus** (every app, unlimited boards). New workspaces start on `DEFAULT_PLAN`
- People join a workspace through invite links its admins create under Workspace settings. A link can join people as members or admins, expires after 1 to 30 days and can be limited to a number of uses. Signing up on its own doesn't give access to any workspace. Links can be revoked, and each one is shown only once, when it's created

**Boards**
- Create, rename and delete boards. Each person can be on up to 100 boards, counting ones shared with them. The boards page warns at 80, and invites are refused once someone is at 100
- Six board backgrounds. Mobile-first navy, light green and gray theme
- Share a board by inviting people by email. The owner manages members and can delete the board; members can leave
- Per-board labels: add, rename, recolor (8 colors) and delete

**Lists**
- Add, rename, delete and reorder lists with drag and drop (up to 100 per board)

**Cards**
- Add, rename, delete and move cards within or between lists (up to 500 per list)
- Drag and drop works with a mouse, touch or keyboard, and the UI updates immediately
- Descriptions (up to 5,000 characters)
- Colored labels from the board's label set
- Due dates with a "complete" toggle and overdue / due-soon badges
- Comments. Authors can delete their own, and the board owner can delete any
- Card previews show badges for the due date, description, checklist progress and comment count
- **Bulk import cards:** open a list's **⋯** menu → **Import cards** and paste up to 100 cards at once. Use plain text (one title per line, with indented `- [ ]` / `- [x]` lines as checklist items) or JSON where each card can set any of its details:

  ```json
  [
    "Just a title",
    {
      "title": "Launch the site",
      "description": "Everything needed to go live",
      "labels": ["red"],
      "dueDate": "2026-10-15",
      "dueComplete": false,
      "checklistTitle": "Steps",
      "checklistHideDone": false,
      "checklist": ["Buy domain", { "text": "Set up DNS", "done": true }]
    }
  ]
  ```
  Only `title` is required. Labels match the board's labels by name, or by color. A date without a time means the end of that day. The dialog checks everything and shows what it found before you import, and an import is all-or-nothing.

**Checklists**
- Add, check off and delete items, with a progress bar (up to 100 items per card)
- Rename the checklist by clicking its title (it starts as "Checklist")
- **Hide when done:** hide completed items. The setting is saved per card
- **Bulk import:** click **Import** on a card's checklist and paste items as JSON or as one item per line:

  ```json
  ["Buy milk", { "text": "Call Ana", "done": true }]
  ```
  ```
  - [ ] Buy milk
  - [x] Call Ana
  ```
  `{ "items": [...] }` also works. The panel shows how many items it found before you import. An import is all-or-nothing: if it would take the checklist past 100 items, nothing is added.

**Notes**
- Rich-text notes: headings, bold, italic, underline, strikethrough, links, lists, checklists, quotes and code blocks. Markdown shortcuts work while typing (`# `, `- `, `[] `)
- Saves automatically as you type. If the same note changed in another tab or device, you choose which version to keep instead of one silently overwriting the other
- Nested folders (up to 10 levels, 500 per account) in a sidebar tree. Open a folder with or without its subfolders, or see Unfiled notes. Move notes and folders with drag and drop or "Move to…". Deleting a folder moves its notes to the trash
- Search titles and text, filter by tag, and pin notes to the top
- Archive, and a trash that deletes notes after 30 days (or empty it yourself)
- Import Markdown files or a whole folder such as an Obsidian vault, keeping its subfolders (a leading `# Heading` becomes the title, front-matter `tags:` become tags). Download one note as Markdown, or export everything as a .zip that keeps the folder structure
- Up to 2,000 notes per account across all your workspaces, including the trash

**Office: Docs**
- A word processor that looks and works like Word or LibreOffice Writer, built into Kanforge. There's no separate office server to run
- Menu bar (File, Edit, View, Insert, Format, Table) and a toolbar with paragraph styles, fonts, sizes, bold/italic/underline/strikethrough, sub- and superscript, text and highlight colours, alignment, line spacing, lists and indents. The usual keyboard shortcuts work
- Pages on screen with a ruler, zoom, page breaks and a status bar (page count, words, characters)
- Page setup: Letter, A4, Legal or A5, portrait or landscape, and custom margins
- Tables (insert, add or remove rows and columns, merge and split cells, header row), images (paste, drag in or insert; resize and align), links, horizontal lines and quotes
- Find and replace, with match case
- Open Word files (.docx) and save as Word. Print or save as PDF with real page breaks. Word import keeps text, headings, lists, tables, links and images; fonts, colours and exact layout are not kept
- Saves automatically. If the same document changed elsewhere, you choose which version to keep
- Documents live in nested folders, with rename, copy, move and a trash that deletes after 30 days
- Tick documents in the list (Shift-click for a run) to download them together (one file, or a .zip of Word and Excel files), move them to a folder, copy them or move them to the trash; in the trash, restore or delete them for good. Any document can also be downloaded from its row menu
- Up to 1,000 documents and 1 GB of document storage per account across all your workspaces, including the trash. Images can be up to 5 MB each and 200 MB per account in total; images no longer used in any document are removed after a day

**Office: Sheets**
- A spreadsheet that looks and works like Excel or LibreOffice Calc, with its own formula engine. Nothing runs on a separate server
- Formulas with about 140 Excel functions: math and statistics (SUM, AVERAGE, ROUND, MEDIAN, SUMPRODUCT…), conditions (IF, IFS, IFERROR, SUMIFS, COUNTIFS, AVERAGEIFS…), lookups (VLOOKUP, XLOOKUP, INDEX/MATCH), text, dates and finance (PMT, FV, NPV). References work across sheets (`'Sheet 2'!A1`), `$` locks rows and columns, and formulas that refer to themselves show `#CIRC!`
- Click cells while typing a formula to add their references. AutoSum (Alt+=), fill handle and Ctrl+D / Ctrl+R to continue series (1, 2, 3… / dates / Item 1, Item 2…), Ctrl+Enter to fill a selection
- Number formats (number, currency, percent, scientific, date, time, text) and decimal places; typing `$5`, `12%` or `2026-09-28` picks the format for you
- Fonts, sizes, bold/italic/underline/strikethrough, text and fill colours, borders, alignment and wrap text
- Insert and delete rows and columns (formulas follow), resize them or fit to contents, freeze rows and columns, sort, find and replace, several sheets per file (add, rename, duplicate, reorder, delete)
- Copy and paste within Sheets keeps formulas and formats; copying to and from Excel or Google Sheets works as tab-separated text. Undo and redo
- Open and save Excel files (.xlsx) and CSV. Excel import keeps values, formulas, number formats, fonts, colours, fills, borders, alignment, column widths, row heights and frozen panes; merged cells, charts, comments and conditional formatting are not kept. Print or save as PDF
- Status bar shows the sum, average and count of the selection
- Up to 50 sheets, 10,000 rows × 200 columns per sheet and 100,000 filled cells per spreadsheet

**Office: Slides**
- A presentation editor that looks and works like PowerPoint or Impress, with a slide panel, menu bar, toolbar and a slide sorter view
- Ten layouts for new slides (title, title and content, two content, comparison, section header, picture with caption, quote, big number, title only, blank) and twelve themes, some with gradients and accent details. Widescreen (16:9) or standard (4:3) slides, solid or gradient backgrounds per slide, and slide numbers and a footer
- Text boxes with fonts, sizes, bold/italic/underline/strikethrough, colours, highlight, alignment, line spacing and bullet or numbered lists
- 21 shapes (rectangles, ovals, triangles, stars, polygons, arrows, chevron, heart, speech bubble, line…) with fill, outline and text inside; images (insert, paste, drag in, or click a picture placeholder) with rounded corners; tables; column, bar, line, area, pie and donut charts with a data editor; and 67 icons
- Transparency, shadows, rotation (drag the handle; Shift snaps to 15°), flipping, and links that open during the slide show
- Move items with snapping to the slide and to other items (Alt turns it off), resize from their handles (Shift keeps the proportions), nudge with the arrow keys, align and distribute, group, lock, and bring forward or send back. Cut, copy, paste, duplicate, undo and redo. Zoom in and out
- Reorder slides by dragging their thumbnails, and duplicate, hide or delete them
- Slide transitions (fade, push, wipe, zoom, cover) and entrance animations (appear, fade, fly in, zoom, wipe) that play in order as you click
- Present full screen from the beginning (F5) or the current slide (Shift+F5), or with presenter view (Alt+F5): a second window with the current and next slide, speaker notes and a timer
- Open PowerPoint (.pptx) files: text and its formatting, shapes, pictures, tables, groups, backgrounds, hidden slides and speaker notes (charts and SmartArt are left out). Save as PowerPoint, with charts as real PowerPoint charts, or print or save as PDF with one slide per page. Saves automatically, and if the same presentation changed elsewhere, you choose which version to keep
- Up to 300 slides per presentation and 150 items per slide
**Accounts**
- Email and password sign-up and sign-in. You stay signed in for 14 days without activity
- Edit your profile name, change your password and "sign out everywhere"
- Signing up never makes anyone platform admin. On a new install, create your account, then run `make admin email=you@example.com` (or `./run.sh admin you@example.com`) on the server. Platform admins run the whole server (plans and other platform admins) but only see workspace names and seat counts, not what's inside. There's always at least one
- Optional security PIN (6 to 8 digits), off by default. Once added under Account & security, you sign in with just the PIN, without typing your email. It works on devices where you've turned it on or signed in with your password since; a new device asks for the password once

**Security first**
- Regularly security-audited, with every workspace kept private to its members. See [Security](#security)

**Stack:**
- Node.js 24 (Express 5), MongoDB 8.3, Redis 8
- React 19 (Vite, JavaScript), Bootstrap 5, Axios, Font Awesome Free, @hello-pangea/dnd
- Tiptap (rich-text editing), docx and mammoth (Word export and import), pptxgenjs (PowerPoint export), fflate (zip, for Excel files and Notes exports). Heavy parts load only when used
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
git clone git@github.com:Fern135/KanForge.git kanforge
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

Go to **https://localhost:8443** and create an account (opening the server's address goes straight to the app).

Then make that account the platform admin (the super admin who runs the server):

| | macOS / Linux | Windows (PowerShell or cmd) |
| --- | --- | --- |
| **Make admin** | `./run.sh admin you@example.com` | `.\run admin you@example.com` |

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
| `admin <email>` | Make an existing account the super admin (platform admin), for example `admin you@example.com`. Sign up in the app first. With make: `make admin email=you@example.com` |
| `seed` | Add a demo user and sample board (prints the login) |
| `demo [remove]` | Fill the dev database with made-up accounts and workspaces for the super admin dashboard, or remove them again. They can't sign in |
| `migrate [up\|down\|status]` | Apply, roll back or list database migrations |
| `test` | Run the backend test suite against an isolated test database |
| `setup` | Only generate `.env` and the TLS certificate |

Running `prod` or `dev` switches modes directly, so you don't need `down` in between. Services are `web`, `web-dev`, `api`, `mongo`, `redis` and `migrate`.

### Dev mode

`dev` runs the Vite dev server with hot reload at **http://localhost:5173** (the app is at **/app/**). The API also restarts on save.
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
| `REFRESH_TOKEN_TTL_DAYS` | `14` | How long you stay signed in without activity |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error` |
| `DEFAULT_PLAN` | `self-hosted` | Plan for new workspaces: `self-hosted` (every app, no limits), `standard` or `plus`. A hosted service uses `standard` |
| `COMPOSE_PROJECT_NAME` | `kanforge` | Prefix for container and volume names |
| `MONGO_*`, `REDIS_PASSWORD`, `JWT_ACCESS_SECRET` | random | Generated secrets. Don't reuse them anywhere else |

> Changing `COMPOSE_PROJECT_NAME` or the `MONGO_*` users after the first run points to new, empty volumes. Back up first.

---

## Adding your own pages

A Kanforge server opens straight into the app. To put pages of your own at `/` (a landing or pricing page), build the web image with them:

- `docker build --build-context site=<folder> --build-arg VITE_SITE_URL=/ frontend` adds the folder's files at `/` (`about.html` is served at `/about`). `VITE_SITE_URL` makes sign-in link back to them.
- Or keep your own compose file next to Kanforge and name it in `KANFORGE_EXTRA_COMPOSE` (both modes) or `KANFORGE_EXTRA_COMPOSE_DEV` (dev mode only) when using `run.sh`.

## Deploying to a server

1. Point a domain at the server and open ports 80 and 443.
2. In `.env`, set `APP_ORIGIN=https://boards.example.com`, `HTTP_PORT=80` and `HTTPS_PORT=443`. Running it as a paid hosted service? Also add `DEFAULT_PLAN=standard`, or every new workspace starts on the free Self-hosted plan with every app.
3. Replace `docker/nginx/certs/tls.crt` and `tls.key` with a real certificate, for example from Let's Encrypt. `tls.crt` should be the full chain. Then make the private key readable only by you and nginx in the container (group 101): `sudo chgrp 101 docker/nginx/certs/tls.key && sudo chmod 640 docker/nginx/certs/tls.key`
4. Run `./run.sh prod`. Containers restart automatically after a reboot.
   Create your account, then run `./run.sh admin you@example.com` to make it the platform admin.
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
│   ├── src/
│   │   ├── core/             Shared by every app: config, db, auth, admin, rate limits,
│   │   │                     rich-text sanitizer, folder trees
│   │   ├── apps/             One folder per app (boards, notes, office), listed in apps/index.js
│   │   └── app.js            Mounts core routes and each app at /api/<app>
│   ├── migrations/           migrate-mongo migrations
│   ├── scripts/seed.js       Demo data
│   └── test/                 Integration and security tests
└── frontend/                 React app (served at /app/; / opens it)
    ├── src/
    │   ├── core/             Sign-in, account, admin, home, navbar, shared components (folder tree)
    │   ├── apps/             One folder per app, listed in apps/index.js, each at /<app>
    │   └── styles/           Theme
    └── nginx/                Production web server config
```

### How it fits together

```
browser ──HTTPS──▶ nginx (web) ──▶ api (Express) ──▶ mongo
                   static SPA         │  internal network, no egress
                                      └────────────▶ redis
```

- Every document people create (boards, lists, cards, comments, notes, documents, folders, images) carries a required `workspace`. A Mongoose plugin (`backend/src/core/tenancy.js`) adds the current workspace to every query, update, delete, aggregate and insert on those models, and throws if there's no workspace, so a forgotten filter can't leak data between workspaces. The workspace comes from the `X-Workspace` header, and membership is checked on every request.
- Each app depends only on `core`, never on another app. Core tells apps about account changes through events (for example `user.renamed`), so it never imports app code.
- Only nginx publishes ports. MongoDB and Redis sit on an `internal` Docker network with no route out.
- Redis caches board payloads and user lookups. The caches are invalidated on every write, including when a member changes their name. Redis also stores rate-limit counters.
- Cards and lists use fractional positions, so a drag writes a single document. The server renumbers a list only when gaps run out.
- The UI updates immediately on drag. Moves are queued and sent in order, and on error the board reloads from the server.

---

## Security

Keeping your data safe is built into Kanforge from the ground up, whether you use our hosted service or run it on your own server.

- **Regular security audits.** Kanforge's code, its dependencies and its server setup are security-audited on an ongoing basis, and anything found is fixed promptly.
- **Encrypted connections.** Everything between your browser and Kanforge travels over HTTPS.
- **Strong account protection.** Passwords are never stored in readable form, and sign-in is protected against password guessing.
- **Your workspace stays yours.** Every workspace is kept separate from every other one, and nobody joins without an invitation.
- **Least access by default.** Each part of the system runs with only the permissions it needs, and the database is never reachable from the internet.
- **Up-to-date dependencies.** Third-party packages are checked for known vulnerabilities and kept current.

**Running it yourself?** Install a real certificate (see [Deploying to a server](#deploying-to-a-server)), keep Kanforge updated by pulling and running `./run.sh prod` again, and run `make audit` from time to time. Sign-ins, admin changes and invites are recorded in the server log: `docker compose logs api | grep '"audit":true'`.

Found a vulnerability? Please report it privately to the maintainer instead of opening a public issue.

---

## Contributing

Contributions are welcome. Kanforge uses two branches:

- **`main`** is the stable release. Only the maintainer pushes to it, and changes reach it from `dev` once they've been tested.
- **`dev`** is where new work lands. Every pull request goes into `dev`, never straight into `main`.

To contribute:

1. Fork the repository and clone your fork.
2. Create a branch from `dev`: `git checkout dev && git checkout -b my-change`.
3. Start dev mode with `./run.sh dev` and make your change. Schema changes go in a new migration (`make migrate-create name=...`).
4. Run `./run.sh test` and check that everything passes. Add tests for new behaviour.
5. Push your branch to your fork and open a pull request with **`dev`** as the base branch. Describe what changed and why.

Keep each pull request to one change, match the style of the surrounding code, and don't commit `.env` files or other secrets. Found a security issue? Report it privately to the maintainer instead of opening an issue or pull request.

**Adding an app**
1. Backend: create `backend/src/apps/<id>/index.js` exporting `id`, `name`, `description`, `defaultEnabled`, `bodyLimits` (optional, for request bodies over 32 KB) and `createRouter({ limiters })`, and add it to `apps/index.js`. Its routes are served at `/api/<id>` behind sign-in, workspace membership, the plan and the on/off switch. Give its models the `tenantPlugin` from `core/tenancy.js`, and add the collection to the next migration's workspace backfill. Larger body limits also need a matching `client_max_body_size` in `frontend/nginx/default.conf.template`.
2. Frontend: create `frontend/src/apps/<id>/routes.jsx` and add an entry (`id`, `name`, `icon`, lazy `Routes`) to `apps/index.js`. It's served at `/app/w/<workspace>/<id>/*`.
3. Only import from `core`. Anything two apps need goes in `core`.

## License

[GNU AGPL-3.0](LICENSE). You can use, change and self-host Kanforge freely. If you run a modified version as a service for others, you must share your changes under the same license. Versions released before this change stay available under MIT.

The logo uses the Font Awesome Free hammer icon ([CC BY 4.0](https://fontawesome.com/license/free)).
