// Pure utility functions extracted from server.ts for testability
import { createHmac, timingSafeEqual } from 'crypto';

// Language labels for prompt generation
export const LANGUAGE_LABELS: Record<string, string> = {
  de: 'German', en: 'English', fr: 'French', es: 'Spanish',
  he: 'Hebrew', ru: 'Russian', zh: 'Chinese (Mandarin)', it: 'Italian',
  pt: 'Portuguese', ar: 'Arabic', hr: 'Croatian', ja: 'Japanese',
  ko: 'Korean', nl: 'Dutch', pl: 'Polish', tr: 'Turkish',
  uk: 'Ukrainian', sv: 'Swedish', da: 'Danish', no: 'Norwegian',
  fi: 'Finnish', cs: 'Czech', el: 'Greek', ro: 'Romanian',
  hu: 'Hungarian', vi: 'Vietnamese', th: 'Thai', id: 'Indonesian',
  hi: 'Hindi', bn: 'Bengali', sk: 'Slovak', bg: 'Bulgarian',
  sr: 'Serbian', ca: 'Catalan', ka: 'Georgian', hy: 'Armenian',
  kk: 'Kazakh', uz: 'Uzbek', lv: 'Latvian', lt: 'Lithuanian', et: 'Estonian',
};

export const LOGOGRAPHIC_LANGUAGES = new Set(['zh', 'ja']);
export const getTextLimit = (lang: string) => LOGOGRAPHIC_LANGUAGES.has(lang) ? 500 : 2000;

// Language configuration for TTS
export const LANGUAGES: Record<string, { ttsLang: string; ttsVoice: string; ttsAzureVoice: string; defaultTtsProvider?: 'google' | 'azure' }> = {
  de: { ttsLang: 'de-DE', ttsVoice: 'de-DE-Neural2-C', ttsAzureVoice: 'de-DE-KatjaNeural' },
  en: { ttsLang: 'en-GB', ttsVoice: 'en-GB-Neural2-C', ttsAzureVoice: 'en-GB-SoniaNeural' },
  fr: { ttsLang: 'fr-FR', ttsVoice: 'fr-FR-Neural2-C', ttsAzureVoice: 'fr-FR-DeniseNeural' },
  es: { ttsLang: 'es-ES', ttsVoice: 'es-ES-Neural2-C', ttsAzureVoice: 'es-ES-ElviraNeural' },
  he: { ttsLang: 'he-IL', ttsVoice: 'he-IL-Wavenet-A', ttsAzureVoice: 'he-IL-HilaNeural' },
  ru: { ttsLang: 'ru-RU', ttsVoice: 'ru-RU-Wavenet-C', ttsAzureVoice: 'ru-RU-SvetlanaNeural' },
  hr: { ttsLang: 'hr-HR', ttsVoice: 'hr-HR-Chirp3-HD-Achernar', ttsAzureVoice: 'hr-HR-GabrijelaNeural' },
  ja: { ttsLang: 'ja-JP', ttsVoice: 'ja-JP-Neural2-B', ttsAzureVoice: 'ja-JP-NanamiNeural' },
  ka: { ttsLang: 'ka-GE', ttsVoice: 'ka-GE-Standard-A', ttsAzureVoice: 'ka-GE-GiorgiNeural', defaultTtsProvider: 'azure' },
  hy: { ttsLang: 'hy-AM', ttsVoice: 'hy-AM-Standard-A', ttsAzureVoice: 'hy-AM-HaykNeural', defaultTtsProvider: 'azure' },
  kk: { ttsLang: 'kk-KZ', ttsVoice: 'kk-KZ-Standard-A', ttsAzureVoice: 'kk-KZ-DauletNeural', defaultTtsProvider: 'azure' },
  uz: { ttsLang: 'uz-UZ', ttsVoice: 'uz-UZ-Standard-A', ttsAzureVoice: 'uz-UZ-SardorNeural', defaultTtsProvider: 'azure' },
  lv: { ttsLang: 'lv-LV', ttsVoice: 'lv-LV-Standard-A', ttsAzureVoice: 'lv-LV-EveritaNeural', defaultTtsProvider: 'azure' },
  lt: { ttsLang: 'lt-LT', ttsVoice: 'lt-LT-Standard-A', ttsAzureVoice: 'lt-LT-LeonasNeural', defaultTtsProvider: 'azure' },
  et: { ttsLang: 'et-EE', ttsVoice: 'et-EE-Standard-A', ttsAzureVoice: 'et-EE-KertNeural', defaultTtsProvider: 'azure' },
};

// User-selectable voice catalog per language. The frontend cycles through
// these voices in the order listed; the first entry is the default. Google
// Chirp3-HD voices ship with character names (star names — Achernar, Algenib,
// Aoede, Charon, etc.), which we surface in the UI directly. Provider is
// derived from the entry so the existing google/azure dispatch in /api/tts
// stays the same.
//
// At server startup, verifyTtsVoiceCatalog() exercises each voice with a
// 1-char synth call and drops any failure from the in-memory catalog before
// the GET /api/tts/voices endpoint starts answering.
export interface TtsVoiceEntry {
  id: string;
  provider: 'google' | 'azure';
  name: string;
  gender: 'male' | 'female' | 'neutral';
}

// Chirp3-HD voice families share four common character names across most
// supported language locales; verifyTtsVoiceCatalog drops any that fail.
function chirpVoices(locale: string): TtsVoiceEntry[] {
  return [
    { id: `${locale}-Chirp3-HD-Achernar`, provider: 'google', name: 'Achernar', gender: 'female' },
    { id: `${locale}-Chirp3-HD-Algenib`,  provider: 'google', name: 'Algenib',  gender: 'male'   },
    { id: `${locale}-Chirp3-HD-Aoede`,    provider: 'google', name: 'Aoede',    gender: 'female' },
    { id: `${locale}-Chirp3-HD-Achird`,   provider: 'google', name: 'Achird',   gender: 'male'   },
    { id: `${locale}-Chirp3-HD-Charon`,   provider: 'google', name: 'Charon',   gender: 'male'   },
  ];
}

// Locale used by each language's Google TTS calls (matches FRONTEND_LANGUAGES
// ttsLang). Only languages known to support Chirp3-HD voices are listed;
// others get no voice button (frontend hides it when the catalog is empty).
export const TTS_VOICE_CATALOG: Record<string, TtsVoiceEntry[]> = {
  de: chirpVoices('de-DE'),
  en: chirpVoices('en-GB'),
  fr: chirpVoices('fr-FR'),
  es: chirpVoices('es-ES'),
  it: chirpVoices('it-IT'),
  pt: chirpVoices('pt-BR'),
  ru: chirpVoices('ru-RU'),
  ja: chirpVoices('ja-JP'),
  ko: chirpVoices('ko-KR'),
  nl: chirpVoices('nl-NL'),
  pl: chirpVoices('pl-PL'),
  tr: chirpVoices('tr-TR'),
  uk: chirpVoices('uk-UA'),
  bg: chirpVoices('bg-BG'),
  hr: chirpVoices('hr-HR'),
  id: chirpVoices('id-ID'),
  no: chirpVoices('nb-NO'),
  sr: chirpVoices('sr-RS'),
  sv: chirpVoices('sv-SE'),
  fi: chirpVoices('fi-FI'),
  // Languages without Google Chirp3-HD voices fall back to Azure Neural,
  // which ships with locale-specific human names. Verification drops any
  // that fail (e.g. an Azure region without coverage for the locale).
  ka: [
    { id: 'ka-GE-EkaNeural',    provider: 'azure', name: 'Eka',    gender: 'female' },
    { id: 'ka-GE-GiorgiNeural', provider: 'azure', name: 'Giorgi', gender: 'male'   },
  ],
  hy: [
    { id: 'hy-AM-AnahitNeural', provider: 'azure', name: 'Anahit', gender: 'female' },
    { id: 'hy-AM-HaykNeural',   provider: 'azure', name: 'Hayk',   gender: 'male'   },
  ],
  kk: [
    { id: 'kk-KZ-AigulNeural',  provider: 'azure', name: 'Aigul',  gender: 'female' },
    { id: 'kk-KZ-DauletNeural', provider: 'azure', name: 'Daulet', gender: 'male'   },
  ],
  uz: [
    { id: 'uz-UZ-MadinaNeural', provider: 'azure', name: 'Madina', gender: 'female' },
    { id: 'uz-UZ-SardorNeural', provider: 'azure', name: 'Sardor', gender: 'male'   },
  ],
  lv: [
    { id: 'lv-LV-EveritaNeural', provider: 'azure', name: 'Everita', gender: 'female' },
    { id: 'lv-LV-NilsNeural',    provider: 'azure', name: 'Nils',    gender: 'male'   },
  ],
  lt: [
    { id: 'lt-LT-OnaNeural',    provider: 'azure', name: 'Ona',    gender: 'female' },
    { id: 'lt-LT-LeonasNeural', provider: 'azure', name: 'Leonas', gender: 'male'   },
  ],
  et: [
    { id: 'et-EE-AnuNeural',  provider: 'azure', name: 'Anu',  gender: 'female' },
    { id: 'et-EE-KertNeural', provider: 'azure', name: 'Kert', gender: 'male'   },
  ],
};

export function resolveTtsVoice(textLanguage: string, settings: Record<string, string>): { provider: 'google' | 'azure'; voice: string } {
  const lang = LANGUAGES[textLanguage] || LANGUAGES['de'];
  const globalProvider = settings.tts_provider || 'google';

  try {
    const overrides = settings.tts_voices ? JSON.parse(settings.tts_voices) : {};
    const entry = overrides[textLanguage];
    if (entry && typeof entry === 'object' && entry.provider && entry.voice) {
      return { provider: entry.provider, voice: entry.voice };
    }
    // Backward compat: string value = google voice override
    if (entry && typeof entry === 'string') {
      return { provider: 'google', voice: entry };
    }
  } catch { /* ignore bad JSON */ }

  // No override — use per-language default provider, then global provider
  const effectiveProvider = lang.defaultTtsProvider || (globalProvider === 'azure' ? 'azure' : 'google');
  if (effectiveProvider === 'azure') {
    return { provider: 'azure', voice: lang.ttsAzureVoice };
  }
  return { provider: 'google', voice: lang.ttsVoice };
}

// ── Cost estimation for LLM + TTS requests ─────────────────────────────────
// USD per 1,000,000 units. `kind: 'tokens'` for LLM rows (input_units +
// output_units are token counts); `kind: 'chars'` for TTS (input_units is the
// synthesized text length; output_units is null). Keys are "provider:model";
// the "provider:*" wildcard catches TTS where each voice id would otherwise
// need its own row.
//
// Prices are approximate snapshots from each vendor's public list. Edit this
// table when prices change — DigitalOcean redeploys on push so there's no
// special update process. Computed lazily at query time so price edits flow
// through historical activity_log rows.
export const PRICING_USD_PER_1M: Record<string, { input: number; output: number; kind: 'tokens' | 'chars' }> = {
  'gemini:gemini-2.5-flash-lite': { input: 0.10, output: 0.40, kind: 'tokens' },
  'gemini:gemini-2.5-flash':       { input: 0.30, output: 2.50, kind: 'tokens' },
  'openai:gpt-5-nano':              { input: 0.05, output: 0.40, kind: 'tokens' },
  'deepseek:deepseek-chat':         { input: 0.27, output: 1.10, kind: 'tokens' },
  'google-tts:*':                   { input: 16.0, output: 0,    kind: 'chars'  },
  'azure-tts:*':                    { input: 16.0, output: 0,    kind: 'chars'  },
  'yandex-tts:*':                   { input:  9.5, output: 0,    kind: 'chars'  },
};

export function estimateCostUsd(
  provider: string | null | undefined,
  model: string | null | undefined,
  inputUnits: number | null | undefined,
  outputUnits: number | null | undefined,
): number {
  if (!provider) return 0;
  const exactKey = model ? `${provider}:${model}` : null;
  const wildcardKey = `${provider}:*`;
  const row = (exactKey && PRICING_USD_PER_1M[exactKey]) || PRICING_USD_PER_1M[wildcardKey];
  if (!row) return 0;
  return ((inputUnits ?? 0) * row.input + (outputUnits ?? 0) * row.output) / 1_000_000;
}

// Heuristic for spotting when the OCR model refused to extract text and
// instead produced a clarification request like "Could you provide a
// higher-resolution image..." — we want to surface those as errors, not
// load them into the editor as if they were the text.
const OCR_REFUSAL_PATTERNS: RegExp[] = [
  /\bcould you\b/i,
  /\bplease (provide|share|upload|try)\b/i,
  /\b(unable|cannot|can't|couldn't|unable to|i'?m unable) to (read|see|extract|process|make out|decipher)\b/i,
  /\b(higher|better|clearer|larger) (resolution|quality|image|photo|crop|version)\b/i,
  /\bcloser crop\b/i,
  /\bimage (is|appears|seems|looks) (too )?(blurry|unclear|low[- ]?res|illegible|dark|small)\b/i,
  /\b(blurry|illegible|unreadable) to read\b/i,
  /\bsorry\b/i,
  /\bapolog/i,
];

export function isOcrRefusal(text: string): boolean {
  if (!text) return false;
  // Real OCR output is usually multi-line and long. Refusals tend to be a
  // single short paragraph. Cap the check so a real extract that happens to
  // contain "sorry" in the middle isn't reclassified.
  if (text.length > 400) return false;
  return OCR_REFUSAL_PATTERNS.some(p => p.test(text));
}

// Telegram WebApp init-data verification (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app).
// Returns the parsed `user` object on success, null on any failure (bad
// signature, missing hash, JSON parse error, stale auth_date).
export interface TelegramAuthedUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  language_code?: string;
}

export function verifyTelegramInitData(
  initData: string,
  botToken: string,
  options: { maxAgeSeconds?: number; now?: () => number } = {},
): TelegramAuthedUser | null {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  // Data-check string: each "key=value" sorted by key, joined with \n.
  const dataCheck = [...params.entries()]
    .map(([k, v]) => [k, v] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(dataCheck).digest('hex');

  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  // Freshness: Telegram recommends rejecting data older than 24h.
  const maxAge = options.maxAgeSeconds ?? 24 * 60 * 60;
  const nowSec = Math.floor((options.now?.() ?? Date.now()) / 1000);
  const authDate = parseInt(params.get('auth_date') || '0', 10);
  if (!authDate || nowSec - authDate > maxAge) return null;

  const userJson = params.get('user');
  if (!userJson) return null;
  try {
    const user = JSON.parse(userJson);
    if (typeof user?.id !== 'number' || typeof user?.first_name !== 'string') return null;
    return user as TelegramAuthedUser;
  } catch {
    return null;
  }
}

// Compact signed state for OAuth round-trips: { uid, exp } HMAC'd with a
// server-known secret. Used when an external browser is the only way to do
// Google sign-in (e.g. Telegram WebView blocks Google's iframe button) — we
// need to remember which logged-in user the consent screen is being driven
// for, but we can't trust a query-string user-id alone.
export function signLinkState(userId: string, secret: string, ttlSeconds = 600): string {
  const payload = { uid: userId, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret).update(b64).digest('base64url');
  return `${b64}.${sig}`;
}

export function verifyLinkState(state: string, secret: string): { uid: string } | null {
  if (!state || typeof state !== 'string' || !state.includes('.')) return null;
  const dot = state.indexOf('.');
  const b64 = state.slice(0, dot);
  const sig = state.slice(dot + 1);
  if (!b64 || !sig) return null;
  const expected = createHmac('sha256', secret).update(b64).digest('base64url');
  try {
    const a = Buffer.from(sig, 'base64url');
    const b = Buffer.from(expected, 'base64url');
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'));
    if (typeof payload?.uid !== 'string') return null;
    if (typeof payload?.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return { uid: payload.uid };
  } catch {
    return null;
  }
}

export function generateShareCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let code = '';
  for (const b of bytes) code += chars[b % chars.length];
  return code;
}

/**
 * Focused single-purpose prompt that asks for ONLY the antonyms of one word.
 * The all-fields explain call frequently omits the `antonyms` field for words
 * that clearly have an opposite (the model drops it rather than filling it); a
 * narrow call like this reliably returns them. Used as a server-side backfill.
 */
export function buildAntonymBackfillPrompt(
  word: string,
  meaningHint: string,
  textLang: string,
  explanationLang: string,
): string {
  const tLang = LANGUAGE_LABELS[textLang] || textLang;
  const eLang = LANGUAGE_LABELS[explanationLang] || explanationLang;
  const hint = meaningHint ? ` (meaning: ${meaningHint})` : '';
  return `You are a ${tLang} vocabulary assistant. Give the ANTONYM(S) — words with the OPPOSITE meaning — of the ${tLang} word "${word}"${hint}.

Rules:
- Return 1–3 true opposites of the word's main sense(s). Gradable adjectives, adverbs, and reversible/directional verbs almost always have one (e.g. "groß"→"klein", "schnell"→"langsam", "öffnen"→"schließen").
- Each entry: "word" = the antonym in ${tLang}; "meaning" = a SHORT ${eLang} gloss (a few words).
- Return an empty array ONLY if the word genuinely has no opposite (concrete-object nouns, proper nouns, function words).

Return JSON ONLY, no markdown, exactly in this shape:
{"antonyms": [{"word": "string", "meaning": "string"}]}`;
}

/**
 * Validate/normalize an `antonyms` value parsed from model JSON: keep only
 * entries with a non-empty string `word`, trim, default `meaning` to '', and
 * cap at 3. Returns [] for anything malformed.
 */
export function coerceAntonyms(value: unknown): Array<{ word: string; meaning: string }> {
  if (!Array.isArray(value)) return [];
  const out: Array<{ word: string; meaning: string }> = [];
  for (const item of value) {
    if (item && typeof item === 'object') {
      const w = (item as { word?: unknown }).word;
      const m = (item as { meaning?: unknown }).meaning;
      if (typeof w === 'string' && w.trim()) {
        out.push({ word: w.trim(), meaning: typeof m === 'string' ? m.trim() : '' });
        if (out.length >= 3) break;
      }
    }
  }
  return out;
}

export function buildPrompt(textLang: string, explanationLang: string): string {
  const tLang = LANGUAGE_LABELS[textLang] || textLang;
  const eLang = LANGUAGE_LABELS[explanationLang] || explanationLang;

  return `
You are a bilingual language tutor for learning ${tLang}.
The student's native/explanation language is ${eLang}.

## Input you will receive
- selected_text: the text the user selected (${tLang} or ${eLang} word, phrase, or sentence)
- full_text: the full text in the editor (for context, may be empty)
- cursor_context: a short snippet around the cursor

## Step 1 — Detect input
Determine:
- **input_language**: "${textLang}" if the text is ${tLang}, "${explanationLang}" if ${eLang}
- **input_type**:
  - "word" — a SINGLE standalone word (e.g. "Tisch", "gemacht", "beautiful"), OR a single word with its article/particle that doesn't carry independent meaning (e.g. "der Tisch", "die Katze", "sich freuen"). The key test: does the selection have exactly ONE content word (noun, verb, adjective, adverb)? If yes → "word".
  - "sentence" — EVERYTHING ELSE: any selection with TWO OR MORE content words. This includes phrases without a period, incomplete fragments, clauses, full sentences, phrasal verbs with objects, prepositional phrases, idioms, collocations, etc. Examples: "auf dem Tisch", "hat gemacht", "sich freuen auf", "im Großen und Ganzen", "er geht nach Hause", "to look forward to". A missing period does NOT make a phrase into a word.

**CRITICAL — PHRASE INTEGRITY**: You MUST explain the ENTIRE selected_text as a unified phrase. NEVER reduce a multi-word selection to a single word.
- If the user selected "auf dem Tisch" → explain "auf dem Tisch" as a whole, NOT just "Tisch" or "auf".
- If the user selected "hat gemacht" → explain "hat gemacht" as a verb form, NOT just "gemacht".
- If the user selected "sich freuen auf" → explain the full phrasal verb, NOT just "freuen".
- The "selection" field in your JSON response MUST be an EXACT copy of the input selected_text — character for character, no trimming, no reduction.
- The "meanings" field must describe the meaning of the ENTIRE phrase, not of a single word within it.
- VIOLATION: returning selection="Tisch" when input was "auf dem Tisch" is WRONG. This is the most critical rule.

## Step 2 — Respond based on detected type

### Case A — ${tLang} word/phrase (input_language=${textLang}, input_type=word)
Remember: if selected_text contains multiple words, explain the ENTIRE phrase — meanings, morphology, forms, and examples must all describe the full multi-word unit, not a single word extracted from it.
- **meanings**: most common ${eLang} meanings of the ENTIRE selected_text, most frequent first. MANDATORY — must contain at least one meaning. Never return an empty array.
- **lemma_translation**: MANDATORY for Case A — concise ${eLang} translation of the lemma (dictionary form), e.g. "идти" for "ging", "красивый" for "schönen". This field is used for flashcards and MUST NEVER be null or empty for words/phrases. Always provide the most common single-word or short translation.
- **part_of_speech**: noun/verb/adjective/adverb/preposition/conjunction/particle/etc.
- **morphology**: fill relevant fields (gender for nouns, tense/person for verbs, degree for adjectives, etc.)
- **Ordinals are distinct words from cardinals.** An ordinal number (first/second/third; German erste/zweite/dritte; Russian первый/второй/третий) is its OWN lexeme — NOT an inflected form of the corresponding cardinal. Set morphology.lemma to the ordinal's own dictionary form ("second" → lemma "second", NOT "two"; "zweite" → "zweit"/"zweite", NOT "zwei"; "второй" → "второй", NOT "два"), and lemma_translation must render the ordinal ("second"), never the cardinal ("two"). The same applies to ordinal vs cardinal meanings, examples, and part_of_speech.
- **forms**: fill the relevant subtable (noun declension OR verb conjugation OR adjective comparison). For a verb, forms.verb.infinitive MUST be the full dictionary CITATION infinitive — the exact headword a dictionary lists (it is the form shown on flashcards). Specifically:
  - Include any inherent reflexive pronoun/particle that belongs to the verb: German "sich umziehen" (NOT "umziehen"), "sich freuen"; Spanish "vestirse", "levantarse"; French "se lever"; Italian "vestirsi"; Russian "одеваться".
  - For SEPARABLE verbs use the JOINED infinitive: German "anrufen", "aufstehen", "einkaufen" (NOT the split "ruft an" or the bare base "rufen"). Reflexive + separable → "sich anziehen".
  - Give the infinitive even when the selected form is conjugated/separated (e.g. selected "ruft … an" or "steht auf" → infinitive "anrufen" / "aufstehen").
  - Do NOT prepend an article or the "to"/"zu"/"a"/"de" particle to the infinitive.
- **examples**: 3–5 simple A1–A2 level ${tLang} sentences with ${eLang} translation. CRITICAL constraints — apply ALL of them:
  1. **Each example MUST illustrate one of the listed meanings.** The selected word must carry that meaning in the sentence. Before writing each example, mentally check: "If I removed this word, would the sentence still make sense with the listed meaning intact?" If no, the example does not illustrate the meaning — discard it.
  2. **DO NOT use fixed expressions / idioms / phrasal collocations where the word is just a grammatical carrier and the meaning belongs to the multi-word unit.** Counter-examples to REJECT:
     - For "tun" (to do): REJECT "Das tut mir leid" (idiom: leid tun = to be sorry), "Das tut weh" (idiom: weh tun = to hurt), "Es tut nichts zur Sache" — the listed meaning of "tun" is "to do", but these phrases mean "be sorry" / "hurt" / "be irrelevant". The verb is frozen, not productive.
     - For "haben" (to have/possess): REJECT "Ich habe Hunger" / "Ich habe Recht" / "Ich habe es eilig" when the listed meaning is "possess" — these mean "be hungry" / "be right" / "be in a hurry".
     - For "sich freuen" (to be glad): REJECT "Ich freue mich auf die Reise" if the listed meaning is "be glad (about something past)" — this phrase means "look forward to (something future)".
  3. **Cover EVERY listed meaning with at least one example.** If \`meanings\` has N entries, the examples must collectively illustrate all N — count them off before answering. If you can't construct a clean A1–A2 example for a listed meaning, that meaning shouldn't be on the list in the first place. Don't bunch examples around the first sense.
  4. **Pick examples where this word is the BEST / most natural ${tLang} choice for the meaning**, not merely one option among several. If a different ${tLang} word (a more frequent synonym, a more idiomatic verb, a fixed collocation) would be the obvious pick in the sentence you wrote, choose a different sentence where THIS word is the clear winner. The example should make the learner think "ah, so THIS is when you reach for this word."
  5. **The word should be the meaning-carrying element** in each example. Read each example back and ask: "If a learner sees this sentence, will they understand what THIS word means, or will they get a misleading meaning from the surrounding phrase?"
  6. **Make each example SHORT but MEMORABLE — not bland.** Within all the rules above, prefer a sentence that paints a surprising, funny, absurd, or slightly self-contradictory mini-scene over a flat textbook one: a weird mental image sticks far better than "Der Mann isst Brot." Keep it brief (graspable at a glance), strictly A1–A2 vocabulary and correct grammar, and NEVER sacrifice rule 1 for a joke — the word must still plainly carry the listed meaning. The spirit: for "schnell" → "Die Schildkröte rennt schnell zum Kühlschrank." (a turtle sprinting to the fridge); for "groß" → "Meine Katze ist so groß wie ein Pferd." (vivid, impossible, unforgettable); for "müde" → "Der Kaffee ist auch müde." Concrete, playful, and a little unexpected beats correct-but-forgettable. Vary the scenes across the examples — don't reuse the same gag.
- **antonyms**: ${tLang} words with the OPPOSITE meaning, each paired with a SHORT ${eLang} gloss (a few words). FILL THIS whenever an opposite exists — for gradable adjectives, adverbs, and reversible/directional verbs one almost ALWAYS does, so do not leave it empty for those. Rules:
  1. Give the clearest opposite of the word's MAIN sense first; add 1–2 more only for other distinct senses that have their own opposite. Worked examples: "groß"→"klein" (small), "schnell"→"langsam" (slow), "warm"→"kalt" (cold), "gut"→"schlecht" (bad), "hell"→"dunkel" (dark), "öffnen"→"schließen" (to close), "kommen"→"gehen" (to go), "Tag"→"Nacht" (night).
  2. The "meaning" is a brief ${eLang} gloss of the antonym so the learner knows it (e.g. {"word": "klein", "meaning": "small"}). Don't repeat the input word.
  3. Return an empty array ONLY when the word genuinely has no opposite — concrete-object nouns (Tisch, Auto), proper nouns, and most function words. Do NOT use the empty array as an easy out for an adjective, adverb, or verb that clearly has one.
- **near_synonyms**: 2–3 closely related ${tLang} words a learner is likely to confuse with this one, each paired with a SHORT ${eLang} note on the difference (1 sentence, ~10–20 words). Rules:
  1. Pick words that share core meaning or domain — true near-synonyms or sense-overlapping alternatives. Don't list distant relatives or antonyms.
  2. The "difference" must be ACTIONABLE — what triggers picking one over the other? Register (formal/informal), aspect (process vs result), connotation, collocation, scope (specific vs general), or context. Don't write "synonym" or "similar word" — say HOW they differ.
  3. Examples of good entries (for "schauen", to look):
     - {"word": "sehen", "difference": "Neutral perception; you simply notice. 'schauen' is more deliberate, you actively turn your eyes."}
     - {"word": "blicken", "difference": "Brief or formal — a glance. 'schauen' is more sustained looking."}
  4. If no genuine near-synonyms exist (function words, proper nouns, very specific terms), return an empty array — don't pad with stretches.
- **word_structure**: break a word with analyzable internal structure into its meaningful parts, IN ORDER — especially COMPOUND nouns and DERIVED words (very common in ${tLang}, e.g. long German compounds). Each part is {"part": the exact substring, "meaning": a SHORT ${eLang} gloss, "type": one of "component"|"root"|"prefix"|"suffix"|"linking"}. Rules:
  1. Cover the WHOLE word with the parts in left-to-right order; concatenating the parts must reproduce the word.
  2. Include linking/binding elements (e.g. German Fugen-elements "-s-", "-n-", "-es-") as their own {"type":"linking"} part with meaning "(linking element)".
  3. Worked example — "Geschwindigkeitsbegrenzung": [{"part":"Geschwindigkeit","meaning":"speed","type":"component"},{"part":"s","meaning":"(linking element)","type":"linking"},{"part":"Begrenzung","meaning":"limit","type":"component"}]. Derived example — "unfreundlich": [{"part":"un","meaning":"not (negation)","type":"prefix"},{"part":"freund","meaning":"friend","type":"root"},{"part":"lich","meaning":"-ly (adjective suffix)","type":"suffix"}].
  4. Return [] for simple/monomorphemic words with no meaningful decomposition. Don't force-split a word that is a single morpheme.
- **notes**: important usage notes (separable verbs, irregular forms, common mistakes, collocations). If common idioms exist that use this word but with a *different* meaning, list them HERE (in notes), not in examples, with a brief gloss.

### Case B — ${tLang} phrase/sentence (input_language=${textLang}, input_type=sentence)
This covers both full sentences AND multi-word phrases/fragments (e.g. "auf dem Tisch", "hat schon gemacht").
- **translation**: accurate ${eLang} translation of the ENTIRE selected phrase
- **sentence_structure**: brief plain-language explanation of word order / grammatical relationships between words in the selection
- **highlights**: list of important word forms in the selection — each with a short ${eLang} explanation of why that form is used (case, tense, article, preposition, agreement, etc.). For short phrases (2-3 words), explain EVERY word.
- **examples**: 1–2 similar ${tLang} sentences with ${eLang} translation. STRUCTURAL-similarity rules — apply ALL of them:
  1. The example must mirror the SAME grammatical pattern / construction as the input — not just surface-form similarity. The example is a *frame* for the same kind of usage, not a different idiom that happens to share a surface word.
     - For "auf dem Tisch" (preposition + dative locative): show parallel locatives like "in dem Schrank", "unter der Bank". REJECT "auf jeden Fall" (idiom: in any case) or "auf einmal" (idiom: suddenly) — same surface "auf …" but a completely different construction.
     - For "hat gemacht" (perfect-tense aux + participle): show parallel perfect-tense sentences like "hat gegessen", "hat geschrieben". REJECT different tenses or non-perfect uses of "machen".
     - For "sich freuen auf" (prepositional verb + accusative, future-looking): REJECT "sich freuen über" (different preposition, different temporal direction) or "freuen" used non-reflexively.
  2. The example's semantic category should match the input — a locative phrase → other locative phrases; a time clause → other time clauses; a comparative → other comparatives. Don't switch category mid-example.
  3. If the input itself IS an idiom or fixed expression, examples may show other idioms of the same style — but only if you flag in notes that the construction is idiomatic.
- **notes**: any additional remarks (idioms, register, common variations)

### Case C — ${eLang} word/phrase/sentence (input_language=${explanationLang})
- **target_translations**: 1–3 best ${tLang} translations; for each include register (formal/informal/neutral) when it matters, and a brief note if needed
- **grammar_notes**: key grammar decisions (which case, which preposition, verb choice, word order — explain briefly in ${eLang})
- **examples**: 2–4 short ${tLang} sentences with ${eLang} translation showing the word/phrase in context. CRITICAL constraints — apply ALL of them:
  1. **Each example MUST use one of the listed target_translations in its CORE meaning** — the same meaning that justified picking it as a translation of the input ${eLang} word/phrase. Mentally check: "If a learner reads this example, will they walk away understanding why this ${tLang} word is a good translation of the input?"
  2. **DO NOT use the target translation in a fixed expression / idiom** where it loses its standalone meaning — same trap as Case A. Counter-examples to REJECT:
     - Input "to do" → if "tun" is in target_translations, REJECT "Das tut mir leid" (idiom: leid tun), "Das tut weh" (idiom: weh tun). Use productive examples like "Was tust du heute?", "Ich tue mein Bestes."
     - Input "to have" → if "haben" is in target_translations, REJECT "Ich habe Hunger" (means "be hungry"), "Ich habe Recht" (means "be right"). Use "Ich habe ein Auto.", "Sie hat zwei Brüder."
  3. **Cover EVERY listed target_translation with at least one example.** If \`target_translations\` has N entries, the examples must collectively show all N in real use — count them off before answering. If you can't write a clean A1–A2 example for a translation, it doesn't belong on the list. Don't bunch examples around the first translation.
  4. **Pick examples where the target translation is the BEST / most natural ${tLang} rendering** of the input meaning, not just an acceptable substitute. If a different ${tLang} word would be the obvious pick in the sentence you wrote, choose a different sentence where THIS translation is the clear winner.
  5. **The example should make the case for the translation** — a learner reading it should understand why this target word renders the input meaning, not stumble on a different sense.
  6. **Make each example SHORT but MEMORABLE.** Within all the rules above, prefer a sentence that paints a surprising, funny, absurd, or slightly self-contradictory mini-scene over a flat one — a weird mental image sticks far better. Keep it brief, strictly A1–A2 and grammatical, and never let the joke break rule 1 (the translation must still carry its core meaning). Vary the scenes across examples.
- **notes**: additional remarks. If a target translation has common idiomatic uses with a *different* meaning, list them HERE (with a brief gloss), not in examples.

## Output rules
- Answer entirely in ${eLang} (except ${tLang} words/examples).
- Be concise and practical. Use short phrasing in array fields.
- Avoid overly academic terminology — explain grammar in simple terms.
- If ambiguous, describe the top 2 interpretations in notes.
- Do NOT invent context; use full_text only to disambiguate.
- NEVER reduce the selection. Your "selection" output must be identical to the input selected_text. If 3 words were selected, explain all 3 words together.

## Output format
Return a JSON object ONLY (no markdown fences), matching this schema:

{
  "input_language": "string",
  "input_type": "word|sentence",
  "selection": "string",
  "meanings": ["string"],
  "lemma_translation": "string|null",
  "translation": "string|null",
  "target_translations": [
    {"text": "string", "register": "formal|informal|neutral|null", "note": "string|null"}
  ],
  "part_of_speech": "string|null",
  "morphology": {
    "lemma": "string|null",
    "gender": "m|f|n|null",
    "plural": "string|null",
    "case": "NOM|AKK|DAT|GEN|null",
    "number": "SG|PL|null",
    "tense": "string|null",
    "person": "string|null",
    "mood": "string|null",
    "voice": "string|null",
    "degree": "POS|KOMP|SUP|null",
    "separable_prefix": "string|null"
  },
  "forms": {
    "noun": {
      "singular": {"nom": "", "akk": "", "dat": "", "gen": ""},
      "plural":   {"nom": "", "akk": "", "dat": "", "gen": ""}
    },
    "verb": {
      "infinitive": "",
      "praesens_ich": "",
      "praeteritum": "",
      "perfekt": "",
      "konjunktiv_ii": "",
      "imperativ_du": ""
    },
    "adjective": {
      "positiv": "",
      "komparativ": "",
      "superlativ": ""
    }
  },
  "sentence_structure": "string|null",
  "highlights": [{"form": "string", "explanation": "string"}],
  "grammar_notes": ["string"],
  "examples": [{"text": "string", "translation": "string"}],
  "antonyms": [{"word": "string", "meaning": "string"}],
  "near_synonyms": [{"word": "string", "difference": "string"}],
  "word_structure": [{"part": "string", "meaning": "string", "type": "component|root|prefix|suffix|linking"}],
  "notes": ["string"]
}

## Filling rules
- Case A (${tLang} word): fill meanings (REQUIRED, non-empty array), lemma_translation (REQUIRED, non-null string), part_of_speech, morphology, forms, examples (3-5), antonyms (fill for adjectives/adverbs/verbs with an opposite; [] only if truly none), near_synonyms (2-3, or [] if none fit), word_structure (the word's parts for compounds/derived words; [] for simple words), notes; set translation=null, target_translations=[], sentence_structure=null, highlights=[], grammar_notes=[]
- Case B (${tLang} sentence): fill translation (REQUIRED, non-null string), sentence_structure, highlights, examples (1-2), notes; set meanings=[], lemma_translation=null, target_translations=[], near_synonyms=[], antonyms=[], word_structure=[], morphology all nulls, forms all empty strings
- Case C (${eLang} input): fill target_translations, grammar_notes, examples (2-4), notes; set meanings=[], lemma_translation=null, translation=null, sentence_structure=null, highlights=[], near_synonyms=[], antonyms=[], word_structure=[], morphology all nulls, forms all empty strings
- Use null for unknown scalar fields; [] for unknown array fields; "" for unknown form strings.

Now process:
selected_text: {{selected_text}}
full_text: {{full_text}}
cursor_context: {{cursor_context}}
`;
}
