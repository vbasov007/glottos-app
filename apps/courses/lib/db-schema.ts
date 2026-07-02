// Courses-owned product tables (self-heal / idempotent apply). Imported by the
// offline `scripts/db-init.ts` and the `POST /api/admin/db-init` route.
//
// In the MERGED monorepo the shared identity tables (`users`, `sessions`) are
// owned by the unified migration `migrations/001_unified_schema.sql`, NOT here —
// run `npm run db:init` at the repo root first (it creates `users`/`sessions`
// plus every product table). These CREATEs only cover the courses product tables,
// which are prefixed `courses_` so they never collide with the tutor app's
// tables in the shared database. Every statement is CREATE … IF NOT EXISTS.

export const SCHEMA_SQL = `
-- Courses product tables (shared DB; users/sessions come from the unified migration).

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
`;
