// Server-side Telegram Mini App helpers. Mirrors the singleton-init pattern
// used by getGoogleClient / getAnthropic / getPool — read env lazily so the
// module can be imported in routes that don't actually need Telegram.

import crypto from 'node:crypto';
import type { CourseSlug, NativeLang } from './content-types';
import { COURSES } from './content-types';

export interface TgUser {
  /** Telegram numeric user id. We prefix this with "tg-" when storing in
   *  users.id to namespace away from Google's numeric sub. */
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  language_code?: string;
  is_premium?: boolean;
}

export type VerifyResult =
  | { ok: true; user: TgUser; authDate: Date; startParam: string | null }
  | { ok: false; reason: 'no_token' | 'no_hash' | 'bad_hash' | 'stale' | 'malformed_user' };

const DEFAULT_MAX_AGE_SEC = 24 * 60 * 60; // 24 h

let _botToken: string | null = null;
function getBotToken(): string | null {
  if (_botToken) return _botToken;
  const v = process.env.TELEGRAM_BOT_TOKEN;
  if (!v) return null;
  _botToken = v;
  return v;
}

/**
 * Verify a Telegram WebApp initData payload per the documented algorithm:
 *
 *   secret_key = HMAC_SHA256("WebAppData", BOT_TOKEN)
 *   data_check_string = sorted("k=v") of every key EXCEPT "hash", joined with "\n"
 *   expected = HMAC_SHA256(secret_key, data_check_string)
 *
 * Compared in constant time. Also enforces auth_date freshness so a leaked
 * payload can't be replayed forever.
 *
 * Docs: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function verifyInitData(
  initData: string,
  opts: { maxAgeSec?: number } = {},
): VerifyResult {
  const token = getBotToken();
  if (!token) return { ok: false, reason: 'no_token' };

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return { ok: false, reason: 'no_hash' };

  // Build data_check_string: every k=v line except hash, sorted.
  const lines: string[] = [];
  for (const [k, v] of params.entries()) {
    if (k === 'hash') continue;
    lines.push(`${k}=${v}`);
  }
  lines.sort();
  const dataCheckString = lines.join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  const expected = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  // Constant-time compare. Lengths must match for timingSafeEqual.
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: 'bad_hash' };
  }

  // Freshness check.
  const authDateStr = params.get('auth_date');
  const authDateSec = authDateStr ? parseInt(authDateStr, 10) : NaN;
  if (!Number.isFinite(authDateSec)) {
    return { ok: false, reason: 'stale' };
  }
  const maxAge = opts.maxAgeSec ?? DEFAULT_MAX_AGE_SEC;
  const ageSec = Math.floor(Date.now() / 1000) - authDateSec;
  if (ageSec < -60 || ageSec > maxAge) {
    // <-60 catches grossly wrong client clocks; the small slack absorbs normal skew.
    return { ok: false, reason: 'stale' };
  }

  // Parse user JSON (it's URL-encoded into the user= field).
  const userJson = params.get('user');
  if (!userJson) return { ok: false, reason: 'malformed_user' };
  let user: TgUser;
  try {
    const parsed = JSON.parse(userJson) as unknown;
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof (parsed as { id?: unknown }).id !== 'number'
    ) {
      return { ok: false, reason: 'malformed_user' };
    }
    user = parsed as TgUser;
  } catch {
    return { ok: false, reason: 'malformed_user' };
  }

  return {
    ok: true,
    user,
    authDate: new Date(authDateSec * 1000),
    startParam: params.get('start_param'),
  };
}

/**
 * Map Telegram's user.language_code to one of our four supported native
 * languages. Telegram returns 2-letter ISO 639-1 codes, sometimes with a
 * regional suffix ("pt-BR"); we take the 2-letter prefix.
 *
 * Default is English so a Spanish or French Telegram user lands on the
 * English UI rather than a broken locale.
 */
export function mapLanguageToNative(code: string | null | undefined): NativeLang {
  if (!code) return 'en';
  const prefix = code.slice(0, 2).toLowerCase();
  if (prefix === 'ru' || prefix === 'uk' || prefix === 'be') return 'ru';
  if (prefix === 'pl') return 'pl';
  if (prefix === 'de' || prefix === 'at' || prefix === 'ch') return 'de';
  if (prefix === 'en') return 'en';
  return 'en';
}

/**
 * Parse the `start_param` field from initDataUnsafe into a deep-link
 * destination. Currently supports:
 *
 *   lesson_<course>_<n>     e.g. "lesson_classic50_3"
 *
 * Returns null for anything we don't recognise — the caller falls back to
 * the default landing.
 */
export function parseStartParam(
  s: string | null | undefined,
): { course: CourseSlug; lessonN: number } | null {
  if (!s) return null;
  const m = s.match(/^lesson_([a-z0-9_-]{3,32})_(\d{1,2})$/i);
  if (!m) return null;
  const course = m[1]!.toLowerCase() as CourseSlug;
  const n = parseInt(m[2]!, 10);
  if (!COURSES.some((c) => c.slug === course)) return null;
  if (!Number.isFinite(n) || n < 1 || n > 50) return null;
  return { course, lessonN: n };
}
