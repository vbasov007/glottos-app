import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getAnthropic, ANSWER_JUDGE_MODEL } from '../../../../lib/anthropic';
import { checkRateLimit, clientKey } from '../../../../lib/rate-limit';
import type { NativeLang, TargetLang } from '../../../../lib/content-types';

export const runtime = 'nodejs';

interface RequestBody {
  target: TargetLang;
  native: NativeLang;
  /** The entry's target-language headword (e.g. "die Stadt"). */
  german: string;
  /** Target-language sentences already shown — the generator avoids
   *  repeating them. Empty for the first "More" click. */
  existing: string[];
}

interface ExampleResponse {
  sentence: string;
  translation: string;
}

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

// Stable system prompt (cache-friendly). The "avoid these sentences" list
// goes into the user message so the cache hit stays warm.
const SYSTEM_PROMPT = `Produce one short, natural target-language example
sentence for a dictionary entry, plus a translation in the learner's
native language.

Input:
- target: target language label (e.g. "German")
- native: native language label (e.g. "Russian")
- word: the dictionary entry (e.g. "die Stadt", "Lust haben")
- existing: sentences already shown to the user — the new sentence MUST
  differ in subject, scene, and surface wording.

Rules:
- Sentence in the target language, ≤12 words, naturally use the entry
  in a way a learner could plausibly speak or read.
- Vary the grammatical context across calls (declarative, question,
  past tense, etc.) so the user sees the word in different shapes.
- Translation in the native language, accurate but idiomatic — not
  word-for-word.
- No proper nouns unless idiomatic. No quotation marks around the
  sentence.

Return STRICT JSON: { "sentence": "...", "translation": "..." }.`;

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    sentence: { type: 'string' },
    translation: { type: 'string' },
  },
  required: ['sentence', 'translation'],
  additionalProperties: false,
} as const;

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
    !['ru', 'en', 'pl'].includes(body.native) ||
    !Array.isArray(body.existing)
  ) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  // Cap "existing" so a runaway client can't blow up the prompt size.
  const existing = body.existing
    .filter((s) => typeof s === 'string')
    .slice(-12)
    .map((s) => s.slice(0, 200));

  const userMsg = JSON.stringify({
    target: TARGET_LANG_LABELS[body.target],
    native: NATIVE_LANG_LABELS[body.native],
    word: body.german,
    existing,
  });

  try {
    const client = getAnthropic();
    const response = await client.messages.create({
      model: ANSWER_JUDGE_MODEL,
      max_tokens: 200,
      system: [
        { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
      ],
      output_config: { format: { type: 'json_schema', schema: RESPONSE_SCHEMA } },
      messages: [{ role: 'user', content: userMsg }],
    } as Anthropic.MessageCreateParamsNonStreaming);
    const block = response.content.find((c) => c.type === 'text');
    if (!block || block.type !== 'text') {
      throw new Error('no text content');
    }
    const parsed = JSON.parse(block.text) as ExampleResponse;
    return NextResponse.json(parsed);
  } catch (err) {
    const e = err as Error;
    console.error('[api/dictionary/more-example] failed', { name: e.name, message: e.message });
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
