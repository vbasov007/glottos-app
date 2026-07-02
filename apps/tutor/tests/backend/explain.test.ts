import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
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

describe('POST /api/explain', () => {
  it('should return explanation for a word', async () => {
    const res = await request(app)
      .post('/api/explain')
      .set('X-Session-Id', sessionId)
      .send({
        phrase: 'Tisch',
        text: 'Der Tisch ist groß.',
        textLanguage: 'de',
        explanationLanguage: 'ru',
      });

    expect(res.status).toBe(200);
    expect(res.body.result).toBeDefined();
    expect(res.body.result.selection).toBe('Tisch');
    expect(res.body.result.meanings).toBeDefined();
    expect(res.body.result.meanings.length).toBeGreaterThan(0);
    // Word results must always carry an `antonyms` array even when the model
    // omits the field (here: a noun, which skips the backfill). Otherwise the
    // client treats the cached entry as stale and re-generates on every click.
    expect(Array.isArray(res.body.result.antonyms)).toBe(true);
  });

  it('should reject empty phrase', async () => {
    const res = await request(app)
      .post('/api/explain')
      .set('X-Session-Id', sessionId)
      .send({
        phrase: '',
        text: 'Der Tisch ist groß.',
        textLanguage: 'de',
        explanationLanguage: 'ru',
      });

    expect(res.status).toBe(400);
  });

  it('should reject missing phrase', async () => {
    const res = await request(app)
      .post('/api/explain')
      .set('X-Session-Id', sessionId)
      .send({
        text: 'Der Tisch ist groß.',
        textLanguage: 'de',
        explanationLanguage: 'ru',
      });

    expect(res.status).toBe(400);
  });

  it('should require authentication', async () => {
    const res = await request(app)
      .post('/api/explain')
      .send({
        phrase: 'Tisch',
        text: 'Der Tisch ist groß.',
        textLanguage: 'de',
        explanationLanguage: 'ru',
      });

    expect(res.status).toBe(401);
  });
});
