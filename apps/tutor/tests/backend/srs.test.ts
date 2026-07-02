import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import { getTestApp, createTestUser } from './setup';

let app: any;
let pool: any;
let sessionId: string;
let userId: string;

beforeAll(async () => {
  ({ app, pool } = await getTestApp());
});

beforeEach(async () => {
  const user = await createTestUser(pool);
  sessionId = user.sessionId;
  userId = user.userId;
});

const sampleExplanation = {
  input_language: 'de',
  input_type: 'word',
  selection: 'Tisch',
  meanings: ['table'],
  lemma_translation: 'table',
  translation: null,
  target_translations: [],
  part_of_speech: 'noun',
  morphology: { lemma: 'Tisch', gender: 'm' },
  forms: { noun: {}, verb: {}, adjective: {} },
  sentence_structure: null,
  highlights: [],
  grammar_notes: [],
  examples: [],
  notes: [],
};

// n distinct card names. Doubling needs a deck big enough that X_MAX = N
// (server uses M = 1) doesn't clamp early: N ≥ 8 to reach 4 → 8 → 16.
const names = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`);

async function createDeckWithCards(names: string[]): Promise<{ deckId: string; cardIds: string[] }> {
  const deck = await request(app).post('/api/decks').set('X-Session-Id', sessionId).send({ name: 'D' });
  const cardIds: string[] = [];
  for (const n of names) {
    const card = await request(app).post(`/api/decks/${deck.body.id}/cards`).set('X-Session-Id', sessionId).send({
      source_text: n, text_language: 'de', explanation: { ...sampleExplanation, selection: n },
    });
    cardIds.push(card.body.id);
  }
  return { deckId: deck.body.id, cardIds };
}

const next = (deckId: string, direction?: string) =>
  request(app).post(`/api/decks/${deckId}/practice/next`).set('X-Session-Id', sessionId).send(direction ? { direction } : {});

const grade = (deckId: string, cardId: string, remembered: boolean, direction?: string) =>
  request(app).post(`/api/decks/${deckId}/cards/${cardId}/grade`).set('X-Session-Id', sessionId)
    .send({ remembered, ...(direction ? { direction } : {}) });

async function cardSched(cardId: string, direction = 'forward') {
  const { rows } = await pool.query(
    'SELECT * FROM srs_card_sched WHERE user_id=$1 AND card_id=$2 AND direction=$3',
    [userId, cardId, direction],
  );
  return rows[0];
}

describe('POST /api/decks/:deckId/practice/next', () => {
  it('selects a card and lazily initialises the scheduler (clean: x = X0)', async () => {
    const { deckId, cardIds } = await createDeckWithCards(['a', 'b', 'c']);
    const res = await next(deckId);
    expect(res.status).toBe(200);
    expect(res.body.deckSize).toBe(3);
    expect(cardIds).toContain(res.body.card.cardId);
    expect(res.body.card.x).toBe(4); // X0

    const deckRows = await pool.query('SELECT * FROM srs_deck_sched WHERE user_id=$1 AND deck_id=$2 AND direction=$3', [userId, deckId, 'forward']);
    expect(deckRows.rows).toHaveLength(1);
    expect(deckRows.rows[0].n).toBe(3);
    const cardRows = await pool.query('SELECT * FROM srs_card_sched WHERE user_id=$1 AND deck_id=$2 AND direction=$3', [userId, deckId, 'forward']);
    expect(cardRows.rows).toHaveLength(3);
    expect(cardRows.rows.every((r: any) => r.x === 4)).toBe(true);
  });

  it('returns card: null for an empty deck', async () => {
    const { deckId } = await createDeckWithCards([]);
    const res = await next(deckId);
    expect(res.status).toBe(200);
    expect(res.body.card).toBeNull();
    expect(res.body.deckSize).toBe(0);
  });

  it('picks up cards added after the deck was initialised', async () => {
    const { deckId } = await createDeckWithCards(['a', 'b']);
    await next(deckId);
    await request(app).post(`/api/decks/${deckId}/cards`).set('X-Session-Id', sessionId).send({
      source_text: 'c', text_language: 'de', explanation: { ...sampleExplanation, selection: 'c' },
    });
    const res = await next(deckId);
    expect(res.body.deckSize).toBe(3);
    const cardRows = await pool.query('SELECT * FROM srs_card_sched WHERE user_id=$1 AND deck_id=$2 AND direction=$3', [userId, deckId, 'forward']);
    expect(cardRows.rows).toHaveLength(3);
  });

  it('404s on a deck owned by a different user', async () => {
    const { deckId } = await createDeckWithCards(['a']);
    const other = await createTestUser(pool);
    const res = await request(app).post(`/api/decks/${deckId}/practice/next`).set('X-Session-Id', other.sessionId).send({});
    expect(res.status).toBe(404);
  });
});

describe('POST /api/decks/:deckId/cards/:cardId/grade', () => {
  it('"known" doubles the interval and returns the next card', async () => {
    const { deckId, cardIds } = await createDeckWithCards(names(10)); // X_MAX = M*n = 10
    const res = await grade(deckId, cardIds[0], true);
    expect(res.status).toBe(200);
    expect(res.body.recorded).toEqual({ cardId: cardIds[0], x: 8 }); // 4 → 8
    expect(res.body.next).not.toBeNull();
    expect((await cardSched(cardIds[0])).x).toBe(8);
  });

  it('the next card after a grade is never the one just answered', async () => {
    const { deckId } = await createDeckWithCards(names(5));
    for (const known of [false, true, false, false, true]) {
      const cur = (await next(deckId)).body.card.cardId;
      const res = await grade(deckId, cur, known);
      expect(res.body.next.cardId).not.toBe(cur);
    }
  });

  it('doubling is capped at X_MAX = M*N (= deck size)', async () => {
    const { deckId, cardIds } = await createDeckWithCards(names(20)); // X_MAX = 20
    const ladder: number[] = [];
    for (let i = 0; i < 4; i++) ladder.push((await grade(deckId, cardIds[0], true)).body.recorded.x);
    expect(ladder).toEqual([8, 16, 20, 20]); // 32 clamps to 20
  });

  it('"don\'t know" resets the interval to X_BASE', async () => {
    const { deckId, cardIds } = await createDeckWithCards(names(20));
    await grade(deckId, cardIds[0], true); // 8
    await grade(deckId, cardIds[0], true); // 16
    const res = await grade(deckId, cardIds[0], false);
    expect(res.body.recorded.x).toBe(4); // X_BASE
  });

  it('upserts the card row — no duplicates across grades', async () => {
    const { deckId, cardIds } = await createDeckWithCards(['a', 'b']);
    await grade(deckId, cardIds[0], true);
    await grade(deckId, cardIds[0], true);
    const { rows } = await pool.query('SELECT * FROM srs_card_sched WHERE user_id=$1 AND card_id=$2', [userId, cardIds[0]]);
    expect(rows).toHaveLength(1);
  });

  it('rejects a missing remembered field', async () => {
    const { deckId, cardIds } = await createDeckWithCards(['a']);
    const res = await request(app).post(`/api/decks/${deckId}/cards/${cardIds[0]}/grade`).set('X-Session-Id', sessionId).send({});
    expect(res.status).toBe(400);
  });

  it('rejects a card that does not belong to the deck', async () => {
    const { deckId } = await createDeckWithCards(['a']);
    const other = await createDeckWithCards(['x']);
    const res = await grade(deckId, other.cardIds[0], true);
    expect(res.status).toBe(404);
  });

  it('cross-user 404 — cannot grade someone else\'s card', async () => {
    const { deckId, cardIds } = await createDeckWithCards(['a']);
    const other = await createTestUser(pool);
    const res = await request(app).post(`/api/decks/${deckId}/cards/${cardIds[0]}/grade`).set('X-Session-Id', other.sessionId).send({ remembered: true });
    expect(res.status).toBe(404);
  });
});

describe('scheduler direction (forward vs reverse)', () => {
  it('keeps independent state for each direction of the same card', async () => {
    const { deckId, cardIds } = await createDeckWithCards(names(10));

    await grade(deckId, cardIds[0], true, 'forward'); // forward x → 8
    expect((await cardSched(cardIds[0], 'forward')).x).toBe(8);
    // Reverse hasn't been touched: no reverse rows yet.
    expect(await cardSched(cardIds[0], 'reverse')).toBeUndefined();

    // Starting a reverse session initialises a separate scheduler at X0.
    await next(deckId, 'reverse');
    expect((await cardSched(cardIds[0], 'reverse')).x).toBe(4);
    expect((await cardSched(cardIds[0], 'forward')).x).toBe(8); // unchanged

    const deckRows = await pool.query('SELECT direction FROM srs_deck_sched WHERE user_id=$1 AND deck_id=$2 ORDER BY direction', [userId, deckId]);
    expect(deckRows.rows.map((r: any) => r.direction)).toEqual(['forward', 'reverse']);
  });

  it('defaults direction to forward when omitted', async () => {
    const { deckId, cardIds } = await createDeckWithCards(['a', 'b']);
    await grade(deckId, cardIds[0], true);
    const { rows } = await pool.query('SELECT direction FROM srs_card_sched WHERE user_id=$1 AND card_id=$2', [userId, cardIds[0]]);
    expect(rows).toHaveLength(1);
    expect(rows[0].direction).toBe('forward');
  });
});

describe('scheduler state cascades with the card', () => {
  it('deleting a card deletes its srs_card_sched row', async () => {
    const { deckId, cardIds } = await createDeckWithCards(['a', 'b']);
    await grade(deckId, cardIds[0], true);

    let { rows } = await pool.query('SELECT 1 FROM srs_card_sched WHERE card_id=$1', [cardIds[0]]);
    expect(rows).toHaveLength(1);

    await request(app).delete(`/api/decks/${deckId}/cards/${cardIds[0]}`).set('X-Session-Id', sessionId);

    ({ rows } = await pool.query('SELECT 1 FROM srs_card_sched WHERE card_id=$1', [cardIds[0]]));
    expect(rows).toHaveLength(0);
  });

  it('GET /api/decks/:id/srs returns the new scheduler shape', async () => {
    const { deckId, cardIds } = await createDeckWithCards(names(10));
    await grade(deckId, cardIds[0], true);
    const res = await request(app).get(`/api/decks/${deckId}/srs`).set('X-Session-Id', sessionId);
    expect(res.status).toBe(200);
    const row = res.body.find((r: any) => r.card_id === cardIds[0] && r.direction === 'forward');
    expect(row).toMatchObject({ card_id: cardIds[0], direction: 'forward', x: 8 });
    expect(typeof row.rank).toBe('number');
    expect(typeof row.next_due).toBe('number');
  });
});
