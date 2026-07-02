# DEPLOY_DROPLET.md — deploying the merged glottos app to a DigitalOcean droplet

Docker-based single-droplet deploy, in the spirit of how `glottos-courses` is
containerized, but as a **long-running compose stack** instead of App Platform.
Both apps run behind one nginx on one origin; the **database is external**
(managed Postgres) — the stack holds no DB of its own.

```
                          ┌──────────── droplet ────────────┐
   browser ──443──▶ nginx │  /courses ─▶ courses  :8080     │
                          │  /        ─▶ tutor    :4000     │──▶  managed Postgres
                          └─────────────────────────────────┘      (external, DATABASE_URL)
```

What runs where:
- **courses** — Next.js standalone (`node server.js`), served under `/courses`.
- **tutor** — Express via `tsx server.ts`, serves the Vite SPA + `/api` at `/`.
- **nginx** — TLS + path routing (`deploy/nginx.prod.conf`).
- **migrate** — one-off job: `db:init` (+ optional legacy import). Not a service.

Everything is defined in `deploy/docker-compose.prod.yml` and `deploy/Dockerfile`.

---

## 0. Prerequisites

- A droplet (Ubuntu 22.04/24.04, **≥2 GB RAM** — the Next build is memory-hungry;
  a 1 GB droplet may OOM during build. Build on a bigger droplet or with swap.)
- **Docker Engine + compose plugin** on the droplet.
- An **external managed Postgres 16** with a `DATABASE_URL` you can reach from
  the droplet. Add the droplet's IP to the DB's **trusted sources / firewall**,
  or `db:init` will hang (known managed-PG gotcha).
- For the legacy import: read-capable connection strings for the two old DBs
  (`DATABASE_URL_COURSES_SRC`, `DATABASE_URL_TUTOR_SRC`).
- A domain pointed at the droplet's IP (for TLS).
- The same **Google OAuth client** as before (keeps `google_sub` identity keys).

Install Docker on a fresh droplet:
```bash
curl -fsSL https://get.docker.com | sh
docker compose version   # confirm the compose plugin is present
```

---

## 1. Get the code + env onto the droplet

```bash
git clone https://github.com/<you>/glottos-app.git
cd glottos-app
cp deploy/.env.example .env
$EDITOR .env
```

Fill in `.env` (it documents every variable + old→new mapping). The ones that
matter most for a droplet deploy:

| Variable | Notes |
|---|---|
| `DATABASE_URL` | the **external** managed Postgres (the one unified DB both apps share). Keep `?sslmode=require`. |
| `GOOGLE_CLIENT_ID` / `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | same OAuth client id; the `NEXT_PUBLIC_` copy is **inlined at build** (see below). |
| `SSO_SHARED_SECRET`, `TELEGRAM_BOT_TOKEN`, `AZURE_TTS_*` | shared by both apps. |
| `NEXT_PUBLIC_BASE_PATH` | `/courses` (baked into the courses build). |
| `SITE_URL`, `APP_URL`, `COURSES_URL`, `NEXT_PUBLIC_TUTOR_URL`, `ALLOWED_ORIGINS` | set to your real origin, e.g. `https://glottos.com` (courses at `…/courses`). |
| courses keys | `ANTHROPIC_API_KEY`, `GOOGLE_TTS_API_KEY`, `NEXT_PUBLIC_POSTHOG_*`. |
| tutor keys | `GEMINI_API_KEY`, `OPENAI_API_KEY`, `STRIPE_*`, `GOOGLE_CLIENT_SECRET`, … |
| legacy import only | `DATABASE_URL_COURSES_SRC`, `DATABASE_URL_TUTOR_SRC`. |

> **Build-time vs run-time:** `NEXT_PUBLIC_*` (courses) and `GOOGLE_CLIENT_ID`
> (tutor SPA) are **inlined into the client bundles during `docker build`**.
> Compose passes them as build args from `.env`. If you change any of them,
> **rebuild** (`up -d --build`) — a plain restart won't pick them up.

---

## 2. Initialize the database (schema + optional legacy import)

The `migrate` job runs `db:init` (applies `migrations/001_unified_schema.sql`,
idempotent). To also import the two legacy production DBs, set the flags below.

**Schema only (fresh empty DB):**
```bash
docker compose --env-file .env -f deploy/docker-compose.prod.yml \
  --profile migrate run --rm migrate
```

**Schema + legacy import** — first a dry-run (writes nothing), review the plan,
then the live import. Controlled by env, so pass them inline:
```bash
# dry-run preview (reads the two legacy DBs, writes nothing)
RUN_LEGACY_MIGRATION=true \
docker compose --env-file .env -f deploy/docker-compose.prod.yml \
  --profile migrate run --rm -e RUN_LEGACY_MIGRATION=true migrate

# live import (idempotent: ON CONFLICT DO NOTHING; users upsert fills gaps)
docker compose --env-file .env -f deploy/docker-compose.prod.yml \
  --profile migrate run --rm -e RUN_LEGACY_MIGRATION=true -e MIGRATE_LIVE=true migrate
```
(`DATABASE_URL_COURSES_SRC` / `DATABASE_URL_TUTOR_SRC` must be in `.env`.)
See **MIGRATION.md** for the full cut-over runbook, back-ups, and rollback — the
importer only ever reads the legacy DBs and only writes the unified one.

Spot-check afterward:
```bash
psql "$DATABASE_URL" -c "\dt"                       # users, sessions, courses_*, tutor tables
psql "$DATABASE_URL" -c "SELECT count(*) FROM users;"
```

---

## 3. Build + start the stack

```bash
docker compose --env-file .env -f deploy/docker-compose.prod.yml up -d --build
docker compose -f deploy/docker-compose.prod.yml ps
```
First build is a few minutes (installs the workspace, runs `next build` +
`vite build`). Rebuilds are faster thanks to the cached `npm ci` layer.

Smoke test on the droplet (plain HTTP, before TLS):
```bash
curl -H "Host: glottos.example.com" http://localhost/api/health          # tutor  -> 200
curl -H "Host: glottos.example.com" http://localhost/courses/api/health  # courses -> 200
```
Container health is also reported by `docker compose ps` (both should be
`healthy`).

---

## 4. TLS (Let's Encrypt via certbot webroot)

The nginx config already serves `/.well-known/acme-challenge/` from
`./certbot-webroot` and mounts `./certs` at `/etc/letsencrypt`.

```bash
mkdir -p deploy/certs deploy/certbot-webroot

# Issue the cert (stack must be up so nginx answers the challenge on :80).
docker run --rm \
  -v "$PWD/deploy/certs:/etc/letsencrypt" \
  -v "$PWD/deploy/certbot-webroot:/var/www/certbot" \
  certbot/certbot certonly --webroot -w /var/www/certbot \
  -d glottos.example.com --email you@example.com --agree-tos --no-eff-email
```

Then enable HTTPS: in `deploy/nginx.prod.conf` set the real `server_name`,
uncomment the `location / { return 301 https://... }` line in the `:80` block
and the whole `:443 server { … }` block, and reload:
```bash
docker compose -f deploy/docker-compose.prod.yml exec nginx nginx -t
docker compose -f deploy/docker-compose.prod.yml exec nginx nginx -s reload
```

Renewal (cron/systemd-timer on the host): re-run the `certbot ... renew`
command above and `nginx -s reload`.

---

## 5. Google OAuth for the production origin

In Google Cloud Console → your OAuth Web client:
- **Authorized JavaScript origins**: `https://glottos.example.com`
- **Authorized redirect URI**: `https://glottos.example.com/courses/api/auth/google/redirect`

(Same client as the legacy apps so `google_sub` stays the identity key.)

---

## 6. Verify end-to-end

1. Open `https://glottos.example.com/` (tutor) — sign in with Google.
2. Open `https://glottos.example.com/courses` — you're **already signed in as the
   same account** (shared origin + shared `sessions` table).
3. Sign out, sign in on `/courses`, confirm `/` is signed in too.
4. Exercise one core action per product (an explain in tutor, a lesson answer in
   courses).

---

## 7. Operating the stack

```bash
# logs
docker compose -f deploy/docker-compose.prod.yml logs -f courses
docker compose -f deploy/docker-compose.prod.yml logs -f tutor

# deploy a new version (git pull, then rebuild + restart changed services)
git pull
docker compose --env-file .env -f deploy/docker-compose.prod.yml up -d --build

# restart / stop
docker compose -f deploy/docker-compose.prod.yml restart tutor
docker compose -f deploy/docker-compose.prod.yml down          # keep external DB

# re-run a schema migration after editing migrations/*.sql (idempotent)
docker compose --env-file .env -f deploy/docker-compose.prod.yml \
  --profile migrate run --rm migrate
```

Notes / gotchas:
- **Rebuild after changing any `NEXT_PUBLIC_*` or tutor `GOOGLE_CLIENT_ID`** —
  they're baked into the client bundles at build time.
- **DB trusted sources:** the droplet IP must be allow-listed on the managed
  Postgres, or `db:init` / app boot hangs on connect.
- The stack has **no DB volume** by design; all state lives in the external DB.
  Backups are the managed DB's responsibility (see MIGRATION.md step 1 for
  `pg_dump`).
- Keep the legacy apps + DBs running read-only for a cool-down window in case of
  rollback (MIGRATION.md step 8) — rollback is DNS-level; the unified DB is the
  only thing this stack writes to.
```
