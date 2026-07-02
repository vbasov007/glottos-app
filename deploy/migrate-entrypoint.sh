#!/usr/bin/env bash
# One-off migration entrypoint for the `migrate` image target.
#
#   Always:  npm run db:init         (apply migrations/*.sql to DATABASE_URL — idempotent)
#   If RUN_LEGACY_MIGRATION=true:
#            npm run migrate:legacy -- --dry-run     (preview the merge; writes nothing)
#     and if MIGRATE_LIVE=true:
#            npm run migrate:legacy                  (perform the import — idempotent)
#
# Legacy import needs DATABASE_URL_COURSES_SRC and DATABASE_URL_TUTOR_SRC set
# (read-only source DBs). See MIGRATION.md for the full runbook.
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "FATAL: DATABASE_URL is not set (point it at the unified external Postgres)." >&2
  exit 1
fi

echo "==> [1/3] db:init — applying unified schema (idempotent)"
npm run db:init

if [[ "${RUN_LEGACY_MIGRATION:-false}" == "true" ]]; then
  : "${DATABASE_URL_COURSES_SRC:?RUN_LEGACY_MIGRATION=true but DATABASE_URL_COURSES_SRC is unset}"
  : "${DATABASE_URL_TUTOR_SRC:?RUN_LEGACY_MIGRATION=true but DATABASE_URL_TUTOR_SRC is unset}"

  echo "==> [2/3] migrate:legacy --dry-run (read-only preview)"
  npm run migrate:legacy -- --dry-run

  if [[ "${MIGRATE_LIVE:-false}" == "true" ]]; then
    echo "==> [3/3] migrate:legacy LIVE — importing legacy data (idempotent)"
    npm run migrate:legacy
  else
    echo "==> [3/3] skipped LIVE import (set MIGRATE_LIVE=true to write). Dry-run only."
  fi
else
  echo "==> legacy import skipped (set RUN_LEGACY_MIGRATION=true to enable)."
fi

echo "==> migration entrypoint done."
