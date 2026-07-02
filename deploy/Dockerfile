# syntax=docker/dockerfile:1.4
#
# One multi-target Dockerfile for the merged glottos monorepo. Build context is
# the REPO ROOT (see deploy/docker-compose.prod.yml). Compose builds each
# service from a different `target`:
#
#   target: courses  -> Next.js standalone server            (:8080, /courses)
#   target: tutor    -> Express (tsx) serving the Vite SPA    (:4000, /)
#   target: migrate  -> one-off: db:init [+ migrate:legacy]   (no long process)
#
# Debian slim (not alpine) because tutor pulls better-sqlite3, a native module
# that has glibc prebuilds — no musl compile toolchain needed.

# ============================================================
# base — install the WHOLE workspace once (courses + tutor + shared).
# ============================================================
FROM node:22-slim AS base
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    npm_config_audit=false \
    npm_config_fund=false

# Toolchain for native addons (tutor's better-sqlite3) in case a prebuilt binary
# isn't available for the target platform. Lives only in the builder — the
# runtime images copy compiled artifacts, not these packages.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Copy only manifests first so `npm ci` is cached until a package.json changes.
# The root lockfile covers every workspace (per-app lockfiles were dropped).
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/courses/package.json apps/courses/package.json
COPY apps/tutor/package.json apps/tutor/package.json

# Install ALL deps incl. devDeps — Next/Vite/tsx builders need them, and tutor
# runs on tsx at runtime (a prod dependency, so it survives). NODE_ENV is unset
# for this one command so npm does not drop devDependencies.
RUN NODE_ENV=development npm ci

# Now the source. .dockerignore keeps out node_modules/.next/dist/.env/etc.
COPY . .

# ============================================================
# courses-build — `next build` produces the standalone bundle.
# NEXT_PUBLIC_* are inlined into the client bundle at build time, so they MUST
# be present here as build args (compose forwards them from .env).
# ============================================================
FROM base AS courses-build
ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID=""
ARG NEXT_PUBLIC_BASE_PATH="/courses"
ARG NEXT_PUBLIC_POSTHOG_KEY=""
ARG NEXT_PUBLIC_POSTHOG_HOST=""
ARG NEXT_PUBLIC_TUTOR_URL=""
ARG NEXT_PUBLIC_TMA_DEFAULT_TARGET=""
ARG SITE_URL=""
ENV NEXT_PUBLIC_GOOGLE_CLIENT_ID=$NEXT_PUBLIC_GOOGLE_CLIENT_ID \
    NEXT_PUBLIC_BASE_PATH=$NEXT_PUBLIC_BASE_PATH \
    NEXT_PUBLIC_POSTHOG_KEY=$NEXT_PUBLIC_POSTHOG_KEY \
    NEXT_PUBLIC_POSTHOG_HOST=$NEXT_PUBLIC_POSTHOG_HOST \
    NEXT_PUBLIC_TUTOR_URL=$NEXT_PUBLIC_TUTOR_URL \
    NEXT_PUBLIC_TMA_DEFAULT_TARGET=$NEXT_PUBLIC_TMA_DEFAULT_TARGET \
    SITE_URL=$SITE_URL \
    NODE_ENV=production
# `prebuild` regenerates content/.generated, then `next build` emits standalone.
RUN npm run build -w @glottos/courses

# ============================================================
# courses — runtime. The standalone tree is self-contained (its own
# node_modules, the traced content/.generated + messages, @glottos/shared
# transpiled in). Run `node server.js` with cwd=apps/courses so the runtime
# `process.cwd()/content/.generated` lookups resolve.
# ============================================================
FROM node:22-slim AS courses
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=8080 \
    HOSTNAME=0.0.0.0
RUN groupadd -r nodejs && useradd -r -g nodejs nextjs
WORKDIR /app
COPY --from=courses-build --chown=nextjs:nodejs /app/apps/courses/.next/standalone ./
COPY --from=courses-build --chown=nextjs:nodejs /app/apps/courses/.next/static ./apps/courses/.next/static
USER nextjs
WORKDIR /app/apps/courses
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+(process.env.NEXT_PUBLIC_BASE_PATH||'/courses')+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]

# ============================================================
# tutor-build — `vite build` emits apps/tutor/dist. GOOGLE_CLIENT_ID is inlined
# into the SPA bundle by vite's `define`, so it must be present at build time.
# (No .git in the image -> vite's getCommitHash() falls back to COMMIT_HASH.)
# ============================================================
FROM base AS tutor-build
ARG GOOGLE_CLIENT_ID=""
ARG COURSES_URL=""
ARG COMMIT_HASH=""
ENV GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID \
    COURSES_URL=$COURSES_URL \
    COMMIT_HASH=$COMMIT_HASH \
    NODE_ENV=production
RUN npm run build -w @glottos/tutor

# ============================================================
# tutor — runtime. Express served by tsx (a prod dependency). Needs the hoisted
# root node_modules + packages/shared TS source + apps/tutor (server*.ts, src/,
# and the freshly built dist/). Carry the whole /app forward from the builder.
# ============================================================
FROM node:22-slim AS tutor
ENV NODE_ENV=production \
    PORT=4000
WORKDIR /app
COPY --from=tutor-build /app ./
WORKDIR /app/apps/tutor
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Uses tutor's package.json "start": "tsx server.ts"; npm resolves tsx from the
# workspace. exec-form via npm keeps signals flowing to the node process.
CMD ["npm", "run", "start"]

# ============================================================
# migrate — one-off schema init + optional legacy data import. Not a service you
# leave running; compose runs it with `--rm` under the `migrate` profile.
# Controlled by env: RUN_LEGACY_MIGRATION / MIGRATE_LIVE (see entrypoint).
# ============================================================
FROM base AS migrate
ENV NODE_ENV=production
COPY deploy/migrate-entrypoint.sh /usr/local/bin/migrate-entrypoint.sh
RUN chmod +x /usr/local/bin/migrate-entrypoint.sh
ENTRYPOINT ["/usr/local/bin/migrate-entrypoint.sh"]
