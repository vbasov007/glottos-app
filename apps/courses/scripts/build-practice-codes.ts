/**
 * Generate a polyGlottos workspace for each lesson's practice exercises, so
 * the learner can drop the lesson's target-language sentences into glottos.com
 * and study them there.
 *
 *   POLYGLOTTOS_API_KEY=… npm run practice
 *
 * Filters:
 *   COURSE=losreden50    only this course
 *   TARGET=de,fr         only these targets
 *   NATIVE=ru,en         only these natives
 *   MAX_LESSON=3         only lessons 1..3
 *
 * Cache file: web/content/practice-codes.json, keyed by
 *   `<course>:<target>:<native>:<lessonN>`.
 * Same idempotent pattern as scripts/build-vocab-codes.ts.
 *
 * The text body is the lesson's canonical answers — one per line, in the
 * target language. Phrases are vocab lemmas found inside the body (case-
 * sensitive substring), falling back to long content words if no vocab
 * matches. Open-ended exercises (no canonical) contribute nothing.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
const GENERATED_DIR = path.resolve(ROOT, 'content/.generated');
const CACHE_PATH = path.resolve(ROOT, 'content/practice-codes.json');
const MANIFEST_PATH = path.resolve(GENERATED_DIR, 'manifest.json');

const ENDPOINT = 'https://t.glottos.com/api/create-shared';
const MAX_PHRASES = 30;

// Same prefix stripper as build-share-codes so vocab lemmas like "der Abend"
// match the bare "Abend" that appears in the answer line.
const ARTICLE_PREFIX = /^(der|die|das|sich|le|la|les|l'|un|une|des|el|los|las|unos|unas|se)\s+/i;

interface ExerciseAnswer {
  canonical: string;
  alternates: string[];
  note: string | null;
}

interface Exercise {
  n: number;
  isOpenEnded: boolean;
  answers: ExerciseAnswer[];
}

interface LessonVocab {
  german: string;
  gender: string | null;
  native: string;
}

interface LessonJson {
  n: number;
  title: string;
  exercises: Exercise[];
  vocab: LessonVocab[];
}

interface ManifestCourse {
  course: string;
  courseKey: string;
  target: string;
  native: string;
  lessonCount: number;
}

interface Manifest {
  courses: ManifestCourse[];
}

interface PracticeCodeMap {
  [key: string]: string;
}

function loadCache(): PracticeCodeMap {
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8')) as PracticeCodeMap;
  } catch {
    return {};
  }
}

function saveCache(map: PracticeCodeMap): void {
  const ordered: PracticeCodeMap = {};
  for (const k of Object.keys(map).sort()) ordered[k] = map[k]!;
  fs.writeFileSync(CACHE_PATH, JSON.stringify(ordered, null, 2) + '\n');
}

/**
 * Sanitize a canonical answer for the polyGlottos workspace text.
 * Source markdown often carries pedagogical markup that confuses the
 * shared workspace (and the TTS):
 *   - `**Der**` bold articles → keep "Der"
 *   - `*Der**` / `*den*` italics → keep inner text
 *   - `(N)` / `(A)` case markers and `(Nominativ — Wen?)` commentary → drop
 * Internal markdown is stripped here only for the polyGlottos send;
 * the canonical stored in lesson JSON keeps its full form so the
 * in-app auto-checker still accepts what the learner sees on screen.
 */
function sanitizeForGlottos(s: string): string {
  let r = s;
  // Strip bold ** ** wrappers — keep inner. Iterate to catch nested/unbalanced.
  r = r.replace(/\*\*([^*]+?)\*\*/g, '$1');
  // Strip italic * * / _ _ wrappers — keep inner.
  r = r.replace(/(?<![*\w])\*([^*\n]+?)\*(?!\w)/g, '$1');
  r = r.replace(/(?<![_\w])_([^_\n]+?)_(?!\w)/g, '$1');
  // Drop any remaining stray asterisks (e.g. broken "**" pairs).
  r = r.replace(/\*+/g, '');
  // Drop ALL parenthetical content — these are case markers, gender
  // notes, register tags, native-language commentary. Iterate for nesting.
  let prev: string;
  do {
    prev = r;
    r = r.replace(/\s*\([^()]*\)/g, '');
  } while (r !== prev);
  // Collapse multiple spaces.
  r = r.replace(/\s+/g, ' ').trim();
  return r;
}

function collectCanonicals(exercises: Exercise[]): string[] {
  const out: string[] = [];
  for (const ex of exercises) {
    if (ex.isOpenEnded) continue;
    for (const a of ex.answers) {
      const s = sanitizeForGlottos(a.canonical.trim());
      if (s) out.push(s);
    }
  }
  return out;
}

function derivePhrases(text: string, vocab: LessonVocab[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of vocab) {
    if (out.length >= MAX_PHRASES) break;
    const stripped = v.german.replace(ARTICLE_PREFIX, '').trim();
    const candidate = text.includes(stripped)
      ? stripped
      : text.includes(v.german)
        ? v.german
        : null;
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    out.push(candidate);
  }
  if (out.length > 0) return out;

  // Fallback: distinct long words from the text. Unicode \p{L} so non-Latin
  // scripts (Cyrillic, Mkhedruli, Hebrew) survive.
  const tokens = text.match(/\p{L}{5,}/gu) ?? [];
  for (const tok of tokens) {
    if (out.length >= 10) break;
    if (seen.has(tok)) continue;
    seen.add(tok);
    out.push(tok);
  }
  return out;
}

async function createShare(
  apiKey: string,
  text: string,
  phrases: string[],
  textLanguage: string,
  explanationLanguage: string,
  name: string,
): Promise<string | null> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    },
    body: JSON.stringify({ text, phrases, textLanguage, explanationLanguage, name }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error(`  ✗ HTTP ${res.status}: ${detail.slice(0, 200)}`);
    return null;
  }
  const data = (await res.json()) as { code?: string };
  return data.code ?? null;
}

async function main(): Promise<void> {
  const apiKey = process.env.POLYGLOTTOS_API_KEY;
  if (!apiKey) {
    console.error('POLYGLOTTOS_API_KEY is not set.');
    process.exit(1);
  }
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error(`Manifest not found at ${MANIFEST_PATH}. Run "npm run build:content" first.`);
    process.exit(1);
  }

  const courseFilter = (process.env.COURSE ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const targetFilter = (process.env.TARGET ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const nativeFilter = (process.env.NATIVE ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const maxLesson = process.env.MAX_LESSON ? parseInt(process.env.MAX_LESSON, 10) : Infinity;

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')) as Manifest;
  const cache = loadCache();

  let created = 0;
  let reused = 0;
  let failed = 0;
  let skipped = 0;

  for (const course of manifest.courses) {
    if (courseFilter.length > 0 && !courseFilter.includes(course.course)) continue;
    if (targetFilter.length > 0 && !targetFilter.includes(course.target)) continue;
    if (nativeFilter.length > 0 && !nativeFilter.includes(course.native)) continue;

    const lessonsDir = path.resolve(GENERATED_DIR, course.course, course.courseKey, 'lessons');
    if (!fs.existsSync(lessonsDir)) continue;

    const files = fs
      .readdirSync(lessonsDir)
      .filter((f) => f.endsWith('.json'))
      .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

    for (const f of files) {
      const lesson = JSON.parse(fs.readFileSync(path.join(lessonsDir, f), 'utf8')) as LessonJson;
      if (lesson.n > maxLesson) continue;
      const key = `${course.course}:${course.target}:${course.native}:${lesson.n}`;

      if (cache[key]) {
        reused++;
        continue;
      }

      const canonicals = collectCanonicals(lesson.exercises ?? []);
      if (canonicals.length === 0) {
        skipped++;
        continue;
      }
      const body = canonicals.join('\n');
      const phrases = derivePhrases(body, lesson.vocab ?? []);
      const name = lesson.title ? `${lesson.title} · Practice` : `Lesson ${lesson.n} · Practice`;
      process.stdout.write(`  ${key} (${canonicals.length} lines, ${phrases.length} phrases) … `);

      if (phrases.length === 0) {
        console.log('(no phrases, skipped)');
        failed++;
        continue;
      }

      const code = await createShare(apiKey, body, phrases, course.target, course.native, name);
      if (code) {
        cache[key] = code;
        created++;
        console.log(`✓ ${code}`);
        saveCache(cache);
      } else {
        failed++;
        console.log('(failed)');
      }
    }
  }

  saveCache(cache);
  console.log(`\nDone. ${created} new, ${reused} reused, ${failed} failed, ${skipped} skipped (no canonicals).`);
  if (created === 0 && failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
