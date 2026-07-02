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

// Minimal valid ExplanationResult shape for card POSTs.
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

describe('POST /api/decks', () => {
  it('creates a deck and returns it', async () => {
    const res = await request(app)
      .post('/api/decks')
      .set('X-Session-Id', sessionId)
      .send({ name: 'My Deck' });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeTruthy();
    expect(res.body.name).toBe('My Deck');
    expect(res.body.position).toBe(0);
    expect(res.body.card_count).toBe(0);
  });

  it('defaults to "Deck" when name is empty', async () => {
    const res = await request(app)
      .post('/api/decks')
      .set('X-Session-Id', sessionId)
      .send({ name: '   ' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Deck');
  });

  it('requires authentication', async () => {
    const res = await request(app).post('/api/decks').send({ name: 'X' });
    expect(res.status).toBe(401);
  });

  it('rejects duplicate name within the same user with 409', async () => {
    await request(app).post('/api/decks').set('X-Session-Id', sessionId).send({ name: 'Unique' });
    const dup = await request(app).post('/api/decks').set('X-Session-Id', sessionId).send({ name: 'Unique' });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe('duplicate_name');
  });

  it('allows the same name across different users', async () => {
    const other = await createTestUser(pool);
    await request(app).post('/api/decks').set('X-Session-Id', sessionId).send({ name: 'Shared' });
    const res = await request(app).post('/api/decks').set('X-Session-Id', other.sessionId).send({ name: 'Shared' });
    expect(res.status).toBe(200);
  });
});

describe('GET /api/decks', () => {
  it('returns user decks ordered by position', async () => {
    await request(app).post('/api/decks').set('X-Session-Id', sessionId).send({ name: 'A' });
    await request(app).post('/api/decks').set('X-Session-Id', sessionId).send({ name: 'B' });
    const res = await request(app).get('/api/decks').set('X-Session-Id', sessionId);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].name).toBe('A');
    expect(res.body[1].name).toBe('B');
  });

  it('does not leak decks from other users', async () => {
    const other = await createTestUser(pool);
    await request(app).post('/api/decks').set('X-Session-Id', other.sessionId).send({ name: 'Theirs' });
    const res = await request(app).get('/api/decks').set('X-Session-Id', sessionId);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });
});

describe('PATCH /api/decks/:id', () => {
  it('renames a deck', async () => {
    const create = await request(app).post('/api/decks').set('X-Session-Id', sessionId).send({ name: 'Old' });
    const deckId = create.body.id;
    const res = await request(app)
      .patch(`/api/decks/${deckId}`)
      .set('X-Session-Id', sessionId)
      .send({ name: 'New' });
    expect(res.status).toBe(200);
    const list = await request(app).get('/api/decks').set('X-Session-Id', sessionId);
    expect(list.body[0].name).toBe('New');
  });

  it('404s when deck belongs to another user', async () => {
    const other = await createTestUser(pool);
    const create = await request(app).post('/api/decks').set('X-Session-Id', other.sessionId).send({ name: 'X' });
    const res = await request(app)
      .patch(`/api/decks/${create.body.id}`)
      .set('X-Session-Id', sessionId)
      .send({ name: 'Hijack' });
    expect(res.status).toBe(404);
  });

  it('rejects rename that would collide with an existing deck name', async () => {
    await request(app).post('/api/decks').set('X-Session-Id', sessionId).send({ name: 'Alpha' });
    const beta = await request(app).post('/api/decks').set('X-Session-Id', sessionId).send({ name: 'Beta' });
    const res = await request(app)
      .patch(`/api/decks/${beta.body.id}`)
      .set('X-Session-Id', sessionId)
      .send({ name: 'Alpha' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('duplicate_name');
  });
});

describe('DELETE /api/decks/:id', () => {
  it('deletes a deck and its cards (cascade)', async () => {
    const create = await request(app).post('/api/decks').set('X-Session-Id', sessionId).send({ name: 'X' });
    const deckId = create.body.id;
    await request(app).post(`/api/decks/${deckId}/cards`).set('X-Session-Id', sessionId).send({
      source_text: 'Tisch', text_language: 'de', explanation: sampleExplanation,
    });
    const del = await request(app).delete(`/api/decks/${deckId}`).set('X-Session-Id', sessionId);
    expect(del.status).toBe(200);
    const { rows } = await pool.query('SELECT COUNT(*)::int AS c FROM flashcard_deck_cards WHERE deck_id=$1', [deckId]);
    expect(rows[0].c).toBe(0);
  });
});

describe('POST /api/decks/:id/cards', () => {
  let deckId: string;
  beforeEach(async () => {
    const create = await request(app).post('/api/decks').set('X-Session-Id', sessionId).send({ name: 'D' });
    deckId = create.body.id;
  });

  it('adds a card and returns its id', async () => {
    const res = await request(app)
      .post(`/api/decks/${deckId}/cards`)
      .set('X-Session-Id', sessionId)
      .send({ source_text: 'Tisch', text_language: 'de', explanation: sampleExplanation });
    expect(res.status).toBe(200);
    expect(typeof res.body.id).toBe('string');

    const list = await request(app).get(`/api/decks/${deckId}/cards`).set('X-Session-Id', sessionId);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].source_text).toBe('Tisch');
  });

  it('upserts on duplicate (deck_id, source_text)', async () => {
    await request(app).post(`/api/decks/${deckId}/cards`).set('X-Session-Id', sessionId).send({
      source_text: 'Tisch', text_language: 'de', explanation: sampleExplanation,
    });
    const updated = { ...sampleExplanation, lemma_translation: 'desk' };
    const res = await request(app).post(`/api/decks/${deckId}/cards`).set('X-Session-Id', sessionId).send({
      source_text: 'Tisch', text_language: 'de', explanation: updated,
    });
    expect(res.status).toBe(200);
    const list = await request(app).get(`/api/decks/${deckId}/cards`).set('X-Session-Id', sessionId);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].explanation.lemma_translation).toBe('desk');
  });

  it('rejects missing fields', async () => {
    const res = await request(app)
      .post(`/api/decks/${deckId}/cards`)
      .set('X-Session-Id', sessionId)
      .send({ source_text: 'Tisch' });
    expect(res.status).toBe(400);
  });
});

// PATCH /api/decks/:id/cards/:cardId was removed when the scheduler replaced the
// frequency field. Cards no longer have a user-mutable scalar; difficulty is
// driven by the interval-doubling scheduler state in srs_card_sched /
// srs_deck_sched. See tests/backend/srs.test.ts.

describe('DELETE /api/decks/:id/cards/:cardId', () => {
  it('removes a card', async () => {
    const deck = await request(app).post('/api/decks').set('X-Session-Id', sessionId).send({ name: 'D' });
    const card = await request(app).post(`/api/decks/${deck.body.id}/cards`).set('X-Session-Id', sessionId).send({
      source_text: 'Tisch', text_language: 'de', explanation: sampleExplanation,
    });
    const res = await request(app)
      .delete(`/api/decks/${deck.body.id}/cards/${card.body.id}`)
      .set('X-Session-Id', sessionId);
    expect(res.status).toBe(200);
    const list = await request(app).get(`/api/decks/${deck.body.id}/cards`).set('X-Session-Id', sessionId);
    expect(list.body).toHaveLength(0);
  });
});

describe('GET /api/state includes decks', () => {
  it('returns decks for the user', async () => {
    await request(app).post('/api/decks').set('X-Session-Id', sessionId).send({ name: 'My Deck' });
    const res = await request(app).get('/api/state').set('X-Session-Id', sessionId);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.decks)).toBe(true);
    expect(res.body.decks).toHaveLength(1);
    expect(res.body.decks[0].name).toBe('My Deck');
    expect(res.body.decks[0].card_count).toBe(0);
  });
});

describe('PUT /api/preferences activeDeckId', () => {
  it('persists activeDeckId', async () => {
    const deck = await request(app).post('/api/decks').set('X-Session-Id', sessionId).send({ name: 'X' });
    const res = await request(app)
      .put('/api/preferences')
      .set('X-Session-Id', sessionId)
      .send({ interfaceLanguage: 'en', explanationLanguage: 'en', activeDeckId: deck.body.id });
    expect(res.status).toBe(200);
    const state = await request(app).get('/api/state').set('X-Session-Id', sessionId);
    expect(state.body.preferences.activeDeckId).toBe(deck.body.id);
  });

  it('allows clearing activeDeckId with null', async () => {
    const deck = await request(app).post('/api/decks').set('X-Session-Id', sessionId).send({ name: 'X' });
    await request(app).put('/api/preferences').set('X-Session-Id', sessionId).send({ activeDeckId: deck.body.id });
    await request(app).put('/api/preferences').set('X-Session-Id', sessionId).send({ activeDeckId: null });
    const state = await request(app).get('/api/state').set('X-Session-Id', sessionId);
    expect(state.body.preferences.activeDeckId).toBeNull();
  });
});
