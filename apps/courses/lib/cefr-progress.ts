import { CEFR_LEVELS, type CefrBreakdown, type CefrEntry, type CefrLevel } from './cefr-types';

const EMPTY_BREAKDOWN: CefrBreakdown = { A1: 0, A2: 0, B1: 0, B2: 0, C1: 0 };

/** Sum per-lesson contributions for the lessons the user has completed. */
export function cumulative(
  perLesson: Record<number, CefrEntry>,
  completedLessonNs: number[],
): { vocabulary: CefrBreakdown; grammar: CefrBreakdown } {
  const vocab: CefrBreakdown = { ...EMPTY_BREAKDOWN };
  const gram: CefrBreakdown = { ...EMPTY_BREAKDOWN };
  for (const n of completedLessonNs) {
    const e = perLesson[n];
    if (!e) continue;
    for (const lvl of CEFR_LEVELS) {
      vocab[lvl] = round1(vocab[lvl] + (e.vocabulary[lvl] ?? 0));
      gram[lvl] = round1(gram[lvl] + (e.grammar[lvl] ?? 0));
    }
  }
  return { vocabulary: vocab, grammar: gram };
}

/**
 * Position on a single 0–100 scale where each CEFR level owns 20%.
 *   100% A1                 → 20
 *   100% A1 + 50% A2        → 30
 *   100% A1 + 100% A2 + ... → 40
 *
 * A coverage cell capped at 100 so an over-100 column (rounding noise)
 * doesn't push the bar past its own band.
 */
export function positionOnScale(b: CefrBreakdown): number {
  let pos = 0;
  for (const lvl of CEFR_LEVELS) {
    pos += Math.min(100, Math.max(0, b[lvl])) * 0.2;
  }
  return Math.min(100, round1(pos));
}

/**
 * Approximate the level the learner is currently working at: the first level
 * whose coverage is < 80%. If every level is ≥ 80%, return C1 (mastered).
 */
export function approximateLevel(b: CefrBreakdown): CefrLevel {
  for (const lvl of CEFR_LEVELS) {
    if ((b[lvl] ?? 0) < 80) return lvl;
  }
  return 'C1';
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
