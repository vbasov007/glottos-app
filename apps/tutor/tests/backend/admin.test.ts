import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import { getTestApp, createTestUser } from './setup';

let app: any;
let pool: any;
let adminSessionId: string;
let adminUserId: string;

beforeAll(async () => {
  ({ app, pool } = await getTestApp());
});

beforeEach(async () => {
  const admin = await createTestUser(pool, { role: 'admin' });
  adminSessionId = admin.sessionId;
  adminUserId = admin.userId;
});

describe('GET /api/admin/settings', () => {
  it('should return app settings', async () => {
    const res = await request(app)
      .get('/api/admin/settings')
      .set('X-Session-Id', adminSessionId);

    expect(res.status).toBe(200);
    expect(res.body.settings).toBeDefined();
    expect(res.body.settings.llm_model).toBeDefined();
    expect(res.body.settings.tts_provider).toBeDefined();
  });
});

describe('PUT /api/admin/settings', () => {
  it('should update a setting', async () => {
    const res = await request(app)
      .put('/api/admin/settings')
      .set('X-Session-Id', adminSessionId)
      .send({ key: 'llm_model', value: 'gemini-2.5-pro' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Verify
    const getRes = await request(app)
      .get('/api/admin/settings')
      .set('X-Session-Id', adminSessionId);

    expect(getRes.body.settings.llm_model).toBe('gemini-2.5-pro');
  });
});

describe('PATCH /api/admin/users/:id/subscription', () => {
  it('should grant Pro to a user', async () => {
    const user = await createTestUser(pool);

    const res = await request(app)
      .patch(`/api/admin/users/${user.userId}/subscription`)
      .set('X-Session-Id', adminSessionId)
      .send({ status: 'active' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Verify
    const { rows } = await pool.query('SELECT subscription_status FROM users WHERE id=$1', [user.userId]);
    expect(rows[0].subscription_status).toBe('active');
  });

  it('should reject invalid status', async () => {
    const user = await createTestUser(pool);

    const res = await request(app)
      .patch(`/api/admin/users/${user.userId}/subscription`)
      .set('X-Session-Id', adminSessionId)
      .send({ status: 'premium' });

    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/admin/users/:id', () => {
  it('should delete a user', async () => {
    const user = await createTestUser(pool);

    const res = await request(app)
      .delete(`/api/admin/users/${user.userId}`)
      .set('X-Session-Id', adminSessionId);

    expect(res.status).toBe(200);

    // Verify user is gone
    const { rows } = await pool.query('SELECT id FROM users WHERE id=$1', [user.userId]);
    expect(rows.length).toBe(0);
  });

  it('should not allow self-deletion', async () => {
    const res = await request(app)
      .delete(`/api/admin/users/${adminUserId}`)
      .set('X-Session-Id', adminSessionId);

    expect(res.status).toBe(400);
  });
});

describe('Admin routes require admin role', () => {
  it('should return 403 for regular user on settings', async () => {
    const user = await createTestUser(pool, { role: 'user' });

    const res = await request(app)
      .get('/api/admin/settings')
      .set('X-Session-Id', user.sessionId);

    expect(res.status).toBe(403);
  });

  it('should return 401 without session', async () => {
    const res = await request(app)
      .get('/api/admin/settings');

    expect(res.status).toBe(401);
  });
});
