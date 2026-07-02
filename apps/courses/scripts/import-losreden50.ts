#!/usr/bin/env tsx
/**
 * One-shot import: convert the losreden_de_src/ Russian-native German fluency
 * materials into the classic50-shaped course layout under
 *   courses/losreden50/de/ru/{lessons,tests,texts,curriculum.md,dictionary.md}
 *
 * Source layout: 5 stage files (stage-N-units-X-Y.md), each containing 10
 * units separated by H1 "# Юнит N — TITLE". Each unit has three sections —
 * Раздел 1 (explanation), Раздел 2 (write-from-scratch exercises with a
 * trailing "Ключ к разделу 2" section), Раздел 3 (three "Аудио-текст N —
 * «TITLE»" entries, each followed by a blockquote of ~30 sentences).
 *
 * Target shape per classic50:
 *   lesson_NN.md — H1 + vocab-subtitle + Часть-N sections + numbered exercises
 *                  with `<details><summary>Ключи</summary>` blocks + "Следующий
 *                  шаг" closing blockquote.
 *   text_NN_X.md — H1 + theme + `## Текст для аудирования` with numbered list
 *                  of sentences. No vocab table (source has only RECOGNIZE
 *                  lemma lists without Russian translations).
 *
 * Tests/ stays empty (the fluency course has no per-unit tests by design).
 * Dictionary.md is a stub — the build-dictionary script will regenerate it
 * from whatever vocab tables exist inside the converted lessons.
 *
 * Idempotent: running it again overwrites the destination.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(__dirname, '..', '..', 'losreden_de_src');
const DEST = path.resolve(__dirname, '..', '..', 'courses', 'losreden50', 'de', 'ru');

interface Unit {
  n: number;
  h1: string; // "Юнит N — Title"
  title: string; // just "Title" (after the dash)
  metaLine: string; // "**Тип:** ... · **Функция:** ..." paragraph
  whatYouCan: string; // "**Что вы сможете...**" paragraph (may be empty)
  sectionsBody: string; // markdown for Раздел 1 + Раздел 2 (exercises) + key
  audioTexts: { title: string; body: string }[]; // up to 3
  nextUpTitle?: string; // populated post-pass
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function readSrc(file: string): string {
  return readFileSync(path.join(SRC, file), 'utf8');
}

/** Strip the YAML front-matter (--- … ---) at the top of a stage file. */
function stripFrontMatter(s: string): string {
  if (!s.startsWith('---')) return s;
  const end = s.indexOf('\n---', 3);
  if (end < 0) return s;
  return s.slice(end + 4).replace(/^\s*\n/, '');
}

/** Split a stage file into per-unit slices. Each unit starts with `# Юнит N — ...`. */
function splitUnits(stageMd: string): Unit[] {
  const body = stripFrontMatter(stageMd);
  const lines = body.split('\n');
  const starts: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^# Юнит \d+/.test(lines[i]!)) starts.push(i);
  }
  const units: Unit[] = [];
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i]!;
    const end = i + 1 < starts.length ? starts[i + 1]! : lines.length;
    const chunk = lines.slice(start, end).join('\n');
    units.push(parseUnit(chunk));
  }
  return units;
}

function parseUnit(chunk: string): Unit {
  const lines = chunk.split('\n');
  const h1 = lines[0]!;
  const m = h1.match(/^# Юнит (\d+) [—-]\s*(.+?)\s*$/);
  if (!m) throw new Error(`Bad H1: ${h1}`);
  const n = parseInt(m[1]!, 10);
  const title = m[2]!;

  // Lines 1..K are header paragraphs until first H2 or H3.
  let bodyStart = 1;
  while (bodyStart < lines.length && !/^##\s/.test(lines[bodyStart]!) && !/^### /.test(lines[bodyStart]!)) {
    bodyStart++;
  }
  const header = lines.slice(1, bodyStart).join('\n').trim();
  const headerParas = header.split(/\n\s*\n/);
  const metaLine = headerParas[0] ?? '';
  const whatYouCan = headerParas[1] ?? '';

  // Now split the rest by H2 sections.
  const rest = lines.slice(bodyStart).join('\n');
  const h2Slices = splitH2(rest);

  // Раздел 1 + Раздел 2 (with key) go into the lesson body.
  // Раздел 3 contains audio texts.
  const lessonH2Slices: { heading: string; body: string }[] = [];
  let audioTexts: { title: string; body: string }[] = [];
  for (const s of h2Slices) {
    if (/Раздел 3/i.test(s.heading) || /Аудио/i.test(s.heading)) {
      audioTexts = extractAudioTexts(s.body);
    } else {
      lessonH2Slices.push(s);
    }
  }

  // Reassemble lesson H2s back into markdown, applying the classic50 transforms.
  let lessonBody = '';
  for (const s of lessonH2Slices) {
    lessonBody += `\n## ${s.heading}\n\n${s.body.trim()}\n`;
  }

  // Convert "Раздел 2. … exercises … Ключ к разделу 2 …" into per-exercise <details>.
  lessonBody = wrapExerciseKeysInDetails(lessonBody);

  // Some source exercises pack all prompts on a single line: "1. foo 2. bar 3. baz".
  // The lesson parser only recognises `1.`-prefixed list ITEMS on their own
  // lines as separate prompts, so we expand inline-numbered prompts into one
  // line each. Conservative trigger: do this only when a line starts with
  // "1." and contains at least one more "<digit>." marker mid-line.
  lessonBody = expandInlineNumberedPrompts(lessonBody);

  // The source units don't have a dedicated `## Словарь` section — but Раздел 1
  // has multiple German/Russian tables inline (Ключевые фразы, Фразы знакомства,
  // alphabet grids, …). Aggregate them into one consolidated vocab section the
  // dictionary parser and per-lesson vocab tab can find.
  const aggregatedVocab = aggregateVocab(lessonBody);
  if (aggregatedVocab.length > 0) {
    lessonBody = lessonBody.trim() + '\n\n' + renderVocabSection(aggregatedVocab);
  }

  return {
    n,
    h1: h1.replace(/^# /, ''),
    title,
    metaLine,
    whatYouCan,
    sectionsBody: lessonBody.trim(),
    audioTexts,
  };
}

/** Walk all markdown tables in the lesson body, collect (German, Russian)
 *  pairs, deduplicate, and return them in source order. Used to build a
 *  per-unit vocab section out of the inline tables that already exist in
 *  Раздел 1 (Ключевые фразы, Фразы знакомства, …). */
function aggregateVocab(lessonBody: string): { german: string; russian: string }[] {
  const out: { german: string; russian: string }[] = [];
  const seen = new Set<string>();
  const tables = splitTables(lessonBody);
  for (const t of tables) {
    if (t.rows.length < 2) continue;
    const header = t.rows[0]!.map((c) => c.toLowerCase());
    const germanCol = header.findIndex((c) => /немецк|german/.test(c));
    if (germanCol < 0) continue;
    let russianCol = header.findIndex(
      (c, i) => i !== germanCol && /русск|russian|перевод/.test(c),
    );
    if (russianCol < 0 && header.length === 2) russianCol = 1 - germanCol;
    if (russianCol < 0) continue;
    for (let i = 1; i < t.rows.length; i++) {
      const row = t.rows[i]!;
      const germanRaw = (row[germanCol] ?? '').trim();
      const russian = (row[russianCol] ?? '').trim();
      if (!germanRaw || !russian) continue;
      const german = germanRaw
        .replace(/^\*\*/, '')
        .replace(/\*\*$/, '')
        .replace(/\s*[…\.]{1,3}\s*$/, '')
        .trim();
      if (!german) continue;
      const key = german.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ german, russian });
    }
  }
  return out;
}

interface TableSlice {
  rows: string[][];
}

function splitTables(md: string): TableSlice[] {
  const lines = md.split('\n');
  const out: TableSlice[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const next = lines[i + 1];
    if (
      line.trimStart().startsWith('|') &&
      next != null &&
      next.trimStart().startsWith('|') &&
      /^[\s|:\-]+$/.test(next)
    ) {
      const rows: string[][] = [splitTableRow(line)];
      let j = i + 2;
      while (j < lines.length && lines[j]!.trimStart().startsWith('|')) {
        rows.push(splitTableRow(lines[j]!));
        j++;
      }
      out.push({ rows });
      i = j;
      continue;
    }
    i++;
  }
  return out;
}

function splitTableRow(line: string): string[] {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return inner.split('|').map((c) => c.trim());
}

function renderVocabSection(entries: { german: string; russian: string }[]): string {
  const rows = entries.map((e) => `| ${e.german} | ${e.russian} |`).join('\n');
  return [
    '## Часть: Словарь юнита',
    '',
    'Сводка лексики, введённой в этом юните.',
    '',
    '| Немецкий | Русский |',
    '|----------|---------|',
    rows,
    '',
  ].join('\n');
}

/**
 * Expand "1. foo 2. bar 3. baz" inline-numbered runs into one-item-per-line
 * markdown lists. Only fires on lines that start with `1.` and have at least
 * one more inline `\d+.` marker. Numbers inside parenthetical notes or normal
 * prose (e.g. "in 1990") aren't affected because they don't lead the line.
 */
function expandInlineNumberedPrompts(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  for (const line of lines) {
    const trimmed = line.trimStart();
    // Must start with "1." and have at least one more "<digit>." after it.
    if (!/^1\.\s/.test(trimmed)) {
      out.push(line);
      continue;
    }
    const items = splitNumberedRun(trimmed);
    if (items.length < 2) {
      out.push(line);
      continue;
    }
    for (let i = 0; i < items.length; i++) {
      out.push(`${i + 1}. ${items[i]}`);
    }
  }
  return out.join('\n');
}

/** Split "1. foo 2. bar 3. baz." into ["foo", "bar", "baz."]. Numbers must be
 *  preceded by whitespace or start-of-string (not e.g. inside "1990").
 *
 *  Walks forward: anchor on "1." at the start, then find "2." AFTER it, then
 *  "3." AFTER that, and so on. Numbers in the middle that don't fit the
 *  sequence (e.g. "12." inside an answer) get absorbed into the current
 *  item instead of breaking the parse. */
function splitNumberedRun(s: string): string[] {
  const findMarker = (target: number, fromIdx: number): { start: number; after: number } | null => {
    // Match the literal "<target>." preceded by whitespace or string start.
    const re = new RegExp(`(?:^|\\s)${target}\\.\\s+`, 'g');
    re.lastIndex = fromIdx;
    const m = re.exec(s);
    if (!m) return null;
    return { start: m.index, after: m.index + m[0].length };
  };

  // Must start with "1." (allowing leading whitespace).
  const first = findMarker(1, 0);
  if (!first || s.slice(0, first.start).trim().length > 0) return [];

  const positions: { num: number; markerStart: number; afterIdx: number }[] = [first].map(
    (p) => ({ num: 1, markerStart: p.start, afterIdx: p.after }),
  );
  let next = 2;
  while (true) {
    const found = findMarker(next, positions[positions.length - 1]!.afterIdx);
    if (!found) break;
    positions.push({ num: next, markerStart: found.start, afterIdx: found.after });
    next++;
  }
  if (positions.length < 2) return [];

  const out: string[] = [];
  for (let i = 0; i < positions.length; i++) {
    const start = positions[i]!.afterIdx;
    const end = i + 1 < positions.length ? positions[i + 1]!.markerStart : s.length;
    out.push(s.slice(start, end).trim());
  }
  return out;
}

function splitH2(s: string): { heading: string; body: string }[] {
  const lines = s.split('\n');
  const result: { heading: string; body: string }[] = [];
  let cur: { heading: string; body: string } | null = null;
  for (const line of lines) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m) {
      if (cur) result.push(cur);
      cur = { heading: m[1]!, body: '' };
    } else if (cur) {
      cur.body += line + '\n';
    }
  }
  if (cur) result.push(cur);
  return result;
}

/** Within a "Раздел 3" body, find each `### Аудио-текст N — «Title»` followed
 *  by a blockquote (lines starting with `>`). */
function extractAudioTexts(body: string): { title: string; body: string }[] {
  const lines = body.split('\n');
  const out: { title: string; body: string }[] = [];
  let i = 0;
  while (i < lines.length) {
    const m = lines[i]!.match(/^### Аудио-текст \d+\s*[—-]\s*[«"](.+?)[»"]/);
    if (!m) { i++; continue; }
    const title = m[1]!;
    i++;
    // Skip blank lines until blockquote.
    while (i < lines.length && lines[i]!.trim() === '') i++;
    if (i >= lines.length || !lines[i]!.startsWith('>')) continue;
    // Take exactly the first blockquote (single line or multi-line). The
    // RECOGNIZE notes are separate blockquotes preceded by their own H3 or
    // a blank line + paragraph delimiter, so they won't get joined here.
    const quoteLines: string[] = [];
    while (i < lines.length && lines[i]!.startsWith('>')) {
      quoteLines.push(lines[i]!.replace(/^>\s?/, ''));
      i++;
    }
    out.push({ title, body: quoteLines.join(' ').trim() });
  }
  return out;
}

/** In the lesson body, locate `## Раздел 2.` block, parse its `### Ключ к разделу 2`
 *  subsection, split into per-exercise answers (`**2.1.** ...`, `**2.2.** ...`),
 *  and inject a `<details><summary>Ключи</summary>` block right after each
 *  matching `### Упражнение 2.M.` heading + its content. */
function wrapExerciseKeysInDetails(lessonBody: string): string {
  // Find Раздел 2 section
  const sections = splitH2(lessonBody);
  let didTransform = false;
  for (const sec of sections) {
    if (!/Раздел 2/i.test(sec.heading)) continue;
    // Split body by ### headings; find the "Ключ к разделу 2" subsection.
    const subLines = sec.body.split('\n');
    let keyStart = -1;
    for (let i = 0; i < subLines.length; i++) {
      if (/^### Ключ к разделу 2\b/.test(subLines[i]!)) { keyStart = i; break; }
    }
    if (keyStart < 0) continue;
    // Collect key lines until next ## or end
    let keyEnd = subLines.length;
    for (let i = keyStart + 1; i < subLines.length; i++) {
      if (/^##\s/.test(subLines[i]!)) { keyEnd = i; break; }
    }
    const keyContent = subLines.slice(keyStart + 1, keyEnd).join('\n');
    // Parse `**N.M.**` markers
    const keys: Record<string, string> = {}; // "2.1" -> "1. sieben 2. dreizehn …"
    const re = /\*\*(\d+\.\d+)\.\*\*\s*([\s\S]*?)(?=\n\*\*\d+\.\d+\.\*\*|\n##|\n*$)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(keyContent)) !== null) {
      keys[m[1]!] = m[2]!.trim();
    }
    // Now rebuild Раздел 2 body: drop the "Ключ к разделу 2" subsection,
    // and after each `### Упражнение N.M. …` block, insert a <details>
    // <summary>Ключи</summary> block with that exercise's answers (formatted
    // as `<num>. *<answer>*` lines split out of the key string).
    const bodyHead = subLines.slice(0, keyStart).join('\n');
    // Now process bodyHead: find each `### Упражнение N.M.` and inject details
    // immediately after the exercise body ends (= just before the next ### or end).
    const transformed = injectExerciseDetails(bodyHead, keys);
    sec.body = transformed;
    didTransform = true;
  }
  if (!didTransform) return lessonBody;
  // Reassemble
  return sections.map((s) => `## ${s.heading}\n\n${s.body.trim()}`).join('\n\n');
}

function injectExerciseDetails(bodyMd: string, keys: Record<string, string>): string {
  const lines = bodyMd.split('\n');
  // Locate every "### Упражнение N.M." heading line; record its index and key.
  const exercises: { lineIdx: number; key: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]!.match(/^### Упражнение (\d+\.\d+)\b/);
    if (m) exercises.push({ lineIdx: i, key: m[1]! });
  }
  if (exercises.length === 0) return bodyMd;
  // Determine the end of each exercise block (= line before the next ### or
  // end of input).
  const blockEnds: number[] = [];
  for (let i = 0; i < exercises.length; i++) {
    blockEnds.push(i + 1 < exercises.length ? exercises[i + 1]!.lineIdx : lines.length);
  }
  // Build new lines, inserting <details> right before each blockEnd.
  const inserts: { atIdx: number; payload: string }[] = [];
  exercises.forEach((ex, i) => {
    const k = keys[ex.key];
    if (!k) return;
    inserts.push({ atIdx: blockEnds[i]!, payload: formatDetails(k) });
  });
  // Re-emit lines with inserts.
  inserts.sort((a, b) => b.atIdx - a.atIdx);
  for (const ins of inserts) {
    lines.splice(ins.atIdx, 0, '', ins.payload, '');
  }
  return lines.join('\n');
}

/** Format the raw key string ("1. sieben 2. dreizehn 3. zwanzig …") into a
 *  `<details><summary>Ключи</summary>` block with one italicized answer per
 *  numbered line. If the key starts with "Образец:" it's a sample-only key —
 *  rendered as a single paragraph inside the details. */
function formatDetails(raw: string): string {
  const trimmed = raw.trim();
  let inner: string;
  if (/^Образец\b/i.test(trimmed)) {
    inner = trimmed;
  } else {
    // Split into numbered chunks. The pattern captures "N. content" where
    // content extends lazily to the next " N. " marker or end.
    const re = /(\d+)\.\s+([^]*?)(?=\s+\d+\.\s|$)/g;
    const parts: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(trimmed)) !== null) {
      const text = m[2]!.trim().replace(/\.$/, '');
      parts.push(`${m[1]}. *${text}*`);
    }
    inner = parts.length > 0 ? parts.join('\n') : trimmed;
  }
  return `<details>\n<summary>Ключи</summary>\n\n${inner}\n\n</details>`;
}

// --- Output writers --------------------------------------------------------

function buildLesson(u: Unit, nextUpHint: string | null): string {
  // Use the meta line as the "subtitle" — but the parser requires the subtitle
  // paragraph to start with one of "Vocabulary:", "Словарный запас:", or
  // "Słownictwo:". Source meta is "**Тип:** GRAMMAR · **Функция:** … · **Грамматика:** …".
  // We strip all the inner `**` markers (otherwise we get nested-bold artefacts)
  // and rebuild a single bold subtitle with a clean "Словарный запас: …" prefix.
  const stripped = u.metaLine
    .replace(/\*\*/g, '') // drop all bold markers
    .replace(/^Тип:\s*/, '') // drop the leading "Тип:" label
    .trim();
  const subtitle = `**Словарный запас: ${stripped}**`;

  const intro = u.whatYouCan && /\*\*Что вы сможете/i.test(u.whatYouCan)
    ? u.whatYouCan
    : '';

  let nextUp = '';
  if (nextUpHint) {
    nextUp = `> **Следующий шаг:** ${nextUpHint}`;
  }

  const parts = [
    `# ${u.h1}`,
    '',
    subtitle,
    '',
  ];
  if (intro) {
    parts.push(intro, '');
  }
  parts.push('---', '', u.sectionsBody.trim(), '');
  if (nextUp) {
    parts.push('---', '', nextUp, '');
  }
  return parts.join('\n');
}

function buildText(u: Unit, t: { title: string; body: string }, variant: 'a' | 'b' | 'c'): string {
  // Split body into sentences. The German audio texts are written as
  // sentence sequences with `. ! ?` as terminators; preserve those.
  const sentences = splitSentences(t.body);
  const numbered = sentences
    .map((s, i) => `${i + 1}. ${s}`)
    .join('\n');
  return [
    `# Текст к Юниту ${u.n} (вариант ${variant.toUpperCase()}): ${t.title}`,
    '',
    `**Тема: ${u.title}**`,
    '',
    '---',
    '',
    '## Текст для аудирования',
    '',
    numbered,
    '',
  ].join('\n');
}

function splitSentences(body: string): string[] {
  // Greedy: split on `.|!|?` followed by whitespace, keeping the terminator.
  const re = /([^.!?]+[.!?]+)/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const s = m[1]!.trim();
    if (s.length > 0) out.push(s);
  }
  return out;
}

// --- main ------------------------------------------------------------------

function main() {
  mkdirSync(path.join(DEST, 'lessons'), { recursive: true });
  mkdirSync(path.join(DEST, 'tests'), { recursive: true });
  mkdirSync(path.join(DEST, 'texts'), { recursive: true });
  writeFileSync(path.join(DEST, 'tests', '.gitkeep'), '');

  const stages = [
    'stage-1-units-1-10.md',
    'stage-2-units-11-20.md',
    'stage-3-units-21-30.md',
    'stage-4-units-31-40.md',
    'stage-5-units-41-50.md',
  ];

  const allUnits: Unit[] = [];
  for (const f of stages) {
    const md = readSrc(f);
    allUnits.push(...splitUnits(md));
  }
  allUnits.sort((a, b) => a.n - b.n);

  // Populate "Следующий шаг" hints based on the next unit's H1.
  for (let i = 0; i < allUnits.length; i++) {
    const next = allUnits[i + 1];
    allUnits[i]!.nextUpTitle = next ? `Юнит ${next.n} — ${next.title}.` : undefined;
  }

  let lessonsWritten = 0;
  let textsWritten = 0;
  for (const u of allUnits) {
    writeFileSync(
      path.join(DEST, 'lessons', `lesson_${pad2(u.n)}.md`),
      buildLesson(u, u.nextUpTitle ?? null),
    );
    lessonsWritten++;

    const variants: Array<'a' | 'b' | 'c'> = ['a', 'b', 'c'];
    for (let i = 0; i < u.audioTexts.length && i < 3; i++) {
      const variant = variants[i]!;
      writeFileSync(
        path.join(DEST, 'texts', `text_${pad2(u.n)}_${variant}.md`),
        buildText(u, u.audioTexts[i]!, variant),
      );
      textsWritten++;
    }
  }

  console.log(`Wrote ${lessonsWritten} lessons + ${textsWritten} listening texts to ${DEST}`);
}

main();
