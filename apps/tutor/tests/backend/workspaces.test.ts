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
});

describe('POST /api/workspaces', () => {
  it('should create a new workspace', async () => {
    const res = await request(app)
      .post('/api/workspaces')
      .set('X-Session-Id', sessionId)
      .send({ name: 'My Workspace' });

    expect(res.status).toBe(200);
    expect(res.body.id).toBeTruthy();
    expect(res.body.name).toBe('My Workspace');
    expect(typeof res.body.position).toBe('number');
  });

  it('should auto-name workspace if no name given', async () => {
    const res = await request(app)
      .post('/api/workspaces')
      .set('X-Session-Id', sessionId)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.name).toBeTruthy();
  });

  it('should increment position for subsequent workspaces', async () => {
    const res1 = await request(app)
      .post('/api/workspaces')
      .set('X-Session-Id', sessionId)
      .send({ name: 'First' });

    const res2 = await request(app)
      .post('/api/workspaces')
      .set('X-Session-Id', sessionId)
      .send({ name: 'Second' });

    expect(res2.body.position).toBeGreaterThan(res1.body.position);
  });
});

describe('PATCH /api/workspaces/:id', () => {
  it('should rename a workspace', async () => {
    const wsId = await createTestWorkspace(pool, userId, 'Old Name');

    const res = await request(app)
      .patch(`/api/workspaces/${wsId}`)
      .set('X-Session-Id', sessionId)
      .send({ name: 'New Name' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe('DELETE /api/workspaces/:id', () => {
  it('should delete a workspace when multiple exist', async () => {
    const ws1 = await createTestWorkspace(pool, userId, 'Workspace 1');
    const ws2 = await createTestWorkspace(pool, userId, 'Workspace 2');

    const res = await request(app)
      .delete(`/api/workspaces/${ws2}`)
      .set('X-Session-Id', sessionId);

    expect(res.status).toBe(200);
    expect(res.body.newActiveWorkspaceId).toBeTruthy();
  });

  it('should refuse to delete the last workspace', async () => {
    const wsId = await createTestWorkspace(pool, userId, 'Only Workspace');

    const res = await request(app)
      .delete(`/api/workspaces/${wsId}`)
      .set('X-Session-Id', sessionId);

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('last workspace');
  });
});

describe('PATCH /api/users/active-workspace', () => {
  it('should switch active workspace', async () => {
    const ws1 = await createTestWorkspace(pool, userId, 'WS 1');
    const ws2 = await createTestWorkspace(pool, userId, 'WS 2');

    const res = await request(app)
      .patch('/api/users/active-workspace')
      .set('X-Session-Id', sessionId)
      .send({ workspaceId: ws2 });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Verify via state
    const stateRes = await request(app)
      .get('/api/state')
      .set('X-Session-Id', sessionId);

    expect(stateRes.body.activeWorkspaceId).toBe(ws2);
  });
});

describe('PUT /api/preferences', () => {
  it('should update user preferences', async () => {
    // Create a workspace first so GET /api/state works
    await createTestWorkspace(pool, userId);

    const res = await request(app)
      .put('/api/preferences')
      .set('X-Session-Id', sessionId)
      .send({
        interfaceLanguage: 'de',
        explanationLanguage: 'ru',
        theme: 'dark',
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Verify
    const stateRes = await request(app)
      .get('/api/state')
      .set('X-Session-Id', sessionId);

    expect(stateRes.body.preferences.interfaceLanguage).toBe('de');
    expect(stateRes.body.preferences.explanationLanguage).toBe('ru');
  });
});
