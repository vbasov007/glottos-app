#!/usr/bin/env tsx
/**
 * Dedupe per-unit vocab tables. Walk lessons in order 1..50; for each lesson,
 * drop rows whose German entry already appeared in any earlier lesson. Match
 * is exact, case-insensitive, on the trimmed German column.
 *
 * Idempotent: re-running on deduped tables is a no-op.
 *
 * Caveats — does NOT collapse:
 *   - Lemma vs. inflection: `kommen` and `Ich komme aus` are different strings,
 *     so both survive. Only exact string repeats are removed.
 *   - Punctuation variants: `Hallo!` and `Hallo` are different strings.
 * If lemma-level dedup is wanted, run as a second pass with explicit rules.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const LESSONS_DIR = path.resolve(
  __dirname,
  '..',
  '..',
  'courses',
  'losreden50',
  'de',
  'ru',
  'lessons',
);

const VOCAB_END = String.raw`(?=\n---\n\n>\s*\*\*Следующий шаг|$)`;
const VOCAB_SECTION_RE = new RegExp(
  String.raw`\n## Часть:\s*Словарь юнита[\s\S]*?${VOCAB_END}`,
);
const TABLE_ROW_RE = /^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*$/;

interface VocabRow {
  german: string;
  russian: string;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function parseVocab(md: string): VocabRow[] {
  const m = md.match(VOCAB_SECTION_RE);
  if (!m) return [];
  const rows: VocabRow[] = [];
  for (const line of m[0].split('\n')) {
    const r = TABLE_ROW_RE.exec(line);
    if (!r) continue;
    const g = r[1]!.trim();
    const ru = r[2]!.trim();
    if (g === 'Немецкий') continue;
    if (/^[-:\s]+$/.test(g)) continue;
    rows.push({ german: g, russian: ru });
  }
  return rows;
}

function normalize(s: string): string {
  return s.toLowerCase().trim();
}

function renderSection(entries: VocabRow[]): string {
  const rows = entries.map((e) => `| ${e.german} | ${e.russian} |`).join('\n');
  return [
    '## Часть: Словарь юнита',
    '',
    'Ключевая лексика этого юнита (AI-сводка по материалу юнита и аудио-текстам).',
    '',
    '| Немецкий | Русский |',
    '|----------|---------|',
    rows,
  ].join('\n');
}

function main(): void {
  const seen = new Set<string>();
  for (let n = 1; n <= 50; n++) {
    const file = path.join(LESSONS_DIR, `lesson_${pad2(n)}.md`);
    const md = readFileSync(file, 'utf8');
    const items = parseVocab(md);
    if (items.length === 0) {
      console.log(`L${pad2(n)} (no vocab section)`);
      continue;
    }
    const kept: VocabRow[] = [];
    const dropped: string[] = [];
    for (const item of items) {
      const key = normalize(item.german);
      if (seen.has(key)) {
        dropped.push(item.german);
      } else {
        kept.push(item);
        seen.add(key);
      }
    }
    if (dropped.length > 0) {
      const updated = md.replace(VOCAB_SECTION_RE, '\n\n' + renderSection(kept));
      writeFileSync(file, updated);
    }
    const dropPreview =
      dropped.length === 0
        ? ''
        : `  drop: ${dropped.slice(0, 4).join(', ')}${dropped.length > 4 ? ` +${dropped.length - 4}` : ''}`;
    console.log(`L${pad2(n)} ${items.length} → ${kept.length}${dropPreview}`);
  }
  console.log(`\nUnique items across all lessons: ${seen.size}`);
}

main();
