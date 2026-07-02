/**
 * Normalize web/content/cefr-levels.json so the 50-lesson sum of each
 * (dimension, level) cell maxes at 100%. Columns whose sum is already ≤100%
 * are left untouched, so the relative weights between lessons survive.
 *
 *   npm run cefr:normalize
 */
import fs from 'node:fs';
import path from 'node:path';

const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1'] as const;
const DIMS = ['vocabulary', 'grammar'] as const;
type Level = (typeof CEFR_LEVELS)[number];
type Dim = (typeof DIMS)[number];
type Breakdown = Record<Level, number>;
type Entry = Record<Dim, Breakdown>;
type Map = Record<string, Entry>;

const CACHE_PATH = path.resolve(__dirname, '..', 'content', 'cefr-levels.json');

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function main(): void {
  const data = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8')) as Map;
  const keys = Object.keys(data);

  const totals: Record<Dim, Breakdown> = {
    vocabulary: { A1: 0, A2: 0, B1: 0, B2: 0, C1: 0 },
    grammar: { A1: 0, A2: 0, B1: 0, B2: 0, C1: 0 },
  };
  for (const k of keys) {
    for (const dim of DIMS) {
      for (const lvl of CEFR_LEVELS) {
        totals[dim][lvl] += data[k]![dim][lvl] ?? 0;
      }
    }
  }

  // Scale factors: cap at 1 (no inflation).
  const scale: Record<Dim, Breakdown> = {
    vocabulary: { A1: 1, A2: 1, B1: 1, B2: 1, C1: 1 },
    grammar: { A1: 1, A2: 1, B1: 1, B2: 1, C1: 1 },
  };
  console.log('Column sums before normalize:');
  for (const dim of DIMS) {
    for (const lvl of CEFR_LEVELS) {
      const sum = totals[dim][lvl];
      const factor = sum > 100 ? 100 / sum : 1;
      scale[dim][lvl] = factor;
      console.log(
        `  ${dim.padEnd(10)} ${lvl}: ${sum.toFixed(1).padStart(6)}` +
          (factor < 1 ? ` → scale ×${factor.toFixed(3)}` : ' (unchanged)'),
      );
    }
  }

  for (const k of keys) {
    for (const dim of DIMS) {
      for (const lvl of CEFR_LEVELS) {
        const v = data[k]![dim][lvl] ?? 0;
        data[k]![dim][lvl] = v === 0 ? 0 : round1(v * scale[dim][lvl]);
      }
    }
  }

  fs.writeFileSync(CACHE_PATH, JSON.stringify(data, null, 2) + '\n');
  console.log(`\nWrote normalized values for ${keys.length} lessons → ${CACHE_PATH}`);

  // Verify.
  const verify: Record<Dim, Breakdown> = {
    vocabulary: { A1: 0, A2: 0, B1: 0, B2: 0, C1: 0 },
    grammar: { A1: 0, A2: 0, B1: 0, B2: 0, C1: 0 },
  };
  for (const k of keys) {
    for (const dim of DIMS) {
      for (const lvl of CEFR_LEVELS) {
        verify[dim][lvl] += data[k]![dim][lvl] ?? 0;
      }
    }
  }
  console.log('\nColumn sums after normalize:');
  for (const dim of DIMS) {
    for (const lvl of CEFR_LEVELS) {
      console.log(`  ${dim.padEnd(10)} ${lvl}: ${verify[dim][lvl].toFixed(1).padStart(6)}`);
    }
  }
}

main();
