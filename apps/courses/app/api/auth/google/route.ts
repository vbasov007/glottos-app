import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { getGoogleClient, SESSION_TTL_DAYS } from '../../../../lib/auth';
import { getPool } from '../../../../lib/db';
import { checkRateLimit, clientKey } from '../../../../lib/rate-limit';

export const runtime = 'nodejs';

interface SuccessBody {
  sessionId: string;
  user: { name: string | null; email: string; picture: string | null; role: string };
}

/** Decode a JWT payload without verifying — purely for diagnostics. */
function peekJwt(token: string): Record<string, unknown> | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const json = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  // Auth bucket: stricter than the default. Per guide: 20 / 15 min.
  const rl = checkRateLimit(`auth:${clientKey(req)}`, 20);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'rate_limited' },
      { status: 429, headers: { 'retry-after': String(rl.retryAfterSec ?? 60) } },
    );
  }

  const ip = clientKey(req);
  const ua = req.headers.get('user-agent');
  console.log('[auth/google] request', { ip, ua });

  let body: { credential?: unknown };
  try {
    body = (await req.json()) as { credential?: unknown };
  } catch {
    console.warn('[auth/google] invalid_json', { ip });
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (typeof body.credential !== 'string') {
    console.warn('[auth/google] missing_credential', { ip });
    return NextResponse.json({ error: 'missing_credential' }, { status: 400 });
  }

  // Peek the JWT so we can see audience/issuer/email when verification fails.
  // Logged to the runtime log only — not returned in the API response.
  const peek = peekJwt(body.credential);
  console.log('[auth/google] credential peek', {
    ip,
    credentialLength: body.credential.length,
    iss: peek?.iss,
    aud: peek?.aud,
    azp: peek?.azp,
    email: peek?.email,
    expectedAud: process.env.GOOGLE_CLIENT_ID,
  });

  try {
    const ticket = await getGoogleClient().verifyIdToken({
      idToken: body.credential,
      audience: process.env.GOOGLE_CLIENT_ID!,
    });
    const payload = ticket.getPayload();
    if (!payload || !payload.sub || !payload.email) {
      console.warn('[auth/google] empty payload after verify', { ip, payload });
      return NextResponse.json({ error: 'invalid_token' }, { status: 401 });
    }
    const { sub: id, email, name = null, picture = null } = payload;
    const adminUser = process.env.ADMIN_USER;
    const role = adminUser && email === adminUser ? 'admin' : 'user';

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
    // Distinguish where we actually failed. Google verify errors have known
    // shapes; pg DB errors carry .code/.address/.port; everything else surfaces
    // as a generic 500 so the client doesn't get a misleading "invalid_credential"
    // when the truth is "DB unreachable".
    const e = err as Error & { code?: string; address?: string; port?: string };
    console.error('[auth/google] failed', {
      name: e.name,
      message: e.message,
      code: e.code,
      address: e.address,
      port: e.port,
      stack: e.stack?.split('\n').slice(0, 4).join('\n'),
    });
    // ENOTFOUND / ECONNREFUSED / etc. → DB or network, not the credential
    if (e.code === 'ENOTFOUND' || e.code === 'ECONNREFUSED' || e.code === 'ETIMEDOUT') {
      return NextResponse.json(
        { error: 'db_unreachable', detail: `${e.code} ${e.address ?? ''}`.trim() },
        { status: 500 },
      );
    }
    return NextResponse.json({ error: 'invalid_credential' }, { status: 401 });
  }
}
