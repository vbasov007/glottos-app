/**
 * Generate lesson / test / text markdown files for a (target, native) course
 * from a curriculum spec, using one already-authored lesson as the gold-standard
 * exemplar.
 *
 *   ANTHROPIC_API_KEY=… npx tsx web/scripts/build-course-content.ts \
 *     --target=fr --native=ru --from=2 --to=50 \
 *     --spec=/workspace/french_50_lessons_curriculum.md \
 *     --exemplar=1
 *
 * For each lesson N in [from..to] the script emits five files into
 * courses/<target>/<native>/:
 *   lessons/lesson_NN.md
 *   tests/test_NN.md
 *   texts/text_NN_a.md
 *   texts/text_NN_b.md
 *   texts/text_NN_c.md
 *
 * Idempotent — files that already exist on disk are skipped. Re-running the
 * script after a failure picks up only the missing artifacts.
 *
 * The curriculum spec is parsed by H3 headings (`### Lesson N — Title`). The
 * grammar / vocabulary / review / why-here lines under each heading are
 * extracted and fed to the model as the per-lesson brief.
 *
 * Model: Opus 4.7 with adaptive thinking and ephemeral prompt caching on the
 * system block (which holds the exemplar files + author guide). The system
 * block stays byte-stable across all calls in a run, so cache hit rate is
 * ~100% from lesson 2 onward, cutting input cost ~10x.
 */
import fs from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-opus-4-7';
const COURSES_ROOT = path.resolve(__dirname, '..', '..', 'courses');

type ArtifactKind = 'lesson' | 'test' | 'text_a' | 'text_b' | 'text_c';

interface LessonSpec {
  n: number;
  title: string;
  stageHeading: string;
  grammar: string;
  vocabulary: string;
  review: string;
  whyHere: string;
}

interface Args {
  target: string;
  native: string;
  from: number;
  to: number;
  spec: string;
  exemplar: number;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (k: string, fallback?: string): string => {
    const hit = argv.find((a) => a.startsWith(`--${k}=`));
    if (hit) return hit.slice(k.length + 3);
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing --${k}=…`);
  };
  return {
    target: get('target'),
    native: get('native'),
    from: parseInt(get('from', '2'), 10),
    to: parseInt(get('to', '50'), 10),
    spec: get('spec'),
    exemplar: parseInt(get('exemplar', '1'), 10),
  };
}

/**
 * Parse a curriculum-design spec (the kind found at
 * /workspace/french_50_lessons_curriculum.md). Returns one LessonSpec per
 * `### Lesson N — …` heading.
 */
function parseSpec(specMd: string): LessonSpec[] {
  const lines = specMd.split('\n');
  const lessons: LessonSpec[] = [];
  let currentStage = '';
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const stageMatch = line.match(/^##\s+(STAGE\s+\d+.*)$/i);
    if (stageMatch) {
      currentStage = stageMatch[1]!.trim();
      i++;
      continue;
    }
    const lessonMatch = line.match(/^###\s+Lesson\s+(\d+)\s*[—-]\s*(.+)$/);
    if (!lessonMatch) {
      i++;
      continue;
    }
    const n = parseInt(lessonMatch[1]!, 10);
    const title = lessonMatch[2]!.trim();
    let grammar = '';
    let vocabulary = '';
    let review = '';
    let whyHere = '';
    i++;
    while (i < lines.length && !/^###?\s/.test(lines[i]!)) {
      const l = lines[i]!;
      const g = l.match(/^-\s+\*\*Grammar:\*\*\s*(.+)$/);
      const v = l.match(/^-\s+\*\*Vocabulary:\*\*\s*(.+)$/);
      const r = l.match(/^-\s+\*\*Review:\*\*\s*(.+)$/);
      const w = l.match(/^-\s+\*\*Why here:\*\*\s*(.+)$/);
      if (g) grammar = g[1]!.trim();
      else if (v) vocabulary = v[1]!.trim();
      else if (r) review = r[1]!.trim();
      else if (w) whyHere = w[1]!.trim();
      i++;
    }
    lessons.push({ n, title, stageHeading: currentStage, grammar, vocabulary, review, whyHere });
  }
  return lessons;
}

function readExemplar(targetDir: string, n: number): {
  lesson: string;
  test: string;
  texts: { a: string; b: string; c: string };
  dictionary: string;
  curriculum: string;
} {
  const read = (p: string): string => fs.readFileSync(path.join(targetDir, p), 'utf8');
  const pad = (k: number): string => String(k).padStart(2, '0');
  return {
    lesson: read(`lessons/lesson_${pad(n)}.md`),
    test: read(`tests/test_${pad(n)}.md`),
    texts: {
      a: read(`texts/text_${pad(n)}_a.md`),
      b: read(`texts/text_${pad(n)}_b.md`),
      c: read(`texts/text_${pad(n)}_c.md`),
    },
    dictionary: read('dictionary.md'),
    curriculum: read('curriculum.md'),
  };
}

function systemPromptFor(
  kind: ArtifactKind,
  target: string,
  native: string,
  exemplar: ReturnType<typeof readExemplar>,
  exemplarN: number,
): string {
  const langName = ({ fr: 'French', es: 'Spanish', sr: 'Serbian', ka: 'Georgian', he: 'Hebrew', de: 'German' } as Record<string, string>)[target] ?? target;
  const nativeName = ({ ru: 'Russian', en: 'English', pl: 'Polish' } as Record<string, string>)[native] ?? native;

  const base = `You write structural language-course content in markdown for the Glottos Matrix system.

Target language: ${langName} (code: ${target})
Native (instruction) language: ${nativeName} (code: ${native})
All headings, explanations, and translations are in ${nativeName}. ${langName} appears only where it is the lesson material itself (vocabulary cells, example sentences, dialogues).

Your output is ONE markdown file. Emit raw markdown only — no \`\`\` fences, no commentary, no JSON, no preamble. Begin with the H1 line and finish at the end of the file.

Voice and tone match the exemplar exactly: terse, structural, mnemonic-driven, no waffle. The user is an adult learner in a hurry. Rules are taught through tables and contrasts, not paragraphs. Every section title and structural choice MUST mirror the exemplar.

Strict parser requirements (silent failures otherwise):
- H1 line exactly: \`# Урок N: <title>\` (or \`# Тест к уроку N: …\` / \`# Текст к уроку N: …\`)
- For lessons: H2 sections MUST use the exact phrases the parser recognizes in ${nativeName}: "Как работать", "Часть N: …", "Словарь", "Языковая гамма", "Языковая матрица", "Упражнения", "Памятка урока". Vocabulary inside the dedicated section, NOT mixed into Theory.
- For tests: exactly 30 numbered prompts followed by \`<details><summary>Ключи</summary>\` then 30 numbered keys with italicised canonical answers. Alternates in \`(или: alt1; alt2)\` form.
- For texts: 30 numbered sentences in the target language only, TTS-clean (no markdown, no brackets, no symbols TTS can't pronounce). End with a 2-column "Список слов и фраз" table.

The exemplar is Lesson ${exemplarN} of this same course. Copy its sectioning, register, exercise patterns, and table shapes. The lesson you are now writing has a different topic; same skeleton.`;

  const exemplarBlock: Record<ArtifactKind, string> = {
    lesson: `=== EXEMPLAR LESSON (Lesson ${exemplarN}) ===\n${exemplar.lesson}\n=== END EXEMPLAR ===`,
    test: `=== EXEMPLAR TEST (Test ${exemplarN}) ===\n${exemplar.test}\n=== END EXEMPLAR ===`,
    text_a: `=== EXEMPLAR TEXT A (Lesson ${exemplarN}, variant A) ===\n${exemplar.texts.a}\n=== END EXEMPLAR ===`,
    text_b: `=== EXEMPLAR TEXT B (Lesson ${exemplarN}, variant B) ===\n${exemplar.texts.b}\n=== END EXEMPLAR ===`,
    text_c: `=== EXEMPLAR TEXT C (Lesson ${exemplarN}, variant C) ===\n${exemplar.texts.c}\n=== END EXEMPLAR ===`,
  };

  return `${base}\n\n${exemplarBlock[kind]}\n\n=== COURSE CURRICULUM (for cross-lesson context) ===\n${exemplar.curriculum}\n=== END CURRICULUM ===`;
}

function userPromptFor(kind: ArtifactKind, spec: LessonSpec): string {
  const lesson = `Lesson ${spec.n} — ${spec.title}
Stage: ${spec.stageHeading}
Grammar topic: ${spec.grammar}
Vocabulary theme: ${spec.vocabulary}
Spaced-repetition recall this lesson should weave in: ${spec.review}
Why this lesson sits here in the sequence: ${spec.whyHere}`;

  const tailByKind: Record<ArtifactKind, string> = {
    lesson: `Write the full lesson markdown for Lesson ${spec.n}. 250–400 lines. Match the exemplar's structure: How-to-work block, Parts 1–N of theory with tables and traps, Vocabulary table (with article + gender markers in column 2 for every noun), Exercises section (5–7 exercises, each with a hidden Ключ block in <details>), and a Памятка cheat sheet in a code block at the end. Add Language scale + Language matrix sections (one each minimum) only if the lesson has any verb / declension paradigm to drill — Lesson 1-type alphabet lessons typically skip these.`,
    test: `Write test_${String(spec.n).padStart(2, '0')}.md for Lesson ${spec.n}. Exactly 30 prompts in Russian translating the lesson's grammar + vocabulary. Each key italicised; provide alternates in (или: …; …) whenever a valid synonym or word-order variant exists.`,
    text_a: `Write text_${String(spec.n).padStart(2, '0')}_a.md — the BASIC variant. 30 sentences, the simplest scenario covering the lesson's vocabulary head-on. End with a Список слов и фраз table.`,
    text_b: `Write text_${String(spec.n).padStart(2, '0')}_b.md — the EXPANDED variant. 30 sentences. Same vocabulary, but a different scenario that introduces light variation: more verbs, more contexts, slightly richer phrasing.`,
    text_c: `Write text_${String(spec.n).padStart(2, '0')}_c.md — the DIALOGUE variant. 30 sentences forming a continuous dialogue or richer narrative scenario, using the lesson vocabulary in lively, conversational context.`,
  };

  return `${lesson}\n\n${tailByKind[kind]}`;
}

async function generate(
  client: Anthropic,
  kind: ArtifactKind,
  spec: LessonSpec,
  systemBlock: string,
): Promise<string> {
  // Hard per-request timeout so a silently-stalled stream can't block the
  // whole script forever. 5 minutes is well above the observed ~2 min p99.
  const PER_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;
  const work = (async () => {
    const stream = await client.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      thinking: { type: 'adaptive' },
      system: [
        { type: 'text', text: systemBlock, cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content: userPromptFor(kind, spec) }],
    });
    const message = await stream.finalMessage();
    const block = message.content.find((b) => b.type === 'text');
    if (!block || block.type !== 'text') throw new Error('No text block returned');
    return block.text.trim() + '\n';
  })();
  const timeout = new Promise<string>((_, reject) =>
    setTimeout(() => reject(new Error(`request timeout after ${PER_REQUEST_TIMEOUT_MS}ms`)), PER_REQUEST_TIMEOUT_MS),
  );
  return Promise.race([work, timeout]);
}

interface Outcome {
  lessonN: number;
  created: ArtifactKind[];
  reused: ArtifactKind[];
  failed: { kind: ArtifactKind; error: string }[];
}

async function processLesson(
  client: Anthropic,
  args: Args,
  spec: LessonSpec,
  exemplar: ReturnType<typeof readExemplar>,
  targetDir: string,
): Promise<Outcome> {
  const outcome: Outcome = { lessonN: spec.n, created: [], reused: [], failed: [] };
  const pad = (n: number): string => String(n).padStart(2, '0');
  const paths: Record<ArtifactKind, string> = {
    lesson: path.join(targetDir, 'lessons', `lesson_${pad(spec.n)}.md`),
    test: path.join(targetDir, 'tests', `test_${pad(spec.n)}.md`),
    text_a: path.join(targetDir, 'texts', `text_${pad(spec.n)}_a.md`),
    text_b: path.join(targetDir, 'texts', `text_${pad(spec.n)}_b.md`),
    text_c: path.join(targetDir, 'texts', `text_${pad(spec.n)}_c.md`),
  };

  const kinds = ['lesson', 'test', 'text_a', 'text_b', 'text_c'] as const;
  // Generate the 5 artifacts in parallel; they share the cached system block
  // but the user-message per call is independent so they can run concurrently.
  await Promise.all(
    kinds.map(async (kind) => {
      if (fs.existsSync(paths[kind])) {
        outcome.reused.push(kind);
        return;
      }
      const systemBlock = systemPromptFor(kind, args.target, args.native, exemplar, args.exemplar);
      try {
        const md = await generate(client, kind, spec, systemBlock);
        fs.writeFileSync(paths[kind], md);
        outcome.created.push(kind);
      } catch (e) {
        outcome.failed.push({ kind, error: (e as Error).message });
      }
    }),
  );
  return outcome;
}

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY not set');
    process.exit(1);
  }
  const args = parseArgs();
  const targetDir = path.join(COURSES_ROOT, args.target, args.native);
  if (!fs.existsSync(targetDir)) {
    console.error(`Missing ${targetDir}. Author the exemplar lesson first.`);
    process.exit(1);
  }

  const specMd = fs.readFileSync(args.spec, 'utf8');
  const allLessons = parseSpec(specMd);
  console.log(`Parsed ${allLessons.length} lessons from ${path.basename(args.spec)}`);
  const exemplar = readExemplar(targetDir, args.exemplar);
  console.log(`Loaded exemplar lesson ${args.exemplar} (${exemplar.lesson.length} chars)`);

  const lessonsToRun = allLessons.filter((l) => l.n >= args.from && l.n <= args.to);
  console.log(`Generating lessons ${args.from}–${args.to} (${lessonsToRun.length} lessons × 5 artifacts = up to ${lessonsToRun.length * 5} calls)\n`);

  const client = new Anthropic();
  const startedAt = Date.now();
  let totalCreated = 0;
  let totalReused = 0;
  let totalFailed = 0;

  for (const spec of lessonsToRun) {
    const t0 = Date.now();
    process.stdout.write(`  L${spec.n}: ${spec.title.slice(0, 60)} … `);
    const outcome = await processLesson(client, args, spec, exemplar, targetDir);
    totalCreated += outcome.created.length;
    totalReused += outcome.reused.length;
    totalFailed += outcome.failed.length;
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(
      `${outcome.created.length} new, ${outcome.reused.length} reused, ${outcome.failed.length} failed (${dt}s)`,
    );
    if (outcome.failed.length) {
      for (const f of outcome.failed) console.log(`    ✗ ${f.kind}: ${f.error}`);
    }
  }
  const elapsedMin = ((Date.now() - startedAt) / 60000).toFixed(1);
  console.log(
    `\nDone in ${elapsedMin} min. Created ${totalCreated}, reused ${totalReused}, failed ${totalFailed}.`,
  );
  if (totalFailed > 0) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
