import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
const GENERATED_DIR = path.resolve(ROOT, 'content/.generated');
const CACHE_PATH = path.resolve(ROOT, 'content/share-codes.json');
const MANIFEST_PATH = path.resolve(GENERATED_DIR, 'manifest.json');

const ENDPOINT = 'https://t.glottos.com/api/create-shared';

interface TextVocab {
  german: string;
  gender: string | null;
  native: string;
}

interface TextJson {
  courseKey: string;
  n: number;
  variant: 'a' | 'b' | 'c';
  title: string;
  sentences: string[];
  vocab: TextVocab[];
}

// Strip an article so the vocab lemma matches the in-text occurrence verbatim.
// Covers all targets currently shipping (German der/die/das/sich, French
// le/la/les/l'/un/une/des, Spanish el/la/los/las/un/una/unos/unas). The "se "
// reflexive marker fronts both Spanish-style infinitives ("se levantar" is
// rare) and is harmless on German.
const ARTICLE_PREFIX = /^(der|die|das|sich|le|la|les|l'|un|une|des|el|los|las|unos|unas|se)\s+/i;
const MAX_PHRASES = 30;

function derivePhrases(text: string, vocab: TextVocab[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of vocab) {
    if (out.length >= MAX_PHRASES) break;
    const stripped = v.german.replace(ARTICLE_PREFIX, '').trim();
    // Case-sensitive substring match — polyGlottos requires the phrase to appear in text verbatim.
    const candidate = text.includes(stripped) ? stripped : text.includes(v.german) ? v.german : null;
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    out.push(candidate);
  }
  if (out.length > 0) return out;

  // Fallback: pick distinct long words from the text. Lessons on separable-prefix
  // verbs etc. give vocab in infinitive form that never appears verbatim in the
  // conjugated text — better to pass *something* than fail the whole text.
  // Unicode \p{L} so French/Spanish/Cyrillic/Mkhedruli/Hebrew letters all count.
  const tokens = text.match(/\p{L}{5,}/gu) ?? [];
  for (const tok of tokens) {
    if (out.length >= 10) break;
    if (seen.has(tok)) continue;
    seen.add(tok);
    out.push(tok);
  }
  return out;
}

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

interface ShareCodeMap {
  [key: string]: string;
}

function loadCache(): ShareCodeMap {
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8')) as ShareCodeMap;
  } catch {
    return {};
  }
}

function saveCache(map: ShareCodeMap): void {
  const ordered: ShareCodeMap = {};
  for (const k of Object.keys(map).sort()) ordered[k] = map[k]!;
  fs.writeFileSync(CACHE_PATH, JSON.stringify(ordered, null, 2) + '\n');
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
    console.error('POLYGLOTTOS_API_KEY is not set. Existing share-codes.json will not be updated.');
    process.exit(1);
  }

  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error(`Manifest not found at ${MANIFEST_PATH}. Run "npm run build:content" first.`);
    process.exit(1);
  }

  // Optional filters — useful for staged rollouts and dev runs.
  // COURSE=classic50  → only process this course slug.
  // TARGET=fr,es  → only process those target langs.
  // NATIVE=ru,en  → only process those native langs.
  // MAX_LESSON=5  → skip texts with n > 5.
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

  let created = 0;
  let reused = 0;
  let failed = 0;

  for (const course of manifest.courses) {
    if (courseFilter.length > 0 && !courseFilter.includes(course.course)) continue;
    if (targetFilter.length > 0 && !targetFilter.includes(course.target)) continue;
    if (nativeFilter.length > 0 && !nativeFilter.includes(course.native)) continue;

    const textsDir = path.resolve(GENERATED_DIR, course.course, course.courseKey, 'texts');
    if (!fs.existsSync(textsDir)) continue;

    const files = fs.readdirSync(textsDir).filter((f) => f.endsWith('.json'));
    for (const f of files) {
      const text = JSON.parse(fs.readFileSync(path.join(textsDir, f), 'utf8')) as TextJson;
      if (text.n > maxLesson) continue;
      const key = `${course.course}:${course.target}:${course.native}:${text.n}:${text.variant}`;

      if (cache[key]) {
        reused++;
        continue;
      }

      const name = text.title || `Lesson ${text.n} · Text ${text.variant.toUpperCase()}`;
      const body = text.sentences.join('\n');
      const phrases = derivePhrases(body, text.vocab ?? []);
      process.stdout.write(`  ${key} (${phrases.length} phrases) … `);

      if (phrases.length === 0) {
        console.log('(no matching vocab, skipped)');
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
        console.log('(skipped)');
      }
    }
  }

  saveCache(cache);
  console.log(`\nDone. ${created} new, ${reused} reused, ${failed} failed.`);
  if (created === 0 && failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
