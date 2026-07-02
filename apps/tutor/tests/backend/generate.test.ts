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

describe('POST /api/generate-text', () => {
  it('should require authentication', async () => {
    const res = await request(app)
      .post('/api/generate-text')
      .send({
        textLanguage: 'de',
        level: 'A1',
        sentences: 5,
        topic: 'food',
      });

    expect(res.status).toBe(401);
  });

  it('should return generated text', async () => {
    const res = await request(app)
      .post('/api/generate-text')
      .set('X-Session-Id', sessionId)
      .send({
        textLanguage: 'de',
        level: 'A1',
        sentences: 5,
        topic: 'food',
        instructions: '',
      });

    expect(res.status).toBe(200);
    expect(res.body.text).toBeDefined();
    expect(typeof res.body.text).toBe('string');
  });

  it('should validate level parameter', async () => {
    const res = await request(app)
      .post('/api/generate-text')
      .set('X-Session-Id', sessionId)
      .send({
        textLanguage: 'de',
        level: 'INVALID',
        sentences: 5,
        topic: 'food',
      });

    expect(res.status).toBe(400);
  });

  it('should accept the dialog flag', async () => {
    const res = await request(app)
      .post('/api/generate-text')
      .set('X-Session-Id', sessionId)
      .send({
        textLanguage: 'de',
        level: 'A2',
        sentences: 6,
        topic: 'a job interview',
        dialog: true,
      });

    expect(res.status).toBe(200);
    expect(typeof res.body.text).toBe('string');
  });

  it('should clamp sentences to valid range', async () => {
    // Even with out-of-range value, should not crash
    const res = await request(app)
      .post('/api/generate-text')
      .set('X-Session-Id', sessionId)
      .send({
        textLanguage: 'de',
        level: 'B1',
        sentences: 100, // above max of 30
        topic: 'travel',
      });

    // Should succeed (server clamps to 30)
    expect(res.status).toBe(200);
  });
});
