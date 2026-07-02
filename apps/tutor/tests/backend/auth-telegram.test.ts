import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { createHmac } from 'crypto';
import request from 'supertest';
import { getTestApp } from './setup';

let app: any;
let pool: any;

const BOT_TOKEN = '1234567:test-bot-token';

function signInitData(fields: Record<string, string>): string {
  const dataCheck = Object.entries(fields)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const hash = createHmac('sha256', secret).update(dataCheck).digest('hex');
  const params = new URLSearchParams(fields);
  params.append('hash', hash);
  return params.toString();
}

function validInitData(user: Record<string, unknown>) {
  return signInitData({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify(user),
    query_id: 'q1',
  });
}

beforeAll(async () => {
  ({ app, pool } = await getTestApp());
});

beforeEach(() => {
  vi.stubEnv('TELEGRAM_BOT_TOKEN', BOT_TOKEN);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /api/auth/telegram', () => {
  it('returns 503 when TELEGRAM_BOT_TOKEN is not set', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', '');
    const res = await request(app)
      .post('/api/auth/telegram')
      .send({ initData: validInitData({ id: 42, first_name: 'Ada' }) });
    expect(res.status).toBe(503);
  });

  it('returns 400 when initData is missing', async () => {
    const res = await request(app)
      .post('/api/auth/telegram')
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns 401 when initData signature is invalid', async () => {
    const initData = validInitData({ id: 42, first_name: 'Ada' });
    const tampered = initData.replace(/hash=[a-f0-9]+/, 'hash=' + 'a'.repeat(64));
    const res = await request(app)
      .post('/api/auth/telegram')
      .send({ initData: tampered });
    expect(res.status).toBe(401);
  });

  it('creates a new user and session on first valid call', async () => {
    const initData = validInitData({ id: 12345, first_name: 'Ada', last_name: 'L' });
    const res = await request(app)
      .post('/api/auth/telegram')
      .send({ initData });

    expect(res.status).toBe(200);
    expect(res.body.sessionId).toBeTruthy();
    expect(res.body.user.name).toBe('Ada L');
    expect(res.body.user.role).toBe('user');
    expect(res.body.user.email).toBeNull();

    const { rows } = await pool.query('SELECT id, telegram_id, name, email FROM users WHERE telegram_id=$1', [12345]);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Ada L');
    expect(rows[0].email).toBeNull();

    const sessRows = await pool.query('SELECT user_id FROM sessions WHERE session_id=$1', [res.body.sessionId]);
    expect(sessRows.rows).toHaveLength(1);
    expect(sessRows.rows[0].user_id).toBe(rows[0].id);
  });

  it('reuses the existing user on a repeat call with the same telegram_id', async () => {
    const tid = 67890;
    const first = await request(app)
      .post('/api/auth/telegram')
      .send({ initData: validInitData({ id: tid, first_name: 'Ada' }) });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post('/api/auth/telegram')
      .send({ initData: validInitData({ id: tid, first_name: 'Ada Updated' }) });
    expect(second.status).toBe(200);
    expect(second.body.sessionId).not.toBe(first.body.sessionId);
    expect(second.body.user.name).toBe('Ada Updated');

    const { rows } = await pool.query('SELECT id, name FROM users WHERE telegram_id=$1', [tid]);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Ada Updated');
  });
});
