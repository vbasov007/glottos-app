import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import { getTestApp, createTestUser } from './setup';

let app: any;
let pool: any;
let apiKey: string;

beforeAll(async () => {
  ({ app, pool } = await getTestApp());
});

beforeEach(async () => {
  // Clean up api_keys and shared_lessons to avoid pg-mem UUID collisions
  await pool.query('DELETE FROM api_keys');
  await pool.query('DELETE FROM shared_lessons');

  // Create an admin and an API key for each test
  const admin = await createTestUser(pool, { role: 'admin' });
  const createRes = await request(app)
    .post('/api/admin/api-keys')
    .set('X-Session-Id', admin.sessionId)
    .send({ name: 'test-create-shared' });

  apiKey = createRes.body.key;
});

describe('POST /api/create-shared', () => {
  it('should return code and processing status for valid request', async () => {
    const res = await request(app)
      .post('/api/create-shared')
      .set('X-API-Key', apiKey)
      .send({
        text: 'Der Tisch ist groß.',
        phrases: ['Tisch', 'groß'],
        textLanguage: 'de',
        explanationLanguage: 'ru',
      });

    expect(res.status).toBe(200);
    expect(res.body.code).toBeDefined();
    expect(typeof res.body.code).toBe('string');
    expect(res.body.code.length).toBeGreaterThanOrEqual(6);
    expect(res.body.status).toBe('processing');
    expect(res.body.total).toBe(2);
  });

  it('should return 400 when text is missing', async () => {
    const res = await request(app)
      .post('/api/create-shared')
      .set('X-API-Key', apiKey)
      .send({ phrases: ['Tisch'] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Missing text/i);
  });

  it('should return 400 when phrases array is empty', async () => {
    const res = await request(app)
      .post('/api/create-shared')
      .set('X-API-Key', apiKey)
      .send({ text: 'Der Tisch ist groß.', phrases: [] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/empty phrases/i);
  });

  it('should return 400 when too many phrases (>200)', async () => {
    const phrases = Array.from({ length: 201 }, (_, i) => `word${i}`);

    const res = await request(app)
      .post('/api/create-shared')
      .set('X-API-Key', apiKey)
      .send({ text: 'Some text', phrases });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Too many phrases/i);
  });

  it('should deduplicate: same text+phrases returns same code', async () => {
    const payload = {
      text: 'Dedup test text.',
      phrases: ['test'],
      textLanguage: 'de',
      explanationLanguage: 'ru',
    };

    const res1 = await request(app)
      .post('/api/create-shared')
      .set('X-API-Key', apiKey)
      .send(payload);

    const res2 = await request(app)
      .post('/api/create-shared')
      .set('X-API-Key', apiKey)
      .send(payload);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(res1.body.code).toBe(res2.body.code);
  });

  it('should use default languages when not provided', async () => {
    const res = await request(app)
      .post('/api/create-shared')
      .set('X-API-Key', apiKey)
      .send({
        text: 'Defaults test.',
        phrases: ['test'],
      });

    expect(res.status).toBe(200);
    expect(res.body.code).toBeDefined();
  });
});

describe('GET /api/shared/:code', () => {
  it('should return status and progress fields when processing', async () => {
    // Create a shared lesson
    const createRes = await request(app)
      .post('/api/create-shared')
      .set('X-API-Key', apiKey)
      .send({
        text: 'Progress test text.',
        phrases: ['Progress'],
        textLanguage: 'de',
        explanationLanguage: 'ru',
      });

    const code = createRes.body.code;

    // Fetch it — it may still be processing or already ready
    const res = await request(app)
      .get(`/api/shared/${code}`);

    expect(res.status).toBe(200);
    expect(res.body.state).toBeDefined();
    expect(res.body.textLanguage).toBe('de');
    expect(res.body.workspaceName).toBeDefined();
  });

  it('should return 404 for non-existent code', async () => {
    const res = await request(app)
      .get('/api/shared/NONEXIST');

    expect(res.status).toBe(404);
  });
});
