import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getAnthropic, EXERCISE_GEN_MODEL } from '../../../lib/anthropic';
import { getLesson } from '../../../lib/content';
import { checkRateLimit, clientKey } from '../../../lib/rate-limit';
import { COURSES } from '../../../lib/content-types';
import type { CourseSlug, NativeLang, TargetLang } from '../../../lib/content-types';

export const runtime = 'nodejs';

// "One more like this" — generates a SINGLE additional prompt similar in
// grammar focus, register, and length to an example the learner just solved.
// Kept separate from /api/generate-exercise (which returns 10 items) because
// (1) round-trip cost matters when learners chain-click after each solve, and
// (2) the model behaves better when anchored to a specific example rather than
// asked to produce a varied 10-pack.

interface RequestBody {
  /** 3-part course key: `${course}.${target}.${native}`. */
  courseKey: string;
  course?: string;
  lessonN: number;
  nativeLang: NativeLang;
  /** The just-solved item the new prompt should resemble. */
  example: {
    /** Native-language prompt the learner saw. */
    prompt: string;
    /** Target-language canonical answer. */
    canonical: string;
  };
  /** Native-language prompts the learner has already practiced in this chain
   *  (the original + any prior "one more" items). The model must not repeat
   *  any of them as a substring. */
  existing?: string[];
}

interface ResponseBody {
  prompt: string;
  canonical: string;
  alternates: string[];
}

const NATIVE_LANG_LABEL: Record<NativeLang, string> = {
  ru: 'Russian',
  en: 'English',
  pl: 'Polish',
  de: 'German',
};

const TARGET_LANG_LABEL: Record<TargetLang, string> = {
  de: 'German',
  fr: 'French',
  es: 'Spanish',
  sr: 'Serbian',
  ka: 'Georgian',
  he: 'Hebrew',
  en: 'English',
  it: 'Italian',
};

const COURSE_KEY_PATTERN_3 = /^([a-z0-9_-]{3,32})\.([a-z]{2,8})\.([a-z]{2,8})$/;

function buildSystemPrompt(target: TargetLang): string {
  const T = TARGET_LANG_LABEL[target];
  return `You generate ONE additional ${T} practice item, similar in STYLE and GRAMMAR FOCUS to a worked example the learner just solved. Output strict JSON: { prompt, canonical, alternates }.

GOAL: give the learner more practice on the SAME pattern with DIFFERENT vocabulary / scenario, so they consolidate the rule.

You receive a user message with:
- targetLanguage / nativeLanguage
- lessonTitle / lessonTheme — what the lesson is teaching
- example: { prompt, canonical } — the item the learner just solved correctly
- existing: list of native-language prompts already shown in this practice chain — DO NOT repeat any of them, do not be a case-insensitive substring of any of them

OUTPUT CONTRACT — read carefully:

1) Same grammar focus as the example. If the example targets dative case, the new item must require dative case. If the example uses a subordinate clause with "weil" / "que" / "когда", the new item must use the same connector pattern. If the example uses an imperative form, keep the imperative.

2) Same register. If the example addresses the learner's husband/friend (informal singular), keep the new addressee informal singular. If the example addresses a boss/client (formal), keep formal. If the example is a 1pl ("we…"), keep 1pl.

3) Similar length and difficulty. Match the example's word count within ±3 words. Match the vocabulary register (do not switch from everyday vocabulary to academic, or vice versa).

4) DIFFERENT content. Change the topic, the third-person referents, the numbers/places/times. The learner must not be able to copy the example verbatim. (e.g. example about "buying an apple at the supermarket" → new item about "ordering coffee at a café"; example about "rain → take the bus" → new item about "snow → wear a coat".)

5) "prompt": native-language scenario / cue that unambiguously implies ONE target-language sentence:
   - Name the SPEAKER and the ADDRESSEE (e.g. "Скажи мужу, что …" / "Tell your colleague that …" / "Ask the waiter formally whether …") so the learner can pick the right pronoun, verb form, and politeness register.
   - NAME any third-person referent (Anna, the brother, the parents, …) when the canonical uses a third-person pronoun.
   - DO NOT include any ${T} skeleton sentence or "___" blank — the learner writes the FULL sentence from scratch.
   - DO NOT contain ${T} text except for quoted proper nouns the canonical needs verbatim.

6) "canonical": ONE complete, grammatically correct ${T} sentence — the model answer.

7) "alternates": other equally-correct ${T} sentences (synonyms / word-order variants / formality variants when the prompt allows them). Empty array if there is genuinely only one good answer.

8) Sentences must be natural, conversational, and grade-school-appropriate ${T}.`;
}

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    prompt: { type: 'string' },
    canonical: { type: 'string' },
    alternates: { type: 'array', items: { type: 'string' } },
  },
  required: ['prompt', 'canonical', 'alternates'],
  additionalProperties: false,
} as const;

export async function POST(req: Request): Promise<NextResponse> {
  const rl = checkRateLimit(`sim:${clientKey(req)}`, 30);
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

  const m = typeof body.courseKey === 'string' ? body.courseKey.match(COURSE_KEY_PATTERN_3) : null;
  if (
    !m ||
    typeof body.lessonN !== 'number' ||
    !Number.isFinite(body.lessonN) ||
    body.lessonN < 1 ||
    body.lessonN > 50 ||
    !['ru', 'en', 'pl'].includes(body.nativeLang) ||
    !body.example ||
    typeof body.example.prompt !== 'string' ||
    typeof body.example.canonical !== 'string' ||
    body.example.canonical.trim().length === 0
  ) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  const courseSlug = (typeof body.course === 'string' && body.course) || m[1]!;
  if (!COURSES.some((c) => c.slug === courseSlug)) {
    return NextResponse.json({ error: 'bad_course' }, { status: 400 });
  }
  const target = m[2]! as TargetLang;
  const native = m[3]! as NativeLang;

  let lesson;
  try {
    lesson = getLesson(courseSlug as CourseSlug, target, native, body.lessonN);
  } catch {
    return NextResponse.json({ error: 'lesson_not_found' }, { status: 404 });
  }

  const userMsg = JSON.stringify({
    targetLanguage: TARGET_LANG_LABEL[target],
    nativeLanguage: NATIVE_LANG_LABEL[body.nativeLang],
    lessonTitle: lesson.title,
    lessonTheme: lesson.vocabSubtitle ?? '',
    example: {
      prompt: body.example.prompt,
      canonical: body.example.canonical,
    },
    existing: Array.isArray(body.existing) ? body.existing.slice(0, 20) : [],
  });

  try {
    const client = getAnthropic();
    const response = await client.messages.create({
      model: EXERCISE_GEN_MODEL,
      max_tokens: 600,
      system: [
        {
          // Stable system block per target → prompt cache hits on every chain.
          type: 'text',
          text: buildSystemPrompt(target),
          cache_control: { type: 'ephemeral' },
        },
      ],
      output_config: {
        format: {
          type: 'json_schema',
          schema: RESPONSE_SCHEMA,
        },
      },
      messages: [{ role: 'user', content: userMsg }],
    } as Anthropic.MessageCreateParamsNonStreaming);

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return NextResponse.json({ error: 'empty_response' }, { status: 502 });
    }
    const parsed = JSON.parse(textBlock.text) as ResponseBody;
    if (
      !parsed.prompt ||
      !parsed.canonical ||
      /_{2,}/.test(parsed.prompt) ||
      parsed.canonical.trim().length === 0
    ) {
      return NextResponse.json({ error: 'malformed_response' }, { status: 502 });
    }
    return NextResponse.json<ResponseBody>({
      prompt: parsed.prompt,
      canonical: parsed.canonical,
      alternates: Array.isArray(parsed.alternates) ? parsed.alternates : [],
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
