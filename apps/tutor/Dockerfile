# Stage 1: build the Vite SPA
FROM node:22-alpine AS builder
RUN apk add --no-cache git
WORKDIR /app

COPY package*.json ./
RUN npm ci

# Build-time env vars for Vite
ARG GOOGLE_CLIENT_ID
ENV GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID
ARG COURSES_URL
ENV COURSES_URL=$COURSES_URL

COPY . .
RUN npm run build

# Stamp the build with the current commit + build time so /api/health can
# report which commit production is actually running. git and .git are present
# in this stage (apk add git above; .git is not in .dockerignore).
RUN printf '{"commit":"%s","builtAt":"%s"}\n' \
      "$(git rev-parse --short HEAD 2>/dev/null || echo unknown)" \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > build-info.json && cat build-info.json

# Stage 2: production image
FROM node:22-alpine
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/build-info.json ./
COPY server.ts server-constants.ts server-utils.ts sso.ts tsconfig.json ./
COPY src/i18n/ ./src/i18n/
COPY src/lib/ ./src/lib/
COPY prompts/ ./prompts/

ENV NODE_ENV=production
EXPOSE 8080

CMD ["npm", "start"]
