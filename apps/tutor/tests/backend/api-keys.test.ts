import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import { getTestApp, createTestUser } from './setup';

let app: any;
let pool: any;
let adminSessionId: string;

beforeAll(async () => {
  ({ app, pool } = await getTestApp());
});

beforeEach(async () => {
  // Clean up api_keys to avoid pg-mem UUID collisions
  await pool.query('DELETE FROM api_keys');
  const admin = await createTestUser(pool, { role: 'admin' });
  adminSessionId = admin.sessionId;
});

describe('POST /api/admin/api-keys', () => {
  it('should create an API key and return the raw key', async () => {
    const res = await request(app)
      .post('/api/admin/api-keys')
      .set('X-Session-Id', adminSessionId)
      .send({ name: 'test-key' });

    expect(res.status).toBe(200);
    expect(res.body.key).toBeDefined();
    expect(typeof res.body.key).toBe('string');
    expect(res.body.key.length).toBeGreaterThan(0);
    expect(res.body.name).toBe('test-key');
  });

  it('should use "default" name when none provided', async () => {
    const res = await request(app)
      .post('/api/admin/api-keys')
      .set('X-Session-Id', adminSessionId)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('default');
  });

  it('should require admin role', async () => {
    const user = await createTestUser(pool, { role: 'user' });

    const res = await request(app)
      .post('/api/admin/api-keys')
      .set('X-Session-Id', user.sessionId)
      .send({ name: 'test-key' });

    expect(res.status).toBe(403);
  });
});

describe('GET /api/admin/api-keys', () => {
  it('should list API keys without raw values', async () => {
    // Create a key first
    await request(app)
      .post('/api/admin/api-keys')
      .set('X-Session-Id', adminSessionId)
      .send({ name: 'listed-key' });

    const res = await request(app)
      .get('/api/admin/api-keys')
      .set('X-Session-Id', adminSessionId);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);

    // Find our key in the list
    const found = res.body.find((k: any) => k.name === 'listed-key');
    expect(found).toBeDefined();
    expect(found.id).toBeDefined();
    expect(found.created_at).toBeDefined();
    // Raw key should NOT be present
    expect(found.key).toBeUndefined();
    expect(found.key_hash).toBeUndefined();
  });

  it('should require admin role', async () => {
    const user = await createTestUser(pool, { role: 'user' });

    const res = await request(app)
      .get('/api/admin/api-keys')
      .set('X-Session-Id', user.sessionId);

    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/admin/api-keys/:id', () => {
  it('should delete an API key', async () => {
    // Create a key
    await request(app)
      .post('/api/admin/api-keys')
      .set('X-Session-Id', adminSessionId)
      .send({ name: 'to-delete' });

    // Find its id
    const listRes = await request(app)
      .get('/api/admin/api-keys')
      .set('X-Session-Id', adminSessionId);

    const key = listRes.body.find((k: any) => k.name === 'to-delete');
    expect(key).toBeDefined();

    // Delete it
    const delRes = await request(app)
      .delete(`/api/admin/api-keys/${key.id}`)
      .set('X-Session-Id', adminSessionId);

    expect(delRes.status).toBe(200);
    expect(delRes.body.ok).toBe(true);

    // Verify it's gone
    const listRes2 = await request(app)
      .get('/api/admin/api-keys')
      .set('X-Session-Id', adminSessionId);

    const deleted = listRes2.body.find((k: any) => k.id === key.id);
    expect(deleted).toBeUndefined();
  });
});

describe('requireApiKey middleware', () => {
  it('should return 401 when X-API-Key header is missing', async () => {
    const res = await request(app)
      .post('/api/create-shared')
      .send({ text: 'hello', phrases: ['hello'] });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Missing API key');
  });

  it('should return 401 when X-API-Key header is invalid', async () => {
    const res = await request(app)
      .post('/api/create-shared')
      .set('X-API-Key', 'invalid-key-12345')
      .send({ text: 'hello', phrases: ['hello'] });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid API key');
  });

  it('should succeed with a valid API key', async () => {
    // Create an API key via admin endpoint
    const createRes = await request(app)
      .post('/api/admin/api-keys')
      .set('X-Session-Id', adminSessionId)
      .send({ name: 'valid-key' });

    const rawKey = createRes.body.key;

    // Use it on the create-shared endpoint
    const res = await request(app)
      .post('/api/create-shared')
      .set('X-API-Key', rawKey)
      .send({ text: 'Der Tisch ist groß.', phrases: ['Tisch'] });

    // Should not be 401 — it should proceed to the endpoint logic
    expect(res.status).not.toBe(401);
    // Should succeed (200) since the request is valid
    expect(res.status).toBe(200);
    expect(res.body.code).toBeDefined();
  });
});
