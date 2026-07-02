# glottos-app — unified courses + tutor monorepo

One codebase, one server, one user system for the two glottos language-learning
products, formerly the separate **glottos-courses** (`courses.glottos.com`) and
**text-tutor** (`t.glottos.com`) repos.

- **`apps/courses`** — Next.js 15 App Router app (lessons, tests, dictionary,
  CEFR progress, TTS, Telegram Mini App). Served under **`/courses`**.
- **`apps/tutor`** — Vite React SPA + Express backend (tap-to-explain,
  flashcards + spaced repetition, Stripe subscriptions, OCR, shared lessons).
  Served at the **root `/`**.
- **`packages/shared`** (`@glottos/shared`) — the shared identity layer both apps
  import: the Postgres pool, the SSO token helper, session constants, and the
  legacy-data dedup logic.
- **`migrations/`** — the one canonical schema + the legacy data importer.
- **`deploy/`** — nginx, pm2, dev docker-compose, and the master `.env.example`.

Both apps are served from **one origin**, so the browser's
`localStorage['session_id']` (sent as `X-Session-Id`) is shared and both apps
read the same `sessions` table — **a login in either product signs you into
both, with no cross-app handoff.**

See `ANALYSIS.md`, `MERGE_PLAN.md`, `DECISIONS.md` for how/why it was merged, and
`MIGRATION.md` for the production cut-over runbook.

---

## Prerequisites

- Node 22+, npm
- Docker (for the local dev Postgres) — or any local Postgres 16

## Setup

```bash
npm install                 # installs all workspaces
cp deploy/.env.example .env # fill in values (see the file's old->new mapping)
```

Start a local database and apply the schema:

```bash
npm run dev:db              # Postgres 16 on localhost:5433 (docker compose)
export DATABASE_URL=postgresql://glottos:glottos@localhost:5433/glottos
npm run db:init             # applies migrations/001_unified_schema.sql
```

(If you don't use Docker, point `DATABASE_URL` at any local Postgres 16 and run
`npm run db:init`.)

## Develop

The two apps run as separate dev servers (each with hot reload); nginx is only
needed to put them on one origin (see Production). For day-to-day work:

```bash
# tutor: Vite SPA on :3000 (proxies /api to Express) + Express API on :4000
npm run dev:tutor            # Vite dev server (port 3000)
npm run dev:tutor-server     # Express API (port 4000)  — run in a second shell

# courses: Next.js dev (defaults to :3000 — set PORT to avoid clashing)
PORT=3001 npm run dev:courses
```

Courses reads content from `apps/courses/content/.generated` (built from the
Markdown under `apps/courses/courses`). It is generated automatically on
`build`, or on demand:

```bash
npm run build:content -w @glottos/courses
```

To exercise the true single-origin behaviour locally, build both apps and run
them behind `deploy/nginx.conf` (see Production).

## Test

```bash
npm test                     # shared + courses + tutor
npm run test:shared          # @glottos/shared (pool/sso/session + dedup logic)
npm run test -w @glottos/courses
npm run test -w @glottos/tutor
```

Type-check / lint:

```bash
npm run lint                 # courses (next lint) + tutor (tsc --noEmit)
npm run lint -w @glottos/shared
```

> Known pre-existing (inherited from the legacy repos, unrelated to the merge):
> tutor's `tsc --noEmit` reports a handful of `src/App.tsx` / `Monitoring.tsx`
> type errors (the app ships via tsx/esbuild, which don't type-check), and one
> tutor TTS-mock test asserts a status that depends on the mock. Both reproduce
> identically in the untouched legacy repo.

## Build

```bash
npm run build                # builds courses (Next standalone) + tutor (Vite)
```

## Production (single origin)

Two Node processes behind one nginx:

```bash
npm run build
pm2 start deploy/ecosystem.config.cjs   # courses :8080, tutor :4000
# install deploy/nginx.conf (set server_name + TLS), then: nginx -t && reload
```

Routing (`deploy/nginx.conf`): `/courses` → Next (`:8080`), everything else →
tutor Express (`:4000`, which serves the built SPA + `/api` + `/s/:code`).

## Migrating existing production data

See **`MIGRATION.md`**. In short: back up both legacy DBs, `npm run db:init` the
unified DB, `npm run migrate:legacy -- --dry-run` to preview, then
`npm run migrate:legacy` to import (idempotent; dedups accounts present in both
apps by Google sub / Telegram id / email).

## Repository layout

```
apps/courses/        Next.js app (basePath /courses)
apps/tutor/          Vite SPA + Express (root)
packages/shared/     @glottos/shared — db pool, sso, session, dedup
migrations/          001_unified_schema.sql, run.ts, migrate_legacy_data.ts
deploy/              nginx.conf, ecosystem.config.cjs, docker-compose.dev.yml, .env.example
legacy/              READ-ONLY reference clones (git-ignored)
```

## Environment variables

All variables (shared + per-app) are documented with old→new mapping in
`deploy/.env.example`. The shared ones — `DATABASE_URL`, `GOOGLE_CLIENT_ID`,
`SSO_SHARED_SECRET`, `TELEGRAM_BOT_TOKEN`, `AZURE_TTS_*`, `SESSION_TTL_DAYS`,
`ADMIN_USER`/`ADMIN_EMAIL` — must hold the same values that feed both apps.
