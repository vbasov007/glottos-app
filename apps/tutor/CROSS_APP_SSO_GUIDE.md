# Cross-App SSO + Navigation: glottos-courses ↔ text-tutor

> This guide is shared between two repos. It describes one feature that spans
> **glottos-courses** (`courses.glottos.com`) and **text-tutor**
> (`t.glottos.com`). The same file lives at the root of both repos — keep them
> in sync. Part A is implemented in glottos-courses, Part B in text-tutor.

## Context

`glottos-courses` already links out to `text-tutor` via public share-code URLs
(`/s/{code}`), but the two feel like separate products: the link opens a
logged-out (or differently-logged-in) tab, and there is no way back. We want
them to behave like **two windows of one app**: clicking through carries the
signed-in user across, and text-tutor has a back-link to courses that does the
same in reverse.

Both apps are architecturally near-identical and that makes this cheap:

- Custom session auth (Google OAuth + Telegram), sessions stored in Postgres.
- Session id kept in `localStorage['session_id']`, sent as the `X-Session-Id`
  header on every API call. **No cookies** — so a server-side redirect cannot
  read the session; the token must be minted via a client-side `fetch` that
  carries the header, then handed off in the URL.
- Google users are keyed by `google_sub`, and (confirmed) **both apps use the
  same Google OAuth client ID**, so `google_sub` is identical across both
  databases. That is our identity key, with verified `email` as fallback.

### Approach (decided)

A **short-lived HMAC-signed token passed in the URL**, symmetric in both
directions. The source app mints a token describing the current user; the
target app verifies it, upserts/looks-up that user in its own DB, mints its own
local session, and strips the token from the URL. No change to the existing
login flows; works across separate databases and separate hosting. Falls back
to the current plain link when the user isn't signed in.

---

## Shared building block: the SSO token

A tiny JWT-style HS256 token using Node's built-in `crypto` (no new
dependency — both apps already HMAC-verify Telegram `initData`, so the pattern
exists). Identical helper implemented once per app.

**Token payload claims:**
```
{ iss: 'courses'|'tutor', aud: 'tutor'|'courses',
  sub: <google_sub>, email, name, picture,
  iat, exp }            // exp = iat + 120s  (short-lived, one-shot handoff)
```

**Helper API (both apps):** `signSsoToken(payload): string` and
`verifySsoToken(token): payload | null`.
- Encode `base64url(header).base64url(payload)`, sign with
  `HMAC-SHA256(SSO_SHARED_SECRET)`, append `.base64url(sig)`.
- Verify: constant-time compare (`crypto.timingSafeEqual`), reject if `exp`
  passed or `aud` ≠ this app.

**New env var in BOTH apps (same value):** `SSO_SHARED_SECRET` (32+ random
bytes). Add to `glottos-courses/web/.env.example`, `glottos-courses/web/.env.local`,
`text-tutor/.env.example`, `text-tutor/.env`.

> Replay window is the 120s TTL. Acceptable for a one-time handoff (same risk
> profile as OAuth authorization codes). A `jti` + short-lived used-token set
> can be added later if desired; not required for v1.

---

## Part A — glottos-courses (Next.js 15 App Router)

### A1. SSO helper — `web/lib/sso.ts` (new)
Server-only `signSsoToken` / `verifySsoToken` as described above. Reads
`process.env.SSO_SHARED_SECRET`.

### A2. Producer endpoint — `web/app/api/sso/mint/route.ts` (new)
- `POST`, authenticated via `requireAuth()` (`web/lib/auth.ts`) — reads
  `X-Session-Id`, resolves the user row.
- Body `{ to: 'tutor' }`. Loads the user (`id` = google sub, `email`, `name`,
  `picture`) and returns `{ token: signSsoToken({ iss:'courses', aud:'tutor', sub: user.id, email, name, picture }) }`.
- If unauthenticated → 401 (client falls back to the plain link).

### A3. Consumer endpoint — `web/app/api/auth/sso/route.ts` (new)
Mirror the existing `web/app/api/auth/google/route.ts`, replacing Google JWT
verification with `verifySsoToken`:
- `POST { token }` → `verifySsoToken` (require `aud === 'courses'`).
- Upsert into `users` keyed by `id = payload.sub` (same upsert SQL the Google
  route already uses, incl. the `ADMIN_USER` role logic), create a `sessions`
  row, return `{ sessionId, user }`.

### A4. Consumer landing page — `web/app/sso/page.tsx` (new, client component)
- Reads `?sso=` from the URL, `POST`s it to `/api/auth/sso`, on success
  `setStoredSessionId(sessionId)` (`web/lib/api-client.ts`), then
  `router.replace('/')` (token stripped). On failure, redirect to `/`.
- **Middleware:** `web/middleware.ts` runs `next-intl` locale routing. Exclude
  `/sso` and `/api/sso` from the locale matcher (and confirm `/api/auth/sso`
  is already excluded like other `/api` routes) so the token isn't lost to a
  locale redirect.

### A5. Producer click-through (courses → tutor)
New client helper `web/lib/open-in-tutor.ts`:
```
TUTOR_BASE_URL = process.env.NEXT_PUBLIC_TUTOR_URL ?? 'https://t.glottos.com'
openInTutor(path):   // path e.g. `/s/${code}`
  const w = window.open('', '_blank')          // open synchronously — avoids popup blocker
  if (!getStoredSessionId()) { w.location = TUTOR_BASE_URL + path; return }
  apiFetch('/api/sso/mint', {method:'POST', body: JSON.stringify({to:'tutor'})})
    .then(r => w.location = `${TUTOR_BASE_URL}${path}?sso=${encodeURIComponent(r.data.token)}`)
    .catch(() => w.location = TUTOR_BASE_URL + path)   // graceful fallback
```
Wire it into the three existing link sites, replacing the hardcoded
`https://t.glottos.com/s/{code}` anchors with a button/onClick calling
`openInTutor('/s/'+code)` (keep the same styling, tooltip, and PostHog
`capture(...)` calls):
- `web/components/VocabTab.tsx` (the `vocabCode` link)
- `web/components/WritingPractice.tsx` (the `practiceCode` link)
- `web/components/AudioPractice.tsx` (the `GLOTTOS_SHARE_BASE` const + link)

### A6. Env
Add `NEXT_PUBLIC_TUTOR_URL=https://t.glottos.com` and `SSO_SHARED_SECRET=…` to
`web/.env.example` and `web/.env.local`.

> Build scripts (`scripts/build-*-codes.ts`) keep their hardcoded
> `t.glottos.com/api/create-shared` — they run at build time, unrelated to SSO.

---

## Part B — text-tutor (React + Vite frontend, Express backend)

### B1. SSO helper — `sso.ts` (new module at repo root, imported by `server.ts`)
Same `signSsoToken` / `verifySsoToken` as A1, reading
`process.env.SSO_SHARED_SECRET`. Reuse the same constant-time-compare style as
the existing `verifyTelegramInitData` in `server.ts`.

### B2. Consumer endpoint — `app.post('/api/auth/sso', …)` in `server.ts`
Mirror the existing Google handler (`server.ts:875`), swapping Google
verification for `verifySsoToken` (require `aud === 'tutor'`):
- Look up the user by `google_sub = payload.sub`; if none, fall back to
  `email`; if still none, insert a new `users` row (reuse the Google-path
  upsert incl. `google_sub`, `email`, `name`, `picture`, `role`).
- Create a `sessions` row (`SESSION_TTL_DAYS`), return `{ sessionId, user }`
  in the same shape as `/api/auth/google`.

### B3. Producer endpoint — `app.post('/api/sso/mint', requireAuth, …)` in `server.ts`
- Resolve the user from `req.userId`, load `google_sub`/`email`/`name`/`picture`.
- Return `{ token: signSsoToken({ iss:'tutor', aud:'courses', sub: google_sub, email, name, picture }) }`.
- If the user is anonymous / has no `google_sub` and no `email` → 400 so the
  client falls back to a plain back-link.

### B4. Preserve the token through the share redirect — `server.ts:2943`
Today: `app.get('/s/:code', (req,res) => res.redirect(302, `/app?import=${req.params.code}`))`.
Change to forward an incoming `sso` query param:
```
const sso = req.query.sso ? `&sso=${encodeURIComponent(String(req.query.sso))}` : '';
res.redirect(302, `/app?import=${encodeURIComponent(req.params.code)}${sso}`);
```

### B5. Consumer bootstrap — `src/App.tsx`
Add a one-shot effect that runs before normal session use (the `sessionId`
state is seeded from `localStorage` at `App.tsx:250`):
- Parse `sso` from `window.location.search`. If present:
  - `POST /api/auth/sso { token }`; on success `localStorage.setItem('session_id', sessionId)`,
    `setSessionId(sessionId)`, set `user`, then
    `history.replaceState` to drop the `sso` param (keep `import`).
  - On failure, just strip `sso` and continue (existing flow).
- This always adopts the SSO identity (switches user if a different/anonymous
  session existed), satisfying "same user as courses". The `import={code}`
  flow then proceeds normally under the new session.

### B6. Producer back-link (tutor → courses) — `src/components/Header.tsx`
- Add a "Courses" / back-to-Glottos link in the header nav.
- New client helper `src/lib/openInCourses.ts`:
  ```
  COURSES_URL = import.meta.env.VITE_COURSES_URL ?? 'https://courses.glottos.com'
  openInCourses():
    const w = window.open('', '_blank')
    if (!sessionId || isAnonymous) { w.location = COURSES_URL; return }
    postJson('/api/sso/mint', {to:'courses'})
      .then(r => w.location = `${COURSES_URL}/sso?sso=${encodeURIComponent(r.token)}`)
      .catch(() => w.location = COURSES_URL)
  ```
  (uses the existing `useApiClient().postJson` and the `sessionId`/`isAnonymous`
  already available in `App.tsx`; pass down or read from context as the Header
  currently receives user state.)

### B7. Env / Vite
- Add `SSO_SHARED_SECRET=…` and `COURSES_URL=https://courses.glottos.com` to
  `.env.example` and `.env`.
- Expose the courses URL to the frontend bundle via `vite.config.ts` `define`
  (same mechanism already used for `GOOGLE_CLIENT_ID`) as
  `import.meta.env.VITE_COURSES_URL`.

---

## Return-to-lesson (deep-link round-trip)

So the tutor → courses back-link returns the user to the *lesson they came
from* rather than the courses home page, the originating courses path is
threaded through the whole round-trip:

1. **courses → tutor** (`web/lib/open-in-tutor.ts`): appends
   `&from=<encodeURIComponent(location.pathname+search+hash)>` to the tutor URL
   (alongside `sso`, and also in the signed-out fallback).
2. **tutor `/s/:code`** (`server.ts`): forwards `from` into `/app` next to `sso`.
3. **tutor bootstrap** (`src/App.tsx`): reads `from`, validates it's a
   site-relative path, persists it to `localStorage['courses_return_path']`,
   and scrubs `from`+`sso` from the URL.
4. **tutor → courses** (`src/lib/openInCourses.ts`): reads
   `courses_return_path`; with a session it appends `&return=<path>` to
   `/sso?sso=…`, and in the signed-out/anonymous/mint-fail fallback it
   deep-links straight to `COURSES_URL + path` (no login needed).
5. **courses `/sso`** (`web/app/sso/page.tsx`): `safeReturn()` clamps `return`
   to a site-relative path (rejects absolute / `//` / `/\` to avoid an open
   redirect) and `router.replace(dest)` lands the user back on the lesson.

If the user reached text-tutor without a `from` (e.g. opened a share link
directly), the back-link falls back to the courses home page.

## Theme handoff (courses → tutor)

So the new tutor tab opens in the same colour scheme the user was in on
courses, the resolved scheme rides along on every cross-app link:

1. **courses → tutor** (`web/lib/open-in-tutor.ts`): reads its own
   `localStorage.theme` (which courses resolves Light / Dark / System into
   `light|dark`) and appends `&theme=<resolved>` to every URL it produces,
   including the signed-out fallback.
2. **tutor `/s/:code`** (`server.ts`): forwards `theme` into `/app` next to
   `sso` and `from`.
3. **tutor bootstrap** (`src/App.tsx`): the `userPrefs` state initializer
   reads `?theme=`, accepts only `'light'` / `'dark'` (anything else is a
   no-op), and overrides any saved tutor pref — the user just acted on
   courses, so that's their fresh intent. Running in the initializer means
   the document class lands correctly on the first paint (no flash). The
   bootstrap effect then persists the new value into
   `localStorage.userPrefs.theme` and scrubs `theme` from the URL alongside
   `sso` and `from`.
4. **No round-trip back.** When tutor → courses (openInCourses) hands the
   user back, courses uses its own saved `localStorage.theme` to render —
   tutor doesn't send `theme` on the back-link.

Edge cases:
- Theme arrives without `sso` (signed-out user, courses fell back to the
  plain share URL): theme still applied. Identity and appearance are
  independent.
- Missing param (older link minted before this change, or a direct
  `/s/:code`): tutor's existing behaviour (saved pref or OS default) is
  unchanged.

## Security notes
- `SSO_SHARED_SECRET` is server-only in both apps; never prefixed `NEXT_PUBLIC_`
  / `VITE_`. Only the *minted token* and the *base URLs* reach the browser.
- Token TTL 120s; `aud` is checked on verify so a courses-issued token can't be
  replayed against courses and vice-versa.
- Mint endpoints require an authenticated session, so a user can only mint a
  token for themselves.
- Tokens travel in the query string (logs/history) — kept short-lived and
  single-purpose to bound exposure.

## Verification (end-to-end)
1. **Config:** set the *same* `SSO_SHARED_SECRET` in both apps; set
   `NEXT_PUBLIC_TUTOR_URL` / `VITE_COURSES_URL` to the local dev origins.
2. **courses → tutor:** run both locally, sign into courses with Google, open a
   lesson, click "Open in Glottos" on Vocab/Writing/Audio. Confirm the tutor
   tab lands already signed in **as the same account** (check the tutor header
   user + `GET /api/state`), the shared content imported, and the URL has no
   `sso` param after load.
3. **Signed-out fallback:** repeat while signed out of courses → tutor opens to
   the plain share link, no errors.
4. **tutor → courses:** from the tutor header back-link while signed in, confirm
   courses opens signed in as the same user (and a plain link when anonymous).
5. **Token hardening:** manually hit `/api/auth/sso` with an expired/tampered
   token → 401/400, no session created. Confirm an `aud:'tutor'` token is
   rejected by the courses consumer.
6. **Regression:** existing Google/Telegram/anonymous logins and the
   `/s/{code}` import still work unchanged.

## New/changed files at a glance
**glottos-courses:** `web/lib/sso.ts`*, `web/app/api/sso/mint/route.ts`*,
`web/app/api/auth/sso/route.ts`*, `web/app/sso/page.tsx`*,
`web/lib/open-in-tutor.ts`*, `web/middleware.ts`, `web/components/{VocabTab,
WritingPractice,AudioPractice}.tsx`, `web/.env.example`, `web/.env.local`.
**text-tutor:** `sso.ts`*, `server.ts` (`/api/auth/sso`*, `/api/sso/mint`*,
`/s/:code`), `src/App.tsx`, `src/components/Header.tsx`,
`src/lib/openInCourses.ts`*, `vite.config.ts`, `.env.example`, `.env`.
(*= new file)
