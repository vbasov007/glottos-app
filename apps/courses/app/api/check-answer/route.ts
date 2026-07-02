import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getAnthropic, ANSWER_JUDGE_MODEL } from '../../../lib/anthropic';
import { checkRateLimit, clientKey } from '../../../lib/rate-limit';
import { checkAgainst } from '../../../lib/normalize';

export const runtime = 'nodejs';

// ---- request / response shapes ---------------------------------------------

interface RequestBody {
  given: string;
  canonical: string;
  alternates?: string[];
  context?: string;
  nativeLang: 'ru' | 'en' | 'pl' | 'de';
  /** The language being learned. Pins the judge to the right target. */
  targetLang: 'de' | 'fr' | 'es' | 'sr' | 'ka' | 'he' | 'en' | 'it';
  /** The native-language prompt the learner is responding to. Required when
   *  canonical is empty so the model has something to invent against. */
  prompt?: string;
}

type IssueCategory =
  | 'spelling'
  | 'wrongWord'
  | 'wordOrder'
  | 'wordForm'
  | 'missingWord'
  | 'syntax';

interface Issue {
  category: IssueCategory;
  word: string;
  comment: string;
}

interface ResponseBody {
  correct: boolean;
  issues: Issue[];
}

// ---- system prompt (stable; prompt-cached) ---------------------------------

const NATIVE_LANG_LABELS: Record<RequestBody['nativeLang'], string> = {
  ru: 'Russian',
  en: 'English',
  pl: 'Polish',
  de: 'German',
};

const TARGET_LANG_LABELS: Record<RequestBody['targetLang'], string> = {
  de: 'German',
  fr: 'French',
  es: 'Spanish',
  sr: 'Serbian',
  ka: 'Georgian',
  he: 'Hebrew',
  en: 'English',
  it: 'Italian',
};

// Keep this stable. Any byte change breaks the prompt cache for every caller.
const SYSTEM_PROMPT = `You are a language tutor judging whether a learner's answer in their target language is acceptable.

You receive:
- targetLang: the language being learned. The canonical answer and the learner's "given" answer should both be in this language.
- canonical: the canonical correct answer in the target language. MAY BE EMPTY — see "no canonical" rules below.
- alternates: optional list of alternate accepted answers in the target language
- given: what the learner actually typed
- prompt: the native-language prompt the learner is responding to
- context: short label of the lesson/test (e.g. "Lesson 9: Akkusativ")
- nativeLang: the learner's native language

NO CANONICAL — open-ended judging. When "canonical" is empty or missing, the lesson source didn't pin a single right answer. Use "prompt" + "context" to mentally compose ONE plausible canonical answer in the target language, then judge "given" against it. Be lenient: accept any sentence that conveys the prompt's meaning in the target language, including paraphrases the learner picks. Reject only if the answer doesn't address the prompt at all, is in the wrong language, or contains a comprehension-blocking error.

WITH CANONICAL — normal judging. Decide if "given" is a VALID translation/answer in the target language and in context, even if it differs from "canonical" or "alternates" wording. Accept:
- equivalent word order where the target language permits it
- synonyms that preserve meaning and register
- inflection variants that fit the same grammatical role
- mild spelling typos that don't change meaning (one or two characters)
- transliterations into Latin/Cyrillic only when the lesson explicitly uses them (e.g. introducing a non-Latin script)
- equivalent NUMBER representations that denote the same value — see "NUMBER FORMATS" below

Reject if:
- the meaning differs
- a required case/gender/binyan is wrong
- a required word is missing or extra
- the verb form is wrong for the subject
- the answer is in the wrong language (e.g. the learner typed their native language instead of the target)

NUMBER FORMATS — judge by VALUE, not notation. Numbers, times, dates, and amounts of money are correct when they denote the SAME value as the canonical, regardless of how they're written. Treat all of these as equivalent and NEVER raise an issue for the formatting difference alone:
- spelled-out numbers vs digits: "sechs" = "6", "twenty" = "20"
- time formats: "sechs Uhr" = "6 Uhr" = "6:00"; "halb acht" = "7:30"
- money: "drei Euro zwanzig" = "3,20 Euro" = "3.20 euro" = "€3,20"; ignore decimal-separator style (comma vs period)
- dates: "der erste Mai" = "1. Mai" = "01.05."
The number's grammatical role still matters (a required word around it, correct case/agreement), but the digit-vs-word choice and the separator/format style never do.
EXCEPTION: when the exercise is explicitly teaching how to WRITE a number in words — the prompt asks to spell the number out, or the entire canonical answer is a single spelled-out number — the requested spelled-out form IS required, so "6" for canonical "sechs" is then wrong.

Return STRICT JSON matching the schema: { correct, issues }.

ISSUES — structured error breakdown. When correct: false, return one or more issue objects describing what's wrong. When correct: true, return an empty issues array.

Each issue has THREE fields:
- category (enum): which kind of error it is. Pick the SINGLE best-fitting bucket per issue:
    "spelling"     — the learner typed a misspelled / mistyped target-language word
    "wrongWord"    — wrong vocabulary choice (used a real word that doesn't fit the meaning)
    "wordOrder"    — an EXISTING word/phrase from the answer is in the wrong position
    "wordForm"     — wrong grammatical form (case, gender, number, tense, person, verb form, binyan, declension, conjugation)
    "missingWord"  — a required CONTENT word (noun, verb, adjective, adverb, article, pronoun, preposition, conjunction, particle) was omitted
    "syntax"       — clause structure or PUNCTUATION: missing/extra comma, missing period, missing comma before a subordinate clause (e.g. before "weil", "dass", "que"), wrong sentence boundary, missing semicolon/colon. NEVER use "missingWord" for a missing punctuation mark — use "syntax".
- word (string): the specific fragment the issue is about, in the target language.
    - spelling   → the misspelled word the learner typed, verbatim
    - wrongWord  → the wrong word the learner typed, verbatim
    - wordOrder  → the misplaced word or short phrase from the learner's answer
    - wordForm   → the wrongly-inflected word the learner typed, verbatim
    - missingWord → the word that was omitted, in its correct target-language form
    - syntax     → the word adjacent to the punctuation problem (e.g. for a missing comma before "weil" → word = "weil"); never put a bare punctuation mark in this field
- comment (string): a SHORT explanation of THIS issue in the learner's native language. Names the problem, never prints the full expected answer.

Emit ONE issue per distinct error. If the same word has two problems (e.g. wrong case AND a typo), emit two issues. If the answer has many issues, list the most important ones first; max 4 issues.

LANGUAGE OF COMMENTS — ABSOLUTE, NON-NEGOTIABLE RULE.
Every "comment" field MUST be written in the prose of the learner's native language as given by "nativeLang". This rule overrides everything else.
- "Russian"  → write in Russian, in Cyrillic script (а-я, А-Я). The comment MUST contain Cyrillic letters.
- "English"  → write in English, in Latin script.
- "Polish"   → write in Polish, in Latin script with Polish diacritics (ą ć ę ł ń ó ś ź ż).
- "German"   → write in German, in Latin script with German diacritics (ä ö ü ß).

NEVER, under any circumstance, write the prose of a "comment" in:
- the target language
- a language not listed above for this nativeLang
- Chinese, Japanese, Korean, Hebrew, Arabic, Thai, or any other script that doesn't match the nativeLang's required script
- a mix of two natural languages

The ONLY exception: short target-language words may appear quoted inside the comment («like this» or "like this") when naming the exact form being discussed. The surrounding prose is still entirely in the native language.

SELF-CHECK before emitting the final JSON: re-read every "comment" you produced. For each one, confirm that the prose (not the quoted target words) is in the nativeLang. If any prose drifted into another language or script, REWRITE that comment in the correct native language before returning.

EXAMPLES (targetLang=German, nativeLang=Russian, given="Ich kaufe der Apfel"):
[
  { "category": "wordForm",  "word": "der",   "comment": "После kaufen нужен Akkusativ — артикль «den»." }
]

EXAMPLES (targetLang=German, nativeLang=English, given="Ich kafe den Apfel"):
[
  { "category": "spelling",  "word": "kafe",  "comment": "Misspelled — should be «kaufe» with «au»." }
]

EXAMPLES (targetLang=German, nativeLang=Russian, given="Nimm den Kassenbon weil der Preis falsch ist"):
[
  { "category": "syntax", "word": "weil", "comment": "Перед «weil» нужна запятая — это придаточное предложение." }
]

WRONG OUTPUT (do NOT produce this — nativeLang=Russian but the comment drifted into Chinese):
[
  { "category": "spelling", "word": "Gehe", "comment": "— 句子开头应大写。" }   ← FORBIDDEN
]
The same comment written correctly for nativeLang=Russian:
[
  { "category": "spelling", "word": "Gehe", "comment": "С заглавной буквы — начало предложения." }
]

EXAMPLES (targetLang=French, nativeLang=English, given="Je suis allé au marché hier"):
[]   (correct, no issues)

FAITHFULNESS — describe the ACTUAL error; never invent one.
Before composing a comment, mentally diff "given" against "canonical" (or, when canonical is empty, against the plausible canonical you composed) and locate the EXACT difference. The comment must describe that real difference. Never:
- claim a feature is wrong when it is already correct in "given" (e.g. saying "needs double f" when the learner already typed "ff")
- invent a generic spelling/grammar rule that doesn't apply to this specific error
- describe a mistake the learner didn't actually make

For SPELLING issues: point at the specific differing characters. If only a vowel differs, name the vowel; if only a doubled consonant is missing, name the consonant. Do NOT comment on parts of the word that are already correct.

WRONG OUTPUT (do NOT produce this — given="Koffee", canonical="Kaffee"; the only difference is the vowel "o" vs "a", but the comment fabricates rules about "ff" and the trailing "e"):
[
  { "category": "spelling", "word": "Koffee", "comment": "Ошибка в написании — «Kaffee» пишется с двойным «ff» и одним «e» в конце." }   ← FORBIDDEN (both claims are unrelated to the actual error)
]
The same case written correctly:
[
  { "category": "spelling", "word": "Koffee", "comment": "Не та гласная — нужна «a», а не «o»." }
]

OTHER RULES:
- Each comment: short, max 14 words.
- Never reveal the full expected answer verbatim; hint at the issue, don't print the solution. Naming the single corrective letter / form is fine — that is not "revealing" the answer.
- "word" must come from (or be relevant to) the learner's "given" answer or the missing target word — never paraphrase it.

Be strict but fair. When in doubt, prefer "correct: true" only if the answer would be understood by a fluent speaker of the target language without confusion.`;

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    correct: { type: 'boolean' },
    issues: {
      // Cap enforced in the prompt, not the schema: Anthropic's structured-
      // output validator rejects `maxItems` on arrays.
      type: 'array',
      items: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            enum: ['spelling', 'wrongWord', 'wordOrder', 'wordForm', 'missingWord', 'syntax'],
          },
          word: { type: 'string' },
          comment: { type: 'string' },
        },
        required: ['category', 'word', 'comment'],
        additionalProperties: false,
      },
    },
  },
  required: ['correct', 'issues'],
  additionalProperties: false,
} as const;

// ---- handler ---------------------------------------------------------------

export async function POST(req: Request): Promise<NextResponse> {
  // Rate limit per IP
  const rl = checkRateLimit(clientKey(req));
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'rate_limited' },
      { status: 429, headers: { 'retry-after': String(rl.retryAfterSec ?? 60) } },
    );
  }

  // Parse + validate
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (
    typeof body.given !== 'string' ||
    typeof body.canonical !== 'string' ||
    typeof body.nativeLang !== 'string' ||
    !['ru', 'en', 'pl', 'de'].includes(body.nativeLang) ||
    typeof body.targetLang !== 'string' ||
    !['de', 'fr', 'es', 'sr', 'ka', 'he', 'en', 'it'].includes(body.targetLang)
  ) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  // Belt-and-suspenders: re-run the cheap exact check before paying for an LLM
  // call. Skip the local check entirely when there's no canonical — the model
  // is doing open-ended judging in that case and exact-match is moot.
  if (body.canonical) {
    const local = checkAgainst(body.given, body.canonical, body.alternates ?? []);
    if (local.correct) {
      return NextResponse.json<ResponseBody>({ correct: true, issues: [] });
    }
  }

  // Build the AI call. Put targetLang/nativeLang first so the model reads the
  // language directives before anything else.
  const nativeLabel = NATIVE_LANG_LABELS[body.nativeLang];
  const payload = JSON.stringify({
    targetLang: TARGET_LANG_LABELS[body.targetLang],
    nativeLang: nativeLabel,
    context: body.context ?? '',
    prompt: body.prompt ?? '',
    canonical: body.canonical,
    alternates: body.alternates ?? [],
    given: body.given,
  });
  // Per-request reminder. The system prompt is shared and prompt-cached; this
  // line lives in the un-cached user message so the actual language name lands
  // in the model's recent context window. Past Claude drift symptom: comments
  // sometimes came back in Chinese for a Russian learner.
  const userMsg = `${payload}\n\nLANGUAGE REMINDER: every "comment" in your response MUST be written in ${nativeLabel}. Re-read each one before emitting and rewrite any comment that drifted into another language.`;

  try {
    const client = getAnthropic();
    const response = await client.messages.create({
      model: ANSWER_JUDGE_MODEL,
      max_tokens: 200,
      // Prompt-cache the system block. Stable across every request → cache hit
      // on every call after the first.
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      // Guarantee a parseable JSON response in the first text block.
      output_config: {
        format: {
          type: 'json_schema',
          schema: RESPONSE_SCHEMA,
        },
      },
      messages: [{ role: 'user', content: userMsg }],
    } as Anthropic.MessageCreateParamsNonStreaming);

    // The first text block is guaranteed to be valid JSON per the schema.
    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return NextResponse.json<ResponseBody>(
        { correct: false, issues: [] },
        { status: 200 },
      );
    }
    const parsed = JSON.parse(textBlock.text) as ResponseBody;
    return NextResponse.json<ResponseBody>(parsed);
  } catch (err) {
    // Typed exception narrowing from the SDK
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
