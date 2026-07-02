# MERGE_PLAN — one codebase, one server, one user system

This plan turns `glottos-courses` + `text-tutor` into a single monorepo served by
one nginx on one origin, backed by one Postgres database with one `users` table,
one auth flow, and one session that is valid across both products.

Guiding constraint from the brief: **move working code intact; refactor only for
the shared layer.** Both apps are ported almost verbatim; the merge value is in
(a) the shared identity/DB layer, (b) single-origin routing so the session is
genuinely shared, and (c) one unified schema + data migration.

---

## 1. Repo layout — npm workspaces monorepo

```
/apps/
  courses/        # Next.js app, ported from legacy/glottos-cources/web (+ courses/ content)
  tutor/          # Vite SPA + Express, ported from legacy/text-tutor
/packages/
  shared/         # @glottos/shared — sso, db pool, session/auth helpers, env, logging
/migrations/
  001_unified_schema.sql      # canonical merged schema (users, sessions + all product tables)
  migrate_legacy_data.ts      # idempotent importer from BOTH legacy DBs, email/sub dedup, --dry-run
  run.ts                      # tiny SQL-file runner (npm run db:init)
/deploy/
  nginx.conf                  # single-origin path routing: / -> tutor, /courses -> Next
  ecosystem.config.cjs        # pm2: courses (Next) + tutor (Express) processes
  docker-compose.dev.yml      # local Postgres 16 for development
  .env.example                # ALL vars for both apps, with old->new name mapping
/legacy/            # READ-ONLY clones (git-ignored, never modified)
package.json        # workspace root: scripts orchestrate both apps
ANALYSIS.md MERGE_PLAN.md DECISIONS.md MIGRATION.md README.md
```

Root `package.json` declares `"workspaces": ["apps/*", "packages/*"]`. Each app
keeps its own lockfile-managed deps via the root install; `@glottos/shared` is a
workspace dependency of both. Tailwind stays per-app (v3 vs v4, incompatible
configs, and there is no shared React UI to justify merging them).

---

## 2. Unified user model

**One `users` table = the superset (tutor's shape).** Columns:

```
id TEXT PK, email TEXT (nullable), name, picture,
role TEXT DEFAULT 'user',            -- 'user' | 'admin' | 'anonymous'
preferences JSONB, active_workspace_id TEXT, created_at TIMESTAMPTZ,
google_sub TEXT UNIQUE, telegram_id BIGINT UNIQUE, source_code TEXT,
stripe_customer_id, subscription_status DEFAULT 'free', subscription_id,
subscription_period_end, cancel_at_period_end BOOLEAN DEFAULT FALSE
```

Courses uses only `id,email,name,picture,role,created_at` — a strict subset, so it
runs unchanged against this table (it never selects the extra columns). Tutor uses
the whole set.

**One auth flow: Google OAuth (standardized).** Google `sub` is the identity key.
Google-rooted users have `id = sub` **and** `google_sub = sub` (courses already
does `id = sub`; the unified Google handler also backfills `google_sub` so both
apps' lookups agree). Telegram and anonymous sign-in are retained (tutor keeps
anon; both keep Telegram). Admin role derived from an env email at each login.

**One session table + one localStorage key + same header.** Both apps already use
`localStorage['session_id']` + `X-Session-Id` and the same `sessions` schema. On a
single origin the localStorage token is shared automatically, and both apps query
the same `sessions` table → **a login in either app authenticates the other with
no handoff.**

**Data migration + dedup:** `migrate_legacy_data.ts` reads the two legacy
databases (`DATABASE_URL_COURSES_SRC`, `DATABASE_URL_TUTOR_SRC`) and writes the
unified DB. Dedup key precedence: `google_sub`/`id`-as-sub, then verified `email`.
Same identity in both systems = **one** merged user row that keeps courses'
progress AND tutor's workspaces/decks/subscription. `--dry-run` prints the merge
plan (new users, merged pairs, row counts) without writing. It only ever **reads**
from the legacy sources and **writes** to the new schema.

---

## 3. Single server & routing

**One origin, path-based routing** (the brief's first-listed option). Chosen over
subdomains because the mission requires *one shared session*, and same-origin
localStorage delivers that directly (subdomains would still need the SSO handoff).

- **tutor** (Express, serves the Vite SPA + its `/api/*`) → mounted at **`/`**.
- **courses** (Next.js) → mounted at **`/courses`** via Next.js native
  `basePath: '/courses'`, which transparently rebases every page, `<Link>`, router
  navigation, and `/_next` asset — so courses' `/api/*` become `/courses/api/*`
  and its pages become `/courses`, `/courses/de`, `/courses/de/en/...`. The only
  manual courses change is prefixing the handful of raw `fetch('/api/...')` calls
  (centralised — `lib/api-client.ts` + ~8 component fetches) with the base path.

Why tutor-at-root and courses-under-`/courses`: Next.js `basePath` is a
first-class, well-tested feature that rebases an entire app with almost no code
change; the tutor SPA is a hand-rolled Vite app + Express with 62 raw `/api`
call-sites and a pathname router — far cheaper to leave at the root it already
assumes. Trade-off: courses' SEO URLs move under `/courses` (documented, 301-able).

**nginx** (`deploy/nginx.conf`), one server block:
```
location /courses      { proxy_pass http://127.0.0.1:8080; }   # Next standalone
location /courses/_next { proxy_pass http://127.0.0.1:8080; }
location /              { proxy_pass http://127.0.0.1:4000; }   # tutor Express (SPA + /api + /s)
```
TLS terminated at nginx (or upstream). Two Node processes under **pm2**
(`ecosystem.config.cjs`): `courses` = `next start` on 8080, `tutor` =
`tsx server.ts` on 4000.

**One shared PostgreSQL database.** Shared `users` + `sessions` in `public`.
Product tables live in the same DB; courses' three generic tables are prefixed
`courses_` for clean separation; tutor's are already domain-specific. Both apps'
`getPool()` is replaced by the shared pool (`@glottos/shared/db`).

---

## 4. Sessions and payments

- **Sessions:** one `sessions` table = one session store. A row created by either
  app's login is valid for both. The cross-app `sso.ts` handoff is retained intact
  (unified into `@glottos/shared`) for external/legacy deep-links and the
  `?sso=`/`/s/:code` share flow, but is **no longer required** for same-origin
  login — documented as such.
- **Payments:** only tutor has Stripe. It stays in tutor with **one** Stripe client
  and **one** webhook endpoint (`POST /api/stripe/webhook`, at the root origin).
  Subscription state is denormalized onto the shared `users` table
  (`subscription_status`, etc.), so courses *could* read entitlement later without
  a second integration. No consolidation work is needed because courses has no
  payments to merge.

---

## 5. Naming convention

- **Product family:** `glottos`. Workspace packages: `@glottos/shared`,
  `@glottos/courses`, `@glottos/tutor`.
- **Env vars:** existing names are preserved (moving code intact) and collected in
  one `deploy/.env.example` with a mapping table. Shared vars documented once.
  Both admin var names (`ADMIN_USER`, `ADMIN_EMAIL`) are accepted by the shared
  auth helper. Legacy dual-DB vars (`DATABASE_URL_COURSES`, `DATABASE_URL_TUTOR`)
  collapse to a single `DATABASE_URL`; the migration script uses temporary
  `*_SRC` vars to read the two old databases.
- **DB objects:** shared identity tables unprefixed (`users`, `sessions`);
  courses product tables `courses_*`; tutor product tables keep their existing
  domain-specific names.

---

## 6. Build & verify plan (phases 2–3)

1. Init workspace root, `.gitignore` (`node_modules`, `.env*`, `legacy/`, build
   output), commit scaffold.
2. Port `apps/tutor` (copy tutor repo files verbatim), `apps/courses` (copy
   `web/` + `courses/` content + top-level content dirs it builds from).
3. Extract `@glottos/shared`: `sso.ts` (one unified helper), `db.ts` (shared
   pool), `session.ts` (auth env constants + admin-email resolution helper),
   `env.ts`, `log.ts`. Point both apps at them.
4. Wire routing: courses `basePath`, api-client base prefix, tutor unchanged;
   nginx + pm2 + docker-compose.
5. Unified migration SQL + data-migration script (dedup, dry-run).
6. Consolidate deps (root install, upgraded shared versions), one lockfile.
7. `deploy/.env.example` covering both apps with old→new mapping.
8. Port tests from both; add tests for the shared sso/db layer and for the dedup
   logic. Build both apps; run both test suites; lint.
9. Boot the full stack against the dev Postgres and smoke-test: sign in once,
   confirm the same session works on both `/` and `/courses`, hit each app's main
   routes.

Every step is its own commit with a clear message.
