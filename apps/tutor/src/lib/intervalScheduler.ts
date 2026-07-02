/**
 * Interval-doubling flashcard scheduler.
 *
 * A deck of N cards is reviewed as an endless deterministic stream driven by a
 * *virtual integer clock* `t` — there is no wall-clock time, no due dates, no
 * ease factor. The user signal is binary: "known" / "don't know".
 *
 *   known      → the card's interval x doubles (review frequency halves),
 *                capped at X_MAX = M * N.
 *   don't know → x resets to X_BASE.
 *
 * Selection is `argmin( next_due[c] + phase[c] )` over all cards, advancing the
 * clock to the chosen card's next_due. Each card has exactly ONE pending
 * position (next_due); the next position is recomputed on every review — a list
 * of future repetitions is never materialised. `phase[c] = rank / N` from the
 * initial seeded shuffle is a fixed, deterministic tie-break that preserves the
 * shuffle order whenever two cards land on the same slot.
 *
 * Because x ≤ X_MAX, every card's next appearance is within the next X_MAX
 * steps, and density N / X_MAX = 1 / M is constant for any deck size.
 *
 * This module is PURE: no DB, no React, no global clock. All functions return
 * new state and never mutate their inputs, so the core is trivially testable.
 */

export interface SchedulerConfig {
  /** Initial interval of a fresh card. */
  X0: number;
  /** Interval a card resets to after a "don't know" answer. */
  X_BASE: number;
  /** Interval-cap multiplier. X_MAX = M * N, so a mastered card reappears about
   *  M full deck-passes apart regardless of deck size. */
  M: number;
}

export const DEFAULT_CONFIG: SchedulerConfig = { X0: 4, X_BASE: 4, M: 4 };

export interface CardSched {
  /** Current interval. */
  x: number;
  /** Absolute virtual time of this card's next appearance. */
  nextDue: number;
  /** Position in the initial shuffle. phase = rank / n is the tie-break. */
  rank: number;
}

export interface DeckSched {
  /** Deck size used for X_MAX = M*n and phase = rank/n. */
  n: number;
  /** Virtual review clock. Starts at 0; advances to the selected card's nextDue. */
  t: number;
  cfg: SchedulerConfig;
  /** Per-card state, keyed by card id. */
  cards: Record<string, CardSched>;
}

// --- derived quantities ----------------------------------------------------

/** Interval cap for this deck: M * n. */
export function xMax(deck: DeckSched): number {
  return deck.cfg.M * deck.n;
}

/** Tie-break key for a card: rank / n, in [0, 1). */
export function phase(card: CardSched, n: number): number {
  return card.rank / n;
}

// --- seeded RNG / shuffle --------------------------------------------------

/** mulberry32 — a tiny, fast, fully deterministic PRNG. Returns () => number in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let z = Math.imul(a ^ (a >>> 15), 1 | a);
    z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z;
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic Fisher–Yates over a copy of `ids`, driven by `seed`. */
export function seededShuffle(ids: readonly string[], seed: number): string[] {
  const out = [...ids];
  const rng = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// --- core ------------------------------------------------------------------

/**
 * Initialise a fresh deck. The shuffle order fixes each card's rank (and thus
 * its phase tie-break) and staggers the initial next_due (rank + 1) so the
 * first pass walks the shuffled order.
 */
export function initDeck(
  cardIds: readonly string[],
  seed: number,
  cfg: SchedulerConfig = DEFAULT_CONFIG,
): DeckSched {
  const order = seededShuffle(cardIds, seed);
  const cards: Record<string, CardSched> = {};
  order.forEach((id, rank) => {
    cards[id] = { x: cfg.X0, nextDue: rank + 1, rank };
  });
  return { n: order.length, t: 0, cfg, cards };
}

/**
 * Select the next card: argmin over all cards of (next_due + phase). Returns a
 * deck with the clock advanced to that card's next_due. cardId is null only
 * when the deck is empty.
 *
 * `excludeId` (the card just answered) is skipped so the same card is never
 * shown twice in a row — unless it is the deck's only card. Without this a
 * just-missed card, freshly scheduled X_BASE ahead, can still be the global
 * minimum in a sparse (well-learned) deck and reappear immediately.
 */
export function selectNext(
  deck: DeckSched,
  excludeId?: string,
): { deck: DeckSched; cardId: string | null } {
  const ids = Object.keys(deck.cards);
  const canExclude = excludeId != null && ids.length > 1;
  let best: string | null = null;
  let bestKey = Infinity;
  for (const id of ids) {
    if (canExclude && id === excludeId) continue;
    const c = deck.cards[id];
    const key = c.nextDue + phase(c, deck.n);
    if (key < bestKey) {
      bestKey = key;
      best = id;
    }
  }
  if (best === null) return { deck, cardId: null };
  const t = deck.cards[best].nextDue;
  return { deck: { ...deck, t }, cardId: best };
}

/**
 * Record an answer for `cardId` at the current clock `t`. "known" doubles the
 * interval (capped at X_MAX); "don't know" resets it to X_BASE. The card's next
 * appearance is scheduled at t + x. No-op if the card isn't in the deck.
 */
export function record(deck: DeckSched, cardId: string, known: boolean): DeckSched {
  const card = deck.cards[cardId];
  if (!card) return deck;
  const x = known ? Math.min(card.x * 2, xMax(deck)) : deck.cfg.X_BASE;
  const next: CardSched = { ...card, x, nextDue: deck.t + x };
  return { ...deck, cards: { ...deck.cards, [cardId]: next } };
}

/**
 * Reconcile a persisted deck against the current card set (decks are mutable):
 * append rows for newly-added cards and drop rows for removed ones. New cards
 * get x = X0 and enter the stream shortly (next_due = t + X0); their rank is
 * appended after the current max so the existing shuffle order is preserved.
 * `n` grows/shrinks to the live card count, so X_MAX and phase track deck size.
 */
export function reconcile(deck: DeckSched, currentCardIds: readonly string[]): DeckSched {
  const cards: Record<string, CardSched> = {};
  let maxRank = -1;
  // Keep existing cards that still belong to the deck (drops removed ones).
  for (const id of currentCardIds) {
    const existing = deck.cards[id];
    if (existing) {
      cards[id] = existing;
      if (existing.rank > maxRank) maxRank = existing.rank;
    }
  }
  // Append brand-new cards after the current max rank.
  for (const id of currentCardIds) {
    if (!deck.cards[id]) {
      maxRank += 1;
      cards[id] = { x: deck.cfg.X0, nextDue: deck.t + deck.cfg.X0, rank: maxRank };
    }
  }
  return { ...deck, n: Object.keys(cards).length, cards };
}
