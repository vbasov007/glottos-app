/**
 * Two things in one pass:
 *
 *  1. STRUCTURAL AUDIT of the dictionary across all 3 native languages:
 *      - Articles match gender markers (m/f/n/pl).
 *      - No accidental duplicates within a single language.
 *      - Cross-language consistency: every German lemma appears in all 3 files.
 *
 *  2. FIRST-USAGE LESSON: for every dictionary entry, find the earliest
 *     lesson (1..50) where the lemma appears verbatim in lesson theory,
 *     exercises, listening texts, or tests. Result is written to
 *     web/content/dictionary-first-lessons.json keyed by lemma.
 *
 * Run:  npm run audit:dict
 *
 * Both outputs are deterministic and depend only on committed content,
 * so re-running on the same input is a no-op.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
const GENERATED_DIR = path.resolve(ROOT, 'content/.generated');
const OUT_PATH = path.resolve(ROOT, 'content/dictionary-first-lessons.json');

type Gender = 'm' | 'f' | 'n' | 'pl' | null;
interface DictEntry {
  german: string;
  lemma: string;
  gender: Gender;
  native: string;
  letter: string;
}
interface Dictionary {
  entries: DictEntry[];
}
interface LessonJson {
  n: number;
  title: string;
  sections: { markdown: string }[];
  exercises: {
    heading: string;
    instruction: string | null;
    prompts: { text: string }[];
    answers: { canonical: string; alternates: string[] }[];
    bodyMarkdown?: string;
  }[];
  vocab: { german: string }[];
}
interface TestJson {
  n: number;
  prompts: { text: string }[];
  answers: { canonical: string; alternates: string[] }[];
}
interface TextJson {
  n: number;
  variant: string;
  sentences: string[];
}

const NATIVES = ['ru', 'en', 'pl'] as const;
const ARTICLE_GENDER: Record<string, Gender> = {
  der: 'm',
  die: 'f',
  das: 'n',
  // "die" + plural noun also valid for pl entries, harder to detect from German alone
};

function loadDict(native: string): Dictionary {
  const p = path.join(GENERATED_DIR, `de.${native}`, 'dictionary.json');
  return JSON.parse(fs.readFileSync(p, 'utf8')) as Dictionary;
}

function loadAllLessons(native: string): LessonJson[] {
  const dir = path.join(GENERATED_DIR, `de.${native}`, 'lessons');
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as LessonJson);
}

function loadAllTexts(native: string): TextJson[] {
  const dir = path.join(GENERATED_DIR, `de.${native}`, 'texts');
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as TextJson);
}

function loadAllTests(native: string): TestJson[] {
  const dir = path.join(GENERATED_DIR, `de.${native}`, 'tests');
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as TestJson);
}

function corpusForLesson(
  n: number,
  lessons: LessonJson[],
  tests: TestJson[],
  texts: TextJson[],
): string {
  const parts: string[] = [];

  const lesson = lessons.find((l) => l.n === n);
  if (lesson) {
    parts.push(lesson.title);
    for (const s of lesson.sections) parts.push(s.markdown);
    for (const ex of lesson.exercises) {
      if (ex.instruction) parts.push(ex.instruction);
      if (ex.bodyMarkdown) parts.push(ex.bodyMarkdown);
      for (const p of ex.prompts) parts.push(p.text);
      for (const a of ex.answers) {
        parts.push(a.canonical);
        for (const alt of a.alternates) parts.push(alt);
      }
    }
    for (const v of lesson.vocab) parts.push(v.german);
  }

  // Tests are aligned 1:1 with lessons by number.
  const test = tests.find((t) => t.n === n);
  if (test) {
    for (const p of test.prompts) parts.push(p.text);
    for (const a of test.answers) {
      parts.push(a.canonical);
      for (const alt of a.alternates) parts.push(alt);
    }
  }

  // Listening texts: 3 variants per lesson (a/b/c).
  for (const t of texts.filter((t) => t.n === n)) {
    for (const s of t.sentences) parts.push(s);
  }

  return parts.join('\n');
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildMatcher(lemma: string): RegExp {
  // Word-boundary match against the lemma. Use Unicode-property word boundary
  // so umlauts (ä ö ü ß) and capitals are handled the same as ASCII.
  // (?<![\p{L}\p{N}])lemma(?![\p{L}\p{N}]) — lookarounds avoid \b's ASCII-only behaviour.
  return new RegExp(
    `(?<![\\p{L}\\p{N}])${escapeRegex(lemma)}(?![\\p{L}\\p{N}])`,
    'iu',
  );
}

const SEPARABLE_PREFIXES = [
  'ab', 'an', 'auf', 'aus', 'bei', 'ein', 'fest', 'her', 'hin', 'los', 'mit',
  'nach', 'vor', 'weg', 'zu', 'zurück', 'zusammen', 'um', 'durch', 'über',
] as const;

/**
 * Build an alternative matcher for verbs whose infinitive (lemma ending in -en)
 * may only appear in conjugated form in the corpus. Generates a small alternation
 * of common inflected forms — covers ~80% of real-world misses.
 *
 * For separable-prefix verbs (e.g. `abgeben`), also matches the root verb plus
 * the prefix appearing anywhere later in the sentence — captures "gibt das
 * Buch ab" style splits.
 */
function buildVerbMatcher(lemma: string): RegExp | null {
  // Must end in -en and be a plausible verb (not a noun like "Kissen").
  if (!/[a-zäöüß]en$/i.test(lemma)) return null;
  const stem = lemma.slice(0, -2);
  if (stem.length < 2) return null;

  // Detect separable prefix.
  let prefix: string | null = null;
  let rootInfinitive = lemma;
  for (const p of SEPARABLE_PREFIXES) {
    if (lemma.startsWith(p) && lemma.length > p.length + 3) {
      const rest = lemma.slice(p.length);
      // Only consider it separable if the remainder is itself a plausible verb.
      if (/^[a-zäöüß]+en$/i.test(rest)) {
        prefix = p;
        rootInfinitive = rest;
        break;
      }
    }
  }

  // Inflected forms for the full lemma (handles inseparable verbs + reflexive
  // and prefix-not-separated forms like "abgesehen").
  const forms: string[] = [
    lemma,                  // infinitive
    `${stem}t`,             // 3rd person sg present / participle of weak verbs
    `${stem}te`,            // past tense weak
    `${stem}ten`,           // past tense plural
    `${stem}st`,            // 2nd person sg
    `${stem}e`,             // 1st person sg
    `ge${stem}t`,           // participle weak
    `ge${stem}en`,          // participle strong
  ];

  // For separable verbs, also match the root verb's stem on its own —
  // "abgeben" can surface as just "gibt" / "gab" + a separate "ab".
  // We require both the root stem AND the prefix in the same paragraph chunk
  // to keep false positives down.
  let separablePattern = '';
  if (prefix) {
    const rootStem = rootInfinitive.slice(0, -2);
    const rootForms = [
      rootInfinitive,
      `${rootStem}t`,
      `${rootStem}te`,
      `${rootStem}st`,
      `${rootStem}e`,
      `ge${rootStem}t`,
      `ge${rootStem}en`,
    ];
    // (?: ... rootForm ... prefix | prefix ... rootForm ) within ~80 chars.
    const altRoot = rootForms.map(escapeRegex).join('|');
    separablePattern =
      `|(?<![\\p{L}\\p{N}])(?:${altRoot})(?![\\p{L}\\p{N}])[\\s\\S]{0,80}(?<![\\p{L}\\p{N}])${escapeRegex(prefix)}(?![\\p{L}\\p{N}])` +
      `|(?<![\\p{L}\\p{N}])${escapeRegex(prefix)}(?![\\p{L}\\p{N}])[\\s\\S]{0,80}(?<![\\p{L}\\p{N}])(?:${altRoot})(?![\\p{L}\\p{N}])`;
  }

  const alt = forms.map(escapeRegex).join('|');
  const pattern = `(?<![\\p{L}\\p{N}])(?:${alt})(?![\\p{L}\\p{N}])${separablePattern}`;
  return new RegExp(pattern, 'iu');
}

interface AuditFindings {
  missingArticle: string[]; // gendered entry without der/die/das
  unexpectedArticle: string[]; // ungendered entry with der/die/das
  duplicateLemmas: { lemma: string; count: number }[];
  crossLangMissing: { lemma: string; missingIn: string[] }[];
}

function auditOne(d: Dictionary, native: string): { lemmas: Set<string>; findings: AuditFindings } {
  const lemmas = new Set<string>();
  const dupCounts = new Map<string, number>();
  const missingArticle: string[] = [];
  const unexpectedArticle: string[] = [];

  for (const e of d.entries) {
    const lemma = e.lemma;
    dupCounts.set(lemma, (dupCounts.get(lemma) ?? 0) + 1);
    lemmas.add(lemma);

    if (e.gender === 'm' || e.gender === 'f' || e.gender === 'n') {
      const head = e.german.split(/\s+/)[0]?.toLowerCase();
      if (head !== 'der' && head !== 'die' && head !== 'das') {
        missingArticle.push(`${native}:${e.german} (gender=${e.gender})`);
      } else if (ARTICLE_GENDER[head] !== e.gender) {
        missingArticle.push(`${native}:${e.german} (article ${head} mismatches gender ${e.gender})`);
      }
    } else if (e.gender === null) {
      const head = e.german.split(/\s+/)[0]?.toLowerCase();
      if (head === 'der' || head === 'das') {
        unexpectedArticle.push(`${native}:${e.german} (article without gender)`);
      }
    }
  }

  const duplicateLemmas: { lemma: string; count: number }[] = [];
  for (const [lemma, count] of dupCounts) {
    if (count > 1) duplicateLemmas.push({ lemma, count });
  }
  duplicateLemmas.sort((a, b) => b.count - a.count);

  return {
    lemmas,
    findings: { missingArticle, unexpectedArticle, duplicateLemmas, crossLangMissing: [] },
  };
}

function main(): void {
  const allDicts = NATIVES.map((n) => ({ native: n, dict: loadDict(n) }));
  const allAudits = allDicts.map(({ native, dict }) => ({
    native,
    ...auditOne(dict, native),
  }));

  // Cross-lang consistency: lemmas present in one native but not the others.
  const union = new Set<string>();
  for (const a of allAudits) for (const l of a.lemmas) union.add(l);
  const crossLangMissing: { lemma: string; missingIn: string[] }[] = [];
  for (const lemma of union) {
    const missingIn = allAudits.filter((a) => !a.lemmas.has(lemma)).map((a) => a.native);
    if (missingIn.length > 0) crossLangMissing.push({ lemma, missingIn });
  }
  crossLangMissing.sort((a, b) => a.lemma.localeCompare(b.lemma));

  // ---------- Print audit report ----------
  console.log('=== Dictionary structural audit ===\n');
  for (const a of allAudits) {
    console.log(`[${a.native}] ${allDicts.find((d) => d.native === a.native)!.dict.entries.length} entries`);
    console.log(`  missing/wrong article: ${a.findings.missingArticle.length}`);
    a.findings.missingArticle.slice(0, 10).forEach((x) => console.log(`    - ${x}`));
    if (a.findings.missingArticle.length > 10) {
      console.log(`    … (${a.findings.missingArticle.length - 10} more)`);
    }
    console.log(`  article without gender: ${a.findings.unexpectedArticle.length}`);
    a.findings.unexpectedArticle.slice(0, 10).forEach((x) => console.log(`    - ${x}`));
    console.log(`  duplicate lemmas: ${a.findings.duplicateLemmas.length}`);
    a.findings.duplicateLemmas.slice(0, 10).forEach((x) =>
      console.log(`    - ${x.lemma} (×${x.count})`),
    );
    console.log('');
  }
  console.log(`Cross-language missing: ${crossLangMissing.length} lemmas not present in all 3 dicts`);
  crossLangMissing.slice(0, 20).forEach((x) =>
    console.log(`  - ${x.lemma} (missing in: ${x.missingIn.join(', ')})`),
  );
  if (crossLangMissing.length > 20) console.log(`  … (${crossLangMissing.length - 20} more)`);
  console.log('');

  // ---------- First-usage scan ----------
  // Use the RU course as the canonical content since lemmas + German content
  // are identical across natives; only translations differ.
  console.log('=== First-usage lesson scan ===');
  const lessons = loadAllLessons('ru');
  const tests = loadAllTests('ru');
  const texts = loadAllTexts('ru');
  // Precompute lowercased lesson corpora.
  const corpus: Record<number, string> = {};
  for (let n = 1; n <= 50; n++) {
    corpus[n] = corpusForLesson(n, lessons, tests, texts).toLowerCase();
  }

  const dict = allDicts.find((d) => d.native === 'ru')!.dict;
  const firstLessons: Record<string, number> = {};
  let foundCount = 0;
  let unusedCount = 0;
  const unusedExamples: string[] = [];

  for (const e of dict.entries) {
    const lemma = e.lemma.toLowerCase();
    const re = buildMatcher(lemma);
    const verbRe = buildVerbMatcher(lemma);
    let found = false;
    for (let n = 1; n <= 50; n++) {
      if (re.test(corpus[n]!) || (verbRe && verbRe.test(corpus[n]!))) {
        firstLessons[e.lemma] = n;
        found = true;
        foundCount++;
        break;
      }
    }
    if (!found) {
      unusedCount++;
      if (unusedExamples.length < 20) unusedExamples.push(e.german);
    }
  }

  console.log(`  ${foundCount} entries with first-use lesson`);
  console.log(`  ${unusedCount} entries never appear in any lesson/test/text`);
  if (unusedExamples.length) {
    console.log('  sample unused:');
    unusedExamples.forEach((u) => console.log(`    - ${u}`));
  }

  // Distribution: how many words first introduced in each lesson?
  const buckets: Record<number, number> = {};
  for (let n = 1; n <= 50; n++) buckets[n] = 0;
  for (const n of Object.values(firstLessons)) buckets[n] = (buckets[n] ?? 0) + 1;
  console.log('  per-lesson new-word count (first 10):');
  for (let n = 1; n <= 10; n++) console.log(`    L${n}: ${buckets[n] ?? 0}`);
  console.log(`  ... L50: ${buckets[50] ?? 0}`);

  fs.writeFileSync(OUT_PATH, JSON.stringify(firstLessons, null, 2) + '\n');
  console.log(`\nWrote ${Object.keys(firstLessons).length} entries → ${OUT_PATH}`);
}

main();
