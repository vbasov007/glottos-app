/**
 * Evaluate each German lesson's CEFR contribution and cache the result.
 *
 *   ANTHROPIC_API_KEY=… npm run cefr
 *
 * For each lesson (1..50) the script asks Claude Sonnet 4.6 to estimate, per
 * dimension (vocabulary + grammar), how many % of A1 / A2 / B1 / B2 / C1's
 * canonical syllabus this lesson covers. The model is told that the 50-lesson
 * curriculum is a roughly A1→B1 path, so most lessons will be A1-heavy with
 * tapering A2/B1 contributions and zeros at higher levels.
 *
 * Output lives at web/content/cefr-levels.json keyed by `de:<n>` (the German
 * content is identical across native langs, so one row per lesson).
 * Idempotent: existing entries are skipped unless FORCE=1 is set.
 */
import fs from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';

const ROOT = path.resolve(__dirname, '..');
const GENERATED_DIR = path.resolve(ROOT, 'content/.generated');
const CACHE_PATH = path.resolve(ROOT, 'content/cefr-levels.json');

// Use de.ru as the canonical source — the German title, vocab and prompts
// are the same across native langs.
const CANONICAL_COURSE = 'de.ru';
const MODEL = 'claude-sonnet-4-6';

const SYSTEM_PROMPT = `You are an experienced CEFR-aligned German curriculum designer. For a given lesson, estimate what fraction of the canonical CEFR syllabus this lesson covers, separately for vocabulary and grammar.

Output strict JSON matching the schema. Numbers are percentages (0-100). They represent: "this lesson contributes N% of the FULL A1 (or A2, etc.) vocabulary/grammar canon."

The full 50-lesson curriculum is designed to take a learner roughly from zero to mid-B1, so:
- Expect most lessons to have A1 contributions in the 1-6% range.
- A2 contributions typically appear from around lesson 10 onward.
- B1 contributions appear later (~lesson 25+).
- B2 and C1 contributions are usually 0 for this curriculum, occasionally a fraction of a percent for specialised vocab.
- Cumulative sums across all 50 lessons should approximate ~100% A1, ~50% A2, ~20% B1, near-zero B2/C1.

Lesson context is provided as: title, vocab list (German + native translation), and a sample of exercise prompts. Use this to judge level + scope.

Return integers (or one-decimal numbers if useful). Do not exceed reasonable per-lesson totals.`;

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    vocabulary: {
      type: 'object',
      properties: {
        A1: { type: 'number' },
        A2: { type: 'number' },
        B1: { type: 'number' },
        B2: { type: 'number' },
        C1: { type: 'number' },
      },
      required: ['A1', 'A2', 'B1', 'B2', 'C1'],
      additionalProperties: false,
    },
    grammar: {
      type: 'object',
      properties: {
        A1: { type: 'number' },
        A2: { type: 'number' },
        B1: { type: 'number' },
        B2: { type: 'number' },
        C1: { type: 'number' },
      },
      required: ['A1', 'A2', 'B1', 'B2', 'C1'],
      additionalProperties: false,
    },
  },
  required: ['vocabulary', 'grammar'],
  additionalProperties: false,
} as const;

type CefrLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1';
type CefrBreakdown = Record<CefrLevel, number>;
interface CefrEntry {
  vocabulary: CefrBreakdown;
  grammar: CefrBreakdown;
}
type CefrMap = Record<string, CefrEntry>;

interface LessonJson {
  n: number;
  title: string;
  vocabSubtitle?: string | null;
  vocab: { german: string; gender: string | null; native: string }[];
  exercises: { heading: string; prompts: { text: string }[] }[];
}

function loadCache(): CefrMap {
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8')) as CefrMap;
  } catch {
    return {};
  }
}

function saveCache(map: CefrMap): void {
  const ordered: CefrMap = {};
  for (const k of Object.keys(map).sort((a, b) => {
    const [, an] = a.split(':');
    const [, bn] = b.split(':');
    return parseInt(an!, 10) - parseInt(bn!, 10);
  })) {
    ordered[k] = map[k]!;
  }
  fs.writeFileSync(CACHE_PATH, JSON.stringify(ordered, null, 2) + '\n');
}

async function evaluateLesson(
  client: Anthropic,
  lesson: LessonJson,
): Promise<CefrEntry | null> {
  const context = {
    title: lesson.title,
    theme: lesson.vocabSubtitle ?? '',
    vocab: lesson.vocab.slice(0, 30).map((v) => ({
      de: v.gender ? `${v.gender} ${v.german}` : v.german,
      native: v.native,
    })),
    sampleExercises: lesson.exercises.slice(0, 3).map((ex) => ({
      heading: ex.heading,
      prompts: ex.prompts.slice(0, 3).map((p) => p.text),
    })),
  };

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 800,
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    output_config: {
      format: { type: 'json_schema', schema: RESPONSE_SCHEMA },
    },
    messages: [{ role: 'user', content: JSON.stringify(context) }],
  } as Anthropic.MessageCreateParamsNonStreaming);

  const block = res.content.find((b) => b.type === 'text');
  if (!block || block.type !== 'text') return null;
  try {
    return JSON.parse(block.text) as CefrEntry;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY not set.');
    process.exit(1);
  }
  const force = process.env.FORCE === '1';
  const cache = loadCache();
  const client = new Anthropic();

  const lessonsDir = path.resolve(GENERATED_DIR, CANONICAL_COURSE, 'lessons');
  if (!fs.existsSync(lessonsDir)) {
    console.error(`Missing ${lessonsDir}. Run npm run build:content first.`);
    process.exit(1);
  }

  let created = 0;
  let reused = 0;
  let failed = 0;

  for (let n = 1; n <= 50; n++) {
    const key = `de:${n}`;
    if (!force && cache[key]) {
      reused++;
      continue;
    }
    const file = path.join(lessonsDir, `${n}.json`);
    if (!fs.existsSync(file)) {
      console.log(`  ${key} (no lesson file, skipped)`);
      failed++;
      continue;
    }
    const lesson = JSON.parse(fs.readFileSync(file, 'utf8')) as LessonJson;
    process.stdout.write(`  ${key} … `);
    const entry = await evaluateLesson(client, lesson);
    if (!entry) {
      console.log('(failed)');
      failed++;
      continue;
    }
    cache[key] = entry;
    created++;
    console.log(
      `vocab A1:${entry.vocabulary.A1} A2:${entry.vocabulary.A2} B1:${entry.vocabulary.B1} ` +
        `· grammar A1:${entry.grammar.A1} A2:${entry.grammar.A2} B1:${entry.grammar.B1}`,
    );
    saveCache(cache);
  }

  saveCache(cache);
  console.log(`\nDone. ${created} new, ${reused} reused, ${failed} failed.`);
  if (created === 0 && failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
