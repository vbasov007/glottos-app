import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { getGoogleClient, SESSION_TTL_DAYS } from '../../../../../lib/auth';
import { getPool } from '../../../../../lib/db';
import { checkRateLimit, clientKey } from '../../../../../lib/rate-limit';

export const runtime = 'nodejs';

/**
 * Redirect-mode handler. Google posts `application/x-www-form-urlencoded`
 * directly to this URL (configured as Authorized redirect URI in Cloud
 * Console). We verify the credential, create a session, then return a
 * one-shot HTML page that writes `session_id` to localStorage and
 * navigates the browser to the app.
 */
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

export async function POST(req: Request): Promise<Response> {
  const rl = checkRateLimit(`auth:${clientKey(req)}`, 20);
  if (!rl.allowed) {
    return new Response('Rate limited', { status: 429 });
  }

  const ip = clientKey(req);
  const ua = req.headers.get('user-agent');
  const referer = req.headers.get('referer');
  console.log('[auth/google/redirect] request', { ip, ua, referer });

  let credential: string | null = null;
  let formKeys: string[] = [];
  try {
    const form = await req.formData();
    formKeys = Array.from(form.keys());
    const c = form.get('credential');
    if (typeof c === 'string') credential = c;
  } catch (err) {
    console.warn('[auth/google/redirect] formData parse failed', { ip, err: String(err) });
  }
  if (!credential) {
    console.warn('[auth/google/redirect] missing credential in form', { ip, formKeys });
    return htmlError('Missing credential.');
  }

  // Peek the JWT for diagnostics — same pattern as the popup handler.
  const peek = peekJwt(credential);
  console.log('[auth/google/redirect] credential peek', {
    ip,
    credentialLength: credential.length,
    iss: peek?.iss,
    aud: peek?.aud,
    azp: peek?.azp,
    email: peek?.email,
    expectedAud: process.env.GOOGLE_CLIENT_ID,
  });

  try {
    const ticket = await getGoogleClient().verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID!,
    });
    const payload = ticket.getPayload();
    if (!payload || !payload.sub || !payload.email) {
      console.warn('[auth/google/redirect] empty payload after verify', { ip, payload });
      return htmlError('Invalid token.');
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

    // Hand off via localStorage write + redirect. JSON.stringify safely escapes the UUID.
    // Land back on the courses home under its base path (/courses in the merged
    // deployment), not the shared origin root (which belongs to the tutor app).
    const basePath =
      process.env.NEXT_PUBLIC_BASE_PATH === '' ? '' : process.env.NEXT_PUBLIC_BASE_PATH || '/courses';
    const home = `${basePath}/`;
    const safe = JSON.stringify(sessionId);
    const html = `<!DOCTYPE html><html><head><title>Signing in…</title></head><body>
<script>
  try { localStorage.setItem('session_id', ${safe}); } catch (e) {}
  window.location.href = ${JSON.stringify(home)};
</script>
<noscript>Sign-in complete. <a href="${home}">Continue</a></noscript>
</body></html>`;
    return new Response(html, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  } catch (err) {
    const e = err as Error & { code?: string; address?: string; port?: string };
    console.error('[auth/google/redirect] failed', {
      name: e.name,
      message: e.message,
      code: e.code,
      address: e.address,
      port: e.port,
      stack: e.stack?.split('\n').slice(0, 4).join('\n'),
    });
    return htmlError('Authentication failed.');
  }
}

function htmlError(msg: string): Response {
  return new Response(
    `<!DOCTYPE html><html><body><p>${msg} <a href="/">Try again</a></p></body></html>`,
    { status: 401, headers: { 'content-type': 'text/html; charset=utf-8' } },
  );
}
