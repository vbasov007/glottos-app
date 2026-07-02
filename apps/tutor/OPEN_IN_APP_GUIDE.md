# polyGlottos "Open in App" Link Guide

How to create a link on an external site that opens polyGlottos, prompts the user to sign in, and — once logged in — adds a new workspace pre-loaded with the text you specified.

This is different from [`EMBEDDING_GUIDE.md`](EMBEDDING_GUIDE.md), which embeds a read-only lesson via iframe. Use **this** guide when you want the user to land inside their own polyGlottos account with the text ready to edit, study, and save.

---

## How the flow works

1. You call `POST /api/create-shared` with the text. The server returns a short share `code`.
2. You publish a link of the form `https://t.glottos.com/s/<code>`.
3. The user clicks the link:
   - If signed in → a **new workspace** is created in their account, pre-loaded with the text and any pre-computed explanations, and made active.
   - If signed out → the share code is held in `sessionStorage` across the login flow (Google sign-in or anonymous start). After sign-in, the workspace is added automatically.
4. The user sees a toast "Shared lesson imported" and lands on the new workspace.

The same share code is safe to reuse: each click creates a fresh workspace for the clicking user. The originating user's workspace is not affected. If the user already has a workspace from the same source, the app shows a duplicate-import confirmation before adding a second copy.

---

## Step 1 — Create the share code

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
  "text": "Der Hund läuft schnell durch den Park.\nDie Kinder spielen fröhlich auf der Wiese.",
  "phrases": ["Hund", "läuft", "Park", "Kinder", "spielen"],
  "textLanguage": "de",
  "explanationLanguage": "en",
  "name": "A Walk in the Park"
}
```

| Parameter             | Type     | Required | Description                                                                 |
|-----------------------|----------|----------|-----------------------------------------------------------------------------|
| `text`                | string   | Yes      | Full text of the lesson. Newlines separate sentences (used by TTS).         |
| `phrases`             | string[] | Yes      | Words/phrases to pre-explain (case-sensitive substring of `text`, max 200). |
| `textLanguage`        | string   | No       | Language code of the text (default `"de"`).                                 |
| `explanationLanguage` | string   | No       | Language for AI explanations (default `"ru"`).                              |
| `name`                | string   | No       | Workspace name shown in the user's tab list (default `"Shared Lesson"`).    |

Supported language codes are the same set listed in `EMBEDDING_GUIDE.md`.

### Response

```json
{ "code": "egr34Z", "status": "processing", "total": 5 }
```

The response is immediate. Explanations are generated in the background; the link works right away. If the same `text + phrases + languages` were submitted before, the existing code is returned (deduplication).

### `phrases` can be empty

If you only want to drop the text into the user's workspace without any pre-computed explanations, pass `"phrases": []`. The workspace is created instantly and the user can tap any word to generate explanations on demand.

---

## Step 2 — Build the link

Two URL forms work; both end up in the same place.

**Short form (recommended for sharing):**

```
https://t.glottos.com/s/<code>
```

**Direct form:**

```
https://t.glottos.com/app?import=<code>
```

The short form simply redirects to the direct form. Use whichever fits your medium.

### HTML example

```html
<a href="https://t.glottos.com/s/egr34Z">
  Open this lesson in polyGlottos →
</a>
```

### Markdown example

```markdown
[Open this lesson in polyGlottos](https://t.glottos.com/s/egr34Z)
```

### Generating the URL in code

```js
const url = `https://t.glottos.com/s/${encodeURIComponent(code)}`;
```

---

## Full example — end-to-end

```bash
# 1. Create the share code
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
# → { "code": "Xk9mPq", "status": "processing", "total": 5 }
```

```html
<!-- 2. Publish the link on your site -->
<a href="https://t.glottos.com/s/Xk9mPq">Study this in polyGlottos</a>
```

When the user clicks:
- New tab opens at `t.glottos.com`.
- If not signed in, they are prompted to sign in with Google or continue anonymously.
- After sign-in, a workspace named **"German Basics: The Cat"** is created and made active. The text is in the textarea, and the listed phrases already have explanations cached.
- The user can edit the text, generate more explanations, save TTS, etc. — it is their workspace from this point on.

---

## What the user sees

- **Already signed in** — the workspace appears in their tab list immediately and becomes the active workspace. A toast confirms the import.
- **Signed out** — they see the landing page or login screen. The pending import is preserved through the Google OAuth round-trip (it lives in `sessionStorage`). After authentication, the workspace is created automatically; they do not need to click the link a second time.
- **Anonymous sign-in** — works the same as Google sign-in for the purpose of the import.
- **Still processing** — if the user clicks the link before background explanations finish, the text is loaded into a new workspace right away and a small progress indicator (e.g. "60% (3/5)") shows in the toolbar. Explanations stream in as they complete; no further user action is required.
- **Duplicate** — if the user previously imported a workspace from this exact source, a confirmation modal appears before a second copy is added.

---

## Guidelines

### Text formatting

The `text` field must be **clean text only** — these rules are the same as in `EMBEDDING_GUIDE.md` because the same TTS and word-tap UI is used:

- No sentence numbering (`"1. ..."`).
- No bracketed annotations or notes.
- No symbols that cannot be pronounced (`*`, `#`, `→`, bullet points, etc.). Only letters, standard punctuation (`. , ! ? : ; " ' -`), and whitespace.
- One sentence per line — use `\n` between sentences. Blank lines between sentences are not needed.

### Choosing phrases

- Pick words a learner would want explained: content words, verbs in interesting forms, prepositional/idiomatic phrases.
- Phrases must appear in `text` as exact, case-sensitive substrings.
- 5–30 phrases per lesson is typical. Each phrase takes a few seconds to generate; very large lists slow the background processing.
- Pass `[]` if you do not want any pre-computation — the user can tap words to generate explanations themselves.

### Embed vs. open-in-app — which to use

| You want…                                                              | Use                              |
|------------------------------------------------------------------------|----------------------------------|
| A read-only preview inside your page, no account needed                | `EMBEDDING_GUIDE.md` (iframe)    |
| To hand the user a copy they can edit, save, and return to             | **this guide** (open-in-app link)|

You can use both with the same share code: embed the lesson on your page, and offer an "Open in polyGlottos" link next to it.

### API key handling

`POST /api/create-shared` requires `X-API-Key`. Call it only from server-side code; never put the key in HTML or client JavaScript. The resulting `/s/<code>` link is fully public — anyone with the code can import the workspace.

### Link stability

Codes are stable. Bookmark them, embed them in newsletters, print them in QR codes — they will keep working. If the underlying text or phrases need to change, generate a new code and update the link.
