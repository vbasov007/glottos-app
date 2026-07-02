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
  workspaceId = await createTestWorkspace(pool, userId, 'Shareable WS');

  // Save some state to the workspace
  await request(app)
    .put('/api/state')
    .set('X-Session-Id', sessionId)
    .send({ workspaceId, state: { text: 'Der Tisch ist groß.', textLanguage: 'de' } });
});

describe('POST /api/share', () => {
  it('should create a share code', async () => {
    const res = await request(app)
      .post('/api/share')
      .set('X-Session-Id', sessionId)
      .send({ workspaceId });

    expect(res.status).toBe(200);
    expect(res.body.code).toBeDefined();
    expect(res.body.code.length).toBeGreaterThanOrEqual(6);
  });

  it('should require workspaceId', async () => {
    const res = await request(app)
      .post('/api/share')
      .set('X-Session-Id', sessionId)
      .send({});

    expect(res.status).toBe(400);
  });

  it('should reject sharing workspace not owned by user', async () => {
    const other = await createTestUser(pool);
    const otherWs = await createTestWorkspace(pool, other.userId, 'Other WS');

    const res = await request(app)
      .post('/api/share')
      .set('X-Session-Id', sessionId)
      .send({ workspaceId: otherWs });

    expect(res.status).toBe(403);
  });

  it('should require authentication', async () => {
    const res = await request(app)
      .post('/api/share')
      .send({ workspaceId });

    expect(res.status).toBe(401);
  });
});

describe('GET /api/shared/:code', () => {
  it('should fetch shared lesson by code', async () => {
    // Create share
    const shareRes = await request(app)
      .post('/api/share')
      .set('X-Session-Id', sessionId)
      .send({ workspaceId });

    const code = shareRes.body.code;

    // Fetch it (no auth required)
    const res = await request(app)
      .get(`/api/shared/${code}`);

    expect(res.status).toBe(200);
    expect(res.body.state).toBeDefined();
    expect(res.body.workspaceName).toBe('Shareable WS');
  });

  it('should return 404 for non-existent code', async () => {
    const res = await request(app)
      .get('/api/shared/NONEXIST');

    expect(res.status).toBe(404);
  });
});
