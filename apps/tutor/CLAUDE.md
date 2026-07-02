# CLAUDE.md

Guidance for Claude Code working in this repo.

## Coding standards

See `CODING_STANDARDS.md` for all coding, architecture, and testing rules. Follow them strictly.

## Commands

```bash
npm run dev       # Vite dev server on port 3000
npm run server    # Express on port 4000
npm run dev:full  # Both, via concurrently
npm run build     # Production build (Vite)
npm run preview   # Preview production build
npm run lint      # TypeScript type check (tsc --noEmit)
npm test          # All Vitest unit/integration tests
npm run test:watch
npm run test:e2e  # Playwright E2E
npm run clean     # Remove dist/
```

`vite.config.ts` proxies `/api/*` to the Express server on port 4000.

## Architecture

A multi-language tutor app (German is the original target; ~40 languages supported now). React SPA + Express + Postgres.

### Frontend (`src/`)
- `App.tsx` (~3100 lines) — primary application; main page UI, state orchestration, toolbar, flashcards modal, generate-text modal
- `Admin.tsx`, `Landing.tsx`, `Monitoring.tsx` — top-level routed pages
- `main.tsx` — entry, routing
- `components/` — `ExplanationPanel`, `Header`, `Modal`, `TextToolbar` (extracted from App.tsx during ongoing refactor)
- `hooks/` — `useApiClient`, `useFlashcards`, `useTtsPlayer`, `useWorkspaces` (extracted from App.tsx)
- `i18n/` — modular i18n: `languages.ts` (per-language TTS config), `translations/` (UI strings, ~315 keys × ~10 languages), `grammar.ts` (grammatical labels), `t.ts` (lookup), `types.ts`
- `utils.ts` — pure functions: `chunksToWav`, `pcmToAudioBuffer`, `decodeJwt`
- `types.ts` — shared TS types (`UserPreferences`, `ExplanationResult`, `Morphology`, `*Forms`)
- `constants.ts` — frontend magic numbers (`TIMEOUTS`, etc.)

### Backend
- `server.ts` (~2400 lines) — Express API: auth, state, workspaces, explain, TTS, share, quotas, admin, Stripe, generate-text
- `server-utils.ts` — pure extracts: `buildPrompt`, `resolveTtsVoice`, `generateShareCode`, `getTextLimit`, `LANGUAGES`, `LANGUAGE_LABELS`
- `server-constants.ts` — backend magic numbers
- `prompts/` — Russian SSML prompt assets

### Storage
- Postgres (`DATABASE_URL`). Tables `users`, `sessions`, `user_state` (JSONB), workspaces, share codes, quotas. Created on server startup via `initDb()`.

### Data flow (explain action)
1. User selects a word/phrase in the textarea
2. Frontend `POST /api/explain` with selection + full text as context
3. `buildPrompt()` in `server-utils.ts` produces a language-aware system prompt for Gemini
4. Gemini returns structured JSON matching `ExplanationResult` in `src/types.ts`
5. `ExplanationPanel` renders it

### TTS
- Multi-provider (Google Cloud TTS, Azure Speech, Gemini TTS, Yandex). Voice resolution via `resolveTtsVoice` in `server-utils.ts`.
- Frontend `useTtsPlayer` hook handles audio context, master gain, MediaStream bridge for iOS Safari, prefetch, sentence playback.
- Decoded `AudioBuffer`s are cached per phrase; raw PCM base64 also cached for serialization.

## Testing

- `tests/frontend/` — pure functions (i18n, utils, prompt, TTS voice resolution)
- `tests/backend/` — Express API tests with supertest + pg-mem (auth, state, workspaces, explain, TTS, share, quotas, admin, api-keys, generate, create-shared)
- `tests/e2e/` — Playwright (auth, embed mode, explain detail/flow, mobile selection, modal rendering, settings, state persistence, TTS playback, workspace CRUD/flow)

`tests/backend/setup.ts` provides pg-mem DB setup, mock providers, helpers. `tests/e2e/helpers.ts` provides API mocking helpers.

## Adding a new language

This is a recurring task. There is a checklist memory at `~/.claude/projects/<this-project>/memory/adding-new-language.md` covering 7 required files plus optional steps. There's also a `/add-language` project skill that automates it.

## Lessons (mined from prior sessions)

These aren't visible from the code alone — keep them in mind:

- **Audio**: WAV silence written as pure-zero samples gets clipped by some players. Use ±1 LSB noise instead (see `src/utils.ts` lead-silence handling).
- **Audio**: `manualStopRef` in `useTtsPlayer` is reset by `handleEnded` when a source's `onended` fires. If `stopAllAudio` runs without a playing source, the flag sticks at `true` and blocks subsequent playback. `speakPhrase` clears it explicitly at the top.
- **Deploy**: When deploying to a managed Postgres (DigitalOcean App Platform), the App Platform must be added to the DB's trusted sources. Otherwise `initDb()` hangs silently.
- **Deploy**: New server-side `.ts` files imported by `server.ts` must be added to the Dockerfile's `COPY` line, otherwise the container starts fine locally but breaks in prod.

## Environment

`.env.example` lists required keys: `GEMINI_API_KEY`, `GOOGLE_CLIENT_ID`, `DATABASE_URL`, `SERVER_PORT`. Copy to `.env` before running.

## Path alias

`@/` resolves to the project root (`tsconfig.json` + `vite.config.ts`).
