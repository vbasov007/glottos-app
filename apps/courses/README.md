# Glottos Matrix — Web App

German-language-learning web app — structural curriculum, mouth-training drills, and translation-checked exercises.

Consumes the markdown course content at `/workspace/courses/de/{ru,en,pl}/` (50 lessons + 150 listening texts + 50 tests + 2,334-entry dictionary, per native language) and renders it as a Next.js 15 site with progress tracking, interactive exercises, translation tests, and hybrid answer-checking (normalized exact match → Claude Haiku fallback).

```
/workspace/
├── courses/         # markdown content (source of truth)
│   └── de/{ru,en,pl}/
├── meta/            # author tooling
└── web/             # this app
```

## Quick start

```bash
cd web
npm install
npm run build:content   # parse markdown → JSON registry
npm run dev             # http://localhost:3000
```

Visit `http://localhost:3000` — middleware redirects to `/en` (default locale). Try also `/ru`, `/pl`.

To enable the Claude answer-check fallback (otherwise the app uses local exact-match only and shows the expected answer on failure):

```bash
cp .env.example .env.local
# Set ANTHROPIC_API_KEY=sk-ant-...
npm run dev
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Next.js dev server. Re-runs `build:content` is **not** automatic — re-run after editing markdown |
| `npm run build:content` | Walks `../courses/` and emits typed JSON under `content/.generated/`. ~5s |
| `npm run build` | SSG production build. Runs `build:content` first via `prebuild` hook. ~30-60s |
| `npm run start` | Run production build on port 3000 |
| `npm test` | Vitest — parser snapshot tests + answer-normalization tests |
| `npm run test:sso` | Playwright smoke test — mints a demo session, clicks the Tutor link, verifies the popup URL carries a valid `?sso=` token. Requires a running `npm run dev` plus `DATABASE_URL` and `SSO_SHARED_SECRET` in `.env.local` |

## Tech stack

| Layer | Pick |
|---|---|
| Framework | Next.js 15 App Router · React 19 · TypeScript |
| Rendering | SSG (all 750+ pages pre-rendered at build) |
| Styling | Tailwind CSS v3 |
| Markdown | react-markdown + remark-gfm + rehype-raw + rehype-slug |
| State | Zustand + persist middleware → localStorage |
| i18n | next-intl (locale segment `[native]`) |
| Search | MiniSearch (in-memory, dictionary) |
| AI fallback | `@anthropic-ai/sdk` · `claude-haiku-4-5` · prompt-cached system, JSON-schema-constrained output |

## Routes

| Route | What |
|---|---|
| `/` | Redirects to default locale |
| `/[native]` | Per-language landing |
| `/[native]/de` | Course home — 6-block tree with progress dots |
| `/[native]/de/lesson/[n]` | Lesson view — markdown sections + interactive exercise inputs |
| `/[native]/de/test/[n]` | Test view — 30 translation prompts + scoring + rank claim |
| `/[native]/de/text/[n]?v=a\|b\|c` | Listening text — German sentences + vocab + glottos.com placeholder |
| `/[native]/de/dictionary` | 2,334-entry German↔native dictionary with MiniSearch |
| `/[native]/dashboard` | Progress, ranks, streak |
| `/[native]/settings` | Native language switcher, export JSON, reset progress |
| `/api/check-answer` | POST — hybrid answer-check fallback (Claude Haiku) |
| `/api/health` | GET — `{ ok, version, contentBuildId }` |

## Project layout

```
web/
├── app/
│   ├── layout.tsx                       # Root <html>/<body>
│   ├── page.tsx                         # Redirect to /[defaultLocale]
│   ├── globals.css                      # Tailwind + prose styles
│   ├── [native]/                        # Per-locale routes
│   │   ├── layout.tsx                   # TopBar · DesktopSidebar · MobileBottomNav
│   │   ├── page.tsx                     # Landing
│   │   ├── dashboard/page.tsx
│   │   ├── settings/page.tsx
│   │   └── de/
│   │       ├── page.tsx                 # Course home
│   │       ├── dictionary/page.tsx
│   │       ├── lesson/[n]/page.tsx
│   │       ├── test/[n]/page.tsx
│   │       └── text/[n]/page.tsx
│   └── api/
│       ├── check-answer/route.ts        # Claude Haiku 4.5 fallback
│       └── health/route.ts
├── components/
│   ├── MarkdownRenderer.tsx             # Lesson body
│   ├── AnswerInput.tsx                  # Client — runs hybrid checker
│   ├── ExerciseBlock.tsx                # Per-exercise input list
│   ├── LessonInteractive.tsx            # Mark-complete + practice
│   ├── TestRunner.tsx                   # 30-prompt test with scoring
│   ├── DictionarySearch.tsx             # MiniSearch
│   ├── DashboardClient.tsx              # Reads Zustand
│   ├── SettingsActions.tsx              # Export JSON / Reset
│   └── ProgressDots.tsx                 # Per-lesson + per-test status
├── lib/
│   ├── content-types.ts                 # Typed shape of all parsed content
│   ├── content.ts                       # Runtime JSON loaders for RSC
│   ├── normalize.ts                     # Answer normalization + exact match
│   ├── checker.ts                       # checkAnswer(): exact → /api fallback
│   ├── store.ts                         # Zustand store (versioned, localStorage)
│   ├── rate-limit.ts                    # In-memory limiter
│   └── anthropic.ts                     # SDK singleton + model alias
├── scripts/
│   └── build-content.ts                 # Markdown → JSON pipeline
├── content/.generated/                  # gitignored — emitted by build:content
│   ├── manifest.json
│   └── de.{ru,en,pl}/
│       ├── curriculum.json
│       ├── dictionary.json
│       ├── index.json
│       ├── lessons/{1..50}.json
│       ├── tests/{1..50}.json
│       └── texts/{1..50}-{a,b,c}.json
├── i18n/request.ts                      # next-intl locale config
├── messages/{ru,en,pl}.json             # UI strings
├── middleware.ts                        # Locale routing
├── tests/                               # Vitest
└── next.config.mjs · tsconfig.json · tailwind.config.ts · postcss.config.mjs
```

## Content pipeline

`scripts/build-content.ts` is the source-of-truth parser. It walks `courses/<target>/<native>/` and emits typed JSON.

**What it handles:**
- Curriculum (6 blocks × ~50 lessons with rank labels)
- Lessons (title, vocab subtitle, ordered sections, exercises with prompts + answers, vocab tables with gender, next-up tease)
- Tests (30 prompts + 30 answers with `(или/or/lub: …)` alternate splitting and italics stripping)
- Texts (30 sentences + vocab table)
- Dictionary (~2,334 entries with lemma normalization stripping `der/die/das/sich`)

**Tolerates 3 native languages.** Headings can be in any of `Упражнение/Exercise/Ćwiczenie`, `Часть/Part/Część`, `Словарь/Vocabulary/Słownictwo`, etc.

**Snapshot-tested.** `tests/parser.test.ts` pins canonical files (lesson_01, lesson_09, test_01, test_45 alternate-answer stress, dictionary structure, text shape) — CI fails if the parser drifts.

## Answer checking

Three-tier strategy. Cheapest first:

1. **Local exact match** (`lib/normalize.ts`). Un-normalized exact, then normalized (lowercase + ü→ue, ö→oe, ß→ss, strip boundary punctuation, collapse whitespace) against canonical + alternates. **Handles ~85% of answers per content analysis.**
2. **Claude Haiku 4.5 fallback** (`/api/check-answer`). Triggered only on local miss. Prompt-cached system message; structured JSON output via `output_config.format`. Returns `{ correct, hint }`. Hint is in the learner's native language, ≤18 words, never reveals the canonical answer.
3. **Reveal-on-fail.** If both fail, the AnswerInput shows a "Show answer" button.

**Cost** (Haiku 4.5 with cache hits): ~$0.00045 per fallback call · ~$0.002 per test session · ~$20/month at 1,000 MAU doing 10 tests/month.

## Adding a new language pair

The pipeline auto-discovers any folder matching the target/native pattern. To add Spanish-speaker support (`de/es`):

1. Create `/workspace/courses/de/es/` with the same shape: `curriculum.md`, `dictionary.md`, `lessons/lesson_{01..50}.md`, `tests/test_{01..50}.md`, `texts/text_{01..50}_{a,b,c}.md`.
2. Add `'es'` to `i18n/request.ts` → `locales`.
3. Add `messages/es.json` (copy from `en.json` and translate).
4. Run `npm run build:content && npm run build`. The new pair appears in the manifest and routes work.

No code changes needed in the parser, routes, or components.

## Database migration scripts

The `progress` table stores per-user lesson/test state keyed by a `course_key`
string. When the schema shape of `course_key` changes (or we rename a course
slug), use these one-off scripts to rewrite the existing rows. Both honour
`DRY_RUN=1` and run in a single transaction (rollback on any error).

### `migrate-progress-course-keys.ts` — v1 → v2 schema bump

One-shot tool, already run against prod. Rewrites legacy 2-part keys
(`target.native`, e.g. `de.ru`) to the post-multi-course-refactor 3-part
shape (`course.target.native`, e.g. `classic50.de.ru`). The prefix is
unconditional because all pre-refactor courses were `classic50`. Conflict
policy is fixed: legacy row loses to the post-refactor row at the same key.

```bash
DRY_RUN=1 npx tsx scripts/migrate-progress-course-keys.ts   # preview
npx tsx scripts/migrate-progress-course-keys.ts             # apply
```

Idempotent: when no 2-part keys remain, the script reports "Nothing to
migrate" and exits. Keep it in the repo as a record of the schema bump.

### `rename-progress-course.ts` — generic course-slug rename

Reusable for any future course rename: course splits, beta-slug promotions,
deprecation merges. Walks `progress` rows where `course_key` starts with
`<from>.` and rewrites the prefix to `<to>.`

```bash
DRY_RUN=1 npx tsx scripts/rename-progress-course.ts \
  --from-course=classic50 \
  --to-course=classic50_v2

# Narrow the scope to a single language pair (and/or a single user):
npx tsx scripts/rename-progress-course.ts \
  --from-course=classic50 \
  --to-course=classic50_v2 \
  --target=de --native=ru \
  [--user=<user-id>]
```

**Conflict policies** (when `<to>.<target>.<native>` already exists for the
same user). Pick via `--on-conflict=`:

| Policy | Behaviour | Use when |
|---|---|---|
| `newer` (default) | Keep whichever row has the newer `updated_at`. | Most renames — preserves freshest work. |
| `src` | Source wins. Delete destination, then rename source. | Rollback: "we shipped Y prematurely, restore from X". |
| `dst` | Destination wins. Delete source, no rename. | Forward-only: "X is deprecated, Y is canonical, don't overwrite". |
| `error` | Abort the entire transaction on any conflict. | When you're not yet sure which side should win and want a hard stop. |

The dry-run output lists every conflict with both `updated_at` timestamps and
which side is newer, so you can pick the right policy before writing.

## Deployment

### Vercel

```bash
vercel --prod
```

Set `ANTHROPIC_API_KEY` in Vercel project env. The `prebuild` hook runs `build:content` automatically.

### Self-host (Docker)

`next.config.mjs` sets `output: 'standalone'`. Dockerfile sketch:

```Dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY . .
RUN npm ci
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/content/.generated ./content/.generated
ENV PORT=3000
CMD ["node", "server.js"]
```

The container needs `ANTHROPIC_API_KEY` if you want the AI fallback.

## Environment variables

| Var | Required | What |
|---|---|---|
| `ANTHROPIC_API_KEY` | No (degrades gracefully) | Enables Claude Haiku fallback in `/api/check-answer` |

When the key is missing, AnswerInput falls back to showing the expected answer as a hint — UI keeps working, no AI calls.

## Architecture notes

- **SSG over ISR.** All pages pre-rendered at build (~750 static HTML files). Trade-off: every content edit requires a redeploy. Revisit if content updates become frequent — the migration to ISR is a one-line `revalidate` flag on the dynamic route configs.
- **No DB at MVP.** Progress in localStorage via Zustand `persist` (versioned `gl.v1.state`). Schema designed to migrate cleanly to a server DB later — when accounts ship, POST the entire `ProgressState` to `/api/sync/import`.
- **Audio is out of scope.** Listening text pages have a placeholder "Open in glottos.com" button — real audio integration is phase 2.
- **i18n is two-layered.** `next-intl` handles UI chrome (`messages/{lang}.json`). Course content itself is authored per-native-language in `courses/de/{native}/` and the native route segment selects both at once.
- **Hybrid answer check is the single design lever for cost.** Tightening the local-match regex (stricter normalization) lowers AI fallback rate → cuts Claude spend. Loosening it raises the fallback rate but gives smarter hints.

## Verification commands

```bash
# Parsers
npm test                               # vitest — should pass 20+ tests

# Build the whole site
npm run build                          # should generate 160+ static pages

# Smoke test in dev
npm run dev
curl http://localhost:3000/en/de/lesson/9    # 200 + Akkusativ
curl http://localhost:3000/en/de/test/8      # 200 + 30 prompts
curl http://localhost:3000/api/health         # 200 + buildId
```

## What's not built yet (phase 2)

- Accounts (Clerk or Auth.js) + Postgres sync
- glottos.com audio integration
- Additional target courses (`es`, `it`, `zh`)
- SRS Leitner over `seenWords` (vocab review)
- PWA / offline mode
- Multi-region edge deployment

## License

Content under `/workspace/courses/` is the course author's IP. App code in `/workspace/web/` — TBD.
