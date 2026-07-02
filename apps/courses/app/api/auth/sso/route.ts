import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { SESSION_TTL_DAYS } from '../../../../lib/auth';
import { getPool } from '../../../../lib/db';
import { checkRateLimit, clientKey } from '../../../../lib/rate-limit';
import { verifySsoToken } from '../../../../lib/sso';

export const runtime = 'nodejs';

interface SuccessBody {
  sessionId: string;
  user: { name: string | null; email: string; picture: string | null; role: string };
}

/**
 * Consumer side of the cross-app SSO handoff. The client (text-tutor, or our
 * own /sso landing page) POSTs the token minted by the OTHER app's /api/sso/mint;
 * we verify and upsert the user into our own database, then issue a fresh
 * session in the same shape as /api/auth/google so the client's
 * apiFetch + X-Session-Id flow is reused verbatim downstream.
 *
 * The upsert by id = payload.sub (Google sub) means a user who has signed
 * into BOTH apps separately ends up unified — the second login finds the
 * same row, refreshes email/name/picture from the token, and issues a
 * session. No new users.<provider> column is needed because Google is the
 * one identity that's portable across our apps; Telegram-only and demo
 * accounts can't initiate an SSO handoff.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const rl = checkRateLimit(`auth:${clientKey(req)}`, 20);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'rate_limited' },
      { status: 429, headers: { 'retry-after': String(rl.retryAfterSec ?? 60) } },
    );
  }

  let body: { token?: unknown };
  try {
    body = (await req.json()) as { token?: unknown };
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (typeof body.token !== 'string' || body.token.length === 0) {
    return NextResponse.json({ error: 'missing_token' }, { status: 400 });
  }

  const verified = verifySsoToken(body.token, 'courses');
  if (!verified.ok) {
    console.warn('[auth/sso] verify failed', { reason: verified.reason });
    if (verified.reason === 'no_secret') {
      return NextResponse.json({ error: 'sso_not_configured' }, { status: 503 });
    }
    // Everything else surfaces as 401 — bad signature, wrong audience,
    // expired window, and malformed payloads are all "we don't trust this
    // token, please re-initiate."
    return NextResponse.json({ error: 'invalid_token' }, { status: 401 });
  }

  const { sub: id, email, name, picture } = verified.payload;
  // Same admin-by-email logic as /api/auth/google so a user who's an admin on
  // one app stays an admin when they're handed off into the other.
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
      user: { name: name ?? null, email, picture: picture ?? null, role },
    };
    return NextResponse.json(out);
  } catch (err) {
    const e = err as Error & { code?: string; address?: string; port?: string };
    console.error('[auth/sso] db failed', {
      name: e.name,
      message: e.message,
      code: e.code,
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
