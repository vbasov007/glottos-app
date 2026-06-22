#!/bin/sh
set -eu

# Hostnames nginx routes on. Override via env (docker-compose .env).
: "${COURSES_HOST:=courses.glottos.com}"
: "${TUTOR_HOST:=t.glottos.com}"
export COURSES_HOST TUTOR_HOST

# Per-app database URLs are referenced by supervisord; ensure they exist so the
# %(ENV_...)s expansion never errors (an empty value yields a clear app-side
# DB error instead of a cryptic supervisor crash).
: "${DATABASE_URL_COURSES:=}"
: "${DATABASE_URL_TUTOR:=}"
export DATABASE_URL_COURSES DATABASE_URL_TUTOR

if [ -z "$DATABASE_URL_COURSES" ]; then
  echo "WARN: DATABASE_URL_COURSES is empty — glottos-courses will fail to start." >&2
fi
if [ -z "$DATABASE_URL_TUTOR" ]; then
  echo "WARN: DATABASE_URL_TUTOR is empty — text-tutor will fail to start." >&2
fi

# Render nginx config with the routing hostnames.
envsubst '${COURSES_HOST} ${TUTOR_HOST}' \
  < /etc/nginx/nginx.conf.template > /etc/nginx/nginx.conf

echo "Routing: ${COURSES_HOST} -> courses(:8080), ${TUTOR_HOST} -> tutor(:4000)"

exec supervisord -c /etc/supervisord.conf
