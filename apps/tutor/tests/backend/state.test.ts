import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import { getTestApp, createTestUser, createTestWorkspace } from './setup';

let app: any;
let pool: any;
let sessionId: string;
let userId: string;
let workspaceId: string;

beforeAll(async () => {
  ({ app, pool } = await getTestApp());
});

beforeEach(async () => {
  const user = await createTestUser(pool);
  sessionId = user.sessionId;
  userId = user.userId;
  workspaceId = await createTestWorkspace(pool, userId);
});

describe('GET /api/state', () => {
  it('should return user state with workspaces', async () => {
    const res = await request(app)
      .get('/api/state')
      .set('X-Session-Id', sessionId);

    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();
    expect(res.body.workspaces).toBeDefined();
    expect(res.body.workspaces.length).toBeGreaterThanOrEqual(1);
    expect(res.body.state).toBeDefined();
  });

  it('should auto-create workspace if user has none', async () => {
    const { sessionId: newSession, userId: newUserId } = await createTestUser(pool);
    // Don't create workspace for this user

    const res = await request(app)
      .get('/api/state')
      .set('X-Session-Id', newSession);

    expect(res.status).toBe(200);
    // Should auto-create a workspace
    expect(res.body.workspaces.length).toBeGreaterThanOrEqual(1);
  });
});

describe('PUT /api/state', () => {
  it('should save workspace state', async () => {
    const state = { text: 'Hello world', explanationHistory: [] };

    const res = await request(app)
      .put('/api/state')
      .set('X-Session-Id', sessionId)
      .send({ workspaceId, state });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.updatedAt).toBeTruthy();
  });

  it('should retrieve saved state', async () => {
    const state = { text: 'Guten Tag', history: ['word1'] };

    // Save
    await request(app)
      .put('/api/state')
      .set('X-Session-Id', sessionId)
      .send({ workspaceId, state });

    // Load
    const res = await request(app)
      .get(`/api/state/${workspaceId}`)
      .set('X-Session-Id', sessionId);

    expect(res.status).toBe(200);
    expect(res.body.state.text).toBe('Guten Tag');
  });

  it('should detect sync conflict when lastSavedAt is stale', async () => {
    const state = { text: 'Version 1' };

    // First save
    const save1 = await request(app)
      .put('/api/state')
      .set('X-Session-Id', sessionId)
      .send({ workspaceId, state });

    const firstSavedAt = save1.body.updatedAt;

    // Second save from "another device"
    await request(app)
      .put('/api/state')
      .set('X-Session-Id', sessionId)
      .send({ workspaceId, state: { text: 'Version 2' } });

    // Third save with stale timestamp
    const conflictRes = await request(app)
      .put('/api/state')
      .set('X-Session-Id', sessionId)
      .send({ workspaceId, state: { text: 'Version 3' }, lastSavedAt: firstSavedAt });

    expect(conflictRes.status).toBe(409);
    expect(conflictRes.body.conflict).toBe(true);
  });

  it('should force save when force=true despite conflict', async () => {
    const state = { text: 'Version 1' };

    const save1 = await request(app)
      .put('/api/state')
      .set('X-Session-Id', sessionId)
      .send({ workspaceId, state });

    // Another save
    await request(app)
      .put('/api/state')
      .set('X-Session-Id', sessionId)
      .send({ workspaceId, state: { text: 'Version 2' } });

    // Force save with stale timestamp
    const forceRes = await request(app)
      .put('/api/state')
      .set('X-Session-Id', sessionId)
      .send({
        workspaceId,
        state: { text: 'Forced Version' },
        lastSavedAt: save1.body.updatedAt,
        force: true,
      });

    expect(forceRes.status).toBe(200);
    expect(forceRes.body.ok).toBe(true);
  });

  it('should reject save for workspace not owned by user', async () => {
    const otherUser = await createTestUser(pool);
    const otherWsId = await createTestWorkspace(pool, otherUser.userId);

    const res = await request(app)
      .get(`/api/state/${otherWsId}`)
      .set('X-Session-Id', sessionId);

    expect(res.status).toBe(403);
  });
});

describe('GET /api/state/:workspaceId/timestamp', () => {
  it('should return updatedAt for owned workspace', async () => {
    // Save something first
    await request(app)
      .put('/api/state')
      .set('X-Session-Id', sessionId)
      .send({ workspaceId, state: { text: 'test' } });

    const res = await request(app)
      .get(`/api/state/${workspaceId}/timestamp`)
      .set('X-Session-Id', sessionId);

    expect(res.status).toBe(200);
    expect(res.body.updatedAt).toBeTruthy();
  });
});
