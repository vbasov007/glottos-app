# DECISIONS

Every non-obvious decision made during the merge, with a one-line rationale.
Newest decisions are appended as work proceeds.

## Architecture

- **Monorepo with npm workspaces** (`apps/*`, `packages/*`) — both stacks are JS/TS
  on Node 22; workspaces give one install, one shared package, minimal churn.
- **Keep two app frameworks as-is** (Next.js for courses, Vite+Express for tutor)
  rather than porting one onto the other — the brief says move working code intact;
  a rewrite would be huge and risky for zero user-facing gain.
- **Single origin, path-based routing** (tutor at `/`, courses at `/courses`) —
  the mission requires ONE shared session; same-origin `localStorage['session_id']`
  gives that for free, whereas subdomains would still need the SSO handoff.
- **Tutor at root, courses under `/courses` via Next.js `basePath`** — `basePath`
  rebases an entire Next app (pages, links, assets, api) natively with ~zero code
  change; the hand-rolled Vite SPA + Express (62 raw `/api` sites, pathname router)
  is far cheaper to leave at the root it already assumes. Cost: courses SEO URLs
  move under `/courses` (301-redirectable; documented in MIGRATION.md).
- **One shared Postgres database** (not two) — a single `users`/`sessions` table is
  the whole point; product tables coexist in one DB.

## User model & auth

- **Unified `users` table = tutor's column superset** — courses' columns are a
  strict subset, so courses runs unchanged; no data is lost from either side.
- **Google `sub` is the dedup / identity key**, with verified `email` as fallback —
  both apps already use the same Google OAuth client, so `sub` matches across DBs.
- **Google-rooted users keep `id = sub` AND `google_sub = sub`** — matches courses'
  existing PK convention and tutor's linkage lookup simultaneously.
- **Standardize on Google OAuth** as the primary auth; retain Telegram (both apps)
  and anonymous (tutor) sign-in unchanged.
- **Keep the opaque-UUID-in-localStorage + `X-Session-Id` session model** (no switch
  to cookies/JWT) — both apps already share it; changing it would touch every call
  site for no benefit once the origin is unified.
- **Retain the HMAC `sso.ts` handoff** (unified into `@glottos/shared`) but treat it
  as optional/legacy — same-origin login no longer needs it; kept for external
  deep-links and the `/s/:code` share flow.
- **Accept both `ADMIN_USER` and `ADMIN_EMAIL`** in the shared admin-resolution
  helper — courses used the former, tutor the latter; supporting both avoids
  breaking either app's existing env.

## Schema / naming

- **Prefix courses' three generic tables** `progress`→`courses_progress`,
  `settings`→`courses_settings`, `daily_activity`→`courses_daily_activity` — they
  are the only collision-prone names; tutor's tables are already domain-specific.
  This delivers the requested table-prefix separation with a contained edit.
- **Product family name `glottos`**; packages `@glottos/{shared,courses,tutor}`.
- **One canonical `migrations/001_unified_schema.sql`** replacing both apps'
  boot-time `CREATE IF NOT EXISTS` blobs (neither legacy app used a migration
  tool). Kept idempotent so re-running is safe; apps may still self-heal on boot.
- **Collapse `DATABASE_URL_COURSES` + `DATABASE_URL_TUTOR` → one `DATABASE_URL`**;
  the data-migration reads the two legacy DBs via temporary `*_SRC` vars.

## Dependencies (resolved upward to newest compatible)

- `pg` → 8.19, `google-auth-library` → 10, `@react-oauth/google` → 0.13,
  TypeScript → 5.8, React → 19.2. Vitest and Tailwind stay per-workspace
  (v2/v4 and v3/v4 respectively) — isolated configs, no shared surface, so a
  forced single version would add risk with no benefit.

## Process / repo

- **`legacy/` is git-ignored** — it is reproducible read-only reference (cloned
  from the two source repos); committing it would bloat the repo and nest git dirs.
- **Reuse the existing `glottos-app` git repo** as the "fresh" repo (it had a single
  stale Docker-deployment commit, now superseded) rather than re-initialising —
  preserves the already-written `.env.example`/`.gitignore` groundwork.
