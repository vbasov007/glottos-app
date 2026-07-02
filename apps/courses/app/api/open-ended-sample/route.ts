import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import crypto from 'node:crypto';
import { getAnthropic, ANSWER_JUDGE_MODEL } from '../../../lib/anthropic';
import { checkRateLimit, clientKey } from '../../../lib/rate-limit';
import type { NativeLang, TargetLang } from '../../../lib/content-types';

export const runtime = 'nodejs';

// ---- request / response shapes ---------------------------------------------

interface RequestBody {
  targetLang: TargetLang;
  nativeLang: NativeLang;
  lessonN: number;
  heading: string;
  instruction: string | null;
  body: string;
  prompts: string[];
}

interface SampleResponse {
  sentences: string[];
}

const TARGET_LABEL: Record<TargetLang, string> = {
  de: 'German',
  fr: 'French',
  es: 'Spanish',
  sr: 'Serbian',
  ka: 'Georgian',
  he: 'Hebrew',
  en: 'English',
  it: 'Italian',
};

const NATIVE_LABEL: Record<NativeLang, string> = {
  ru: 'Russian',
  en: 'English',
  pl: 'Polish',
  de: 'German',
};

// Cache the system block. Any byte change here breaks the prompt cache for
// every caller — keep iterations small.
const SYSTEM_PROMPT = `You generate "model answer" sentences for an OPEN-ENDED language-learning exercise — one that has no canonical answer in the lesson source, so the learner is supposed to speak aloud and move on.

You receive a single JSON object with:
- targetLang: the language being learned (e.g. "German"). All output sentences MUST be in this language.
- nativeLang: the learner's native language (e.g. "Russian"). Used only to read the body; you do NOT produce output in this language.
- heading: the exercise heading (often in the native language).
- instruction: optional one-line instruction (native language).
- body: the full exercise body markdown. May contain text in either the native language, the target language, or both.
- prompts: list of items already extracted from the body. When the exercise is a numbered list of target-language words / short phrases, prompts contains them verbatim. When the body is prose, prompts is usually empty.

Task: return a JSON object { "sentences": [...] }. Each item is a clean target-language string the learner can hear via TTS and use as a self-check.

How to decide what goes in "sentences":

1. If prompts is non-empty AND every prompt is already a clean target-language word or phrase (no leading numbers like "1." — the parser already strips those), return the prompts as-is, in order, deduplicated.

2. If the body already contains target-language sentences (a dialogue in target language, a paragraph in target, a list of target sentences), extract those sentences in reading order. Strip leading "—" / ">" markdown markers, strip bullet/list prefixes, strip code-fence wrappers. Keep punctuation that matters for TTS pronunciation. Drop lines that are entirely in the native language (those are instructions/glosses).

3. If the body is entirely in the native language and asks the learner to translate / describe / answer in target language (e.g. "Translate this dialogue", "Describe your hobbies in German"), produce a plausible MODEL TARGET-LANGUAGE ANSWER — a natural sequence of target-language sentences the learner could plausibly say. Match the body's register (formal vs informal addressee) and content. Length: 4 to 14 sentences.

4. NEVER mix native- and target-language sentences in the output. Every item must be target-language.

5. NEVER add quotation marks around items. Each sentence is a bare string suitable for direct TTS input.

6. Maximum 20 sentences total. Trim to the most useful ones if the source has more.

7. If the body is so short that there's nothing meaningful to read aloud, return an empty array — the UI will hide the panel.

Output strict JSON matching the schema.`;

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    sentences: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: ['sentences'],
  additionalProperties: false,
} as const;

// ---- in-memory cache ------------------------------------------------------

// Hash of the inbound payload — process-lifetime cache, same shape as
// /api/dictionary/details. Lost on redeploy; that's fine.
const cache = new Map<string, SampleResponse>();
function cacheKey(b: RequestBody): string {
  return crypto
    .createHash('sha1')
    .update(
      [
        b.targetLang,
        b.nativeLang,
        b.lessonN,
        b.heading,
        b.instruction ?? '',
        b.body,
        b.prompts.join('\n'),
      ].join('|'),
    )
    .digest('hex');
}

// ---- handler --------------------------------------------------------------

const VALID_TARGETS: TargetLang[] = ['de', 'fr', 'es', 'sr', 'ka', 'he', 'en', 'it'];
const VALID_NATIVES: NativeLang[] = ['ru', 'en', 'pl', 'de'];

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
    typeof body.heading !== 'string' ||
    typeof body.body !== 'string' ||
    !VALID_TARGETS.includes(body.targetLang) ||
    !VALID_NATIVES.includes(body.nativeLang) ||
    typeof body.lessonN !== 'number' ||
    !Array.isArray(body.prompts)
  ) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  // Sanitize prompts to strings.
  body.prompts = body.prompts.filter((s): s is string => typeof s === 'string');

  const key = cacheKey(body);
  const cached = cache.get(key);
  if (cached) {
    return NextResponse.json(cached, {
      headers: { 'cache-control': 'public, max-age=86400' },
    });
  }

  const userMsg = JSON.stringify({
    targetLang: TARGET_LABEL[body.targetLang],
    nativeLang: NATIVE_LABEL[body.nativeLang],
    lessonN: body.lessonN,
    heading: body.heading,
    instruction: body.instruction,
    body: body.body.slice(0, 6000), // belt-and-suspenders cap
    prompts: body.prompts.slice(0, 30),
  });

  try {
    const client = getAnthropic();
    const response = await client.messages.create({
      model: ANSWER_JUDGE_MODEL,
      max_tokens: 900,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      output_config: { format: { type: 'json_schema', schema: RESPONSE_SCHEMA } },
      messages: [{ role: 'user', content: userMsg }],
    } as Anthropic.MessageCreateParamsNonStreaming);

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return NextResponse.json({ error: 'no_content' }, { status: 502 });
    }
    const parsed = JSON.parse(textBlock.text) as SampleResponse;
    // Final guard: enforce array + clean strings.
    parsed.sentences = (parsed.sentences ?? [])
      .filter((s): s is string => typeof s === 'string')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s.length < 400);
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
