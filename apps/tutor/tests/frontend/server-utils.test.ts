import { describe, it, expect } from 'vitest';
import { createHmac } from 'crypto';
import { generateShareCode, getTextLimit, isOcrRefusal, verifyTelegramInitData, signLinkState, verifyLinkState, estimateCostUsd, PRICING_USD_PER_1M } from '../../server-utils';

describe('generateShareCode', () => {
  it('should return a 6-character string', () => {
    const code = generateShareCode();
    expect(typeof code).toBe('string');
    expect(code.length).toBe(6);
  });

  it('should contain only alphanumeric characters', () => {
    const code = generateShareCode();
    expect(code).toMatch(/^[A-Za-z0-9]{6}$/);
  });

  it('should return different values on multiple calls', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 20; i++) {
      codes.add(generateShareCode());
    }
    // With 62^6 possible codes, 20 calls should produce at least 15 unique values
    expect(codes.size).toBeGreaterThanOrEqual(15);
  });
});

describe('getTextLimit', () => {
  it('should return 500 for Chinese (zh)', () => {
    expect(getTextLimit('zh')).toBe(500);
  });

  it('should return 500 for Japanese (ja)', () => {
    expect(getTextLimit('ja')).toBe(500);
  });

  it('should return 2000 for German (de)', () => {
    expect(getTextLimit('de')).toBe(2000);
  });

  it('should return 2000 for English (en)', () => {
    expect(getTextLimit('en')).toBe(2000);
  });

  it('should return 2000 for French (fr)', () => {
    expect(getTextLimit('fr')).toBe(2000);
  });

  it('should return 2000 for Russian (ru)', () => {
    expect(getTextLimit('ru')).toBe(2000);
  });

  it('should return 2000 for unknown languages', () => {
    expect(getTextLimit('xyz')).toBe(2000);
  });
});

describe('isOcrRefusal', () => {
  it('detects the user-reported phrasing', () => {
    expect(isOcrRefusal(
      'Could you provide a higher-resolution image or a closer crop of the page? The current image is too blurry to read accurately.'
    )).toBe(true);
  });

  it('detects "unable to read"', () => {
    expect(isOcrRefusal("I'm unable to read the text in this image.")).toBe(true);
  });

  it('detects "please provide" + clearer image', () => {
    expect(isOcrRefusal('Please provide a clearer image.')).toBe(true);
  });

  it('detects "sorry" apologies', () => {
    expect(isOcrRefusal("Sorry, I can't make out the text.")).toBe(true);
  });

  it('does not flag empty string', () => {
    expect(isOcrRefusal('')).toBe(false);
  });

  it('does not flag normal extracted text', () => {
    expect(isOcrRefusal(
      'Die Nudel lag auf dem Gehsteig.\nSie war dick und geriffelt, mit einem Loch drin von vorn bis hinten.'
    )).toBe(false);
  });

  it('does not flag long real text that happens to contain a refusal-ish word', () => {
    // Real OCR'd text could mention "blurry" or "sorry" inside book prose.
    // Refusals are short paragraphs; long text is treated as legitimate.
    const longBookText = ('The artist apologised once again. ' + 'Sed ut perspiciatis unde omnis iste natus error. '.repeat(20)).trim();
    expect(longBookText.length).toBeGreaterThan(400);
    expect(isOcrRefusal(longBookText)).toBe(false);
  });
});

// Re-implement Telegram's signing here to produce test fixtures without
// hand-rolling hashes. Same algorithm as the verifier so a bug in both would
// pass the test — but the cross-check is in tests/backend/auth-telegram.test.ts
// which exercises the full endpoint flow.
function signInitData(fields: Record<string, string>, botToken: string): string {
  const dataCheck = Object.entries(fields)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secret).update(dataCheck).digest('hex');
  const params = new URLSearchParams(fields);
  params.append('hash', hash);
  return params.toString();
}

describe('verifyTelegramInitData', () => {
  const BOT = '1234567:test-bot-token';
  const now = Math.floor(Date.now() / 1000);
  const userJson = JSON.stringify({ id: 99, first_name: 'Ada', last_name: 'Lovelace', username: 'alove' });

  it('accepts a valid signature and returns the parsed user', () => {
    const initData = signInitData({ auth_date: String(now), user: userJson, query_id: 'q1' }, BOT);
    const user = verifyTelegramInitData(initData, BOT);
    expect(user).not.toBeNull();
    expect(user?.id).toBe(99);
    expect(user?.first_name).toBe('Ada');
    expect(user?.username).toBe('alove');
  });

  it('rejects when the hash is tampered with', () => {
    const initData = signInitData({ auth_date: String(now), user: userJson }, BOT);
    const tampered = initData.replace(/hash=[a-f0-9]+/, 'hash=' + 'a'.repeat(64));
    expect(verifyTelegramInitData(tampered, BOT)).toBeNull();
  });

  it('rejects when a data field is changed after signing', () => {
    const initData = signInitData({ auth_date: String(now), user: userJson }, BOT);
    // Swap in a different user payload while keeping the original hash.
    const otherUser = JSON.stringify({ id: 100, first_name: 'Bob' });
    const tampered = initData.replace(/user=[^&]+/, 'user=' + encodeURIComponent(otherUser));
    expect(verifyTelegramInitData(tampered, BOT)).toBeNull();
  });

  it('rejects when auth_date is older than 24h', () => {
    const stale = now - 25 * 60 * 60;
    const initData = signInitData({ auth_date: String(stale), user: userJson }, BOT);
    expect(verifyTelegramInitData(initData, BOT)).toBeNull();
  });

  it('rejects when the bot token does not match', () => {
    const initData = signInitData({ auth_date: String(now), user: userJson }, BOT);
    expect(verifyTelegramInitData(initData, 'wrong-token')).toBeNull();
  });

  it('rejects empty initData', () => {
    expect(verifyTelegramInitData('', BOT)).toBeNull();
  });

  it('rejects missing hash field', () => {
    const params = new URLSearchParams({ auth_date: String(now), user: userJson });
    expect(verifyTelegramInitData(params.toString(), BOT)).toBeNull();
  });

  it('rejects when user JSON is malformed', () => {
    const initData = signInitData({ auth_date: String(now), user: 'not-json' }, BOT);
    expect(verifyTelegramInitData(initData, BOT)).toBeNull();
  });
});

describe('sign/verifyLinkState (OAuth round-trip state token)', () => {
  const SECRET = 'test-link-state-secret';

  it('roundtrips a fresh token', () => {
    const token = signLinkState('user-abc', SECRET, 600);
    const v = verifyLinkState(token, SECRET);
    expect(v?.uid).toBe('user-abc');
  });

  it('rejects when signed with a different secret', () => {
    const token = signLinkState('user-abc', SECRET);
    expect(verifyLinkState(token, 'other-secret')).toBeNull();
  });

  it('rejects when the payload is tampered after signing', () => {
    const token = signLinkState('user-abc', SECRET);
    const [b64, sig] = token.split('.');
    const decoded = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'));
    decoded.uid = 'attacker';
    const tamperedB64 = Buffer.from(JSON.stringify(decoded)).toString('base64url');
    expect(verifyLinkState(`${tamperedB64}.${sig}`, SECRET)).toBeNull();
  });

  it('rejects when expired', () => {
    const token = signLinkState('user-abc', SECRET, -10); // already past
    expect(verifyLinkState(token, SECRET)).toBeNull();
  });

  it('rejects malformed token', () => {
    expect(verifyLinkState('not-even-a-token', SECRET)).toBeNull();
    expect(verifyLinkState('', SECRET)).toBeNull();
    expect(verifyLinkState('only-one-part', SECRET)).toBeNull();
  });
});

describe('estimateCostUsd', () => {
  it('computes LLM cost from input + output tokens at the listed price', () => {
    // gemini-2.5-flash-lite is $0.10/1M input, $0.40/1M output
    const cost = estimateCostUsd('gemini', 'gemini-2.5-flash-lite', 1_000_000, 0);
    expect(cost).toBeCloseTo(0.10, 6);
    const cost2 = estimateCostUsd('gemini', 'gemini-2.5-flash-lite', 0, 1_000_000);
    expect(cost2).toBeCloseTo(0.40, 6);
    const combined = estimateCostUsd('gemini', 'gemini-2.5-flash-lite', 500_000, 500_000);
    expect(combined).toBeCloseTo(0.05 + 0.20, 6);
  });

  it('falls back to the wildcard row for TTS where the voice id is not in the table', () => {
    // google-tts:* applies to any voice id; charges per char input
    const cost = estimateCostUsd('google-tts', 'de-DE-Neural2-C', 1_000_000, 0);
    expect(cost).toBeCloseTo(PRICING_USD_PER_1M['google-tts:*'].input, 6);
  });

  it('returns 0 for unknown provider', () => {
    expect(estimateCostUsd('mystery', 'mystery-model', 1000, 1000)).toBe(0);
  });

  it('returns 0 when provider is null/undefined', () => {
    expect(estimateCostUsd(null, 'gemini-2.5-flash-lite', 1000, 1000)).toBe(0);
    expect(estimateCostUsd(undefined, null, null, null)).toBe(0);
  });

  it('treats null unit counts as 0 rather than throwing', () => {
    expect(estimateCostUsd('gemini', 'gemini-2.5-flash-lite', null, null)).toBe(0);
  });
});
