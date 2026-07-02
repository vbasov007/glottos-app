---
name: add-language
description: Add a new study language to the Deutsch Tutor app. Walks through all required files (i18n config, UI translations, grammar labels, server-side mappings, guide page translation) so nothing is missed. Trigger when the user says "add language X", "/add-language", or asks to support a new language code.
---

# Add a new language

Adding a language touches 6 required locations and up to 3 optional ones. Some pieces are derived from a single source of truth — don't duplicate. Verify the exact line numbers in the listed files before editing; they drift.

## Inputs to gather upfront

Ask the user for these via `AskUserQuestion` (single multi-question call):

1. **Language code** (ISO 639-1, e.g. `xx`)
2. **Display label** (English name, e.g. "Norwegian")
3. **Whether the language is logographic** (uses character-based script like zh, ja) — affects text limit and rendering
4. **Whether to use Yandex SpeechKit** (default: no — only relevant for ru, kk, uz at present)

Before proceeding, verify the code is **not** already in `src/i18n/languages.ts`:

```
Grep("^  xx:" in src/i18n/languages.ts)
```

If found, abort and tell the user it already exists.

## Required steps

### 1. `src/i18n/languages.ts` — LANGUAGES map (single source of truth)

Add a new entry to the `LANGUAGES` object. Required fields: `label`, `ttsLang`, `ttsVoice`, `ttsAzureVoice`, `ttsTestPhrase`. Optional: `defaultTtsProvider: 'azure' | 'google'`.

Example shape:
```ts
xx: { label: 'Xxxxxx', ttsLang: 'xx-YY', ttsVoice: 'xx-YY-Wavenet-A', ttsAzureVoice: 'xx-YY-NameNeural', ttsTestPhrase: 'Good morning everyone (in target language)' },
```

`server.ts` derives its own `LANGUAGES` map from this file at startup — do **not** also add to `server.ts`. (Memory file `adding-new-language.md` is stale on this point.)

For voice IDs, check Google Cloud TTS voice list and Azure Speech voice list. Prefer Neural2 / Wavenet / Chirp3 voices. Test phrase should be a natural greeting in the target language.

**If neither provider supports the language** (e.g. Esperanto, lesser-spoken languages): stop and ask the user how to proceed. Options:
- Pick a phonetically-close fallback (e.g. Italian voice for Esperanto, English voice for constructed languages) and document the substitution in the test phrase comment
- Skip the language entirely — TTS is core to the app's value, so a language without voices may not be worth shipping
Don't silently invent voice IDs that don't exist; the Admin TTS test will fail loudly later but a user might ship before noticing.

### 2. `src/i18n/translations/xx.ts` — UI translation file

Create a new file matching the shape of `src/i18n/translations/en.ts` (~229 keys). Translate every value. Keep keys identical.

For initial scaffolding: copy `en.ts` to `xx.ts` and ask the user whether to translate inline now or stub English values for later translation. **Do not commit half-translated files silently** — flag unstubbed entries with a `// TODO: translate` comment if needed.

### 3. `src/i18n/translations/index.ts` — register the translation

Add an import line and add `xx` to the `TRANSLATIONS` object (in the spread block, alphabetically grouped with similar codes).

### 4. `src/i18n/grammar.ts` — GRAMMAR_LABELS

Add an entry with all required fields: `masculine`, `feminine`, `neuter`, `cases` (`nom`, `akk`, `dat`, `gen`), `infinitive`, `present`, `past`, `perfect`. **Every language gets a full entry** — even languages with no grammatical gender (Turkish, Hungarian, Vietnamese, Thai, Indonesian) or no traditional cases.

Conventions used by existing entries:
- **No grammatical gender**: translate the conceptual labels into the target language (Turkish uses `Eril/Dişil/Nötr`, Vietnamese uses `Giống đực/Giống cái/Trung tính`, Hungarian uses `Hímnem/Nőnem/Semlegesnem`). Don't leave blank.
- **No third gender** (Hebrew, Arabic): use `'—'` (em dash) for `neuter`.
- **Cases**: even languages without traditional case marking still get all four — translated as best-fit conceptual labels (Vietnamese uses `Chủ cách/Đối cách/Tặng cách/Sở hữu cách`, Indonesian uses `Nominatif/Akusatif/Datif/Genitif`).
- **Verb forms**: similar — translate the tense names even if the target language uses aspect or other systems.

Reference Turkish (`tr`), Vietnamese (`vi`), Hungarian (`hu`) for non-gendered patterns; Hebrew (`he`), Arabic (`ar`) for the `'—'` neuter pattern.

### 5. `server.ts` — LANGUAGE_LABELS

Find the `LANGUAGE_LABELS: Record<string, string>` map (currently around line 314 — verify with Grep `^const LANGUAGE_LABELS`). Add `xx: 'Xxxxxx'` (the English name from step 1). Used in AI prompts.

### 6. `public/guide-i18n/xx.json` — guide page translation

Copy `public/guide-i18n/en.json` (92 keys). Translate values. Keep HTML tags and brand names (`Polyglottos`, `Glottos`, etc.) untranslated.

## Optional steps

### Logographic script (only if user said yes)

Add `xx` to **two** sets:
- `src/i18n/languages.ts` `LOGOGRAPHIC_LANGUAGES` set
- `server.ts` `LOGOGRAPHIC_LANGUAGES` set (currently around line 327 — verify)

These must stay in sync.

### Yandex SpeechKit (only if user said yes)

Add to `YANDEX_VOICES` in `server.ts` (currently around line 216). Format: `xx: { lang: 'xx-XX', voice: 'voice-name' }`.

## Verify

After all edits, run:

```
npm run lint
```

If clean, summarize for the user:
- Files changed (list)
- Whether translation values are complete or stubbed
- What to test manually: text language dropdown, interface language dropdown, explanation language dropdown, Admin TTS test, generate-text in the new language, `/guide` page

## Don't

- Don't add the language to `server.ts` `LANGUAGES` — it's derived
- Don't skip `grammar.ts` even if the language has no gender (the lookup needs the entry)
- Don't translate brand names or HTML tags in the guide JSON
- Don't commit untranslated stubs without flagging them to the user
