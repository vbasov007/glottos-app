# MIGRATION.md — production cut-over runbook

How to move production from the two separate apps (`courses.glottos.com`,
`t.glottos.com`, two databases) to the merged single-origin app with one unified
database. Read this whole file before starting. Every data step has a **dry-run
first** and a **rollback**.

> The data-migration script **only reads** the two legacy databases and **only
> writes** to the new unified database. It never drops, truncates, or updates
> legacy data. Keep the legacy apps and DBs running until step 7 sign-off.

---

## 0. Pre-flight

- [ ] Provision the **unified Postgres** (managed PG 16). Note its `DATABASE_URL`.
- [ ] Have read-only-capable connection strings for the two legacy DBs:
      `DATABASE_URL_COURSES_SRC`, `DATABASE_URL_TUTOR_SRC`.
- [ ] Same **Google OAuth client** as before (so `google_sub` stays the identity
      key). Add the new redirect URI (see step 5).
- [ ] One host with Node 22, nginx, pm2. Clone this repo, `npm ci`,
      `npm run build` (builds both apps).
- [ ] Decide the public origin, e.g. `https://glottos.com`. Courses will live at
      `/courses`, tutor at `/`.

## 1. Back up everything (both legacy DBs)

```bash
pg_dump "$DATABASE_URL_COURSES_SRC" -Fc -f courses_legacy_$(date +%F).dump
pg_dump "$DATABASE_URL_TUTOR_SRC"   -Fc -f tutor_legacy_$(date +%F).dump
```
Store both off-host. These are the rollback source of truth.

## 2. Create the unified schema

```bash
export DATABASE_URL=<unified>
npm run db:init        # applies migrations/001_unified_schema.sql (idempotent)
```
Verify: `psql "$DATABASE_URL" -c "\dt"` shows `users`, `sessions`, `courses_*`
and the tutor tables.

## 3. Dry-run the data migration (READ-ONLY)

```bash
export DATABASE_URL=<unified>
export DATABASE_URL_COURSES_SRC=<legacy courses>
export DATABASE_URL_TUTOR_SRC=<legacy tutor>
npm run migrate:legacy -- --dry-run
```
Review the printed plan:
- `unified users` / `present in BOTH apps` (deduplicated) / `courses-only` /
  `tutor-only` — sanity-check the counts against expectations.
- The sample `merge:` lines show which accounts collapse (by google_sub, then
  telegram id, then verified email).
- Per-table `would import N` counts.

Nothing is written in dry-run.

## 4. Run the data migration (LIVE)

Ideally freeze writes on the legacy apps first (maintenance banner) so no new
rows are created mid-copy; otherwise re-running later is safe (idempotent).

```bash
npm run migrate:legacy          # same env as step 3, without --dry-run
```
The script is idempotent: `users` upserts fill gaps via COALESCE (never
overwrite), all product inserts are `ON CONFLICT DO NOTHING`. Re-run any time to
catch rows created after the copy.

Spot-check:
```sql
SELECT count(*) FROM users;
SELECT count(*) FROM courses_progress;   -- courses data landed
SELECT count(*) FROM workspaces;         -- tutor data landed
-- a known dual-app account resolves to one row with both products' data:
SELECT id, role, subscription_status FROM users WHERE email = '<known user>';
```

## 5. Configure the merged app

- [ ] `cp deploy/.env.example .env` and fill in ALL values (one `DATABASE_URL`,
      the shared Google/SSO/Telegram/Azure vars, plus each app's own keys). The
      file documents every old→new variable mapping.
- [ ] `NEXT_PUBLIC_BASE_PATH=/courses` (baked into the courses build — rebuild
      courses if you change it).
- [ ] Google Cloud console: add Authorized redirect URI
      `https://glottos.com/courses/api/auth/google/redirect` and authorized
      JavaScript origin `https://glottos.com`.
- [ ] `npm run build` (rebuild both apps with the final env).

## 6. Deploy behind one nginx

- [ ] Start both processes: `pm2 start deploy/ecosystem.config.cjs`
      (courses → :8080, tutor → :4000). `pm2 save`.
- [ ] Install `deploy/nginx.conf` (set `server_name`, TLS certs), `nginx -t`,
      `systemctl reload nginx`.
- [ ] Smoke test on the live origin:
  - `GET /api/health` (tutor) and `GET /courses/api/health` → 200.
  - Sign in with Google on `/` (tutor). Then open `/courses` — you are **already
    signed in as the same account** (shared origin + shared `sessions` table).
  - Sign out, sign in on `/courses`, confirm `/` is signed in too.
  - Exercise a core action in each product (an explain in tutor, a lesson answer
    in courses).

## 7. Cut over DNS / URLs

- Point `glottos.com` (or your chosen origin) at the new host.
- **Old URLs:** add 301 redirects so existing links/SEO survive:
  - `courses.glottos.com/<path>` → `glottos.com/courses/<path>`
  - `t.glottos.com/<path>` → `glottos.com/<path>`
  (The cross-app `?sso=` / `/s/:code` handoff still works for any external deep
  links minted before cut-over.)
- Keep the legacy apps + DBs **running but read-only** for a cool-down window
  (e.g. 1–2 weeks) in case of rollback.

## 8. Rollback plan

The legacy stack is untouched, so rollback is DNS-level:
1. Repoint DNS back to `courses.glottos.com` / `t.glottos.com` (legacy apps).
2. Remove the 301 redirects.
3. The legacy DBs were never modified, so no data restore is needed. (If you
   ever must rebuild a legacy DB, restore from the step-1 dumps.)

Because the migration only ever wrote to the NEW database, aborting mid-way is
safe: drop/recreate the unified DB and re-run `db:init` + `migrate:legacy` from
scratch. No legacy data is ever at risk.

## Notes / gotchas

- **Telegram identity:** courses rooted Telegram users at `id = "tg-<id>"`; the
  merged schema and migration keep that canonical form and remap tutor's UUID
  telegram rows onto it (dedup by `telegram_id`).
- **Sessions carry over:** legacy session rows are imported, so users already
  signed in stay signed in after cut-over (their localStorage `session_id` still
  resolves — on the SAME origin now, for both apps).
- **App-settings:** tutor seeds its `app_settings` defaults on first boot; the
  migration also copies any customised legacy values.
- **DB trusted sources:** add the new host to the managed Postgres firewall/
  trusted-sources, or `initDb()`/`db:init` will hang (a known legacy gotcha).
