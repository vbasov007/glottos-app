import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import { getTestApp, createTestUser } from './setup';

let app: any;
let pool: any;

beforeAll(async () => {
  ({ app, pool } = await getTestApp());
});

async function makeAdmin(userId: string) {
  await pool.query(`UPDATE users SET role='admin' WHERE id=$1`, [userId]);
}

async function seedActivityRow(userId: string, opts: {
  action: string;
  provider?: string;
  model?: string;
  language?: string;
  inputUnits?: number;
  outputUnits?: number;
  durationMs?: number;
  device?: string;
  detail?: string;
  createdAt?: string;
}) {
  await pool.query(
    `INSERT INTO activity_log (user_id, action, detail, input_units, output_units, device, model, provider, language, duration_ms, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, COALESCE($11::timestamptz, NOW()))`,
    [
      userId, opts.action,
      opts.detail ?? null,
      opts.inputUnits ?? null,
      opts.outputUnits ?? null,
      opts.device ?? null,
      opts.model ?? null,
      opts.provider ?? null,
      opts.language ?? null,
      opts.durationMs ?? null,
      opts.createdAt ?? null,
    ]
  );
}

beforeEach(async () => {
  await pool.query(`DELETE FROM activity_log`);
});

describe('GET /api/admin/cost-log', () => {
  it('requires a session', async () => {
    const res = await request(app).get('/api/admin/cost-log?start=2026-01-01&end=2026-01-31');
    expect(res.status).toBe(401);
  });

  it('refuses non-admin users', async () => {
    const u = await createTestUser(pool);
    const res = await request(app)
      .get('/api/admin/cost-log?start=2026-01-01&end=2026-01-31')
      .set('X-Session-Id', u.sessionId);
    expect(res.status).toBe(403);
  });

  it('rejects malformed dates and inverted ranges', async () => {
    const u = await createTestUser(pool);
    await makeAdmin(u.userId);
    const bad1 = await request(app).get('/api/admin/cost-log?start=2026/01/01&end=2026-01-31').set('X-Session-Id', u.sessionId);
    expect(bad1.status).toBe(400);
    const bad2 = await request(app).get('/api/admin/cost-log?start=2026-12-01&end=2026-01-01').set('X-Session-Id', u.sessionId);
    expect(bad2.status).toBe(400);
  });

  it('returns CSV with the header row when the range is empty', async () => {
    const u = await createTestUser(pool);
    await makeAdmin(u.userId);
    const res = await request(app)
      .get('/api/admin/cost-log?start=2026-01-01&end=2026-01-02')
      .set('X-Session-Id', u.sessionId);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.text.split('\n')[0]).toBe('id,created_at,user_id,action,provider,model,language,input_units,output_units,cost_usd,duration_ms,device,detail');
    expect(res.text.trim().split('\n')).toHaveLength(1);
  });

  it('streams rows with computed cost_usd', async () => {
    const u = await createTestUser(pool);
    await makeAdmin(u.userId);
    // Seed two rows — one LLM (gemini-2.5-flash-lite), one TTS (google-tts wildcard).
    await seedActivityRow(u.userId, {
      action: 'explain', provider: 'gemini', model: 'gemini-2.5-flash-lite',
      inputUnits: 1_000_000, outputUnits: 500_000, language: 'de', durationMs: 850,
    });
    await seedActivityRow(u.userId, {
      action: 'tts_request', provider: 'google-tts', model: 'de-DE-Neural2-C',
      inputUnits: 1_000_000, language: 'de', durationMs: 220,
    });

    const today = new Date().toISOString().slice(0, 10);
    const res = await request(app)
      .get(`/api/admin/cost-log?start=${today}&end=${today}`)
      .set('X-Session-Id', u.sessionId);
    expect(res.status).toBe(200);
    const lines = res.text.trim().split('\n');
    expect(lines).toHaveLength(3); // header + 2 rows

    // cost_usd column for the explain row: 1M input @ 0.10 + 0.5M output @ 0.40 = 0.10 + 0.20 = 0.30
    const explainCols = lines[1].split(',');
    const costIdx = lines[0].split(',').indexOf('cost_usd');
    expect(parseFloat(explainCols[costIdx])).toBeCloseTo(0.30, 4);

    // TTS: 1M chars @ $16/1M = 16.00
    const ttsCols = lines[2].split(',');
    expect(parseFloat(ttsCols[costIdx])).toBeCloseTo(16.00, 4);
  });
});
