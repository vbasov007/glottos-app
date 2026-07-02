# ANALYSIS — glottos-courses & text-tutor

Study of the two legacy codebases (read-only reference in `./legacy/`) that are
being merged into one monorepo with a shared user system.

- `legacy/glottos-cources/` — the **courses** app (`courses.glottos.com`, internal
  name *language-matrix-web* / "Glottos Matrix"). Main app in `web/` (Next.js).
- `legacy/text-tutor/` — the **tutor** app (`t.glottos.com`, "polyGlottos").
  Vite SPA (`src/`) + Express backend (`server.ts`).

Both are single-author language-learning products by the same developer, already
architecturally near-identical in their auth model, and already loosely joined by
a cross-app HMAC SSO handoff. That similarity is what makes a true merge cheap.

---

## 1. Tech stack of each project

| | **courses** (`web/`) | **tutor** (root) |
|---|---|---|
| Framework | **Next.js 15.5** App Router, `output: standalone` | **Vite 6** SPA + **Express 4.21** |
| UI | React 19.2 | React 19.0 |
| Language | TypeScript 5.7 | TypeScript 5.8 (server run via `tsx`, no compile) |
| Styling | Tailwind **3** + PostCSS | Tailwind **4** (Vite plugin) |
| Backend | Next.js route handlers (`app/api/**`) | Express `server.ts` (~3.7k lines) |
| DB client | `pg` 8.13, raw SQL, singleton Pool (`lib/db.ts`) | `pg` 8.19, raw SQL, singleton Pool |
| Auth libs | `@react-oauth/google` 0.12, `google-auth-library` 9 | `@react-oauth/google` 0.13, `google-auth-library` 10 |
| LLM | **Anthropic** Claude (`@anthropic-ai/sdk`) | **Gemini** (`@google/genai`), DeepSeek, OpenAI (OCR) |
| TTS | Google Cloud TTS + Azure | Google Cloud TTS + Azure + Yandex + Gemini |
| Payments | **none** | **Stripe** 20.4 (subscriptions) |
| Analytics | PostHog | (activity_log + Recharts admin) |
| i18n | `next-intl` (4 UI langs) | custom `src/i18n/` (~10 UI langs, ~45 target langs) |
| Tests | Vitest 2.1 (5 unit files); Playwright (mobile audit) | Vitest 4 (~300 tests, supertest + pg-mem); Playwright 1.58 (~42 e2e) |
| Node | 22 (alpine) | 22 (alpine) |
| Pkg mgr | npm | npm |
| Deploy | DigitalOcean App Platform, Docker, port **8080** | DigitalOcean App Platform / Yandex Cloud, Docker, port **8080**; nginx `t.glottos.com.conf` |

---

## 2. What overlaps (the shared surface)

These are the concerns that must be **unified** rather than duplicated:

### Auth — nearly identical
- Both verify **Google ID tokens** server-side with `google-auth-library`
  `OAuth2Client.verifyIdToken({ audience: GOOGLE_CLIENT_ID })`.
- Both mint an **opaque server-side session**: `session_id = crypto.randomUUID()`,
  row in a `sessions` table, `expires_at = now + SESSION_TTL_DAYS` (default **30**).
- Both store the id in **`localStorage['session_id']`** and send it as the
  **`X-Session-Id`** header on every API call. **No cookies, no JWT** for the app
  session.
- Both resolve the user with `SELECT user_id FROM sessions WHERE session_id=$1 AND expires_at > NOW()`
  (`requireAuth`) and gate admin on a `users.role='admin'` derived from an env
  email (`ADMIN_USER` in courses, `ADMIN_EMAIL` in tutor).
- Both support **Telegram Mini App** sign-in (HMAC `initData` verify with
  `TELEGRAM_BOT_TOKEN`).
- **Identity key is the Google `sub`.** In courses, `users.id = sub` directly. In
  tutor, `users.id = sub` for Google-rooted users **and** there is a separate
  `google_sub UNIQUE` column (so telegram/anon users can later link a Google
  account). Because **both apps use the same Google OAuth client ID**, the `sub`
  is identical across both databases — this is the deduplication key for the merge.

### Users & sessions tables — tutor's is a superset of courses'
courses `users`: `id, email(NOT NULL), name, picture, role, created_at`.
tutor `users`: the same columns **plus** `preferences, active_workspace_id,
stripe_customer_id, subscription_status, subscription_id, subscription_period_end,
cancel_at_period_end, source_code, telegram_id(UNIQUE), google_sub(UNIQUE)` and
`email` is **nullable** (anon users). → The unified `users` table = tutor's shape.
`sessions` is byte-identical (`session_id, user_id, expires_at`); courses adds two
indexes.

### Cross-app SSO handoff — already exists
`sso.ts` (both repos) mints a short-lived (120s) HMAC-SHA256 token
`base64url(header).base64url(payload).base64url(sig)` carrying
`{iss,aud,sub,email,name,picture,iat,exp}`, passed in the URL, so one app can log
a user into the other across separate DBs/origins. Endpoints in both:
`POST /api/sso/mint` (producer, auth-gated) and `POST /api/auth/sso` (consumer).
This exists **because** the two apps live on different origins and use localStorage
(not cross-domain cookies). A single-origin merge makes it largely redundant.

### Other shared concerns
- **DB access**: identical singleton `pg.Pool` pattern with the same DO-managed-
  Postgres SSL workaround (strip `sslmode=` from the URL, set
  `ssl: { rejectUnauthorized: false }`). Perfect candidate for extraction.
- **Multi-provider TTS** (Google + Azure) — both have their own copy.
- **Client error telemetry** (`POST /api/log`) — both have one.
- **Rate limiting**, **health check** (`GET /api/health`), **admin gating**.
- **Env vars** shared: `DATABASE_URL`, `GOOGLE_CLIENT_ID`,
  `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, `SSO_SHARED_SECRET`, `TELEGRAM_BOT_TOKEN`,
  `AZURE_TTS_KEY`, `AZURE_TTS_REGION`, `ADMIN_USER`/`ADMIN_EMAIL`, `SESSION_TTL_DAYS`.

---

## 3. What conflicts

| Conflict | courses | tutor | resolution (see MERGE_PLAN) |
|---|---|---|---|
| **`users`/`sessions` table names** | owns them | owns them | intentional — become the ONE shared table |
| **`/api/*` namespace** | `/api/*` (Next) | `/api/*` (Express) | courses moved under `/courses` via Next `basePath`; tutor keeps `/api/*` at root |
| **Root `/`** | multi-course landing + `/[target]` SEO | `Landing.tsx` marketing | tutor owns `/`; courses moves to `/courses/*` |
| **`pg`** | 8.13 | 8.19 | upgrade to 8.19 |
| **`google-auth-library`** | 9.15 | 10.6 | upgrade to 10 |
| **`@react-oauth/google`** | 0.12 | 0.13 | 0.13 |
| **Vitest** | 2.1 | 4.1 | keep per-workspace (isolated configs) |
| **Tailwind** | 3 | 4 | keep per-app (different config formats; no shared UI) |
| **React** | 19.2 | 19.0 | 19.2 (compatible) |
| **TypeScript** | 5.7 | 5.8 | 5.8 |
| **`sso.ts` header** | `typ:'JWT'` | `typ:'SSO'` | latent interop mismatch in legacy; unify on ONE shared helper |
| **Admin env var name** | `ADMIN_USER` | `ADMIN_EMAIL` | keep both accepted; document mapping |
| **Port** | 8080 | 8080 (4000 dev) | two processes on distinct internal ports behind one nginx |
| **Generic table names** | `progress`, `settings`, `daily_activity` | domain-specific names | prefix courses' three with `courses_` |
| **Dev DB port** | 55432 | 54320 | one dev Postgres (docker-compose) |

No **product-specific** table names collide (only `users`/`sessions`, which is the
point of the merge). Courses' three generically-named tables are the only real
collision risk and get a `courses_` prefix.

---

## 4. What is unique to each

**courses only**
- Build-time **course content pipeline**: Markdown under `courses/**` compiled by
  `scripts/build-content.ts` → `web/content/.generated/**` JSON. Two courses
  (`classic50`, `losreden50`), 8 targets × 4 native UI langs, SEO-indexable
  `/[target]/[native]` URLs.
- **Anthropic Claude** answer-judging (structured, categorized error feedback in
  the learner's native language) + AI exercise/dictionary generation.
- **CEFR** level tracking, gamified `daily_activity` points heatmap.
- Telegram Mini App chrome bridges, `?embed=1` iframe modal nav.
- Tables: `progress`, `settings`, `daily_activity`.

**tutor only**
- **Tap-to-explain** grammar (`/api/explain` → Gemini structured `ExplanationResult`).
- **Flashcards + spaced repetition** (bespoke interval-doubling scheduler,
  `srs_deck_sched`/`srs_card_sched`; legacy SM-2 `srs_card_state` kept as backup).
- **Stripe subscriptions** + tiered **quotas** (`daily_usage`, `app_settings`).
- **Workspaces** (multiple state tabs per user), **anonymous** trial + conversion.
- **Image OCR** (OpenAI vision), **text generation**, **shared lessons / iframe embed**.
- **Admin + monitoring** console (users, subs, promo sources, API keys, cost log).
- Tables: `user_state`, `workspaces`, `workspace_state`, `activity_log`,
  `daily_usage`, `app_settings`, `promo_sources`, `shared_lessons`, `api_keys`,
  `flashcard_decks`, `flashcard_deck_cards`, `srs_card_state`, `srs_deck_sched`,
  `srs_card_sched`.

---

## 5. Data-model summary (feeds the unified schema)

**Shared (become ONE table each):**
- `users` — unified = tutor's full column set (superset of courses').
- `sessions` — identical; keep courses' indexes.

**courses-owned product tables** → prefixed `courses_`:
- `courses_progress` (was `progress`), `courses_settings` (was `settings`),
  `courses_daily_activity` (was `daily_activity`).

**tutor-owned product tables** (names already domain-specific, kept as-is):
- `user_state`, `workspaces`, `workspace_state`, `activity_log`, `daily_usage`,
  `app_settings`, `promo_sources`, `shared_lessons`, `api_keys`,
  `flashcard_decks`, `flashcard_deck_cards`, `srs_card_state`, `srs_deck_sched`,
  `srs_card_sched`.

Neither app uses a migration framework — both apply idempotent
`CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` on boot
(`web/lib/db-schema.ts` for courses, `initDb()` in `server.ts` for tutor). The
merge introduces a single canonical `migrations/001_unified_schema.sql`.
