import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getAnthropic, ANSWER_JUDGE_MODEL } from '../../../../lib/anthropic';
import { checkRateLimit, clientKey } from '../../../../lib/rate-limit';
import type { NativeLang, TargetLang } from '../../../../lib/content-types';

export const runtime = 'nodejs';

// ---- request / response shapes ---------------------------------------------

interface RequestBody {
  target: TargetLang;
  native: NativeLang;
  /** The entry's target-language word or phrase (e.g. "die Stadt", "Lust haben"). */
  german: string;
}

/** Grammatical gender for nouns in target languages that have it. Lowercase
 *  for the wire to match the static-dictionary enum after .toLowerCase()
 *  (which uses "m"/"f"/"n"/"Pl"|null). `null` when the language has no
 *  grammatical gender (en, ka), when the part of speech doesn't carry
 *  gender (verbs, adjectives, …), or when exists=false. */
export type AiGender = 'm' | 'f' | 'n' | 'pl' | null;

export type AiPartOfSpeech =
  | 'noun'
  | 'verb'
  | 'adjective'
  | 'adverb'
  | 'phrase'
  | 'particle'
  | 'other';

interface DetailsResponse {
  /** False when the queried string isn't a real word/phrase in the target
   *  language. Used by the "Try AI" entry point: typed-in queries can be
   *  typos or gibberish. Forms/example will be empty when !exists. */
  exists: boolean;
  /** When !exists: a short native-language sentence stating why (typo /
   *  not in target / etc.). Empty when exists. */
  reason: string;
  /** Citation form a paper dictionary would print. Includes the canonical
   *  article when the target language calls for one — "die Stadt" (de),
   *  "il libro" (it), "el agua" (es), "la ville" (fr). Bare word for
   *  Hebrew/Serbian/English/Georgian. Empty string when !exists. */
  headword: string;
  /** Native-language meaning of the word — terse dictionary-style gloss
   *  (e.g. "город, населённый пункт" for "die Stadt" with native=ru).
   *  Empty when !exists. */
  meaning: string;
  /** Lowercase part-of-speech tag. Used server-side by `assertGenderForNoun`
   *  to enforce that nouns in gendered targets always come back with a
   *  gender; rendered nowhere yet. */
  partOfSpeech: AiPartOfSpeech | '';
  /** Short gender code, or null when the language/POS has no gender. */
  gender: AiGender;
  forms: { label: string; form: string }[];
  example: { sentence: string; translation: string };
}

// Target languages where nouns carry grammatical gender we need to surface.
// English and Georgian are excluded — they don't mark nouns for gender.
const GENDERED_TARGETS: ReadonlySet<TargetLang> = new Set<TargetLang>([
  'de',
  'fr',
  'es',
  'it',
  'he',
  'sr',
]);

/**
 * Loud guard against a malformed response: nouns in gendered targets must
 * carry a non-null `gender`. Anthropic's structured output usually obeys
 * the enum, but a missed schema constraint shouldn't silently render an
 * empty pill — failing here turns it into a 502 the client can retry.
 */
function assertGenderForNoun(parsed: DetailsResponse, target: TargetLang): void {
  if (!parsed.exists) return;
  if (parsed.partOfSpeech !== 'noun') return;
  if (!GENDERED_TARGETS.has(target)) return;
  if (parsed.gender == null) {
    throw new Error('malformed_response: noun in gendered target missing gender');
  }
}

// ---- system prompt (stable; prompt-cached) ---------------------------------

const NATIVE_LANG_LABELS: Record<NativeLang, string> = {
  ru: 'Russian',
  en: 'English',
  pl: 'Polish',
  de: 'German',
};

const TARGET_LANG_LABELS: Record<TargetLang, string> = {
  de: 'German',
  fr: 'French',
  es: 'Spanish',
  sr: 'Serbian',
  ka: 'Georgian',
  he: 'Hebrew',
  en: 'English',
  it: 'Italian',
};

// Keep this stable. Any byte change breaks the prompt cache for every
// caller until it warms again. v2 adds the headword + gender mandate.
const SYSTEM_PROMPT = `You produce study-card details for vocabulary entries.

You receive:
- target: target language of the dictionary (e.g. "German")
- native: learner's native language (e.g. "Russian")
- word: a query string

The query MAY be in either the target language (the most common case) or
in the native language (the learner is looking up the foreign equivalent
of a word they know). Handle both.

STEP 1 — language detection. Decide whether "word" is:
  (a) a valid word/phrase in the TARGET language, or
  (b) a valid word/phrase in the NATIVE language, or
  (c) neither (gibberish, typo nobody would write, another language).

STEP 2 — respond based on the detection.

- Case (c): set "exists": false and write a short native-language sentence
  in "reason" (≤15 words) explaining why. Set "forms" to [] and "example"
  to {sentence: "", translation: ""}. Don't invent content for non-words.

- Case (a): the user typed a target-language word directly. Set "exists":
  true, "reason": "". Fill "meaning" (native-language gloss), "forms"
  (inflections of the target word), and "example" (target sentence +
  native translation) as described below.

- Case (b): the user typed a native-language word and wants to find the
  target-language equivalent. Resolve the most common target-language
  translation, then build the response AS IF the user had typed that
  target word. "meaning" is still in the native language (it can simply
  echo or expand the query). "forms" inflect the resolved target word,
  not the native input. "example" is a target sentence using the
  resolved target word, with a native translation.

Be lenient on capitalization (target nouns may be lowercased) and on
missing articles ("Stadt" is valid even though dictionary form is "die
Stadt"). Be strict on actual gibberish.

When "exists": true, return:

0) partOfSpeech — one of: "noun", "verb", "adjective", "adverb", "phrase",
   "particle", "other". For words that the user looked up that ARE an
   article themselves (German "der", French "la", Italian "il", Spanish
   "el"), return "particle".

0a) headword — the citation form a paper dictionary would print, in the
   target language. MANDATORY for "exists": true. Per-language rules:
   - German: definite article + noun. "die Stadt", "der Tisch",
     "das Haus", "die Ferien" (plurale tantum). Capitalize nouns.
   - French: definite singular article + noun. "la ville", "le livre".
     Keep elisions: "l'eau", "l'aboutissement".
   - Italian: definite singular article + noun, applying the il/lo rule.
     "il libro", "lo studente", "lo zaino", "la casa".
   - Spanish: definite singular article + noun, applying the el-for-
     euphony rule. "el libro", "la casa", "el agua" (feminine word
     taking "el"), "el alma" (likewise).
   - Hebrew: bare word in Hebrew script. NO article — Hebrew citation
     forms don't prepend ה. Example: "ספר", "עיר". Gender lives in the
     gender field, not the headword.
   - Serbian: bare noun. Serbian has no articles. Example: "grad".
   - English / Georgian: just the lemma. "city", "to walk", "ქალაქი".
   - Non-noun parts of speech (verbs, adjectives, …): lemma in the form
     a paper dictionary uses (verbs → infinitive: German "gehen", French
     "aller", Italian "andare"; adjectives → masculine singular positive).
   - If the user looked up the article itself ("der", "la", "il", "el"):
     headword = the article verbatim.

0b) gender — short code, MANDATORY for nouns in target languages with
   grammatical gender (German, French, Italian, Spanish, Hebrew, Serbian).
   Use:
   - "m" masculine
   - "f" feminine
   - "n" neuter (German, sometimes others)
   - "pl" plurale tantum (plural-only nouns: German "die Ferien",
     Italian "i pantaloni", Spanish "las gafas")
   - null when (a) the target language is English or Georgian, OR
     (b) the part of speech is not a noun (verb, adjective, adverb,
     particle, phrase, multi-word), OR (c) the user looked up an article.
   Lowercase exactly — "m", not "M".

   Ambiguous gender (e.g. "der Junge" vs "die Junge", "el calor" vs
   "la calor"): pick the modern-standard dominant form. Mention the
   alternative inside meaning, NOT inside headword.
   Two-gender homographs (German "der See" lake vs "die See" sea): pick
   the more frequent / contextually likely sense; note the other inside
   meaning.

1) meaning — a terse dictionary-style gloss of the word's meaning in the
   LEARNER'S native language. One line, ≤8 words, no surrounding quotes.
   Comma-separate alternate senses. Example: for "die Stadt" with
   native=Russian, "город, населённый пункт"; for "Lust haben" with
   native=English, "to feel like, to be in the mood for".

2) forms — 3 to 8 commonly used inflected forms or closely related word forms,
   chosen by the part of speech:
   - Verbs: present tense for 1st/2nd/3rd singular (and infinitive if not the word),
     plus past (Präteritum or Perfekt participle for German).
   - Nouns: singular with article, plural, genitive singular (where applicable).
     If the entry already includes the article, vary case/number; don't repeat
     the entry verbatim.
   - Adjectives / adverbs: comparative and superlative (positive too if missing).
   - Phrases / multi-word entries: 2-3 typical sentence variants (questions,
     negations, common conjugations).
   - Particles / function words: usage variants in different positions/contexts.

   For each form: a SHORT label (≤20 chars, in the LEARNER'S native language,
   e.g. "Настоящее (я)", "Present (I)", "Множественное", "Plural", "Genitiv ед.ч.",
   "Past participle") and the form itself as a clean target-language string
   that a TTS engine can pronounce naturally (no parentheticals, no slashes).

3) example — ONE natural target-language sentence using the entry, plus a
   translation in the LEARNER'S native language. Keep it short (≤12 words),
   plausible, and pedagogically useful. Avoid proper nouns unless idiomatic.

When "exists": false, set headword="" and gender=null and
partOfSpeech="other".

Return STRICT JSON matching the schema. Forms must be unique. Skip categories
that don't apply for the word type. Never put grammar abbreviations like
"3.Sg." in the "form" field — those belong in "label".`;

// NOTE: structured-outputs json_schema does not support numeric array
// constraints (minItems/maxItems/minimum/maximum), so the "3 to 8 forms"
// rule lives in the system prompt only.
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    exists: { type: 'boolean' },
    reason: { type: 'string' },
    headword: { type: 'string' },
    meaning: { type: 'string' },
    partOfSpeech: {
      type: 'string',
      enum: ['noun', 'verb', 'adjective', 'adverb', 'phrase', 'particle', 'other'],
    },
    // Gender is nullable (verbs, English nouns, the article itself, etc.).
    // Anthropic's structured-output validator accepts the anyOf-with-null
    // form, which keeps the field typed as a real enum on success.
    gender: {
      anyOf: [
        { type: 'string', enum: ['m', 'f', 'n', 'pl'] },
        { type: 'null' },
      ],
    },
    forms: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          form: { type: 'string' },
        },
        required: ['label', 'form'],
        additionalProperties: false,
      },
    },
    example: {
      type: 'object',
      properties: {
        sentence: { type: 'string' },
        translation: { type: 'string' },
      },
      required: ['sentence', 'translation'],
      additionalProperties: false,
    },
  },
  required: [
    'exists',
    'reason',
    'headword',
    'meaning',
    'partOfSpeech',
    'gender',
    'forms',
    'example',
  ],
  additionalProperties: false,
} as const;

// ---- cache -----------------------------------------------------------------

// Process-lifetime cache. Details are deterministic for (target, native, word),
// so memoizing across the deploy keeps the LLM cost ~one call per entry. Lost
// on every redeploy — fine, regenerates lazily on demand.
const cache = new Map<string, DetailsResponse>();
function cacheKey(b: RequestBody): string {
  return `${b.target}|${b.native}|${b.german.toLowerCase()}`;
}

// ---- handler ---------------------------------------------------------------

export async function POST(req: Request): Promise<NextResponse> {
  const rl = checkRateLimit(clientKey(req));
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'rate_limited' },
      { status: 429, headers: { 'retry-after': String(rl.retryAfterSec ?? 60) } },
    );
  }

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (
    typeof body.german !== 'string' ||
    !body.german.trim() ||
    typeof body.target !== 'string' ||
    !['de', 'fr', 'es', 'sr', 'ka', 'he', 'en', 'it'].includes(body.target) ||
    typeof body.native !== 'string' ||
    !['ru', 'en', 'pl'].includes(body.native)
  ) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  const key = cacheKey(body);
  const cached = cache.get(key);
  if (cached) {
    return NextResponse.json(cached, {
      headers: { 'cache-control': 'public, max-age=86400' },
    });
  }

  const userMsg = JSON.stringify({
    target: TARGET_LANG_LABELS[body.target],
    native: NATIVE_LANG_LABELS[body.native],
    word: body.german,
  });

  try {
    const client = getAnthropic();
    const response = await client.messages.create({
      model: ANSWER_JUDGE_MODEL,
      max_tokens: 600,
      system: [
        { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
      ],
      output_config: { format: { type: 'json_schema', schema: RESPONSE_SCHEMA } },
      messages: [{ role: 'user', content: userMsg }],
    } as Anthropic.MessageCreateParamsNonStreaming);

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return NextResponse.json({ error: 'no_content' }, { status: 502 });
    }
    const parsed = JSON.parse(textBlock.text) as DetailsResponse;
    try {
      assertGenderForNoun(parsed, body.target);
    } catch (e) {
      console.warn('[dictionary/details]', (e as Error).message, {
        target: body.target,
        word: body.german,
        gender: parsed.gender,
        partOfSpeech: parsed.partOfSpeech,
      });
      return NextResponse.json({ error: 'malformed_response' }, { status: 502 });
    }
    cache.set(key, parsed);
    return NextResponse.json(parsed, {
      headers: { 'cache-control': 'public, max-age=86400' },
    });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      return NextResponse.json(
        { error: 'upstream_rate_limited' },
        { status: 429, headers: { 'retry-after': '30' } },
      );
    }
    if (err instanceof Anthropic.AuthenticationError) {
      return NextResponse.json({ error: 'auth_error' }, { status: 500 });
    }
    if (err instanceof Anthropic.APIError) {
      return NextResponse.json(
        { error: 'upstream_error', detail: err.message },
        { status: err.status ?? 500 },
      );
    }
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
