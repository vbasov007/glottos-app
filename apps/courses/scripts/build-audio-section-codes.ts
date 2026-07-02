/**
 * Mints polyGlottos share codes for the matrix/scales sections of each
 * lesson — the "Языковая матрица" / "Языковые гаммы" blocks that already
 * surface on the Audio tab as static markdown today. Once a code is minted,
 * AudioPractice surfaces a "🔊 Audio practice" chip above the section so the
 * learner can drill the same sentences with audio in text-tutor.
 *
 * Mirrors scripts/build-share-codes.ts almost verbatim — same caching, same
 * POLYGLOTTOS_API_KEY contract, same idempotent behaviour. The only
 * differences are (1) the input is parsed lesson sections rather than
 * listening texts and (2) the cache key carries a section index instead of
 * a variant letter.
 *
 * Usage:
 *   POLYGLOTTOS_API_KEY=… npm run codes:sections
 *
 * Optional filters (same as build-share-codes.ts):
 *   COURSE=classic50     only this course slug
 *   TARGET=de,fr         only these target langs
 *   NATIVE=ru,en         only these native langs
 *   MAX_LESSON=10        skip lessons with n > 10
 */
import fs from 'node:fs';
import path from 'node:path';
import { classifySection } from '../lib/lesson-sections';

const ROOT = path.resolve(__dirname, '..');
const GENERATED_DIR = path.resolve(ROOT, 'content/.generated');
const CACHE_PATH = path.resolve(ROOT, 'content/audio-section-codes.json');
const MANIFEST_PATH = path.resolve(GENERATED_DIR, 'manifest.json');

const ENDPOINT = 'https://t.glottos.com/api/create-shared';

interface ManifestCourse {
  course: string;
  courseKey: string;
  target: string;
  native: string;
  textCount: number;
}

interface Manifest {
  courses: ManifestCourse[];
}

interface LessonSection {
  heading: string;
  slug: string;
  markdown: string;
}

interface LessonJson {
  course: string;
  courseKey: string;
  n: number;
  title: string;
  sections: LessonSection[];
}

interface CodeMap {
  [key: string]: string;
}

function loadCache(): CodeMap {
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8')) as CodeMap;
  } catch {
    return {};
  }
}

function saveCache(map: CodeMap): void {
  const ordered: CodeMap = {};
  for (const k of Object.keys(map).sort()) ordered[k] = map[k]!;
  fs.writeFileSync(CACHE_PATH, JSON.stringify(ordered, null, 2) + '\n');
}

/**
 * Pull sentences out of fenced code blocks. The matrix/scales sections
 * use ``` blocks containing one drill sentence per line. We strip blank
 * lines, conversational separators ("---"), and anything that looks like
 * a commentary line — leaving target-language sentences ready for the
 * polyGlottos audio drill.
 */
function extractSentences(markdown: string): string[] {
  const sentences: string[] = [];
  // Match every fenced block, regardless of language tag (or none).
  const fence = /```[^\n]*\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(markdown)) !== null) {
    const body = m[1] ?? '';
    for (const raw of body.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      if (line === '---') continue;
      // Lines like "Повтори каждую гамму 3 раза" are guidance in the
      // learner's native language, not drill sentences. They tend to lack
      // capital letters from the target language and contain Cyrillic
      // markers, but we deliberately don't filter on script — false
      // positives are better than false negatives at this stage.
      sentences.push(line);
    }
  }
  return sentences;
}

interface CreateShareResult {
  code: string | null;
  reason?: string;
}

async function createShare(
  apiKey: string,
  text: string,
  phrases: string[],
  textLanguage: string,
  explanationLanguage: string,
  name: string,
): Promise<CreateShareResult> {
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
    return { code: null, reason: `HTTP ${res.status}: ${detail.slice(0, 200)}` };
  }
  const data = (await res.json()) as { code?: string };
  return { code: data.code ?? null };
}

async function main(): Promise<void> {
  const apiKey = process.env.POLYGLOTTOS_API_KEY;
  if (!apiKey) {
    console.error(
      'POLYGLOTTOS_API_KEY is not set. Existing audio-section-codes.json will not be updated.',
    );
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
      const lesson = JSON.parse(
        fs.readFileSync(path.join(lessonsDir, f), 'utf8'),
      ) as LessonJson;
      if (lesson.n > maxLesson) continue;

      // partitionSections lives in lib/lesson-sections; classifySection is
      // its single-section primitive. Re-derive the audio[] list here
      // rather than importing partitionSections so we keep the per-section
      // ordinal (idx) — that's our stable cache key.
      const audioSections = lesson.sections.filter(
        (s) => classifySection(s.heading) === 'audio',
      );
      if (audioSections.length === 0) continue;

      for (let idx = 0; idx < audioSections.length; idx++) {
        const s = audioSections[idx]!;
        const key = `${course.course}:${course.target}:${course.native}:${lesson.n}:${idx}`;
        if (cache[key]) {
          reused++;
          continue;
        }

        const sentences = extractSentences(s.markdown);
        process.stdout.write(`  ${key} (${sentences.length} sentences) … `);
        if (sentences.length === 0) {
          console.log('(no code blocks, skipped)');
          skipped++;
          continue;
        }

        const text = sentences.join('\n');
        const name = `Lesson ${lesson.n} · ${s.heading}`;
        const result = await createShare(
          apiKey,
          text,
          sentences,
          course.target,
          course.native,
          name,
        );
        if (result.code) {
          cache[key] = result.code;
          created++;
          console.log(`✓ ${result.code}`);
          saveCache(cache);
        } else {
          failed++;
          console.log(`✗ ${result.reason ?? '(skipped)'}`);
        }
      }
    }
  }

  saveCache(cache);
  console.log(
    `\nDone. ${created} new, ${reused} reused, ${failed} failed, ${skipped} skipped (no sentences).`,
  );
  if (created === 0 && failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
