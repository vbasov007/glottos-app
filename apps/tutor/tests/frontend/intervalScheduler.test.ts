/**
 * Deterministic tests for the interval-doubling scheduler core.
 *
 * Covers the spec's invariants: "known" doubles the interval up to X_MAX = M*N,
 * "don't know" resets to X_BASE, the gap between two shows of a card equals its
 * current x, a card is never selected twice at the same virtual time, state
 * round-trips through JSON, the stream is deterministic for a given seed, and it
 * works across a range of deck sizes.
 */
import { describe, it, expect } from 'vitest';
import {
  initDeck, selectNext, record, reconcile, xMax, mulberry32,
  DEFAULT_CONFIG, type DeckSched,
} from '../../src/lib/intervalScheduler';

/** Build N stable card ids. */
function ids(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `c${i}`);
}

interface StreamEvent {
  cardId: string;
  /** Virtual time at which the card was selected. */
  t: number;
  /** The card's interval after the answer was recorded. */
  xAfter: number;
}

/** Drive the stream: select → answer → record, `steps` times. */
function runStream(
  deck: DeckSched,
  steps: number,
  answer: (cardId: string, step: number) => boolean,
): { deck: DeckSched; events: StreamEvent[] } {
  const events: StreamEvent[] = [];
  let d = deck;
  for (let i = 0; i < steps; i++) {
    const sel = selectNext(d);
    if (sel.cardId === null) break;
    d = sel.deck;
    const known = answer(sel.cardId, i);
    d = record(d, sel.cardId, known);
    events.push({ cardId: sel.cardId, t: d.t, xAfter: d.cards[sel.cardId].x });
  }
  return { deck: d, events };
}

describe('interval-doubling scheduler', () => {
  it('repeated "known" doubles the interval 4 → 8 → 16 → … capped at X_MAX = M*N', () => {
    const n = 50;
    let d = initDeck(ids(n), 1); // X0 = 4, X_MAX = M*n = 4*50 = 200
    expect(xMax(d)).toBe(200);
    const id = 'c0';
    expect(d.cards[id].x).toBe(DEFAULT_CONFIG.X0); // 4

    const seen: number[] = [];
    for (let k = 0; k < 8; k++) {
      d = record(d, id, true);
      seen.push(d.cards[id].x);
    }
    expect(seen).toEqual([8, 16, 32, 64, 128, 200, 200, 200]);
  });

  it('"don\'t know" resets the interval to X_BASE', () => {
    let d = initDeck(ids(50), 2);
    const id = 'c0';
    for (let k = 0; k < 4; k++) d = record(d, id, true); // grow x to 64
    expect(d.cards[id].x).toBe(64);
    d = record(d, id, false);
    expect(d.cards[id].x).toBe(DEFAULT_CONFIG.X_BASE); // 4
  });

  it('the gap between two consecutive shows of a card equals its current x', () => {
    const d0 = initDeck(ids(20), 7);
    const { events } = runStream(d0, 600, (_id, step) => step % 3 !== 0);
    // For each card, the time between consecutive selections must equal the x
    // that was set at the earlier selection (next_due = t + x).
    const lastByCard = new Map<string, StreamEvent>();
    let checked = 0;
    for (const e of events) {
      const prev = lastByCard.get(e.cardId);
      if (prev) {
        expect(e.t - prev.t).toBe(prev.xAfter);
        checked++;
      }
      lastByCard.set(e.cardId, e);
    }
    expect(checked).toBeGreaterThan(100); // the invariant was actually exercised
  });

  it('never selects the same card twice at the same virtual time t', () => {
    const d0 = initDeck(ids(30), 11);
    const { events } = runStream(d0, 1000, (id) => id.charCodeAt(1) % 2 === 0);
    const pairs = new Set<string>();
    for (const e of events) {
      const key = `${e.cardId}@${e.t}`;
      expect(pairs.has(key)).toBe(false);
      pairs.add(key);
    }
    // t is non-decreasing across the stream.
    for (let i = 1; i < events.length; i++) {
      expect(events[i].t).toBeGreaterThanOrEqual(events[i - 1].t);
    }
  });

  it('round-trips through JSON serialization unchanged', () => {
    const d0 = initDeck(ids(40), 99);
    const { deck } = runStream(d0, 250, (_id, s) => s % 2 === 0);
    const revived: DeckSched = JSON.parse(JSON.stringify(deck));
    expect(revived).toEqual(deck);
    // A revived deck keeps producing the same stream as the live one.
    const a = runStream(deck, 50, (_id, s) => s % 2 === 0).events.map(e => e.cardId);
    const b = runStream(revived, 50, (_id, s) => s % 2 === 0).events.map(e => e.cardId);
    expect(b).toEqual(a);
  });

  it('is deterministic: same seed + same answer stream ⇒ identical show sequence', () => {
    const answer = (id: string, step: number) => mulberry32(step + id.charCodeAt(1))() < 0.5;
    const seqA = runStream(initDeck(ids(25), 12345), 800, answer).events.map(e => e.cardId);
    const seqB = runStream(initDeck(ids(25), 12345), 800, answer).events.map(e => e.cardId);
    expect(seqB).toEqual(seqA);
    // A different seed yields a different ordering (sanity: shuffle matters).
    const seqC = runStream(initDeck(ids(25), 54321), 800, answer).events.map(e => e.cardId);
    expect(seqC).not.toEqual(seqA);
  });

  it('works across a range of deck sizes (N = 1, 2, 50, 5000)', () => {
    for (const n of [1, 2, 50, 5000]) {
      const cardIds = ids(n);
      const d0 = initDeck(cardIds, n);
      const valid = new Set(cardIds);
      const steps = Math.min(2000, n * 4 + 50);
      const { events } = runStream(d0, steps, (_id, s) => s % 2 === 0);
      expect(events.length).toBe(steps);
      for (const e of events) {
        expect(valid.has(e.cardId)).toBe(true);
        expect(e.xAfter).toBeLessThanOrEqual(xMax(d0)); // x never exceeds M*N
        expect(e.xAfter).toBeGreaterThanOrEqual(DEFAULT_CONFIG.X_BASE);
      }
    }
  });

  it('reconcile adds new cards and drops removed ones', () => {
    let d = initDeck(ids(5), 3); // c0..c4
    d = record(d, 'c0', true);
    const tBefore = d.t;
    // Remove c4, add c5 and c6.
    d = reconcile(d, ['c0', 'c1', 'c2', 'c3', 'c5', 'c6']);
    expect(d.n).toBe(6);
    expect(d.cards.c4).toBeUndefined();        // removed
    expect(d.cards.c5).toBeDefined();           // added
    expect(d.cards.c0.x).toBe(8);               // kept card's progress preserved
    expect(d.cards.c5.x).toBe(DEFAULT_CONFIG.X0);
    expect(d.cards.c5.nextDue).toBe(tBefore + DEFAULT_CONFIG.X0);
    // New ranks are unique and appended after the existing max.
    const ranks = Object.values(d.cards).map(c => c.rank).sort((a, b) => a - b);
    expect(new Set(ranks).size).toBe(ranks.length);
  });

  it('handles an empty deck (cardId === null)', () => {
    const d = initDeck([], 1);
    const sel = selectNext(d);
    expect(sel.cardId).toBeNull();
  });

  it('selectNext never returns the excluded card (no back-to-back repeats)', () => {
    let d = initDeck(ids(8), 5);
    // Walk a stream; after each answer the next card must differ from the one
    // just answered — even after a "don't know" that reschedules it soon.
    for (let i = 0; i < 200; i++) {
      const cur = selectNext(d).cardId!;
      d = record(d, cur, i % 4 === 0); // mostly "don't know"
      const next = selectNext(d, cur).cardId;
      expect(next).not.toBe(cur);
      d = selectNext(d, cur).deck;
    }
  });

  it('selectNext still returns the only card even when excluded', () => {
    const d = initDeck(['solo'], 1);
    expect(selectNext(d, 'solo').cardId).toBe('solo');
  });
});
