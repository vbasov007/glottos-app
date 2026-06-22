# syntax=docker/dockerfile:1.4
#
# Single-image deployment that joins two apps behind one nginx, routed by Host:
#   - glottos-courses (Next.js 15 standalone)  ->  127.0.0.1:8080
#   - text-tutor      (Express + Vite SPA)     ->  127.0.0.1:4000
#
# IMPORTANT: build context must be the PARENT directory that contains both
# sibling repos plus this folder, e.g.:
#
#   docker build -f glottos-app/Dockerfile -t glottos-combined .
#
# (docker-compose.yml already sets `context: ..` so `docker compose build` does
# this for you.) We never write into the project folders — we only COPY from
# them during the image build.

# =========================================================================
# glottos-courses (Next.js)  — mirrors ../glottos-courses/Dockerfile
# =========================================================================

# ---------- courses: install deps ----------
FROM node:22-alpine AS courses-deps
WORKDIR /app/web
COPY glottos-courses/web/package.json glottos-courses/web/package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---------- courses: build ----------
FROM node:22-alpine AS courses-build
WORKDIR /app/web
COPY --from=courses-deps /app/web/node_modules ./node_modules

# build-content.ts walks ../../courses and ../../meta, so both trees must exist.
COPY glottos-courses/courses /app/courses
COPY glottos-courses/meta /app/meta
COPY glottos-courses/web /app/web

# NEXT_PUBLIC_* must be in scope during `next build` (Next inlines them into the
# client bundle). Provide via --build-arg (docker-compose forwards them).
ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID=""
ENV NEXT_PUBLIC_GOOGLE_CLIENT_ID=$NEXT_PUBLIC_GOOGLE_CLIENT_ID
ARG NEXT_PUBLIC_POSTHOG_KEY=""
ENV NEXT_PUBLIC_POSTHOG_KEY=$NEXT_PUBLIC_POSTHOG_KEY
ARG NEXT_PUBLIC_POSTHOG_HOST=""
ENV NEXT_PUBLIC_POSTHOG_HOST=$NEXT_PUBLIC_POSTHOG_HOST
ARG NEXT_PUBLIC_TUTOR_URL=""
ENV NEXT_PUBLIC_TUTOR_URL=$NEXT_PUBLIC_TUTOR_URL
ARG NEXT_PUBLIC_TMA_DEFAULT_TARGET=""
ENV NEXT_PUBLIC_TMA_DEFAULT_TARGET=$NEXT_PUBLIC_TMA_DEFAULT_TARGET
ARG SITE_URL=""
ENV SITE_URL=$SITE_URL

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
RUN npm run build

# =========================================================================
# text-tutor (Vite SPA + Express)  — mirrors ../text-tutor/Dockerfile
# =========================================================================

# ---------- tutor: build the SPA ----------
FROM node:22-alpine AS tutor-build
RUN apk add --no-cache git
WORKDIR /app
COPY text-tutor/package.json text-tutor/package-lock.json ./
RUN npm ci

# Build-time env vars for Vite (loadEnv with empty prefix merges process.env).
ARG GOOGLE_CLIENT_ID=""
ENV GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID
ARG COURSES_URL=""
ENV COURSES_URL=$COURSES_URL

COPY text-tutor/ ./
RUN npm run build
# Stamp the build so /api/health can report it (matches the tutor Dockerfile).
RUN printf '{"commit":"%s","builtAt":"%s"}\n' \
      "$(git rev-parse --short HEAD 2>/dev/null || echo unknown)" \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > build-info.json

# ---------- tutor: production node_modules (prod deps incl. tsx) ----------
FROM node:22-alpine AS tutor-runtime-deps
WORKDIR /app
COPY text-tutor/package.json text-tutor/package-lock.json ./
RUN npm ci --omit=dev

# =========================================================================
# Final runtime image: nginx + both node servers under supervisord
# =========================================================================
FROM node:22-alpine AS final
RUN apk add --no-cache nginx supervisor gettext tini curl
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# --- courses: Next.js standalone bundle (run with cwd /app/courses) ---
COPY --from=courses-build /app/web/.next/standalone ./courses
COPY --from=courses-build /app/web/.next/static ./courses/.next/static

# --- tutor: exactly the runtime files its own Dockerfile ships ---
COPY --from=tutor-runtime-deps /app/node_modules ./tutor/node_modules
COPY --from=tutor-build /app/dist ./tutor/dist
COPY --from=tutor-build /app/build-info.json ./tutor/
COPY text-tutor/package.json text-tutor/package-lock.json ./tutor/
COPY text-tutor/server.ts text-tutor/server-constants.ts text-tutor/server-utils.ts text-tutor/sso.ts text-tutor/tsconfig.json ./tutor/
COPY text-tutor/src/i18n/ ./tutor/src/i18n/
COPY text-tutor/src/lib/ ./tutor/src/lib/
COPY text-tutor/prompts/ ./tutor/prompts/

# --- process orchestration + edge routing ---
COPY glottos-app/supervisord.conf /etc/supervisord.conf
COPY glottos-app/nginx.conf.template /etc/nginx/nginx.conf.template
COPY glottos-app/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 80
ENTRYPOINT ["/sbin/tini", "--", "/entrypoint.sh"]
