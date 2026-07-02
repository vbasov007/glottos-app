import { NextResponse } from 'next/server';
import { requireAuth } from '../../../../lib/auth';
import { getPool } from '../../../../lib/db';
import { checkRateLimit, clientKey } from '../../../../lib/rate-limit';
import { signSsoToken, type SsoIssuer } from '../../../../lib/sso';

export const runtime = 'nodejs';

interface MintRequest {
  to?: SsoIssuer;
}

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  picture: string | null;
}

/**
 * Mints a short-lived SSO token describing the currently signed-in user.
 * Client uses this when handing off to text-tutor — the resulting token is
 * passed in the URL (`?sso=…`) to the other app, which verifies and
 * adopts the identity.
 *
 * Requires an authenticated `X-Session-Id` (same as every other
 * progress-touching route). Returns 401 if unauthenticated so the client
 * can fall back to the plain share link.
 */
export async function POST(req: Request): Promise<NextResponse> {
  // Stricter than the default bucket — minting is cheap server-side but a
  // misbehaving client could try to spam handoff URLs.
  const rl = checkRateLimit(`sso-mint:${clientKey(req)}`, 30);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'rate_limited' },
      { status: 429, headers: { 'retry-after': String(rl.retryAfterSec ?? 60) } },
    );
  }

  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  let body: MintRequest;
  try {
    body = (await req.json()) as MintRequest;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  // v1 only mints for the tutor; the guide leaves `aud` open so a future
  // back-handoff (tutor → courses) can reuse the same endpoint shape from
  // its own side.
  if (body.to !== 'tutor') {
    return NextResponse.json({ error: 'bad_audience' }, { status: 400 });
  }

  try {
    const pool = getPool();
    const { rows } = await pool.query<UserRow>(
      'SELECT id, email, name, picture FROM users WHERE id = $1',
      [auth.userId],
    );
    if (rows.length === 0) {
      // Session pointed at a row that no longer exists (e.g. cleanup ran).
      // Treat as unauthenticated so the client falls back gracefully.
      return NextResponse.json({ error: 'invalid_session' }, { status: 401 });
    }
    const user = rows[0]!;
    const token = signSsoToken({
      iss: 'courses',
      aud: 'tutor',
      sub: user.id,
      email: user.email,
      name: user.name,
      picture: user.picture,
    });
    if (!token) {
      // SSO_SHARED_SECRET isn't set — fail loud so the operator can spot
      // the misconfiguration during smoke tests.
      console.error('[api/sso/mint] SSO_SHARED_SECRET is not configured');
      return NextResponse.json({ error: 'sso_not_configured' }, { status: 503 });
    }
    return NextResponse.json({ token });
  } catch (err) {
    const e = err as Error & { code?: string };
    console.error('[api/sso/mint] failed', { name: e.name, message: e.message, code: e.code });
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
