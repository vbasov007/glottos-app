import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { SESSION_TTL_DAYS } from '../../../../lib/auth';
import { getPool } from '../../../../lib/db';
import { checkRateLimit, clientKey } from '../../../../lib/rate-limit';
import { verifyInitData } from '../../../../lib/telegram';

export const runtime = 'nodejs';

interface SuccessBody {
  sessionId: string;
  user: { name: string | null; email: string; picture: string | null; role: string };
}

/**
 * Telegram Mini App sign-in. The client posts the raw `initData` string
 * provided by `window.Telegram.WebApp.initData` and we:
 *
 *   1. Verify the HMAC signature with TELEGRAM_BOT_TOKEN.
 *   2. Upsert a row in `users` keyed by id="tg-<telegram_id>" (namespaced
 *      away from Google's numeric subs).
 *   3. Create a fresh session row identical in shape to the Google path,
 *      so the existing X-Session-Id flow downstream is unchanged.
 *
 * Response shape MATCHES /api/auth/google exactly so the client's
 * setStoredSessionId + setUser flow is reused verbatim.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const rl = checkRateLimit(`auth:${clientKey(req)}`, 20);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'rate_limited' },
      { status: 429, headers: { 'retry-after': String(rl.retryAfterSec ?? 60) } },
    );
  }

  const ip = clientKey(req);
  const ua = req.headers.get('user-agent');
  console.log('[auth/telegram] request', { ip, ua });

  let body: { initData?: unknown };
  try {
    body = (await req.json()) as { initData?: unknown };
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (typeof body.initData !== 'string' || body.initData.length === 0) {
    return NextResponse.json({ error: 'missing_init_data' }, { status: 400 });
  }

  const verified = verifyInitData(body.initData);
  if (!verified.ok) {
    console.warn('[auth/telegram] verify failed', { ip, reason: verified.reason });
    // Map the structured reason to the documented error codes the client
    // distinguishes. Everything except "no_token" surfaces as 401.
    if (verified.reason === 'no_token') {
      return NextResponse.json({ error: 'tg_not_configured' }, { status: 503 });
    }
    if (verified.reason === 'stale') {
      return NextResponse.json({ error: 'stale_init_data' }, { status: 401 });
    }
    return NextResponse.json({ error: 'invalid_init_data' }, { status: 401 });
  }

  const tg = verified.user;
  // Namespaced user id. Google's sub is a long numeric string; the "tg-"
  // prefix guarantees we never collide on a value that happens to look like
  // a Telegram id.
  const id = `tg-${tg.id}`;
  // Synthetic email — keeps users.email NOT NULL satisfied without a
  // schema migration. Domain ".telegram.local" is reserved so it can never
  // resolve to a real mailbox.
  const email = `tg+${tg.id}@telegram.local`;
  const fullName = [tg.first_name, tg.last_name].filter(Boolean).join(' ').trim();
  const name = fullName || tg.username || null;
  const picture = tg.photo_url ?? null;
  // ADMIN_USER is configured as a real Google email; a Telegram synthetic
  // address won't match. Keep the check for symmetry with the Google route,
  // but in practice admin role doesn't propagate via Telegram in v1.
  const adminUser = process.env.ADMIN_USER;
  const role = adminUser && email === adminUser ? 'admin' : 'user';

  try {
    const pool = getPool();
    await pool.query(
      `INSERT INTO users (id, email, name, picture, role)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE
         SET email = EXCLUDED.email,
             name = EXCLUDED.name,
             picture = EXCLUDED.picture,
             role = EXCLUDED.role`,
      [id, email, name, picture, role],
    );

    const sessionId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);
    await pool.query(
      'INSERT INTO sessions (session_id, user_id, expires_at) VALUES ($1, $2, $3)',
      [sessionId, id, expiresAt],
    );

    const out: SuccessBody = {
      sessionId,
      user: { name, email, picture, role },
    };
    return NextResponse.json(out);
  } catch (err) {
    const e = err as Error & { code?: string; address?: string; port?: string };
    console.error('[auth/telegram] db failed', {
      name: e.name,
      message: e.message,
      code: e.code,
      address: e.address,
      port: e.port,
    });
    if (e.code === 'ENOTFOUND' || e.code === 'ECONNREFUSED' || e.code === 'ETIMEDOUT') {
      return NextResponse.json(
        { error: 'db_unreachable', detail: `${e.code} ${e.address ?? ''}`.trim() },
        { status: 500 },
      );
    }
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
