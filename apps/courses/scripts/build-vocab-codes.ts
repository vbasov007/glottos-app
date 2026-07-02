/**
 * Generate a polyGlottos workspace for each lesson's vocabulary, so the user
 * can tap any vocab item in t.glottos.com to see a full AI explanation.
 *
 *   POLYGLOTTOS_API_KEY=… npm run vocab
 *
 * Filters:
 *   NATIVE=ru,en       only those native langs
 *   MAX_LESSON=3       only lessons 1..3
 *
 * Cache file: web/content/vocab-codes.json, keyed by
 * `<course>:<target>:<native>:<lessonN>` → share code.
 *
 * Change detection: a sidecar web/content/vocab-codes.hashes.json stores a
 * hash of the vocab text each code was generated from. A lesson is
 * regenerated when its current vocab text no longer matches the recorded
 * hash — so editing a lesson's vocabulary automatically refreshes its audio
 * on the next run, no manual cache-busting needed. Legacy entries that have a
 * code but no recorded hash are backfilled with the current hash and trusted
 * (the first migration run makes no extra API calls).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const ROOT = path.resolve(__dirname, '..');
const GENERATED_DIR = path.resolve(ROOT, 'content/.generated');
const CACHE_PATH = path.resolve(ROOT, 'content/vocab-codes.json');
const HASH_PATH = path.resolve(ROOT, 'content/vocab-codes.hashes.json');
const MANIFEST_PATH = path.resolve(GENERATED_DIR, 'manifest.json');

const ENDPOINT = 'https://t.glottos.com/api/create-shared';
const MAX_PHRASES = 200; // polyGlottos hard cap per OPEN_IN_APP_GUIDE.md

interface LessonVocab {
  german: string;
  gender: string | null;
  native: string;
}

interface LessonJson {
  n: number;
  title: string;
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

interface VocabCodeMap {
  [key: string]: string;
}

function loadCache(): VocabCodeMap {
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8')) as VocabCodeMap;
  } catch {
    return {};
  }
}

function saveCache(map: VocabCodeMap): void {
  const ordered: VocabCodeMap = {};
  for (const k of Object.keys(map).sort((a, b) => {
    const [, an, al] = a.split(':');
    const [, bn, bl] = b.split(':');
    if (an !== bn) return (an ?? '').localeCompare(bn ?? '');
    return parseInt(al ?? '0', 10) - parseInt(bl ?? '0', 10);
  })) {
    ordered[k] = map[k]!;
  }
  fs.writeFileSync(CACHE_PATH, JSON.stringify(ordered, null, 2) + '\n');
}

// Sidecar: key → hash of the vocab text the code was generated from.
function loadHashes(): VocabCodeMap {
  try {
    return JSON.parse(fs.readFileSync(HASH_PATH, 'utf8')) as VocabCodeMap;
  } catch {
    return {};
  }
}

function saveHashes(map: VocabCodeMap): void {
  fs.writeFileSync(HASH_PATH, JSON.stringify(map, null, 2) + '\n');
}

function textHash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

/**
 * Build the "text" to send. Each vocab entry on its own line — that way every
 * phrase is a verbatim substring of the text (polyGlottos requires this) and
 * the in-app TTS plays them cleanly one at a time.
 *
 * `v.german` already contains the article for nouns ("der Abend"). `v.gender`
 * is a parser marker ("m" / "f" / "n" / "pl") and must NOT be prepended —
 * otherwise the text becomes "m der Abend" and polyGlottos / TTS treats "m"
 * as a word.
 */
function formatEntry(v: LessonVocab): string {
  return v.german;
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
    body: JSON.stringify({
      text,
      phrases,
      textLanguage,
      explanationLanguage,
      name,
    }),
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

  const courseFilter = (process.env.COURSE ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const targetFilter = (process.env.TARGET ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const nativeFilter = (process.env.NATIVE ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const maxLesson = process.env.MAX_LESSON ? parseInt(process.env.MAX_LESSON, 10) : Infinity;

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')) as Manifest;
  const cache = loadCache();
  const hashes = loadHashes();

  let created = 0;
  let reused = 0;
  let failed = 0;

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

      const entries = (lesson.vocab ?? []).slice(0, MAX_PHRASES);
      if (entries.length === 0) {
        if (cache[key]) {
          reused++;
        } else {
          console.log(`  ${key} (no vocab, skipped)`);
          failed++;
        }
        continue;
      }

      const lines = entries.map(formatEntry);
      const text = lines.join('\n');
      const phrases = lines; // every line is its own phrase
      const hash = textHash(text);

      // Reuse when a code exists AND the vocab text is unchanged. Legacy
      // entries (code present, no recorded hash) are backfilled with the
      // current hash and trusted — no API call on the first migration run.
      if (cache[key] && (hashes[key] === hash || hashes[key] === undefined)) {
        if (hashes[key] === undefined) {
          hashes[key] = hash;
          saveHashes(hashes);
        }
        reused++;
        continue;
      }

      // A code exists but the recorded hash differs → the vocabulary changed.
      const changed = Boolean(cache[key]);
      const name = lesson.title || `Lesson ${lesson.n} · Vocabulary`;
      process.stdout.write(`  ${key} (${phrases.length} entries)${changed ? ' [text changed]' : ''} … `);

      const code = await createShare(apiKey, text, phrases, course.target, course.native, name);
      if (code) {
        cache[key] = code;
        hashes[key] = hash;
        created++;
        console.log(`✓ ${code}`);
        saveCache(cache);
        saveHashes(hashes);
      } else {
        failed++;
        console.log('(failed)');
      }
    }
  }

  saveCache(cache);
  saveHashes(hashes);
  console.log(`\nDone. ${created} new, ${reused} reused, ${failed} failed.`);
  // Only a hard failure when nothing succeeded at all (e.g. bad API key).
  // A pure no-op run (everything reused, a few vocab-less lessons) is fine.
  if (created === 0 && reused === 0 && failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
