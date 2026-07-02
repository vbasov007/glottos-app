import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { getAnthropic, EXERCISE_GEN_MODEL } from '../../../lib/anthropic';
import { getLesson } from '../../../lib/content';
import { checkRateLimit, clientKey } from '../../../lib/rate-limit';
import { COURSES } from '../../../lib/content-types';
import type {
  CourseSlug,
  Exercise,
  ExerciseAnswer,
  ExercisePrompt,
  NativeLang,
  TargetLang,
} from '../../../lib/content-types';

export const runtime = 'nodejs';

interface RequestBody {
  /** 3-part course key: `${course}.${target}.${native}`. Old 2-part keys
   *  (target.native) are accepted for backwards compat — they fall back to
   *  the canonical classic50 course. */
  courseKey: string;
  /** Explicit course slug. When present, takes precedence over whatever is
   *  parsed from courseKey. */
  course?: string;
  lessonN: number;
  nativeLang: NativeLang;
  /** Exercise mode. Default 'writing': learner sees native prompt, types
   *  target. 'listening': learner hears target audio, types target. */
  mode?: 'writing' | 'listening';
  /** Difficulty 1..10 on the "absolute beginner → native speaker" scale.
   *  Each click of "Generate exercise" in the UI bumps this by 1. */
  difficulty?: number;
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

// course.target.native (3-part, new format) or target.native (legacy 2-part).
// Captures vary by format: 3-part puts course in group 1; 2-part has no course.
const COURSE_KEY_PATTERN_3 = /^([a-z0-9_-]{3,32})\.([a-z]{2,8})\.([a-z]{2,8})$/;
const COURSE_KEY_PATTERN_2 = /^([a-z]{2,8})\.([a-z]{2,8})$/;

// Difficulty knob — 1..10 on an "absolute-beginner-to-native" scale. The UI
// starts at 1 and increments by 1 on each "Generate exercise" click. Returns
// 5 (a comfortable middle) when the parameter is missing or out of range so
// legacy callers and odd inputs get a sensible baseline rather than failing.
function clampDifficulty(d: unknown): number {
  if (typeof d !== 'number' || !Number.isFinite(d)) return 5;
  return Math.max(1, Math.min(10, Math.round(d)));
}

// Per-level rubric injected into the system prompt. The phrasing is qualitative
// because the model interprets it across the four dimensions that drive
// learner difficulty: sentence length, vocabulary frequency, grammar complexity,
// and ambiguity / idiomaticity.
function difficultyRubric(d: number): string {
  // Anchors for level 1 (absolute beginner) and level 10 (native).
  const anchors: Record<number, string> = {
    1: 'Absolute-beginner level. Sentences of 3–5 words. Highest-frequency vocabulary only (the ~200 most common words in the language). Present tense only, simple SVO. No subordination, no idioms, no implied subjects beyond explicit pronouns. Aim like a children\'s first-reader.',
    2: 'Strong A1. Sentences of 4–6 words. Top ~500 words. Present and very common past forms. Coordination with "and" / "but" is OK; no subordinate clauses. Vocabulary stays concrete and everyday.',
    3: 'Late A1 / early A2. Sentences of 5–8 words. Top ~1000 words. Past and future appear naturally. One subordinate clause max per sentence ("when X", "because X"). Still mostly concrete; light idioms only.',
    4: 'A2. Sentences of 6–10 words. Common modal verbs, common prepositional phrases, basic comparative. Up to one subordinate clause. Occasional common idiom (the equivalent of "no problem", "see you later").',
    5: 'Strong A2 / B1. Sentences of 7–12 words. Mix tenses naturally. Subordinate clauses with "that / when / if / because" are normal. Pronoun anaphora across the sentence. A few common idioms and discourse markers ("by the way", "actually").',
    6: 'B1. Sentences of 8–14 words. Hypothetical conditionals, indirect speech, common relative clauses. Vocabulary extends into abstract everyday domains (feelings, opinions, plans, work). Idiomatic chunks expected.',
    7: 'Strong B1 / early B2. Sentences of 10–16 words. Multi-clause sentences are routine. Less-common tenses (perfect, pluperfect, subjunctive where the language uses one) appear naturally. Vocabulary includes journalistic and analytical words.',
    8: 'B2. Sentences of 12–20 words. Nested subordination, register-aware word choices, fixed expressions and collocations. Idioms and figurative language appear. Some sentences feel like newspaper headlines or essay prose.',
    9: 'C1. Long, syntactically dense sentences (15–25+ words). Nominalisations, passive voice, formal register, dependent infinitives. Rich idiomatic and figurative language. Vocabulary clearly above everyday: literary, technical, or rhetorical.',
    10: 'Native-speaker / C2. No constraint on length or register. Cultural references, slang, dialectal variants, wordplay, double meanings, and idioms a native uses without thinking. Sentences a learner would have to puzzle through, not skim. Make the learner sweat.',
  };
  return anchors[d] ?? anchors[5]!;
}

// Built per target so cached system messages are keyed per language —
// each target has its own ephemeral cache entry that warms independently.
// The illustrative examples remain in German because the model has the
// strongest in-context grasp of German shape; the rules above tell the
// model to translate the SHAPE to the actual target language for output.
function buildSystemPrompt(target: TargetLang, difficulty: number): string {
  const T = TARGET_LANG_LABEL[target];
  return `You generate fresh ${T} practice exercises for adult learners. Output strict JSON matching the schema you are given.

DIFFICULTY LEVEL ${difficulty}/10 — calibrate the entire exercise to this level:
${difficultyRubric(difficulty)}

The goal is to STRETCH the learner at the chosen level — items should feel challenging FOR THAT LEVEL, not flashcard-easy. Keep the grammar achievable for the level, but reach the upper end of the difficulty band described above.

OUTPUT CONTRACT — read carefully, deviations make the exercise broken:

1) Produce EXACTLY 10 items.

2) Each item has:
   - "prompt": a scenario, mini-dialogue cue, transformation request, or short situation WRITTEN ENTIRELY IN THE LEARNER'S NATIVE LANGUAGE.
   - "canonical": a SINGLE, COMPLETE, GRAMMATICALLY CORRECT ${T} sentence — the answer the learner should type.
   - "alternates": other equally-correct ${T} sentences (synonyms / word-order variants / formality variants when the prompt allows them). Empty array if there is genuinely only one good answer.

3) The "prompt" MUST NOT contain any ${T} text, ${T} skeleton sentence, or any "___" blank. The learner types the FULL ${T} sentence from scratch — they are NOT filling a blank in a pre-written frame. (Quoted ${T} proper nouns like names, place names, or brand names that the canonical needs verbatim are OK.)

4) The "prompt" must unambiguously imply ONE correct ${T} sentence (allowing for the "alternates" list). In particular:

   (a) ROLE — name who is SPEAKING (default: the learner) and who is being ADDRESSED, so the learner can pick the right verb form, pronoun, and politeness register without guessing. ${T} distinguishes (per its grammar) 1st-/2nd-/3rd-person, singular vs plural, formal vs informal addressee where it applies, and grammatical gender of speaker / addressee where it applies. The prompt must give the learner enough information to choose correctly. Concrete framings (native = Russian):
       - "Ты говоришь жене / мужу / брату / другу / маме …"     → speaker = 1sg, addressee = informal singular.
       - "Ты говоришь коллеге / начальнику / клиенту / врачу …" → speaker = 1sg, addressee = formal singular.
       - "Вы с женой / с друзьями обсуждаете …"                 → speaker = 1pl.
       - "Спроси у двух туристов / у детей …"                   → addressee = informal plural.
       Use the equivalent framings in English / Polish prompts. Never write a bare "Say that …" / "Ask whether …" / "Скажи, что …" without the role marker — the learner shouldn't have to guess between 1sg and 1pl, or between informal and formal addressee.

   (b) THIRD-PERSON REFERENT — when the canonical uses a third-person pronoun, NAME the referent in the prompt (Anna, the brother, the parents, the car, …) so the learner can pick the right pronoun and verb form. Don't say "ask whether he comes" without saying who "he" is, and don't say "tell that they live in Berlin" without saying who "they" are.

   (c) DATA — don't require information the learner can't guess. "Tell your friend the time is 4:35pm" only works if 4:35pm is restated verbatim in the prompt.

5) VARIETY — the 10 items must span at least FOUR of these styles (no more than 4 of any one style):
   (a) Express a fact or intent: "Tell your colleague that ..."
   (b) Reply in a mini-dialogue: "Your friend asks 'X' — answer that ..."
   (c) Ask a question (formal or informal): "Ask the waiter (formally) whether ..."
   (d) Transform / rephrase: "Make this polite", "Put this in the past", "Rewrite as a question"
   (e) Combine two ideas into one sentence with a connector (because / and / but / then / therefore / when — use the natural ${T} form)
   (f) Describe a short scenario: "It is raining and you forgot your umbrella — tell your wife you'll take the bus today."
   (g) Negate or contradict: "Disagree with X and offer the opposite"

6) LENGTH AND DIFFICULTY:
   - Aim for canonical ${T} answers of 6–14 words on average. Mix shorter (~4 words) and longer (~15 words) items so the set feels varied.
   - Use common modal verbs (the ${T} equivalents of can / must / may / want), time/place adverbials, and simple subordinate clauses where natural.
   - The grammatical focus implied by the lesson title MUST appear in most items, but 1–3 items may stretch into adjacent grammar the learner is likely to have met before (basic past tense, common modals, frequent prepositions).

7) VOCABULARY:
   - Prefer the supplied "vocab" list when the prompt calls for it, but you may use everyday function words and common high-frequency vocabulary not in the list (articles, prepositions, common verbs like to be / to have / to go / to come, numbers, days, weather).
   - Do not introduce specialised or low-frequency vocabulary the learner couldn't reasonably guess.

8) Do NOT duplicate (or be a case-insensitive substring of) any entry in "existingPrompts".

9) GOOD vs BAD examples — the canonicals below are shown in German for illustrative SHAPE; your actual canonicals must be in ${T}. The native-language prompts can stay verbatim:

   GOOD — varied styles, full sentences, no skeletons:
     prompt          = "Скажи коллеге, что встреча начинается в десять и закончится примерно в полдень."
     canonical (de)  = "Die Besprechung fängt um zehn Uhr an und endet ungefähr am Mittag."
     → produce the equivalent natural sentence in ${T}.

   GOOD — mini-dialogue reply (if the quoted question is in ${T}, keep it verbatim; otherwise restate it in ${T}):
     prompt          = "Кассир спрашивает: «Möchten Sie eine Tüte?» Ответь вежливо, что нет, у тебя своя сумка."
     canonical (de)  = "Nein danke, ich habe eine eigene Tasche."

   GOOD — transformation:
     prompt          = "Перепиши вопрос «Wie heißt du?» в вежливой форме."
     canonical (de)  = "Wie heißen Sie?"

   GOOD — combine ideas with a connector:
     prompt          = "Скажи мужу, что не пойдёшь в магазин, потому что идёт дождь."
     canonical (de)  = "Ich gehe nicht einkaufen, weil es regnet."

   GOOD — speaker + addressee explicit, formal:
     prompt          = "Спроси у начальника, может ли он перенести встречу на четверг."
     canonical (de)  = "Können Sie die Besprechung auf Donnerstag verschieben?"

   GOOD — third-person referent named:
     prompt          = "Расскажи о сестре: она учит французский и хорошо готовит."
     canonical (de)  = "Meine Schwester lernt Französisch und kocht gut."

   GOOD — first-person plural made explicit:
     prompt          = "Вы с женой решили: в субботу едете в горы."
     canonical (de)  = "Am Samstag fahren wir in die Berge."

   BAD (speaker + addressee unclear — could be 1sg or 1pl, informal or formal):
     prompt          = "Скажи, что не любишь рано вставать."

   BAD (third-person referent missing — masculine or feminine?):
     prompt          = "Скажи, что он/она работает в Берлине."

   BAD (target-language skeleton in prompt — DO NOT DO THIS):
     prompt          = "Сколько тебе лет? — [target sentence with ___]"

   BAD (blank in prompt — DO NOT DO THIS):
     prompt          = "[target sentence with ___]"

   BAD (ambiguous — many ${T} sentences would be valid):
     prompt          = "Поприветствуй кого-нибудь."

10) Sentences must be natural, conversational, and grade-school-appropriate ${T}.`;
}

// Listening-mode system prompt: learner hears a TTS playback of the target
// sentence and transcribes it back. There is no native prompt — the model
// produces 10 self-contained ${T} sentences that are unambiguous to transcribe.
function buildListeningSystemPrompt(target: TargetLang, difficulty: number): string {
  const T = TARGET_LANG_LABEL[target];
  return `You generate fresh ${T} listening / dictation exercises for adult learners. Output strict JSON matching the schema you are given.

DIFFICULTY LEVEL ${difficulty}/10 — calibrate every canonical sentence to this level:
${difficultyRubric(difficulty)}

The learner will hear a text-to-speech rendering of each sentence and type it back. There is no native-language prompt — the sentence itself is the entire exercise.

OUTPUT CONTRACT — read carefully, deviations make the exercise broken:

1) Produce EXACTLY 10 items.

2) Each item has:
   - "prompt": ALWAYS the empty string "". (Listening exercises have no native-language prompt.)
   - "canonical": a SINGLE, COMPLETE, GRAMMATICALLY CORRECT ${T} sentence — what the learner will hear and transcribe.
   - "alternates": homophone / punctuation-variant equally-acceptable transcriptions of the SAME spoken sentence (e.g. "il a deux ans" vs "il a 2 ans" in French; "I'll go" vs "I will go" in English). Empty array if the spoken form is unambiguous in spelling.

3) The "canonical" must be CLEAR WHEN SPOKEN ALOUD:
   - Use everyday vocabulary the learner has met.
   - Avoid homophones / ambiguous spellings unless you list both spellings in "alternates".
   - Avoid sentences whose meaning depends on punctuation that is impossible to hear (e.g. parenthetical asides).
   - 5–12 words is the sweet spot; mix shorter (3–5) and longer (12–15) for variety.

4) VARIETY — the 10 items should span: short statements, short questions, requests, mini-instructions, numbers / times / dates, common idiomatic chunks. Don't make 10 declaratives in a row.

5) Use the lesson's grammar focus where it fits naturally — but everyday vocabulary is fine even if not on the explicit vocab list. The point is dictation practice, not vocab quiz.

6) Do NOT duplicate (or be a case-insensitive substring of) any entry in "existingPrompts".

7) Sentences must be natural, conversational, and grade-school-appropriate ${T}.`;
}

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    heading: { type: 'string' },
    instruction: { type: 'string' },
    items: {
      // Claude structured output rejects minItems > 1; the system prompt asks
      // for exactly 10 and we trim/pad server-side.
      type: 'array',
      items: {
        type: 'object',
        properties: {
          prompt: { type: 'string' },
          canonical: { type: 'string' },
          alternates: { type: 'array', items: { type: 'string' } },
        },
        required: ['prompt', 'canonical', 'alternates'],
        additionalProperties: false,
      },
    },
  },
  required: ['heading', 'instruction', 'items'],
  additionalProperties: false,
} as const;

interface ModelItem {
  prompt: string;
  canonical: string;
  alternates: string[];
}

interface ModelResponse {
  heading: string;
  instruction: string;
  items: ModelItem[];
}

export async function POST(req: Request): Promise<NextResponse> {
  const rl = checkRateLimit(`gen:${clientKey(req)}`, 10);
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
  const m3 = typeof body.courseKey === 'string' ? body.courseKey.match(COURSE_KEY_PATTERN_3) : null;
  const m2 = typeof body.courseKey === 'string' ? body.courseKey.match(COURSE_KEY_PATTERN_2) : null;
  if (
    (!m3 && !m2) ||
    typeof body.lessonN !== 'number' ||
    !Number.isFinite(body.lessonN) ||
    body.lessonN < 1 ||
    body.lessonN > 50 ||
    !['ru', 'en', 'pl'].includes(body.nativeLang)
  ) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  // Prefer explicit body.course when present; otherwise derive from courseKey.
  // Legacy 2-part keys fall back to "classic50".
  const courseSlug = (typeof body.course === 'string' && body.course)
    || (m3 ? m3[1]! : 'classic50');
  if (!COURSES.some((c) => c.slug === courseSlug)) {
    return NextResponse.json({ error: 'bad_course' }, { status: 400 });
  }
  const target = (m3 ? m3[2]! : m2![1]!) as TargetLang;
  const native = (m3 ? m3[3]! : m2![2]!) as NativeLang;
  const mode: 'writing' | 'listening' =
    body.mode === 'listening' ? 'listening' : 'writing';
  const difficulty = clampDifficulty(body.difficulty);

  let lesson;
  try {
    lesson = getLesson(courseSlug as CourseSlug, target, native, body.lessonN);
  } catch {
    return NextResponse.json({ error: 'lesson_not_found' }, { status: 404 });
  }

  // Existing prompts: flat list of strings the model must avoid duplicating.
  const existingPrompts: string[] = [];
  for (const ex of lesson.exercises) {
    for (const p of ex.prompts) {
      if (p.text) existingPrompts.push(p.text);
    }
  }

  // Compact vocab payload: just German + native.
  const vocab = lesson.vocab.map((v) => ({
    de: v.gender ? `${v.gender} ${v.german}` : v.german,
    native: v.native,
  }));

  const userMsg = JSON.stringify(
    {
      targetLanguage: TARGET_LANG_LABEL[target],
      nativeLanguage: NATIVE_LANG_LABEL[body.nativeLang],
      lessonTitle: lesson.title,
      lessonTheme: lesson.vocabSubtitle ?? '',
      vocab,
      existingPrompts,
    },
    null,
    0,
  );

  try {
    const client = getAnthropic();
    const response = await client.messages.create({
      model: EXERCISE_GEN_MODEL,
      max_tokens: 4000,
      system: [
        {
          type: 'text',
          text: mode === 'listening'
            ? buildListeningSystemPrompt(target, difficulty)
            : buildSystemPrompt(target, difficulty),
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
    let parsed: ModelResponse;
    try {
      parsed = JSON.parse(textBlock.text) as ModelResponse;
    } catch {
      return NextResponse.json({ error: 'malformed_response' }, { status: 502 });
    }

    if (!Array.isArray(parsed.items) || parsed.items.length === 0) {
      return NextResponse.json({ error: 'no_items' }, { status: 502 });
    }
    // Defensive filter: drop any item the model produced that still slipped a
    // "___" blank into the prompt (the contract forbids it but models drift).
    // Writing mode requires a non-empty native prompt; listening mode forbids
    // one — the canonical IS the exercise.
    const items = parsed.items
      .filter(
        (it) =>
          it &&
          typeof it.prompt === 'string' &&
          typeof it.canonical === 'string' &&
          it.canonical.trim().length > 0 &&
          (mode === 'listening' || it.prompt.trim().length > 0) &&
          !/_{2,}/.test(it.prompt),
      )
      .slice(0, 10);
    if (items.length < 5) {
      return NextResponse.json({ error: 'too_few_items' }, { status: 502 });
    }

    const slug = `gen-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`;
    const prompts: ExercisePrompt[] = items.map((it) => ({ text: it.prompt }));
    const answers: ExerciseAnswer[] = items.map((it) => ({
      canonical: it.canonical,
      alternates: Array.isArray(it.alternates) ? it.alternates : [],
      note: null,
    }));

    const exercise: Exercise = {
      n: 0,
      heading: parsed.heading || 'AI Exercise',
      slug,
      instruction: parsed.instruction || null,
      prompts,
      answers,
      isOpenEnded: false,
      bodyMarkdown: '',
      mode,
    };

    return NextResponse.json({ exercise });
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
