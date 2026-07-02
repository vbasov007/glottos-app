import { OAuth2Client } from 'google-auth-library';
import { NextResponse } from 'next/server';
import { getPool } from './db';
import { SESSION_TTL_DAYS as SHARED_SESSION_TTL_DAYS } from '@glottos/shared';

let _googleClient: OAuth2Client | null = null;

export function getGoogleClient(): OAuth2Client {
  if (_googleClient) return _googleClient;
  const id = process.env.GOOGLE_CLIENT_ID;
  if (!id) throw new Error('GOOGLE_CLIENT_ID is not set');
  _googleClient = new OAuth2Client(id);
  return _googleClient;
}

// Re-exported from the shared layer so both apps agree on session lifetime.
export const SESSION_TTL_DAYS = SHARED_SESSION_TTL_DAYS;

/**
 * Resolve the current user from the `X-Session-Id` header. Returns either
 * the userId or a ready-made 401 NextResponse. Callers do:
 *
 *   const auth = await requireAuth(req);
 *   if (auth instanceof NextResponse) return auth;
 *   const { userId } = auth;
 */
export async function requireAuth(req: Request): Promise<{ userId: string } | NextResponse> {
  const sessionId = req.headers.get('x-session-id');
  if (!sessionId) {
    return NextResponse.json({ error: 'no_session' }, { status: 401 });
  }
  try {
    const pool = getPool();
    const { rows } = await pool.query<{ user_id: string }>(
      'SELECT user_id FROM sessions WHERE session_id = $1 AND expires_at > NOW()',
      [sessionId],
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: 'invalid_session' }, { status: 401 });
    }
    return { userId: rows[0]!.user_id };
  } catch (err) {
    return dbErrorResponse('requireAuth', err);
  }
}

/** Like requireAuth, but additionally requires the user's role be 'admin'.
 *  Use this on every /api/admin/* route. */
export async function requireAdmin(req: Request): Promise<{ userId: string } | NextResponse> {
  const sessionId = req.headers.get('x-session-id');
  if (!sessionId) {
    return NextResponse.json({ error: 'no_session' }, { status: 401 });
  }
  try {
    const pool = getPool();
    const { rows } = await pool.query<{ user_id: string; role: string }>(
      `SELECT u.id AS user_id, u.role
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.session_id = $1 AND s.expires_at > NOW()`,
      [sessionId],
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: 'invalid_session' }, { status: 401 });
    }
    if (rows[0]!.role !== 'admin') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    return { userId: rows[0]!.user_id };
  } catch (err) {
    return dbErrorResponse('requireAdmin', err);
  }
}

function dbErrorResponse(scope: string, err: unknown): NextResponse {
  // Surface the actual cause in the runtime log rather than letting the
  // route's generic 500 swallow it. Most common: DATABASE_URL misconfigured
  // (ENOTFOUND), schema not applied, or trusted-source firewall blocking.
  const e = err as Error & { code?: string; address?: string; port?: string };
  console.error(`[${scope}] db query failed`, {
    name: e.name,
    message: e.message,
    code: e.code,
    address: e.address,
    port: e.port,
  });
  return NextResponse.json(
    { error: 'db_unreachable', detail: `${e.code ?? 'unknown'} ${e.address ?? ''}`.trim() },
    { status: 500 },
  );
}
