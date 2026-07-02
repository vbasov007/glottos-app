# Production Readiness Audit

Generated: 2026-03-08 | Updated: 2026-03-08

## FIXED

| # | Issue | Fix |
|---|---|---|
| 1 | ~~TLS verification globally disabled~~ | Removed `NODE_TLS_REJECT_UNAUTHORIZED='0'`; DB pool uses its own `ssl` config |
| 2 | ~~XSS in OAuth redirect~~ | `sessionId` escaped via `JSON.stringify()` (`server.ts:419`) |
| 3 | ~~CORS wildcard with credentials~~ | Allowlist from `ALLOWED_ORIGINS` / `APP_URL` env vars (`server.ts:25-36`) |
| 4 | ~~No rate limiting, TTS unauthenticated~~ | `express-rate-limit` on all `/api/` (1000/15min), TTS (300/15min), auth (20/15min); TTS now requires auth (`server.ts:39-61, 536`) |
| 5 | ~~Playback race: prefetch ignores stop~~ | `manualStopRef` checked after prefetch completes (`App.tsx:1849`) |
| 6 | ~~localStorage JSON.parse crash~~ | Wrapped in try/catch, corrupted data removed (`App.tsx:1391-1395`) |
| 9 | ~~No global Express error middleware~~ | `asyncHandler` wrapper on all 20 async routes + error middleware (`server.ts:80-83, 902-908`) |
| 10 | ~~No DB pool config~~ | `max: 20`, `idleTimeoutMillis: 30s`, `connectionTimeoutMillis: 5s`, `pool.on('error')` (`server.ts:68-77`) |
| 15 | ~~No startup env var validation~~ | `DATABASE_URL` and `GOOGLE_CLIENT_ID` validated on boot (`server.ts:13-20`) |
| 16 | ~~No graceful shutdown~~ | SIGTERM/SIGINT handlers: close server, drain pool, 10s forced exit (`server.ts:927-948`) |

## HIGH — Should fix next

| # | Issue | Location |
|---|---|---|
| 8 | **State save (`PUT /api/state`) is fire-and-forget** — no error handling, user work silently lost on network failure | `App.tsx:2190-2205` |
| 11 | **Missing input validation on workspace/preference endpoints** — name length, type not checked | `server.ts:483, 494` |
| 12 | **No request abort on workspace switch** — old fetch can update state for wrong workspace | `App.tsx:2213-2214` |
| 13 | **Missing OAuth state parameter** — no CSRF protection on auth flow | `server.ts:368-428` |
| 14 | **User deletion not in DB transaction** — partial delete possible on failure | `server.ts:790-794` |
| 17 | **Inconsistent header casing** — `X-Session-Id` vs `x-session-id` across fetch calls (both work but confusing) | `App.tsx` (many places) |

## MEDIUM

| # | Issue | Location |
|---|---|---|
| 7 | `loadEnv(mode, '.', '')` loads ALL env vars (empty prefix), potentially bundling secrets | `vite.config.ts:16` |
| 18 | Preference save errors only logged to console, no user feedback | `App.tsx:1590, 2429, 3500+` |
| 19 | `ssl: { rejectUnauthorized: false }` on DB pool (acceptable for managed PostgreSQL) | `server.ts:70` |
| 20 | No schema validation on LLM response JSON | `server.ts:706, 735` |
| 21 | Request body limit 50MB is excessive | `server.ts:23` |
| 22 | 30-day session TTL may be too long | `server.ts:98` |
| 23 | Admin email comparison is case-sensitive | `server.ts:377, 406` |
| 24 | Admin user deletion not audit-logged | `server.ts:787-796` |

## LOW

| # | Issue | Location |
|---|---|---|
| 25 | No `/health` endpoint for load balancers | `server.ts` |
| 26 | Dockerfile missing HEALTHCHECK directive | `Dockerfile` |
| 27 | `decodeJwt()` function is dead code | `App.tsx:1374-1376` |
| 28 | No request correlation IDs for tracing | `server.ts` |
| 29 | No source maps in production build | `vite.config.ts` |

## Recommended fix order

1. ~~**Server critical security** (#1-4) — CORS, TLS, XSS, rate limiting~~ DONE
2. ~~**Client crash prevention** (#5-6) — localStorage parse, playback race~~ DONE
3. ~~**Server robustness** (#9-10, 15-16) — error middleware, pool config, graceful shutdown, env validation~~ DONE
4. **Data integrity** (#8, 12, 14) — abort controllers, state save errors, DB transactions
5. **Remaining HIGH** (#11, 13, 17)
6. **MEDIUM and LOW** (#7, 18-29)
