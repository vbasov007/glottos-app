import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getAnthropic, ANSWER_JUDGE_MODEL } from '../../../../lib/anthropic';
import { checkRateLimit, clientKey } from '../../../../lib/rate-limit';
import type { NativeLang, TargetLang } from '../../../../lib/content-types';

export const runtime = 'nodejs';

interface RequestBody {
  target: TargetLang;
  native: NativeLang;
  /** The entry's target-language headword the exercise must drill. */
  german: string;
}

interface PracticeResponse {
  /** Native-language prompt the learner must translate into the target. */
  prompt: string;
  /** Correct target-language translation, anchored on the headword's usage. */
  canonical: string;
  /** Acceptable variants — synonymous word orders, alternate inflections,
   *  optional articles where the canonical includes one, etc. */
  alternates: string[];
  /** Short grammar / usage tip in the native language. ≤15 words. Hidden
   *  by default behind a blur in the UI. */
  hint: string;
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

const SYSTEM_PROMPT = `Produce a tiny translation drill for one dictionary
entry. The goal is to give the learner one short sentence that forces
them to use the entry in a grammatically correct shape.

Input:
- target: target language
- native: learner's native language
- word: the dictionary entry (e.g. "die Stadt", "Lust haben", "fahren")

Return JSON with:
1) prompt — short native-language sentence (≤12 words) the learner has
   to translate INTO the target language. The sentence MUST require the
   target word in a non-trivial form (a specific case, tense, gender
   agreement, separable-prefix split, etc.). Plain dictionary citation
   shouldn't suffice — the user has to think about HOW to use it.
2) canonical — the expected target-language sentence in its standard
   form. Use natural register, proper punctuation, capitalisation as
   the target language requires.
3) alternates — 0 to 4 acceptable variations: alternate word orders,
   synonymous lexical choices, contracted forms ("am" vs "an dem"),
   without changing the grammar lesson being tested. Don't include
   the canonical itself.
4) hint — ≤15-word grammar/usage tip that names the trap. MUST be
   written in the LEARNER'S native language ("native" field), not in
   the target language and not in English (unless English IS the
   native). Examples by native:
     native=Russian: "Используй Dativ после 'mit'.", "Помни:
       отделяемая приставка уходит в конец.", "Род женский —
       прилагательное меняет окончание."
     native=Polish:  "Dativ po 'mit'.", "Przedrostek 'an' idzie na
       koniec zdania."
     native=German:  "Akkusativ nach 'durch'."
     native=English: "Use Dativ after 'mit'."
   Tells the user WHAT to think about without giving the answer word.

Avoid proper nouns. Stay one sentence. Aim for B1-level constructions
unless the word itself is more advanced.

Return STRICT JSON matching the schema. Don't add explanations.`;

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    prompt: { type: 'string' },
    canonical: { type: 'string' },
    alternates: { type: 'array', items: { type: 'string' } },
    hint: { type: 'string' },
  },
  required: ['prompt', 'canonical', 'alternates', 'hint'],
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
    !['ru', 'en', 'pl'].includes(body.native)
  ) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
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
      max_tokens: 400,
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
    const parsed = JSON.parse(block.text) as PracticeResponse;
    return NextResponse.json(parsed);
  } catch (err) {
    const e = err as Error;
    console.error('[api/dictionary/practice] failed', { name: e.name, message: e.message });
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
