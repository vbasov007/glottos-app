# polyGlottos Embedding Guide

Instructions for a Claude coding agent on how to create interactive language lessons and embed them into generated HTML pages using the polyGlottos API.

## Overview

polyGlottos is a language learning app at `https://t.glottos.com`. It lets users read foreign-language texts, tap on words/phrases to get AI-generated grammar explanations, and listen to TTS pronunciation.

You can programmatically create lessons with pre-explained words and embed them as read-only interactive widgets into any HTML page via an iframe.

## Two-step process

1. **Create a shared lesson** via `POST /api/create-shared` — pass the text and words to explain. Get back a share code.
2. **Embed the lesson** into HTML via an iframe pointing to `/embed?import=CODE`.

---

## Step 1: Create a shared lesson

### Endpoint

```
POST https://t.glottos.com/api/create-shared
```

### Headers

```
Content-Type: application/json
X-API-Key: <your-api-key>
```

### Request body

```json
{
  "text": "Der Hund läuft schnell durch den Park. Die Kinder spielen fröhlich.",
  "phrases": ["Hund", "läuft", "schnell", "durch", "Park", "Kinder", "spielen", "fröhlich"],
  "textLanguage": "de",
  "explanationLanguage": "ru",
  "name": "Lesson: A Walk in the Park"
}
```

### Parameters

| Parameter             | Type     | Required | Description |
|-----------------------|----------|----------|-------------|
| `text`                | string   | Yes      | The full text of the lesson |
| `phrases`             | string[] | Yes      | Words/phrases from the text to explain (max 200) |
| `textLanguage`        | string   | No       | Language code of the text (default: `"de"`) |
| `explanationLanguage` | string   | No       | Language for explanations (default: `"ru"`) |
| `name`                | string   | No       | Lesson name (default: `"Shared Lesson"`) |

### Supported language codes

`ar` Arabic, `hy` Armenian, `bn` Bengali, `bg` Bulgarian, `ca` Catalan, `zh` Chinese, `hr` Croatian, `cs` Czech, `da` Danish, `nl` Dutch, `en` English, `et` Estonian, `fi` Finnish, `fr` French, `ka` Georgian, `de` German, `el` Greek, `he` Hebrew, `hi` Hindi, `hu` Hungarian, `id` Indonesian, `it` Italian, `ja` Japanese, `kk` Kazakh, `ko` Korean, `lv` Latvian, `lt` Lithuanian, `no` Norwegian, `pl` Polish, `pt` Portuguese, `ro` Romanian, `ru` Russian, `sr` Serbian, `sk` Slovak, `es` Spanish, `sv` Swedish, `th` Thai, `tr` Turkish, `uk` Ukrainian, `uz` Uzbek, `vi` Vietnamese

Both `textLanguage` and `explanationLanguage` accept any of these codes.

### Response (immediate)

```json
{
  "code": "egr34Z",
  "status": "processing",
  "total": 8
}
```

Explanations are generated in the background. The response returns immediately with a share code. If the same text + phrases + languages were already submitted before, the existing code is returned (deduplication).

### Checking progress (optional)

```
GET https://t.glottos.com/api/shared/<code>
```

No authentication needed. Returns:

```json
{
  "state": { "text": "...", "explanationCache": { ... }, ... },
  "textLanguage": "de",
  "workspaceName": "Lesson: A Walk in the Park",
  "status": "processing",
  "progress": { "done": 5, "total": 8 }
}
```

When all explanations are done, `status` is omitted (or `"ready"`), and `progress` is absent.

---

## Step 2: Embed into HTML

Use an iframe pointing to the embed URL:

```html
<iframe
  src="https://t.glottos.com/embed?import=egr34Z"
  width="100%"
  height="600"
  frameborder="0"
  style="border: none; border-radius: 8px;"
></iframe>
```

### What the embedded view shows

- Read-only text with tappable words
- Floating toolbar on word selection: **Listen** (TTS) + **Explain** (AI grammar)
- Explanation panel on the right with meanings, morphology, declension/conjugation tables
- Full-text listen button and hide-text button in toolbar
- TTS phrase history sidebar

### What is hidden in embed mode

- App header, logo, navigation
- Workspace tabs
- Login/signup banners
- Text editing controls (textarea, edit button, generate text)
- Language selector (uses the language from the shared lesson)

### Sizing

The iframe adapts to any size. Recommendations:
- **Width**: `100%` for responsive layouts, or a fixed value like `800px`
- **Height**: `500px` minimum for comfortable reading; `600-800px` ideal
- On narrow widths (< 1024px), the layout stacks vertically (text above, explanation below)
- On wider widths, it's side-by-side (text left, explanation right)

### If still processing

If the lesson is still being processed when the user opens the embed, a progress indicator appears (e.g., "60% (5/8)") and auto-updates every 3 seconds until ready. The text is visible immediately; explanations appear as they complete.

---

## Full example: generating a lesson page

Here is a complete example of an HTML page with an embedded lesson. This shows the pattern a coding agent should follow when generating sites with polyGlottos embeds.

### 1. Call the API (e.g. with curl, fetch, or any HTTP client)

```bash
curl -X POST https://t.glottos.com/api/create-shared \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{
    "text": "Die Katze sitzt auf dem Tisch und schaut aus dem Fenster.",
    "phrases": ["Katze", "sitzt", "auf dem Tisch", "schaut", "aus dem Fenster"],
    "textLanguage": "de",
    "explanationLanguage": "en",
    "name": "German Basics: The Cat"
  }'
```

Response: `{"code":"Xk9mPq","status":"processing","total":5}`

### 2. Generate the HTML page using the returned code

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>German Lesson: The Cat</title>
  <style>
    body {
      font-family: system-ui, sans-serif;
      max-width: 1000px;
      margin: 0 auto;
      padding: 2rem;
    }
    h1 { margin-bottom: 0.5rem; }
    .description { color: #666; margin-bottom: 1.5rem; }
    .lesson-frame {
      border: 1px solid #e0e0e0;
      border-radius: 12px;
      overflow: hidden;
    }
    iframe {
      display: block;
      width: 100%;
      height: 650px;
      border: none;
    }
  </style>
</head>
<body>
  <h1>German Basics: The Cat</h1>
  <p class="description">Click on any highlighted word to see its grammar explanation and hear pronunciation.</p>
  <div class="lesson-frame">
    <iframe src="https://t.glottos.com/embed?import=Xk9mPq"></iframe>
  </div>
</body>
</html>
```

---

## Guidelines for the coding agent

### Text formatting rules

The `text` field must contain **pure, clean text only**. The app uses the text for TTS pronunciation and word-by-word display, so any non-text artifacts will break the experience.

- **No sentence numbering** — wrong: `"1. Der Hund läuft."`, right: `"Der Hund läuft."`
- **No annotations or notes** — wrong: `"Der Hund läuft. (note: accusative case)"`, right: `"Der Hund läuft."`
- **No unpronounceable symbols** — no `*`, `#`, `→`, `—`, bullet points, brackets with metadata, etc. Only letters, punctuation (`.` `,` `!` `?` `:` `;` `"` `'` `-`), and whitespace.
- **One sentence per line** — use `\n` (newline) to separate sentences. This enables sentence-by-sentence TTS playback.
- **No blank lines between sentences** — just single newlines.

Example of correctly formatted text:
```
Der Hund läuft schnell durch den Park.\nDie Kinder spielen fröhlich auf der Wiese.\nEin alter Mann sitzt auf der Bank und liest eine Zeitung.
```

### When generating lesson content

1. **Choose meaningful words/phrases** — pick words the learner would need explained: nouns, verbs, adjectives, prepositions, idiomatic expressions. Don't include punctuation or trivial words like articles unless they illustrate a grammar point.

2. **Include multi-word phrases** when they form a unit — e.g., `"auf dem Tisch"` (prepositional phrase), `"sich freuen"` (reflexive verb), `"in der Nähe"` (fixed expression).

3. **Phrases must appear exactly as written in the text** — the API matches phrases by exact substring. `"Katze"` matches if the text contains "Katze" but not if it only contains "katze" (case-sensitive).

4. **Keep phrase count reasonable** — 5-30 phrases per lesson is typical. More phrases means longer processing time (~2-5 seconds per phrase).

5. **Set `explanationLanguage`** to match the learner's native language for the most useful explanations.

### When generating HTML pages

1. **Wait for the API response** before writing the HTML — you need the share code.

2. **The iframe URL is always** `https://t.glottos.com/embed?import=CODE` — no other parameters needed.

3. **The lesson works immediately** even while still processing — the text appears right away, and explanations become available as they finish.

4. **No JavaScript needed** on the embedding page — the iframe is fully self-contained. Just set the `src` attribute.

5. **Responsive design** — use `width="100%"` and a fixed height. The embed handles its own responsive layout inside.

6. **Multiple lessons on one page** — you can have multiple iframes with different share codes on the same page.

### API key

The API key is only needed for `POST /api/create-shared`. The embed iframe and `GET /api/shared/:id` are public and need no authentication. Never expose the API key in client-side HTML or JavaScript.
