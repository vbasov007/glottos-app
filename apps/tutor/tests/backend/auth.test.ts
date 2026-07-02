import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { getTestApp, createTestUser } from './setup';

let app: any;
let pool: any;

beforeAll(async () => {
  ({ app, pool } = await getTestApp());
});

describe('POST /api/auth/google', () => {
  it('should create user and return session on valid credential', async () => {
    const res = await request(app)
      .post('/api/auth/google')
      .send({ credential: 'fake-google-token' });

    expect(res.status).toBe(200);
    expect(res.body.sessionId).toBeTruthy();
    expect(res.body.user).toBeTruthy();
    expect(res.body.user.email).toBe('test@example.com');
    expect(res.body.user.name).toBe('Test User');
  });

  it('should return same user on repeated login', async () => {
    const res1 = await request(app)
      .post('/api/auth/google')
      .send({ credential: 'fake-google-token' });

    const res2 = await request(app)
      .post('/api/auth/google')
      .send({ credential: 'fake-google-token' });

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(res1.body.user.email).toBe(res2.body.user.email);
    // Each login should create a new session
    expect(res1.body.sessionId).not.toBe(res2.body.sessionId);
  });
});

describe('Authentication middleware', () => {
  it('should reject requests without session header', async () => {
    const res = await request(app)
      .get('/api/state');

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('No session');
  });

  it('should reject requests with invalid session', async () => {
    const res = await request(app)
      .get('/api/state')
      .set('X-Session-Id', 'nonexistent-session');

    expect(res.status).toBe(401);
  });

  it('should accept requests with valid session', async () => {
    // Login first
    const loginRes = await request(app)
      .post('/api/auth/google')
      .send({ credential: 'fake-google-token' });

    const sessionId = loginRes.body.sessionId;

    const res = await request(app)
      .get('/api/state')
      .set('X-Session-Id', sessionId);

    expect(res.status).toBe(200);
  });

  it('should accept session via query parameter', async () => {
    const loginRes = await request(app)
      .post('/api/auth/google')
      .send({ credential: 'fake-google-token' });

    const sessionId = loginRes.body.sessionId;

    const res = await request(app)
      .get(`/api/state?sid=${sessionId}`);

    expect(res.status).toBe(200);
  });
});

describe('Admin middleware', () => {
  it('should return 403 for non-admin user', async () => {
    const { sessionId } = await createTestUser(pool, { role: 'user' });

    const res = await request(app)
      .get('/api/admin/users?period=day')
      .set('X-Session-Id', sessionId);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Forbidden');
  });

  it('should allow admin access to settings endpoint', async () => {
    const { sessionId } = await createTestUser(pool, { role: 'admin' });

    // Use settings endpoint which has simpler SQL (avoids pg-mem subquery limitations)
    const res = await request(app)
      .get('/api/admin/settings')
      .set('X-Session-Id', sessionId);

    expect(res.status).toBe(200);
    expect(res.body.settings).toBeDefined();
  });
});
