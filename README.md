# glottos-app — combined deployment

Runs **glottos-courses** (Next.js) and **text-tutor** (Express + Vite SPA) in a
**single container** behind one nginx, with a **single shared login**. Neither
project's source is modified — this image only builds *from* the two sibling
repos.

```
                 (TLS terminated upstream: Cloudflare / LB)
                              │ HTTP :80
                  ┌───────────▼───────────┐  one container
                  │   nginx (Host router)  │
                  │ courses.* → :8080      │
                  │ t.*       → :4000      │
                  └─────┬───────────┬──────┘
            Next.js standalone   Express (tsx) + SPA
                  │                   │
              external Postgres: db "courses" + db "textutor"
```

## How "one login" works

The two apps already federate sign-in via a short-lived HMAC token handoff
(`CROSS_APP_SSO_GUIDE.md` in both repos). It works as long as three things match
across both apps, which `.env` enforces:

- the **same Google OAuth client ID** (`GOOGLE_CLIENT_ID` == `NEXT_PUBLIC_GOOGLE_CLIENT_ID`),
- the **same `SSO_SHARED_SECRET`**,
- cross-app base URLs (`NEXT_PUBLIC_TUTOR_URL`, `COURSES_URL`) pointing at the
  two public subdomains.

Signing into either subdomain then carries the user to the other.

## Prerequisites

- Both repos checked out as siblings of this folder:
  `../glottos-courses`, `../text-tutor`.
- An external/managed PostgreSQL with **two empty databases** (one per app —
  their schemas conflict, so they cannot share one).
- DNS: point `COURSES_HOST` and `TUTOR_HOST` at this server. TLS is handled by
  your upstream proxy (Cloudflare / load balancer) → forward HTTP to `:80`.
- In the Google OAuth console, add both subdomains as authorized JavaScript
  origins / redirect URIs.

## First deploy

```sh
cd glottos-app
cp .env.example .env          # fill in DB URLs, Google client ID, SSO secret, API keys
docker compose build          # builds both apps into one image (context = parent dir)
docker compose run --rm courses-db-init   # one-time: create glottos-courses tables
docker compose up -d          # text-tutor auto-creates its own tables on boot
```

> Build args (`NEXT_PUBLIC_*`, `GOOGLE_CLIENT_ID`, `COURSES_URL`, `SITE_URL`)
> are inlined at build time, so **re-run `docker compose build` if you change
> them** — editing `.env` alone won't update the already-built bundles.

## Verify

```sh
# health of each app through the router
curl -fsS -H "Host: courses.glottos.com" http://localhost/api/health
curl -fsS -H "Host: t.glottos.com"       http://localhost/api/health

# routing sanity
curl -s -H "Host: courses.glottos.com" http://localhost/      | head   # Next.js HTML
curl -s -H "Host: t.glottos.com"       http://localhost/app   | head   # tutor SPA shell
```

End-to-end "one login": sign into courses with Google, click an "Open in
Glottos" link → the tutor tab lands signed in as the same account; the tutor
header back-link returns to courses as the same user.

## Operating

- Logs: `docker compose logs -f app` (nginx + both node servers stream to stdout
  via supervisord).
- Change a runtime secret (e.g. `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, DB URL):
  edit `.env`, then `docker compose up -d` (no rebuild needed for runtime vars).
- Change a build-time var (anything `NEXT_PUBLIC_*`, `GOOGLE_CLIENT_ID`,
  `COURSES_URL`, `SITE_URL`): `docker compose build && docker compose up -d`.

## Files

| File | Purpose |
|------|---------|
| `Dockerfile` | Multi-stage build of both apps → one runtime image (context = parent dir). |
| `docker-compose.yml` | `app` service (+ one-time `courses-db-init`). |
| `nginx.conf.template` | Host-based router; rendered by `entrypoint.sh`. |
| `supervisord.conf` | Runs nginx + courses + tutor; injects per-app `PORT`/`DATABASE_URL`. |
| `entrypoint.sh` | Renders nginx config from `COURSES_HOST`/`TUTOR_HOST`, then starts supervisord. |
| `.env.example` | All build + runtime variables. |
