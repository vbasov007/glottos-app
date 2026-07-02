import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'node:crypto';
import { verifyInitData, mapLanguageToNative, parseStartParam } from '../lib/telegram';

const FAKE_TOKEN = 'test-bot-token-12345';

// Build a signed initData blob the same way Telegram itself does it.
// Exposed for the curl smoke test below too — same algorithm.
function signInitData(
  fields: Record<string, string | object | number>,
  token: string,
): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) {
    params.set(k, typeof v === 'string' ? v : JSON.stringify(v));
  }
  const lines: string[] = [];
  for (const [k, v] of params.entries()) lines.push(`${k}=${v}`);
  lines.sort();
  const dataCheckString = lines.join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
  params.set('hash', hash);
  return params.toString();
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function makeUser(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 42,
    first_name: 'Anna',
    last_name: 'Bauer',
    username: 'anna',
    language_code: 'de',
    ...extra,
  };
}

describe('verifyInitData', () => {
  beforeEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = FAKE_TOKEN;
    // Reset the lazy token cache in lib/telegram so each test reads the env.
    // The module caches the token in a module-scoped let; we re-import to
    // reset for the no-token tests. Vitest's resetModules covers that
    // surface — call it before tests that touch the env.
  });

  afterEach(() => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    vi.resetModules();
  });

  it('accepts a freshly-signed payload', async () => {
    const initData = signInitData(
      {
        auth_date: nowSec(),
        query_id: 'AAH123',
        user: makeUser(),
      },
      FAKE_TOKEN,
    );
    const { verifyInitData: fresh } = await import('../lib/telegram');
    const result = fresh(initData);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.user.id).toBe(42);
      expect(result.user.first_name).toBe('Anna');
      expect(result.authDate.getTime()).toBeGreaterThan(0);
    }
  });

  it('rejects a tampered field', async () => {
    const goodInitData = signInitData(
      { auth_date: nowSec(), user: makeUser() },
      FAKE_TOKEN,
    );
    // Mutate the user blob WITHOUT re-signing — hash now doesn't match.
    const params = new URLSearchParams(goodInitData);
    params.set('user', JSON.stringify(makeUser({ id: 999 })));
    const { verifyInitData: fresh } = await import('../lib/telegram');
    const result = fresh(params.toString());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('bad_hash');
  });

  it('rejects missing hash', async () => {
    const params = new URLSearchParams({
      auth_date: String(nowSec()),
      user: JSON.stringify(makeUser()),
    });
    const { verifyInitData: fresh } = await import('../lib/telegram');
    const result = fresh(params.toString());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('no_hash');
  });

  it('rejects stale auth_date older than 24h', async () => {
    const stale = nowSec() - 25 * 60 * 60;
    const initData = signInitData(
      { auth_date: stale, user: makeUser() },
      FAKE_TOKEN,
    );
    const { verifyInitData: fresh } = await import('../lib/telegram');
    const result = fresh(initData);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('stale');
  });

  it('rejects malformed user JSON', async () => {
    const params = new URLSearchParams({
      auth_date: String(nowSec()),
      user: 'not-json{{{',
    });
    const lines: string[] = [];
    for (const [k, v] of params.entries()) lines.push(`${k}=${v}`);
    lines.sort();
    const dataCheckString = lines.join('\n');
    const secret = crypto.createHmac('sha256', 'WebAppData').update(FAKE_TOKEN).digest();
    params.set('hash', crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex'));
    const { verifyInitData: fresh } = await import('../lib/telegram');
    const result = fresh(params.toString());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('malformed_user');
  });

  it('reports no_token when TELEGRAM_BOT_TOKEN is unset', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    vi.resetModules();
    const { verifyInitData: fresh } = await import('../lib/telegram');
    const result = fresh('anything');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('no_token');
  });

  it('parses start_param when present', async () => {
    const initData = signInitData(
      {
        auth_date: nowSec(),
        user: makeUser(),
        start_param: 'lesson_classic50_7',
      },
      FAKE_TOKEN,
    );
    const { verifyInitData: fresh } = await import('../lib/telegram');
    const result = fresh(initData);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.startParam).toBe('lesson_classic50_7');
  });
});

describe('mapLanguageToNative', () => {
  it('maps ru/uk/be to ru', () => {
    expect(mapLanguageToNative('ru')).toBe('ru');
    expect(mapLanguageToNative('uk')).toBe('ru');
    expect(mapLanguageToNative('be-BY')).toBe('ru');
  });
  it('maps de/at/ch to de', () => {
    expect(mapLanguageToNative('de')).toBe('de');
    expect(mapLanguageToNative('at')).toBe('de');
    expect(mapLanguageToNative('de-AT')).toBe('de');
  });
  it('maps pl to pl', () => {
    expect(mapLanguageToNative('pl')).toBe('pl');
    expect(mapLanguageToNative('pl-PL')).toBe('pl');
  });
  it('defaults unknown / missing codes to en', () => {
    expect(mapLanguageToNative(undefined)).toBe('en');
    expect(mapLanguageToNative(null)).toBe('en');
    expect(mapLanguageToNative('')).toBe('en');
    expect(mapLanguageToNative('zh')).toBe('en');
    expect(mapLanguageToNative('en-US')).toBe('en');
  });
});

describe('parseStartParam', () => {
  it('parses valid lesson deep links', () => {
    expect(parseStartParam('lesson_classic50_1')).toEqual({ course: 'classic50', lessonN: 1 });
    expect(parseStartParam('lesson_classic50_50')).toEqual({ course: 'classic50', lessonN: 50 });
    expect(parseStartParam('lesson_losreden50_3')).toEqual({ course: 'losreden50', lessonN: 3 });
  });
  it('rejects unknown course slugs', () => {
    expect(parseStartParam('lesson_unknown_1')).toBeNull();
  });
  it('rejects out-of-range lesson numbers', () => {
    expect(parseStartParam('lesson_classic50_0')).toBeNull();
    expect(parseStartParam('lesson_classic50_51')).toBeNull();
  });
  it('rejects malformed strings', () => {
    expect(parseStartParam(null)).toBeNull();
    expect(parseStartParam('')).toBeNull();
    expect(parseStartParam('classic50_1')).toBeNull();
    expect(parseStartParam('something_else')).toBeNull();
  });
});
