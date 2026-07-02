import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { getTestApp, createTestUser, createTestWorkspace } from './setup';

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
  await createTestWorkspace(pool, userId);
});

describe('POST /api/explain/example-variant', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await request(app)
      .post('/api/explain/example-variant')
      .send({
        selection: 'gehen',
        inputType: 'word',
        textLanguage: 'de',
        explanationLanguage: 'ru',
        meanings: ['идти'],
        currentExample: { text: 'Ich gehe ins Kino.', translation: 'Я иду в кино.' },
      });
    expect(res.status).toBe(401);
  });

  it('rejects missing selection', async () => {
    const res = await request(app)
      .post('/api/explain/example-variant')
      .set('X-Session-Id', sessionId)
      .send({
        inputType: 'word',
        textLanguage: 'de',
        explanationLanguage: 'ru',
        currentExample: { text: 'Ich gehe ins Kino.', translation: 'Я иду в кино.' },
      });
    expect(res.status).toBe(400);
  });

  it('rejects invalid inputType', async () => {
    const res = await request(app)
      .post('/api/explain/example-variant')
      .set('X-Session-Id', sessionId)
      .send({
        selection: 'gehen',
        inputType: 'paragraph',
        textLanguage: 'de',
        explanationLanguage: 'ru',
        currentExample: { text: 'Ich gehe ins Kino.', translation: 'Я иду в кино.' },
      });
    expect(res.status).toBe(400);
  });

  it('rejects missing currentExample', async () => {
    const res = await request(app)
      .post('/api/explain/example-variant')
      .set('X-Session-Id', sessionId)
      .send({
        selection: 'gehen',
        inputType: 'word',
        textLanguage: 'de',
        explanationLanguage: 'ru',
      });
    expect(res.status).toBe(400);
  });

  it('guards against an LLM response that does not match the {text, translation} shape', async () => {
    // The shared Gemini mock returns a full ExplanationResult, not {text,
    // translation}. The variant endpoint must reject that with a clean 500
    // rather than serving malformed data downstream.
    const res = await request(app)
      .post('/api/explain/example-variant')
      .set('X-Session-Id', sessionId)
      .send({
        selection: 'gehen',
        inputType: 'word',
        textLanguage: 'de',
        explanationLanguage: 'ru',
        meanings: ['идти', 'ходить'],
        currentExample: { text: 'Ich gehe ins Kino.', translation: 'Я иду в кино.' },
        otherExamples: [{ text: 'Sie geht zur Schule.' }],
      });
    expect(res.status).toBe(500);
    expect(String(res.body.error)).toMatch(/Invalid variant response shape/);
  });
});
