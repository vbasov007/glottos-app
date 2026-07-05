#!/usr/bin/env tsx
/**
 * Walk /workspace/courses/<course>/<target>/<native>/ and emit typed JSON under
 * /workspace/web/content/.generated/<course>/<courseKey>/, where courseKey =
 * `${target}.${native}`. Course is the top-level grouping above target+native.
 *
 * Design: do all parsing here (build-time) so runtime is pure JSON reads.
 */

import { mkdir, readFile, readdir, writeFile, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { toString as mdastToString } from 'mdast-util-to-string';
import type { Root, Content, Heading, Table, Code, Paragraph, Blockquote, List, Html } from 'mdast';

import type {
  ContentManifest,
  CourseKey,
  CourseSlug,
  Curriculum,
  CurriculumBlock,
  CurriculumLessonRef,
  Dictionary,
  DictionaryEntry,
  Exercise,
  ExerciseAnswer,
  ExercisePrompt,
  Lesson,
  LessonSection,
  NativeLang,
  TargetLang,
  Test,
  Text,
  VocabRow,
} from '../lib/content-types';
import { COURSES } from '../lib/content-types';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
// In the merged monorepo the courses app lives at apps/courses/ and its content
// sources are a LOCAL subdir (apps/courses/courses), not a repo-root sibling as
// in the legacy `web/` layout. ROOT is therefore the app dir (one level up from
// scripts/), so COURSES_DIR resolves to apps/courses/courses.
const ROOT = path.resolve(SCRIPT_DIR, '..');
const COURSES_DIR = path.join(ROOT, 'courses');
const OUT_DIR = path.join(SCRIPT_DIR, '..', 'content', '.generated');

const NATIVES = new Set<NativeLang>(['ru', 'en', 'pl', 'de']);
const TARGETS = new Set<TargetLang>(['de', 'fr', 'es', 'sr', 'ka', 'he', 'en', 'it']);
const COURSE_SLUGS = new Set<CourseSlug>(COURSES.map((c) => c.slug));

// --- helpers ----------------------------------------------------------------

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60);
}

function parseMd(src: string): Root {
  return unified().use(remarkParse).use(remarkGfm).parse(src) as Root;
}

/**
 * Slice an mdast Root into the original source string for the nodes whose
 * indices fall in [startIdx, endIdx). Uses node.position to splice the raw
 * source — keeps tables, code blocks, etc. intact byte-for-byte.
 */
function sliceSource(src: string, nodes: Content[]): string {
  if (nodes.length === 0) return '';
  const first = nodes[0]?.position?.start.offset;
  const last = nodes[nodes.length - 1]?.position?.end.offset;
  if (first == null || last == null) return '';
  return src.slice(first, last);
}

function tableToRows(node: Table, src: string): string[][] {
  const rows: string[][] = [];
  for (const row of node.children) {
    const cells: string[] = [];
    for (const cell of row.children) {
      // Cell content as text (preserves italics/bold as plain text)
      cells.push(mdastToString(cell).trim());
    }
    rows.push(cells);
  }
  return rows;
}

function getHeadingDepth(n: Content | undefined, depth: number): boolean {
  return !!n && n.type === 'heading' && (n as Heading).depth === depth;
}

// --- alternate splitting ----------------------------------------------------

/**
 * "Hallo! (или: Servus; Grüß Gott)" → { canonical: "Hallo!", alternates: ["Servus","Grüß Gott"], note: null }
 * "vierzehn (= Russian четырнадцать)" → { canonical: "vierzehn", alternates: [], note: "(= Russian четырнадцать)" }
 */
const ALT_PREFIX_RE = /^\s*(или|or|lub)\s*[::]?\s*/i;

/** Strip outer italics markers `*...*` and `_..._` if they wrap the whole string. */
function stripItalics(s: string): string {
  let r = s.trim();
  // Repeat in case of doubled markers
  while ((r.startsWith('*') && r.endsWith('*')) || (r.startsWith('_') && r.endsWith('_'))) {
    if (r.length < 2) break;
    r = r.slice(1, -1).trim();
  }
  return r;
}

function splitAnswer(raw: string): ExerciseAnswer {
  let text = raw.trim();
  let canonical = text;
  const alternates: string[] = [];
  let note: string | null = null;

  // Walk for `(...)` blocks; if inner starts with или/or/lub, treat as alternates;
  // otherwise treat the LAST non-alt paren as a note.
  const parenRe = /\(([^()]+)\)/g;
  const parens: { full: string; inner: string; index: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = parenRe.exec(text)) !== null) {
    parens.push({ full: m[0]!, inner: m[1]!, index: m.index });
  }

  for (const p of parens) {
    if (ALT_PREFIX_RE.test(p.inner)) {
      const altsRaw = p.inner.replace(ALT_PREFIX_RE, '');
      const parts = altsRaw
        .split(/[;]|\s+(?:или|or|lub)\s+/i)
        .map((s) => stripItalics(s.trim()))
        .filter(Boolean);
      alternates.push(...parts);
      canonical = canonical.replace(p.full, '').trim();
    } else if (p.index + p.full.length === text.trimEnd().length) {
      // Trailing paren — treat as a note
      note = p.full;
      canonical = canonical.slice(0, canonical.length - p.full.length).trim();
    }
  }

  // Strip outer italics after paren-removal
  canonical = stripItalics(canonical);
  canonical = canonical.replace(/\s+$/, '').replace(/^\s+/, '');

  return { canonical, alternates, note };
}

// --- common section walker --------------------------------------------------

/**
 * Walk children, splitting into sections by H2 heading. Returns array of
 * { heading, slug, children } where children is the in-between Content[].
 */
function splitH2Sections(root: Root): { heading: string; slug: string; children: Content[] }[] {
  const out: { heading: string; slug: string; children: Content[] }[] = [];
  let current: { heading: string; slug: string; children: Content[] } | null = null;
  for (const node of root.children) {
    if (node.type === 'heading' && (node as Heading).depth === 2) {
      const heading = mdastToString(node).trim();
      current = { heading, slug: slugify(heading), children: [] };
      out.push(current);
    } else if (current) {
      current.children.push(node);
    }
  }
  return out;
}

// --- curriculum -------------------------------------------------------------

const BLOCK_HEADING_RE = /^(?:БЛОК|BLOCK|BLOK)\s+(\d+)\b/i;
const RANK_LINE_RE = /[«„"]([A-Za-zÄÖÜäöüß\/\s]+)[»""]/u;
// Trailing "→ TEST «...» (Rank): description, level X" line. After mdast
// stringification the bold markers are gone, so we match the inner text.
// No \b after TEST/ТЕСТ — JS \b only matches ASCII word boundaries.
const TEST_DESC_RE = /^→\s*(?:TEST|ТЕСТ)\s[\s\S]+?\)\s*[:.]\s*(.+)$/u;

async function parseCurriculum(file: string, course: CourseSlug, courseKey: CourseKey): Promise<Curriculum> {
  const src = await readFile(file, 'utf8');
  const root = parseMd(src);

  let title = '';
  let subtitle: string | null = null;
  const blocks: CurriculumBlock[] = [];

  // H1 title
  const h1 = root.children.find((n) => n.type === 'heading' && (n as Heading).depth === 1) as
    | Heading
    | undefined;
  if (h1) title = mdastToString(h1).trim();

  // Subtitle = first short paragraph immediately after H1 (the bolded line 2).
  const h1Idx = root.children.findIndex((n) => n === h1);
  if (h1Idx >= 0) {
    const next = root.children[h1Idx + 1];
    if (next?.type === 'paragraph') {
      const txt = mdastToString(next).trim();
      // Only treat as subtitle if it's a short bolded line — not a normal paragraph.
      if (txt.length > 0 && txt.length < 200) {
        subtitle = txt;
      }
    }
  }

  // Walk H2 sections looking for "BLOCK N:" / "БЛОК N:" / "BLOK N:"
  const sections = splitH2Sections(root);
  for (const sec of sections) {
    const match = sec.heading.match(BLOCK_HEADING_RE);
    if (!match) continue;
    const id = parseInt(match[1]!, 10);
    const rankMatch = sec.heading.match(RANK_LINE_RE);
    const rankLabel = rankMatch ? rankMatch[1]!.trim() : null;

    // Find the first table in the block; the rows are lessons
    const table = sec.children.find((n) => n.type === 'table') as Table | undefined;
    const lessons: CurriculumLessonRef[] = [];
    if (table) {
      const rows = tableToRows(table, src);
      // First row is header
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i]!;
        const n = parseInt(r[0]?.trim() ?? '', 10);
        if (!Number.isFinite(n)) continue;
        lessons.push({ n, grammar: r[1]?.trim() ?? '', vocab: r[2]?.trim() ?? '' });
      }
    }

    // Intro paragraph(s) before the first table: any blockquote/paragraph between heading and table
    const tableIdx = sec.children.findIndex((n) => n.type === 'table');
    const introNodes = tableIdx > 0 ? sec.children.slice(0, tableIdx) : [];
    const intro = introNodes.length > 0 ? sliceSource(src, introNodes).trim() || null : null;

    // Trailing "→ TEST «...» (Rank): description" line — usually a paragraph
    // after the table. Find it anywhere in the section's children.
    let testDescription: string | null = null;
    for (const node of sec.children) {
      if (node.type !== 'paragraph') continue;
      const txt = mdastToString(node).trim();
      const m = txt.match(TEST_DESC_RE);
      if (m) {
        testDescription = m[1]!.trim();
        break;
      }
    }

    blocks.push({ id, title: sec.heading, rankLabel, lessons, intro, testDescription });
  }

  // Trailing markdown = everything after the last block's table heading
  let trailingMarkdown: string | null = null;
  const lastBlockSection = sections
    .filter((s) => BLOCK_HEADING_RE.test(s.heading))
    .pop();
  if (lastBlockSection) {
    const idx = root.children.indexOf(lastBlockSection.children[lastBlockSection.children.length - 1]!);
    if (idx >= 0 && idx + 1 < root.children.length) {
      const trailing = root.children.slice(idx + 1);
      const txt = sliceSource(src, trailing).trim();
      if (txt) trailingMarkdown = txt;
    }
  }

  return { course, courseKey, title, subtitle, blocks, trailingMarkdown };
}

// --- lessons ----------------------------------------------------------------

const EXERCISE_HEADING_RE = /^(?:Упражнение|Exercise|Ćwiczenie|Übung)\s+(\d+)/i;
const VOCAB_SECTION_RE = /(?:Словарь|Словарный\s+запас|Vocabulary|Słownictwo|Słownik|Wortschatz|Лексика|лексика)/i;
const NEXT_UP_RE = /^>\s*\*\*(?:Следующий шаг|Next up|Następny krok|Nächster Schritt)/im;

/**
 * If an exercise heading or instruction matches these patterns, the exercise
 * is a "read it out loud" drill — nothing to type, nothing to auto-check.
 * Treat as open-ended even when a <details> key is present (the key gets
 * rendered as a native <details> inside the body for self-checking).
 *
 * NOTE: JS regex `\b` only recognizes ASCII word boundaries. Cyrillic and
 * Polish-diacritic substrings are matched without word boundaries — they're
 * distinctive enough not to false-positive in normal lesson copy.
 */
const READ_ALOUD_PATTERNS: RegExp[] = [
  // Read-aloud / conjugate-aloud verbs in all four UI native languages plus
  // English mixed into exercise headings on some courses.
  /вслух/i,
  /\b(?:read|say|pronounce|repeat|conjugate)\b[^.!?\n]*\b(?:aloud|out\s+loud)\b/i,
  /\bread\s+aloud\b/i,
  /\b(?:lies|sag|sprich|sage|wiederhol)\s+laut\b/i,
  /\blaut\s+konjugieren\b/i,
  /\blauter\s+durchlauf\b/i,
  /\b(?:czytaj|powiedz|powtórz|wymów|czytanie)\b[^.!?\n]*(?:głośno|na\s+głos)/i,
  /\bna\s+głos\b/i,
  /głośno/i,

  // Sound discrimination — bold-letter anchored so "Distinguish contrast/result"
  // grammar drills don't get caught.
  /(?:различи|distinguish|rozróżnij|unterscheide)\s*\*\*[^\s*]+\*\*\s+(?:и|and|i|und)\s+\*\*[^\s*]+\*\*/i,
  /(?:прочитай|read|przeczytaj|lies)\s+пары|pair[s]?\s+of\s+words|pary\s+słów|wortpaare/i,
  /минимальные\s+пар|minimal\s+pair|paire(?:s)?\s+minimale|minimalpaar/i,

  // Stress / accent / intonation identification — pure observation.
  /ударение/i,
  /\b(?:stress(?:ed)?|syllable)\b/i,
  /\b(?:wort|satz)?akzent\b/i,
  /\bakcent\b/i,
  /\bbetonung\b/i,
  /сила\s+слова|kraft\s+des\s+wortes|siła\s+słowa/i,
  /только\s+(?:интонация|мелодия)|only\s+intonation|nur\s+intonation|sama\s+intonacja/i,

  // Spelling drills — read out the letters, nothing to type.
  /\bspell(?:ing)?\s+drill\b/i,
  /по\s+буквам|po\s+literach|\bbuchstabieren\b/i,

  // Matrix / paradigm run-throughs and recall-from-memory drills.
  /прогон/i,
  /наизусть/i,
  /\bna\s+pamięć\b/i,
  /\b(?:auswendig|aus\s+dem\s+kopf)\b/i,
  /\bfrom\s+memory\b/i,
];

function isReadAloudExercise(heading: string, instruction: string | null): boolean {
  const text = `${heading} ${instruction ?? ''}`;
  return READ_ALOUD_PATTERNS.some((re) => re.test(text));
}

async function parseLesson(file: string, course: CourseSlug, courseKey: CourseKey, n: number): Promise<Lesson> {
  const src = await readFile(file, 'utf8');
  const root = parseMd(src);

  // Title (H1)
  const h1 = root.children.find((nn) => nn.type === 'heading' && (nn as Heading).depth === 1) as
    | Heading
    | undefined;
  const title = h1 ? mdastToString(h1).trim() : `Lesson ${n}`;

  // Vocab subtitle = first paragraph after H1 that starts with **
  let vocabSubtitle = '';
  const h1Idx = root.children.findIndex((nn) => nn === h1);
  for (let i = h1Idx + 1; i < root.children.length && i < h1Idx + 4; i++) {
    const node = root.children[i];
    if (node?.type === 'paragraph') {
      const txt = mdastToString(node).trim();
      if (txt.startsWith('Vocabulary:') || txt.startsWith('Словарный запас:') || txt.startsWith('Słownictwo:')) {
        vocabSubtitle = txt;
        break;
      }
    }
  }

  // Split into H2 sections
  const sections: LessonSection[] = [];
  const h2Splits = splitH2Sections(root);
  for (const s of h2Splits) {
    sections.push({
      heading: s.heading,
      slug: s.slug,
      markdown: sliceSource(src, s.children).trim(),
    });
  }

  // Exercises = H3 nodes inside the "Exercises" section, OR top-level H3s matching the pattern
  const exercises: Exercise[] = parseExercises(root, src);

  // Vocab = first table inside the section whose heading matches VOCAB_SECTION_RE
  const vocab = parseLessonVocab(root, h2Splits);

  // Next up = the trailing blockquote
  const nextUp = parseNextUp(src);

  return {
    course,
    courseKey,
    n,
    title,
    vocabSubtitle,
    sections,
    exercises,
    vocab,
    nextUp,
  };
}

function parseExercises(root: Root, src: string): Exercise[] {
  const exercises: Exercise[] = [];
  // Walk all top-level nodes; collect H3 nodes matching exercise pattern
  // and the nodes that follow until the next H3 or H2.
  const all = root.children;
  let i = 0;
  while (i < all.length) {
    const node = all[i]!;
    if (node.type === 'heading' && (node as Heading).depth === 3) {
      const heading = mdastToString(node).trim();
      const m = heading.match(EXERCISE_HEADING_RE);
      if (m) {
        const n = parseInt(m[1]!, 10);
        // Collect children until next H3 or H2
        let j = i + 1;
        const blockNodes: Content[] = [];
        while (j < all.length) {
          const next = all[j]!;
          if (next.type === 'heading' && ((next as Heading).depth === 2 || (next as Heading).depth === 3)) {
            break;
          }
          blockNodes.push(next);
          j++;
        }
        exercises.push(buildExercise(n, heading, blockNodes, src));
        i = j;
        continue;
      }
    }
    i++;
  }
  return exercises;
}

function buildExercise(n: number, heading: string, nodes: Content[], src: string): Exercise {
  // First <details> opening — any ordered list at or after this index belongs
  // to the answer key, not the prompt list.
  const detailsOpenIdx = nodes.findIndex(
    (nn) => nn.type === 'html' && /<details\b/i.test((nn as Html).value),
  );
  // Prompt list = first ordered list BEFORE the <details> block. If none,
  // prompts is empty (open-ended/read-aloud-style exercise).
  const firstListIdx = nodes.findIndex(
    (nn, i) => nn.type === 'list' && (detailsOpenIdx < 0 || i < detailsOpenIdx),
  );

  // Instruction = leading paragraphs before the first list
  const instructionNodes = firstListIdx > 0 ? nodes.slice(0, firstListIdx) : [];
  const instruction = instructionNodes.length > 0
    ? instructionNodes
        .filter((nn) => nn.type === 'paragraph')
        .map((nn) => mdastToString(nn).trim())
        .filter(Boolean)
        .join(' ')
    : null;

  // Prompts = items of the first <ol> (which by the index above is outside <details>)
  let prompts: ExercisePrompt[] = [];
  if (firstListIdx >= 0) {
    const list = nodes[firstListIdx] as List;
    if (list.ordered) {
      prompts = list.children.map((li) => ({ text: mdastToString(li).trim() }));
    }
  }

  // Answers = inside the <details> block; we find raw HTML node containing <details>
  let answers: ExerciseAnswer[] = [];
  let isOpenEnded = true;
  for (const nn of nodes) {
    if (nn.type === 'html' && /<details>/i.test((nn as Html).value)) {
      // The full <details>...</details> may be split across multiple html nodes.
      // Easier: grab from source.
      const detailsBlock = sliceFromSourceContaining(src, nodes, '<details>', '</details>');
      if (detailsBlock) {
        answers = extractAnswersFromDetails(detailsBlock);
        isOpenEnded = answers.length === 0;
      }
      break;
    }
  }

  // Read-aloud override: nothing to type, regardless of whether a <details>
  // key exists. The key (if any) will be rendered via bodyMarkdown so the
  // learner can still reveal pronunciation hints.
  const readAloud = isReadAloudExercise(heading, instruction);
  if (readAloud) {
    isOpenEnded = true;
  }

  // bodyMarkdown = exercise body markdown.
  // - Normal exercises: stop at <details> (key rendered separately via prompts+inputs).
  // - Read-aloud exercises: include <details> so the native HTML reveal still works.
  const detailsIdx = nodes.findIndex(
    (nn) => nn.type === 'html' && /<details>/i.test((nn as Html).value),
  );
  const bodyNodes = !readAloud && detailsIdx >= 0 ? nodes.slice(0, detailsIdx) : nodes;
  const bodyMarkdown = sliceSource(src, bodyNodes).trim();

  return {
    n,
    heading,
    slug: slugify(heading),
    instruction,
    prompts,
    answers,
    isOpenEnded,
    bodyMarkdown,
  };
}

function sliceFromSourceContaining(
  src: string,
  nodes: Content[],
  open: string,
  close: string,
): string | null {
  for (const node of nodes) {
    const offset = node.position?.start.offset;
    if (offset == null) continue;
    const fromHere = src.indexOf(open, offset);
    if (fromHere < 0) continue;
    const end = src.indexOf(close, fromHere);
    if (end < 0) continue;
    return src.slice(fromHere, end + close.length);
  }
  return null;
}

function extractAnswersFromDetails(html: string): ExerciseAnswer[] {
  // Split lines, find numbered lines "1. *Hallo!*" style.
  const lines = html.split(/\r?\n/);
  const ans: ExerciseAnswer[] = [];
  const numRe = /^\s*(\d+)\.\s+(.*\S)\s*$/;
  for (const line of lines) {
    const m = line.match(numRe);
    if (!m) continue;
    ans.push(splitAnswer(m[2]!));
  }
  return ans;
}

function parseLessonVocab(root: Root, sections: ReturnType<typeof splitH2Sections>): VocabRow[] {
  // Find the H2 section whose heading matches VOCAB_SECTION_RE
  for (const sec of sections) {
    if (VOCAB_SECTION_RE.test(sec.heading)) {
      const tables: Table[] = [];
      collectTables(sec.children, tables);
      return tables.flatMap((t) => parseVocabTable(t));
    }
  }
  return [];
}

function collectTables(nodes: Content[], out: Table[]) {
  for (const node of nodes) {
    if (node.type === 'table') out.push(node as Table);
    // Don't recurse — vocab tables are top-level inside sections
  }
}

// Strip inline HTML tags like <say>…</say> or <span>…</span> from a cell's
// text content. mdast-util-to-string returns the raw HTML literal inside table
// cells; the wrapper tags are presentational and shouldn't end up in vocab
// rows, dictionary entries, or test prompts.
function stripInlineHtml(s: string): string {
  return s.replace(/<\/?\w[^>]*>/g, '');
}

function cellText(cell: { children: unknown[] }): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return stripInlineHtml(mdastToString(cell as any).trim()).trim();
}

function parseVocabTable(table: Table): VocabRow[] {
  if (table.children.length < 2) return [];
  const headerCells = table.children[0]!.children.map((c) => cellText(c).toLowerCase());

  // Identify columns. We accept either 2-col (Target/Native) or 3-col
  // (Target/Gender/Native). Header variants per supported target language;
  // gender column header is "Gender"/"Rodzaj"/"Род"/"Класс". The native
  // column is anything that isn't target or gender.
  const TARGET_HEADERS = [
    'german', 'niemiecki', 'немецкий', 'deutsch',
    'french', 'francuski', 'французский', 'französisch',
    'spanish', 'hiszpański', 'испанский', 'español', 'spanisch',
    'serbian', 'serbski', 'сербский', 'srpski',
    'georgian', 'gruziński', 'грузинский', 'ქართული',
    'hebrew', 'hebrajski', 'иврит', 'hebräisch', 'עברית',
    'english', 'angielski', 'английский', 'englisch',
    'italian', 'włoski', 'итальянский', 'italienisch', 'italiano',
  ];
  const GENDER_HEADERS = ['gender', 'rodzaj', 'род', 'класс'];
  // Transliteration / note / commentary columns aren't the translation. Skip
  // them when picking the native column or e.g. a "Транслит" column wins over
  // "Русский" because findIndex stops at the first non-target/non-gender hit.
  const TRANSLIT_HEADERS = [
    'transliteration', 'translit', 'transkrypcja',
    'транслит', 'транскрипция',
    'romanization', 'romanisation', 'romanizacja',
    'pronunciation', 'wymowa', 'произношение',
  ];
  const NOTE_HEADERS = [
    'note', 'notes', 'комментарий', 'заметка', 'примечание',
    'remark', 'uwaga', 'uwagi',
  ];
  // Native-language column labels — used to anchor the native side of the
  // table when the target column is implicit (e.g. Hebrew conjugation tables
  // headed "Корень | м.ед. | ж.ед. | м.мн. | ж.мн. | Перевод").
  const NATIVE_HEADERS = [
    'русский', 'russian', 'rosyjski', 'russisch',
    'polski', 'polish', 'polnisch', 'польский',
    'english', 'angielski', 'englisch', 'английский',
    'deutsch', 'german', 'niemiecki', 'немецкий',
    'перевод', 'translation', 'tłumaczenie', 'übersetzung', 'meaning',
  ];
  // Root / stem column — present in Hebrew/Arabic tables. Not a usable lemma.
  const ROOT_HEADERS = ['корень', 'root', 'rdzeń', 'wurzel'];
  const germanIdx = headerCells.findIndex((c) =>
    TARGET_HEADERS.some((k) => c.includes(k)),
  );
  const genderIdx = headerCells.findIndex((c) =>
    GENDER_HEADERS.some((k) => c.includes(k)),
  );
  const translitIdx = headerCells.findIndex((c) =>
    TRANSLIT_HEADERS.some((k) => c.includes(k)),
  );
  const noteIdx = headerCells.findIndex((c) =>
    NOTE_HEADERS.some((k) => c.includes(k)),
  );
  const rootIdx = headerCells.findIndex((c) =>
    ROOT_HEADERS.some((k) => c.includes(k)),
  );
  // Prefer an explicit native header (last column "Перевод"/"Русский"/etc).
  // Fall back to "first column not consumed by anything else" — the original
  // heuristic — when no native header is present.
  //
  // Important: skip the column already claimed as target. Otherwise a header
  // like "Немецкий" (German) matches both TARGET_HEADERS *and* NATIVE_HEADERS,
  // and the parser would assign native = target (showing the target word
  // repeated in the translation column).
  const explicitNativeIdx = headerCells.findIndex((c, i) =>
    i !== germanIdx && NATIVE_HEADERS.some((k) => c.includes(k)),
  );
  // Fallback target when no language-name header is found: first non-skipped
  // column. Lets us parse Hebrew/Serbian conjugation tables where the "target"
  // column is the lemma form (m.sg.) but isn't labelled with the language.
  const inferredTargetIdx =
    germanIdx < 0
      ? headerCells.findIndex(
          (_c, i) =>
            i !== genderIdx &&
            i !== translitIdx &&
            i !== noteIdx &&
            i !== rootIdx &&
            i !== explicitNativeIdx,
        )
      : -1;
  const targetIdx = germanIdx >= 0 ? germanIdx : inferredTargetIdx;
  const nativeIdx = explicitNativeIdx >= 0
    ? explicitNativeIdx
    : headerCells.findIndex(
        (_c, i) =>
          i !== targetIdx &&
          i !== genderIdx &&
          i !== translitIdx &&
          i !== noteIdx &&
          i !== rootIdx,
      );
  if (targetIdx < 0 || nativeIdx < 0) return [];

  const out: VocabRow[] = [];
  for (let i = 1; i < table.children.length; i++) {
    const cells = table.children[i]!.children.map((c) => cellText(c));
    const german = cells[targetIdx];
    if (!german) continue;
    out.push({
      german,
      gender: genderIdx >= 0 ? cells[genderIdx] || null : null,
      native: cells[nativeIdx] ?? '',
    });
  }
  return out;
}

function parseNextUp(src: string): string | null {
  // Find a line matching NEXT_UP_RE; grab from there to end of the blockquote
  const m = src.match(NEXT_UP_RE);
  if (!m) return null;
  const start = m.index!;
  // Blockquotes are markdown ">" prefixed lines until a non-> line or EOF
  const tail = src.slice(start);
  const lines = tail.split(/\r?\n/);
  const buf: string[] = [];
  for (const line of lines) {
    if (line.startsWith('>')) buf.push(line);
    else if (line.trim() === '' && buf.length > 0 && buf[buf.length - 1]?.startsWith('>')) {
      // continuation might allow blank line; stop for now
      break;
    } else if (buf.length > 0) break;
    else buf.push(line);
  }
  return buf.join('\n').trim() || null;
}

// --- tests ------------------------------------------------------------------

async function parseTest(file: string, course: CourseSlug, courseKey: CourseKey, n: number): Promise<Test> {
  const src = await readFile(file, 'utf8');
  const root = parseMd(src);

  const h1 = root.children.find((nn) => nn.type === 'heading' && (nn as Heading).depth === 1) as
    | Heading
    | undefined;
  const title = h1 ? mdastToString(h1).trim() : `Test ${n}`;

  // Instruction = paragraphs between H1 and first ordered list
  const firstListIdx = root.children.findIndex((nn) => nn.type === 'list' && (nn as List).ordered);
  const instructionNodes = root.children.slice(
    root.children.findIndex((nn) => nn === h1) + 1,
    firstListIdx,
  );
  const instruction = instructionNodes
    .filter((nn) => nn.type === 'paragraph')
    .map((nn) => mdastToString(nn).trim())
    .filter(Boolean)
    .join(' ');

  // Prompts = every ordered list before the <details> answer key. Block-end
  // tests group their 50 prompts into 10 sub-lists (one per lesson, under a
  // bold "**Урок N — …**" subheading); flat tests have a single list. Both
  // shapes work — we concatenate the items.
  const detailsBlockStart = src.indexOf('<details');
  const prompts: ExercisePrompt[] = [];
  for (const node of root.children) {
    if (node.type !== 'list' || !(node as List).ordered) continue;
    // mdast position offsets correlate with the raw markdown — stop once we
    // pass the answer-key boundary.
    const pos = (node as List & { position?: { start?: { offset?: number } } }).position;
    if (
      detailsBlockStart >= 0 &&
      pos?.start?.offset !== undefined &&
      pos.start.offset > detailsBlockStart
    ) {
      break;
    }
    for (const li of (node as List).children) {
      prompts.push({ text: mdastToString(li).trim() });
    }
  }

  // Answers = parse <details> block
  const detailsBlock = (() => {
    const openIdx = src.indexOf('<details>');
    if (openIdx < 0) return null;
    const closeIdx = src.indexOf('</details>', openIdx);
    if (closeIdx < 0) return null;
    return src.slice(openIdx, closeIdx + '</details>'.length);
  })();
  const answers = detailsBlock ? extractAnswersFromDetails(detailsBlock) : [];

  return { course, courseKey, n, title, instruction, prompts, answers };
}

// --- texts ------------------------------------------------------------------

// Heading patterns are deliberately permissive — sub-agents have authored
// these files with a variety of casing and wording across courses ("Listening
// text", "Listening and repetition", "Tekst do słuchania", etc.). Match any
// H2 whose text mentions "listening" / "text for listening" / "Текст" etc.
const TEXT_SENTENCES_HEADING_RE = /(?:^\s*(?:[Тт]екст|[Tt]ekst|[Tt]ext)(?=$|\s|[:.\-—])|[Тт]екст\s+для|[Tt]ekst.*słuchania|[Ll]istening|[Tt]ext\s+(?:for|zum|to|do)\s+(?:listening|reading|Hören|Lesen|read|czytania)|[Hh]örtext|[Ll]esetext|[Rr]eading\s+text|[Dd]ialog(?:ue)?\s+\d|[Дд]иалог\s+\d|[Рр]еплики|[Rr]epliken|[Kk]westie|[Ll]ines\s+and|[Сс]лова\s+и\s+фразы|[Ss]łowa\s+i\s+frazy|[Тт]ранслитерация|[Tt]ranslit\b)/i;
// Vocab footer heading: anything mentioning vocab/word/phrase/Список слов/Wort- und Wendungsliste.
const TEXT_VOCAB_HEADING_RE = /(?:[Сс]писок\s+слов|[Ll]ista\s+słów|[Vv]ocab|[Ww]ord|[Pp]hrase|[Ww]ort|[Ww]endung)/;

async function parseText(
  file: string,
  course: CourseSlug,
  courseKey: CourseKey,
  n: number,
  variant: string,
): Promise<Text> {
  const src = await readFile(file, 'utf8');
  const root = parseMd(src);

  const h1 = root.children.find((nn) => nn.type === 'heading' && (nn as Heading).depth === 1) as
    | Heading
    | undefined;
  const title = h1 ? mdastToString(h1).trim() : `Text ${n}${variant}`;

  // Theme = the line right after H1, often bolded "**Тема: ...**"
  let theme: string | null = null;
  const h1Idx = root.children.findIndex((nn) => nn === h1);
  for (let i = h1Idx + 1; i < root.children.length && i < h1Idx + 3; i++) {
    const node = root.children[i];
    if (node?.type === 'paragraph') {
      const txt = mdastToString(node).trim();
      if (txt && !txt.match(TEXT_SENTENCES_HEADING_RE)) {
        theme = txt;
        break;
      }
    }
    if (node?.type === 'heading') break;
  }

  // Walk sections
  const sections = splitH2Sections(root);
  let sentences: string[] = [];
  let vocab: VocabRow[] = [];
  for (const sec of sections) {
    if (TEXT_SENTENCES_HEADING_RE.test(sec.heading)) {
      const list = sec.children.find((nn) => nn.type === 'list' && (nn as List).ordered) as List | undefined;
      if (list) {
        sentences = list.children.map((li) => mdastToString(li).trim());
      }
    } else if (TEXT_VOCAB_HEADING_RE.test(sec.heading)) {
      const tables: Table[] = [];
      collectTables(sec.children, tables);
      vocab = tables.flatMap((t) => parseVocabTable(t));
    }
  }

  return { course, courseKey, n, variant, title, theme, sentences, vocab };
}

// --- dictionary -------------------------------------------------------------

// Dictionary section heading: a single letter (one to a few characters) in
// any script (Latin, Cyrillic, Mkhedruli, Hebrew, Arabic, CJK). Excludes
// multi-word headings like "Memory hacks" which would otherwise be misread
// as letter sections.
const LETTER_HEADING_RE = /^\p{L}{1,3}$/u;
const ARTICLE_RE = /^(der|die|das|sich)\s+/i;

/** Normalize a German vocab entry to its dictionary lemma (the dedup key used
 *  by parseDictionary). Shared so coverage matching uses the exact same rule
 *  as the dictionary — otherwise "words seen" would fail to match entries. */
function germanLemma(german: string): string {
  return german
    .replace(ARTICLE_RE, '')
    .replace(/^sich\s+/i, '')
    .replace(/\s*\((?:m|f|n|pl|Partizip\s*I+|Part\.\s*I+)\)\s*$/i, '')
    .trim()
    .toLowerCase();
}

async function parseDictionary(file: string, course: CourseSlug, courseKey: CourseKey): Promise<Dictionary> {
  const src = await readFile(file, 'utf8');
  const root = parseMd(src);

  const h1 = root.children.find((nn) => nn.type === 'heading' && (nn as Heading).depth === 1) as
    | Heading
    | undefined;
  const title = h1 ? mdastToString(h1).trim() : 'Dictionary';

  // Walk H2 sections: each is a letter
  const sections = splitH2Sections(root);
  const entries: DictionaryEntry[] = [];
  for (const sec of sections) {
    if (!LETTER_HEADING_RE.test(sec.heading)) continue;
    const letter = sec.heading;
    const tables: Table[] = [];
    collectTables(sec.children, tables);
    for (const t of tables) {
      const rows = parseVocabTable(t);
      for (const r of rows) {
        const lemma = germanLemma(r.german);
        entries.push({
          german: r.german,
          lemma,
          gender: r.gender,
          native: r.native,
          letter,
        });
      }
    }
  }

  return { course, courseKey, title, totalEntries: entries.length, entries };
}

// --- main loop --------------------------------------------------------------

async function processCourse(course: CourseSlug, target: TargetLang, native: NativeLang): Promise<{
  courseKey: CourseKey;
  lessonCount: number;
  testCount: number;
  textCount: number;
  dictionaryEntries: number;
  blockCount: number;
}> {
  const courseKey = `${target}.${native}` as CourseKey;
  const baseDir = path.join(COURSES_DIR, course, target, native);
  const outDir = path.join(OUT_DIR, course, courseKey);
  await mkdir(outDir, { recursive: true });
  await mkdir(path.join(outDir, 'lessons'), { recursive: true });
  await mkdir(path.join(outDir, 'tests'), { recursive: true });
  await mkdir(path.join(outDir, 'texts'), { recursive: true });

  // Curriculum
  const curriculum = await parseCurriculum(path.join(baseDir, 'curriculum.md'), course, courseKey);
  await writeFile(path.join(outDir, 'curriculum.json'), JSON.stringify(curriculum, null, 2));

  // Dictionary — the source of truth is the consolidated shared file under
  // courses/_shared/dictionaries/<target>/<native>/dictionary.md (built by
  // scripts/build-dictionary.ts across all courses for that pair). The
  // per-course dictionary.json is still emitted for backward-compat callers
  // (CourseIndex.dictionaryEntries, the /dictionary/<course> route, etc.) and
  // is identical across courses for the same (target, native).
  const dictPath = path.join(
    COURSES_DIR,
    '_shared',
    'dictionaries',
    target,
    native,
    'dictionary.md',
  );
  const dictionary = existsSync(dictPath)
    ? await parseDictionary(dictPath, course, courseKey)
    : { course, courseKey, title: 'Dictionary', totalEntries: 0, entries: [] };
  await writeFile(path.join(outDir, 'dictionary.json'), JSON.stringify(dictionary, null, 2));

  // Lessons
  const lessonsDir = path.join(baseDir, 'lessons');
  const lessonFiles = await readdir(lessonsDir);
  const lessonSlugs: { n: number; title: string }[] = [];
  for (const f of lessonFiles) {
    const m = f.match(/^lesson_(\d{2})\.md$/);
    if (!m) continue;
    const n = parseInt(m[1]!, 10);
    const lesson = await parseLesson(path.join(lessonsDir, f), course, courseKey, n);
    await writeFile(path.join(outDir, 'lessons', `${n}.json`), JSON.stringify(lesson, null, 2));
    lessonSlugs.push({ n, title: lesson.title });
  }

  // Tests. Missing directory is allowed (pre-authoring stage for new pairs).
  const testsDir = path.join(baseDir, 'tests');
  const testFiles = existsSync(testsDir) ? await readdir(testsDir) : [];
  const testSlugs: { n: number; title: string }[] = [];
  for (const f of testFiles) {
    const m = f.match(/^test_(\d{2})\.md$/);
    if (!m) continue;
    const n = parseInt(m[1]!, 10);
    const test = await parseTest(path.join(testsDir, f), course, courseKey, n);
    await writeFile(path.join(outDir, 'tests', `${n}.json`), JSON.stringify(test, null, 2));
    testSlugs.push({ n, title: test.title });
  }

  // Texts. Missing directory is allowed (pre-authoring stage for new pairs).
  const textsDir = path.join(baseDir, 'texts');
  const textFiles = existsSync(textsDir) ? await readdir(textsDir) : [];
  const textSlugs: { n: number; variant: string; title: string }[] = [];
  for (const f of textFiles) {
    const m = f.match(/^text_(\d{2})_(a|b|c)\.md$/);
    if (!m) continue;
    const n = parseInt(m[1]!, 10);
    const variant = m[2]!;
    const text = await parseText(path.join(textsDir, f), course, courseKey, n, variant);
    await writeFile(
      path.join(outDir, 'texts', `${n}-${variant}.json`),
      JSON.stringify(text, null, 2),
    );
    textSlugs.push({ n, variant, title: text.title });
  }

  // Per-course index for fast nav
  const indexJson = {
    course,
    courseKey,
    target,
    native,
    curriculumTitle: curriculum.title,
    blockCount: curriculum.blocks.length,
    lessons: lessonSlugs.sort((a, b) => a.n - b.n),
    tests: testSlugs.sort((a, b) => a.n - b.n),
    texts: textSlugs.sort((a, b) => a.n - b.n || a.variant.localeCompare(b.variant)),
    dictionaryEntries: dictionary.totalEntries,
  };
  await writeFile(path.join(outDir, 'index.json'), JSON.stringify(indexJson, null, 2));

  return {
    courseKey,
    lessonCount: lessonSlugs.length,
    testCount: testSlugs.length,
    textCount: textSlugs.length,
    dictionaryEntries: dictionary.totalEntries,
    blockCount: curriculum.blocks.length,
  };
}

// --- incremental cache ------------------------------------------------------

/** Hash every markdown file under `dir`, sorted by path, into a single
 *  deterministic SHA-256. The hash changes if any file's path or content
 *  changes. */
async function hashSourceTree(dir: string): Promise<string> {
  const files: { rel: string; abs: string }[] = [];
  async function walk(d: string, rel: string): Promise<void> {
    const entries = await readdir(d, { withFileTypes: true });
    for (const e of entries) {
      const abs = path.join(d, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        await walk(abs, r);
      } else if (e.isFile() && e.name.endsWith('.md')) {
        files.push({ rel: r, abs });
      }
    }
  }
  await walk(dir, '');
  files.sort((a, b) => a.rel.localeCompare(b.rel));
  const h = createHash('sha256');
  for (const f of files) {
    h.update(f.rel);
    h.update('\0');
    h.update(await readFile(f.abs));
    h.update('\0');
  }
  return h.digest('hex');
}

/** Hash the build script itself so any parser change invalidates every
 *  course's cached output. */
async function buildScriptVersion(): Promise<string> {
  const self = fileURLToPath(import.meta.url);
  const buf = await readFile(self);
  return createHash('sha256').update(buf).digest('hex').slice(0, 16);
}

interface CacheStamp {
  scriptVersion: string;
  sourceHash: string;
  builtAt: string;
}

async function readCacheStamp(outDir: string): Promise<CacheStamp | null> {
  const file = path.join(outDir, '_inputs.json');
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(await readFile(file, 'utf8')) as CacheStamp;
  } catch {
    return null;
  }
}

async function writeCacheStamp(outDir: string, stamp: CacheStamp): Promise<void> {
  await writeFile(path.join(outDir, '_inputs.json'), JSON.stringify(stamp, null, 2));
}

/** Reconstruct the manifest course entry from an already-emitted course
 *  directory, so a cache hit doesn't need to re-parse anything. */
async function readCourseSummary(
  course: CourseSlug,
  target: TargetLang,
  native: NativeLang,
): Promise<ContentManifest['courses'][number] | null> {
  const courseKey = `${target}.${native}` as CourseKey;
  const outDir = path.join(OUT_DIR, course, courseKey);
  const indexFile = path.join(outDir, 'index.json');
  if (!existsSync(indexFile)) return null;
  try {
    const idx = JSON.parse(await readFile(indexFile, 'utf8')) as {
      lessons?: unknown[];
      tests?: unknown[];
      texts?: unknown[];
      blockCount?: number;
      dictionaryEntries?: number;
    };
    return {
      course,
      courseKey,
      target,
      native,
      lessonCount: Array.isArray(idx.lessons) ? idx.lessons.length : 0,
      testCount: Array.isArray(idx.tests) ? idx.tests.length : 0,
      textCount: Array.isArray(idx.texts) ? idx.texts.length : 0,
      dictionaryEntries: typeof idx.dictionaryEntries === 'number' ? idx.dictionaryEntries : 0,
      blockCount: typeof idx.blockCount === 'number' ? idx.blockCount : 0,
    };
  } catch {
    return null;
  }
}

// --- main -------------------------------------------------------------------

/**
 * Emit content/.generated/<course>/<courseKey>/coverage.json — for each lesson
 * and each listening text, the set of dictionary-lemma ids its vocabulary
 * covers. The dashboard unions these over the lessons the learner completed
 * and the texts they read to derive "words seen" as a true subset of the
 * course dictionary. Ids index the unique lemmas of that pair's dictionary, so
 * the union size is directly the count of distinct dictionary words seen.
 */
async function buildCoverage(): Promise<void> {
  let courseDirs: string[];
  try {
    courseDirs = (await readdir(OUT_DIR)).filter((d) => COURSE_SLUGS.has(d as CourseSlug));
  } catch {
    return;
  }
  for (const course of courseDirs) {
    const courseDir = path.join(OUT_DIR, course);
    let courseKeys: string[];
    try {
      courseKeys = (await readdir(courseDir)).filter((d) => d.includes('.'));
    } catch {
      continue;
    }
    for (const courseKey of courseKeys) {
      const [target, native] = courseKey.split('.');
      const dictFile = path.join(OUT_DIR, '_shared', 'dictionaries', target!, `${native}.json`);
      if (!existsSync(dictFile)) continue;
      const dict = JSON.parse(await readFile(dictFile, 'utf8')) as { entries: { lemma: string }[] };
      // Stable id per unique dictionary lemma.
      const lemmaId = new Map<string, number>();
      for (const e of dict.entries) if (!lemmaId.has(e.lemma)) lemmaId.set(e.lemma, lemmaId.size);

      const coveredIds = (vocab?: { german: string }[]): number[] => {
        const ids = new Set<number>();
        for (const v of vocab ?? []) {
          const id = lemmaId.get(germanLemma(v.german));
          if (id !== undefined) ids.add(id);
        }
        return [...ids].sort((a, b) => a - b);
      };

      const keyDir = path.join(courseDir, courseKey);
      const lessons: Record<string, number[]> = {};
      const lessonsDir = path.join(keyDir, 'lessons');
      if (existsSync(lessonsDir)) {
        for (const f of (await readdir(lessonsDir)).filter((f) => f.endsWith('.json'))) {
          const l = JSON.parse(await readFile(path.join(lessonsDir, f), 'utf8')) as {
            n: number;
            vocab?: { german: string }[];
          };
          lessons[String(l.n)] = coveredIds(l.vocab);
        }
      }
      const texts: Record<string, number[]> = {};
      const textsDir = path.join(keyDir, 'texts');
      if (existsSync(textsDir)) {
        for (const f of (await readdir(textsDir)).filter((f) => f.endsWith('.json'))) {
          const tx = JSON.parse(await readFile(path.join(textsDir, f), 'utf8')) as {
            n: number;
            variant: string;
            vocab?: { german: string }[];
          };
          texts[`${tx.n}-${tx.variant}`] = coveredIds(tx.vocab);
        }
      }
      await writeFile(
        path.join(keyDir, 'coverage.json'),
        JSON.stringify({ lemmaCount: lemmaId.size, lessons, texts }),
      );
    }
  }
}

async function main() {
  console.log(`Building content from ${COURSES_DIR} → ${OUT_DIR}`);

  // Incremental: keep existing .generated; per-course cache stamps decide
  // what to reparse. Force a full rebuild with FORCE_REBUILD=1.
  const force = !!process.env.FORCE_REBUILD;
  if (force) {
    console.log('  FORCE_REBUILD=1 → wiping .generated');
    if (existsSync(OUT_DIR)) await rm(OUT_DIR, { recursive: true, force: true });
  }
  await mkdir(OUT_DIR, { recursive: true });

  const scriptVersion = await buildScriptVersion();
  let hits = 0;
  let misses = 0;
  const seenOutDirs = new Set<string>();

  // Discover course/target/native triples
  const courseDirs = await readdir(COURSES_DIR);
  const courses: ContentManifest['courses'] = [];
  for (const courseSlug of courseDirs) {
    if (!COURSE_SLUGS.has(courseSlug as CourseSlug)) {
      console.log(`  skip course=${courseSlug} (not in COURSES registry)`);
      continue;
    }
    const courseRoot = path.join(COURSES_DIR, courseSlug);
    const courseStat = await stat(courseRoot);
    if (!courseStat.isDirectory()) continue;
    const targets = await readdir(courseRoot);
    for (const target of targets) {
      if (!TARGETS.has(target as TargetLang)) {
        console.log(`  skip target=${target} (not in allowlist)`);
        continue;
      }
      const targetDir = path.join(courseRoot, target);
      const targetStat = await stat(targetDir);
      if (!targetStat.isDirectory()) continue;
      const natives = await readdir(targetDir);
      for (const native of natives) {
        if (!NATIVES.has(native as NativeLang)) {
          console.log(`  skip native=${native} (not in allowlist)`);
          continue;
        }
        const pairDir = path.join(targetDir, native);
        const cs = await stat(pairDir);
        if (!cs.isDirectory()) continue;

        const courseKey = `${target}.${native}` as CourseKey;
        const outDir = path.join(OUT_DIR, courseSlug, courseKey);
        seenOutDirs.add(outDir);

        const sourceHash = await hashSourceTree(pairDir);
        const cached = await readCacheStamp(outDir);
        if (
          !force &&
          cached &&
          cached.scriptVersion === scriptVersion &&
          cached.sourceHash === sourceHash
        ) {
          const reusedSummary = await readCourseSummary(
            courseSlug as CourseSlug,
            target as TargetLang,
            native as NativeLang,
          );
          if (reusedSummary) {
            courses.push(reusedSummary);
            hits++;
            console.log(
              `  cached ${courseSlug}/${target}/${native} (${reusedSummary.lessonCount} lessons, ${reusedSummary.testCount} tests, ${reusedSummary.textCount} texts)`,
            );
            continue;
          }
          // Stamp matched but index was missing — fall through to a full
          // re-process to repair the output.
        }

        // Cache miss → wipe this course's output dir before re-emitting so
        // stale files from a prior build can't leak through.
        if (existsSync(outDir)) await rm(outDir, { recursive: true, force: true });
        console.log(`  parsing ${courseSlug}/${target}/${native}…`);
        const summary = await processCourse(
          courseSlug as CourseSlug,
          target as TargetLang,
          native as NativeLang,
        );
        courses.push({
          course: courseSlug as CourseSlug,
          courseKey: summary.courseKey,
          target: target as TargetLang,
          native: native as NativeLang,
          lessonCount: summary.lessonCount,
          testCount: summary.testCount,
          textCount: summary.textCount,
          dictionaryEntries: summary.dictionaryEntries,
          blockCount: summary.blockCount,
        });
        await writeCacheStamp(outDir, {
          scriptVersion,
          sourceHash,
          builtAt: new Date().toISOString(),
        });
        misses++;
        console.log(
          `    ✓ ${summary.lessonCount} lessons, ${summary.testCount} tests, ${summary.textCount} texts, ${summary.dictionaryEntries} dict entries`,
        );
      }
    }
  }

  // GC: prune .generated directories for courses no longer in the source tree
  // (e.g. a registry removal). Leaves _shared/ alone — handled below.
  for (const courseSlug of await readdir(OUT_DIR).catch(() => [])) {
    if (courseSlug === '_shared' || courseSlug === 'manifest.json') continue;
    const courseOut = path.join(OUT_DIR, courseSlug);
    let kids: string[] = [];
    try {
      kids = await readdir(courseOut);
    } catch {
      continue;
    }
    for (const k of kids) {
      const dir = path.join(courseOut, k);
      if (!seenOutDirs.has(dir)) {
        console.log(`  gc ${courseSlug}/${k}`);
        await rm(dir, { recursive: true, force: true });
      }
    }
  }

  // After all per-course builds, walk courses/_shared/dictionaries/<t>/<n>/
  // and emit the global dictionary JSON for each pair. This is what the
  // single /<target>/<native>/dictionary route reads.
  //
  // Cache: each (target, native) gets a stamp file alongside the JSON. The
  // stamp records the source-file hash + script version; on hit we reuse the
  // existing JSON and skip parseDictionary entirely (which is the slowest
  // part — these files have 3-4 K entries each).
  const sharedDictRoot = path.join(COURSES_DIR, '_shared', 'dictionaries');
  if (existsSync(sharedDictRoot)) {
    const targets = await readdir(sharedDictRoot);
    for (const target of targets) {
      if (!TARGETS.has(target as TargetLang)) continue;
      const tDir = path.join(sharedDictRoot, target);
      const tStat = await stat(tDir);
      if (!tStat.isDirectory()) continue;
      const natives = await readdir(tDir);
      for (const native of natives) {
        if (!NATIVES.has(native as NativeLang)) continue;
        const file = path.join(tDir, native, 'dictionary.md');
        if (!existsSync(file)) continue;

        const buf = await readFile(file);
        const sourceHash = createHash('sha256').update(buf).digest('hex');
        const outFile = path.join(OUT_DIR, '_shared', 'dictionaries', target, `${native}.json`);
        const stampFile = `${outFile}.stamp.json`;
        if (!force && existsSync(outFile) && existsSync(stampFile)) {
          try {
            const stamp = JSON.parse(await readFile(stampFile, 'utf8')) as CacheStamp;
            if (stamp.scriptVersion === scriptVersion && stamp.sourceHash === sourceHash) {
              // Re-read the JSON just to log the entry count for parity with
              // the cache-miss path.
              const cachedDict = JSON.parse(await readFile(outFile, 'utf8')) as { totalEntries?: number };
              console.log(`  cached global dict ${target}.${native} (${cachedDict.totalEntries ?? '?'} entries)`);
              continue;
            }
          } catch {
            // Stamp unreadable — fall through and rebuild.
          }
        }

        const dict = await parseDictionary(
          file,
          // Per-course identifiers aren't meaningful for the global dict; use
          // sentinel values so consumers can tell them apart from a per-course
          // emit if needed.
          'classic50' as CourseSlug,
          `${target}.${native}` as CourseKey,
        );
        await mkdir(path.dirname(outFile), { recursive: true });
        await writeFile(outFile, JSON.stringify(dict, null, 2));
        await writeFile(stampFile, JSON.stringify({
          scriptVersion,
          sourceHash,
          builtAt: new Date().toISOString(),
        }, null, 2));
        console.log(`  global dict ${target}.${native}: ${dict.totalEntries} entries → ${outFile}`);
      }
    }
  }

  // Per-course lemma coverage for the "words seen" dashboard metric. Runs last
  // so every lesson/text JSON and the shared dictionaries already exist.
  await buildCoverage();

  const manifest: ContentManifest = {
    builtAt: new Date().toISOString(),
    buildId: randomBytes(4).toString('hex'),
    courses,
  };
  await writeFile(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`\n✓ manifest written. buildId=${manifest.buildId}`);
  console.log(`  cache: ${hits} hit, ${misses} miss`);
}

main().catch((err) => {
  console.error('Content build failed:', err);
  process.exit(1);
});
