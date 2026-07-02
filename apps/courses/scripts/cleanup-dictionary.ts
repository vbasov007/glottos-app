/**
 * Clean up source dictionary.md files for all native languages:
 *
 *   1. Drop "bare" duplicate rows — every noun where the same lemma appears
 *      once without article/gender (e.g. `| Bett |  | кровать |`) AND once
 *      with article + gender (`| das Bett | n | кровать |`). The bare form
 *      is the authoring slip; keep the gendered one.
 *
 *   2. Drop grammar-pattern entries that shouldn't live in the dictionary at
 *      all — they describe grammatical constructions (`als + Konj. II`,
 *      `je ... desto`, `am + (Ordnungszahl) + -en`, etc.) and were polluting
 *      the alphabetical word list.
 *
 * Rewrites courses/de/{ru,en,pl}/dictionary.md in place. Idempotent —
 * re-running on a clean file removes nothing.
 *
 *   npm run cleanup:dict
 */
import fs from 'node:fs';
import path from 'node:path';

const COURSES_ROOT = path.resolve(__dirname, '..', '..', 'courses', 'de');
const NATIVES = ['ru', 'en', 'pl'] as const;

const ARTICLE_RE = /^(der|die|das)\s+/i;
const SICH_RE = /^sich\s+/i;
const GENDER_SUFFIX_RE = /\s*\((?:m|f|n|pl|Partizip\s*I+|Part\.\s*I+)\)\s*$/i;

function lemmaOf(german: string): string {
  return german
    .replace(ARTICLE_RE, '')
    .replace(SICH_RE, '')
    .replace(GENDER_SUFFIX_RE, '')
    .trim()
    .toLowerCase();
}

const GRAMMAR_PATTERN_RE =
  /(\+\s*(Konj\.|Konjunktiv|Ordnungszahl|глагол|-en)|\bdesto\b|\bdoch nur\b|\bals\s+ob\b)/i;

function isGrammarPattern(german: string): boolean {
  return GRAMMAR_PATTERN_RE.test(german);
}

interface ParsedRow {
  raw: string;
  german: string;
  gender: string;
  native: string;
}

function parseRow(line: string): ParsedRow | null {
  // Standard pipe table row: | a | b | c |
  const parts = line.split('|').map((s) => s.trim());
  if (parts.length < 5) return null;
  const [, german = '', gender = '', native = ''] = parts;
  if (!german) return null;
  return { raw: line, german, gender, native };
}

function processFile(file: string): { droppedBare: number; droppedGrammar: number } {
  const lines = fs.readFileSync(file, 'utf8').split('\n');

  // Pass 1: collect every parsed row + line index so we can spot bare/article dups.
  const rows: { row: ParsedRow; lineIdx: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // Skip header separators like | ---- | --- | --- |
    if (/^\|\s*-+\s*\|/.test(line)) continue;
    if (/^\|\s*(Немецкий|German|Niemiecki)\s*\|/i.test(line)) continue;
    if (!line.trimStart().startsWith('|')) continue;
    const r = parseRow(line);
    if (!r) continue;
    rows.push({ row: r, lineIdx: i });
  }

  // Group by lemma to find duplicates.
  const byLemma = new Map<string, { row: ParsedRow; lineIdx: number }[]>();
  for (const item of rows) {
    const key = lemmaOf(item.row.german);
    if (!byLemma.has(key)) byLemma.set(key, []);
    byLemma.get(key)!.push(item);
  }

  // Mark lines for deletion.
  const dropLines = new Set<number>();
  let droppedBare = 0;
  let droppedGrammar = 0;

  // Rule 1: bare-form dupes — drop the bare row when an article+gender row exists.
  for (const items of byLemma.values()) {
    if (items.length < 2) continue;
    const bare = items.filter((x) => !x.row.gender && !ARTICLE_RE.test(x.row.german) && !SICH_RE.test(x.row.german));
    const gendered = items.filter((x) => x.row.gender || ARTICLE_RE.test(x.row.german));
    if (bare.length && gendered.length) {
      for (const b of bare) {
        dropLines.add(b.lineIdx);
        droppedBare++;
      }
    }
  }

  // Rule 2: grammar-pattern entries — drop whenever the German cell describes a construction.
  for (const item of rows) {
    if (isGrammarPattern(item.row.german)) {
      dropLines.add(item.lineIdx);
      droppedGrammar++;
    }
  }

  // Write back, preserving everything we didn't mark.
  const kept = lines.filter((_, i) => !dropLines.has(i));
  fs.writeFileSync(file, kept.join('\n'));

  return { droppedBare, droppedGrammar };
}

function main(): void {
  console.log('Cleaning up dictionary.md files…\n');
  for (const native of NATIVES) {
    const file = path.join(COURSES_ROOT, native, 'dictionary.md');
    const { droppedBare, droppedGrammar } = processFile(file);
    console.log(
      `  ${native}: dropped ${droppedBare} bare-form duplicates + ${droppedGrammar} grammar patterns → ${file}`,
    );
  }
}

main();
