import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import { getTestApp, createTestUser } from './setup';

// The mocked OAuth2Client (see tests/backend/setup.ts) returns a fixed Google
// payload — sub='test-google-id-123', email='test@example.com'. So every
// test in this file links "the same" Google account, which is exactly what we
// want for the conflict probe.
const MOCKED_GOOGLE_SUB = 'test-google-id-123';
const MOCKED_GOOGLE_EMAIL = 'test@example.com';

let app: any;
let pool: any;

beforeAll(async () => {
  ({ app, pool } = await getTestApp());
});

beforeEach(async () => {
  // Reset google_sub on the row that might be claiming the mock sub so each
  // test starts clean.
  await pool.query('UPDATE users SET google_sub=NULL WHERE google_sub=$1', [MOCKED_GOOGLE_SUB]);
  await pool.query('DELETE FROM users WHERE id=$1', [MOCKED_GOOGLE_SUB]);
});

describe('POST /api/auth/link-google', () => {
  it('requires authentication', async () => {
    const res = await request(app)
      .post('/api/auth/link-google')
      .send({ credential: 'any-token' });
    expect(res.status).toBe(401);
  });

  it('returns 400 when credential is missing', async () => {
    const u = await createTestUser(pool, { email: null as any });
    const res = await request(app)
      .post('/api/auth/link-google')
      .set('X-Session-Id', u.sessionId)
      .send({});
    expect(res.status).toBe(400);
  });

  it('attaches google_sub + email to the current user', async () => {
    const u = await createTestUser(pool, { email: null as any });
    const res = await request(app)
      .post('/api/auth/link-google')
      .set('X-Session-Id', u.sessionId)
      .send({ credential: 'mock-credential' });

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(MOCKED_GOOGLE_EMAIL);

    const { rows } = await pool.query('SELECT google_sub, email FROM users WHERE id=$1', [u.userId]);
    expect(rows[0].google_sub).toBe(MOCKED_GOOGLE_SUB);
    expect(rows[0].email).toBe(MOCKED_GOOGLE_EMAIL);
  });

  it('merges the current user into the existing Google user when both rows exist', async () => {
    // Set up a Google-rooted user (created via /api/auth/google as if from a
    // previous web sign-in) — owns the mocked sub.
    const first = await createTestUser(pool, { email: null as any });
    const linkRes = await request(app)
      .post('/api/auth/link-google')
      .set('X-Session-Id', first.sessionId)
      .send({ credential: 'mock-credential' });
    expect(linkRes.status).toBe(200);
    const googleUserId = first.userId;

    // Now a SECOND user (think: Telegram-rooted) has been working separately;
    // create them and stash a workspace in their account.
    const second = await createTestUser(pool, { email: null as any });
    await pool.query(
      'INSERT INTO workspaces (id, user_id, name, position) VALUES ($1, $2, $3, 0)',
      ['ws-from-second', second.userId, 'Second user workspace']
    );

    // Linking Google from the second user should MERGE into the Google user,
    // not refuse with 409.
    const mergeRes = await request(app)
      .post('/api/auth/link-google')
      .set('X-Session-Id', second.sessionId)
      .send({ credential: 'mock-credential' });
    expect(mergeRes.status).toBe(200);
    expect(mergeRes.body.merged).toBe(true);

    // The merged-away user row is gone.
    const { rows: gone } = await pool.query('SELECT id FROM users WHERE id=$1', [second.userId]);
    expect(gone).toHaveLength(0);

    // The workspace that belonged to the second user now belongs to the Google user.
    const { rows: ws } = await pool.query('SELECT user_id FROM workspaces WHERE id=$1', ['ws-from-second']);
    expect(ws[0].user_id).toBe(googleUserId);

    // The second user's session is still valid and now resolves to the Google user.
    const { rows: sess } = await pool.query('SELECT user_id FROM sessions WHERE session_id=$1', [second.sessionId]);
    expect(sess[0].user_id).toBe(googleUserId);
  });
});

describe('POST /api/auth/google after linking', () => {
  it('signing in via Google resolves to the same user (by google_sub)', async () => {
    // Create a non-Google user (think: Telegram-rooted), link Google to them.
    const u = await createTestUser(pool, { email: null as any });
    await request(app)
      .post('/api/auth/link-google')
      .set('X-Session-Id', u.sessionId)
      .send({ credential: 'mock-credential' });

    // Now sign in fresh via /api/auth/google as if from a new device.
    const signin = await request(app)
      .post('/api/auth/google')
      .send({ credential: 'mock-credential' });

    expect(signin.status).toBe(200);
    const newSession = signin.body.sessionId;
    expect(newSession).toBeTruthy();

    // The new session must point at the ORIGINAL user, not a freshly created
    // user keyed by the Google sub.
    const { rows } = await pool.query('SELECT user_id FROM sessions WHERE session_id=$1', [newSession]);
    expect(rows[0].user_id).toBe(u.userId);
  });
});
