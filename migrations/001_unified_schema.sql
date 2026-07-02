-- =====================================================================
-- 001_unified_schema.sql — the ONE canonical schema for the merged app.
--
-- Replaces the two legacy boot-time schemas (glottos-courses
-- web/lib/db-schema.ts and text-tutor server.ts initDb()). One database, one
-- `users` table, one `sessions` table, shared by both products. Product tables
-- are separated by ownership: courses tables are prefixed `courses_`, tutor
-- tables keep their (already domain-specific) names.
--
-- Every statement is idempotent (CREATE ... IF NOT EXISTS), so this file is
-- safe to run repeatedly and safe to run alongside each app's own boot-time
-- self-heal. Apply with:  npm run db:init
-- =====================================================================

-- ---------------------------------------------------------------------
-- SHARED IDENTITY  (owned by neither product — the whole point of the merge)
-- ---------------------------------------------------------------------

-- Unified users table = the SUPERSET of both apps' columns (tutor's shape, which
-- already contained courses' columns as a subset). Courses reads only
-- id/email/name/picture/role/created_at; tutor uses the rest. email is nullable
-- to allow tutor's anonymous users.
CREATE TABLE IF NOT EXISTS users (
  id                       TEXT PRIMARY KEY,                 -- Google sub, "tg-<id>", or UUID (anon)
  email                    TEXT,                             -- nullable (anon); real email or tg+<id>@telegram.local
  name                     TEXT,
  picture                  TEXT,
  role                     TEXT NOT NULL DEFAULT 'user',     -- 'user' | 'admin' | 'anonymous'
  preferences              JSONB DEFAULT '{"interfaceLanguage":"en","explanationLanguage":"en"}',
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  active_workspace_id      TEXT,
  google_sub               TEXT UNIQUE,                      -- identity key; = id for Google-rooted users
  telegram_id              BIGINT UNIQUE,
  source_code              TEXT,                             -- promo channel
  stripe_customer_id       TEXT,
  subscription_status      TEXT DEFAULT 'free',              -- 'free'|'active'|'trialing'|'past_due'
  subscription_id          TEXT,
  subscription_period_end  TIMESTAMPTZ,
  cancel_at_period_end     BOOLEAN DEFAULT FALSE
);

-- Opaque server-side sessions (bearer UUID in localStorage -> X-Session-Id).
-- Because both apps share this table AND (single origin) the same localStorage
-- key, a login in either app authenticates the other with no SSO handoff.
CREATE TABLE IF NOT EXISTS sessions (
  session_id   TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at   TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id   ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

-- ---------------------------------------------------------------------
-- COURSES product tables  (prefixed courses_)
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS courses_progress (
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_key   TEXT NOT NULL,
  state        JSONB NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, course_key)
);

CREATE TABLE IF NOT EXISTS courses_settings (
  key          TEXT PRIMARY KEY,
  value        JSONB NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS courses_daily_activity (
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_key   TEXT NOT NULL,
  day          DATE NOT NULL,
  points       INTEGER NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, course_key, day)
);
CREATE INDEX IF NOT EXISTS idx_courses_daily_activity_user_course
  ON courses_daily_activity(user_id, course_key, day DESC);

-- ---------------------------------------------------------------------
-- TUTOR product tables  (existing domain-specific names, kept as-is)
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS user_state (
  user_id    TEXT PRIMARY KEY REFERENCES users(id),
  state      JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workspaces (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  name       TEXT NOT NULL DEFAULT 'Workspace 1',
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workspace_state (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  state        JSONB NOT NULL DEFAULT '{}',
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS activity_log (
  id           SERIAL PRIMARY KEY,
  user_id      TEXT REFERENCES users(id) ON DELETE CASCADE,
  action       TEXT NOT NULL,
  detail       TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  input_units  INTEGER,
  output_units INTEGER,
  device       TEXT,
  model        TEXT,
  provider     TEXT,
  language     TEXT,
  duration_ms  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_activity_log_created_at ON activity_log(created_at);

CREATE TABLE IF NOT EXISTS daily_usage (
  user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  usage_date          DATE NOT NULL DEFAULT CURRENT_DATE,
  explain_count       INTEGER NOT NULL DEFAULT 0,
  tts_count           INTEGER NOT NULL DEFAULT 0,
  generate_count      INTEGER NOT NULL DEFAULT 0,
  wav_text_count      INTEGER NOT NULL DEFAULT 0,
  wav_flashcard_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, usage_date)
);

CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS promo_sources (
  id          SERIAL PRIMARY KEY,
  code        TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shared_lessons (
  id              TEXT PRIMARY KEY,
  creator_user_id TEXT REFERENCES users(id),
  workspace_id    TEXT,
  state           JSONB NOT NULL,
  text_language   TEXT NOT NULL DEFAULT 'de',
  workspace_name  TEXT,
  share_source    TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  status          TEXT DEFAULT 'ready',
  progress_total  INTEGER DEFAULT 0,
  progress_done   INTEGER DEFAULT 0,
  content_hash    TEXT
);

CREATE TABLE IF NOT EXISTS api_keys (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  key_hash   TEXT UNIQUE NOT NULL,
  name       TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS flashcard_decks (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_flashcard_decks_user ON flashcard_decks(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_flashcard_decks_user_name ON flashcard_decks(user_id, name);

CREATE TABLE IF NOT EXISTS flashcard_deck_cards (
  id                   TEXT PRIMARY KEY,
  deck_id              TEXT NOT NULL REFERENCES flashcard_decks(id) ON DELETE CASCADE,
  source_text          TEXT NOT NULL,
  text_language        TEXT NOT NULL,
  explanation          JSONB NOT NULL,
  frequency            SMALLINT NOT NULL DEFAULT 2,
  position             INTEGER NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  explanation_language TEXT,
  UNIQUE (deck_id, source_text)
);
CREATE INDEX IF NOT EXISTS idx_flashcard_deck_cards_deck ON flashcard_deck_cards(deck_id);

-- Legacy SM-2 SRS state (retained untouched as a backup scheduler).
CREATE TABLE IF NOT EXISTS srs_card_state (
  user_id       TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_id       TEXT        NOT NULL REFERENCES flashcard_deck_cards(id) ON DELETE CASCADE,
  deck_id       TEXT        NOT NULL REFERENCES flashcard_decks(id) ON DELETE CASCADE,
  direction     TEXT        NOT NULL DEFAULT 'forward' CHECK (direction IN ('forward','reverse')),
  phase         TEXT        NOT NULL DEFAULT 'new' CHECK (phase IN ('new','learning','review')),
  step_index    SMALLINT    NOT NULL DEFAULT 0,
  ease          REAL        NOT NULL DEFAULT 2.3,
  interval_days REAL        NOT NULL DEFAULT 0,
  due           TIMESTAMPTZ,
  reps          INTEGER     NOT NULL DEFAULT 0,
  lapses        INTEGER     NOT NULL DEFAULT 0,
  is_leech      BOOLEAN     NOT NULL DEFAULT FALSE,
  last_reviewed TIMESTAMPTZ,
  PRIMARY KEY (user_id, card_id, direction)
);
CREATE INDEX IF NOT EXISTS idx_srs_due   ON srs_card_state (user_id, deck_id, due) WHERE phase <> 'new';
CREATE INDEX IF NOT EXISTS idx_srs_new   ON srs_card_state (user_id, deck_id) WHERE phase = 'new';
CREATE INDEX IF NOT EXISTS idx_srs_leech ON srs_card_state (user_id, deck_id) WHERE is_leech;

-- Active interval-doubling scheduler.
CREATE TABLE IF NOT EXISTS srs_deck_sched (
  user_id   TEXT     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  deck_id   TEXT     NOT NULL REFERENCES flashcard_decks(id) ON DELETE CASCADE,
  direction TEXT     NOT NULL DEFAULT 'forward' CHECK (direction IN ('forward','reverse')),
  seed      BIGINT   NOT NULL,
  n         INTEGER  NOT NULL,
  t         BIGINT   NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, deck_id, direction)
);

CREATE TABLE IF NOT EXISTS srs_card_sched (
  user_id   TEXT     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_id   TEXT     NOT NULL REFERENCES flashcard_deck_cards(id) ON DELETE CASCADE,
  deck_id   TEXT     NOT NULL REFERENCES flashcard_decks(id) ON DELETE CASCADE,
  direction TEXT     NOT NULL DEFAULT 'forward' CHECK (direction IN ('forward','reverse')),
  rank      INTEGER  NOT NULL,
  x         INTEGER  NOT NULL,
  next_due  BIGINT   NOT NULL,
  PRIMARY KEY (user_id, card_id, direction)
);
CREATE INDEX IF NOT EXISTS idx_srs_card_sched_deck ON srs_card_sched (user_id, deck_id, direction);

-- tutor seeds app_settings defaults on boot (server.ts initDb). They are not
-- duplicated here to keep this file schema-only; booting the tutor app once
-- populates them, or they can be managed via the Admin UI.
