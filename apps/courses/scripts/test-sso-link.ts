/**
 * Smoke-test the Tutor link: mint a demo session, load the landing page,
 * click <TutorLink>, capture the URL the same tab navigates to, verify
 * it carries `?sso=…` and that the token decodes to the expected payload.
 *
 * Run: DATABASE_URL=… SSO_SHARED_SECRET=… npx tsx scripts/test-sso-link.ts
 */

import crypto from 'node:crypto';
import { chromium } from 'playwright';
import { getPool } from '../lib/db';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const SESSION_TTL_DAYS = 30;

async function mintDemoSession(email: string): Promise<{ sessionId: string; userId: string }> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL not set');
  }
  const pool = getPool();
  const userId = 'demo-' + email.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  await pool.query(
    `INSERT INTO users (id, email, name, picture, role)
     VALUES ($1, $2, 'SSO Test', NULL, 'user')
     ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email`,
    [userId, email],
  );
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);
  await pool.query(
    'INSERT INTO sessions (session_id, user_id, expires_at) VALUES ($1, $2, $3)',
    [sessionId, userId, expiresAt],
  );
  return { sessionId, userId };
}

function b64urlDecode(s: string): string {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from((s + pad).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function verifyToken(token: string, secret: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('not a JWS');
  const [h, p, s] = parts as [string, string, string];
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${h}.${p}`)
    .digest('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  if (expected !== s) throw new Error('signature mismatch');
  return JSON.parse(b64urlDecode(p)) as Record<string, unknown>;
}

async function main(): Promise<void> {
  const secret = process.env.SSO_SHARED_SECRET;
  if (!secret) throw new Error('SSO_SHARED_SECRET not set');

  console.log('[sso-test] minting demo session…');
  const { sessionId, userId } = await mintDemoSession('sso-test@glottos.local');
  console.log(`[sso-test] userId=${userId} sessionId=${sessionId.slice(0, 8)}…`);

  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // Step 1: visit landing, seed the session id, reload so client picks it up.
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.evaluate((sid) => localStorage.setItem('session_id', sid), sessionId);
  await page.reload({ waitUntil: 'networkidle' });

  // Step 2: find the Tutor link and click it. openInTutor now navigates the
  // SAME tab to the tutor URL once /api/sso/mint resolves — no popup is
  // opened — so wait for the page to leave the courses origin.
  const tutor = page.getByRole('link', { name: /Open in t\.glottos\.com/i });
  await tutor.waitFor({ state: 'visible', timeout: 5000 });

  const baseOrigin = new URL(BASE_URL).origin;
  const navPromise = page.waitForURL((url) => {
    try {
      return new URL(url.toString()).origin !== baseOrigin;
    } catch {
      return false;
    }
  }, { timeout: 10_000 });
  await tutor.click();
  await navPromise;
  const finalUrl = page.url();
  console.log(`[sso-test] same-tab landed at: ${finalUrl}`);

  const url = new URL(finalUrl);
  const sso = url.searchParams.get('sso');
  const from = url.searchParams.get('from');
  const theme = url.searchParams.get('theme');

  let pass = true;
  if (!sso) {
    console.error('[sso-test] FAIL — no ?sso= parameter in landing URL');
    pass = false;
  } else {
    console.log(`[sso-test] sso token: ${sso.slice(0, 24)}…`);
    try {
      const payload = verifyToken(sso, secret);
      console.log('[sso-test] decoded payload:', payload);
      if (payload.iss !== 'courses') {
        console.error(`[sso-test] FAIL — iss=${String(payload.iss)} expected 'courses'`);
        pass = false;
      }
      if (payload.aud !== 'tutor') {
        console.error(`[sso-test] FAIL — aud=${String(payload.aud)} expected 'tutor'`);
        pass = false;
      }
      if (payload.sub !== userId) {
        console.error(`[sso-test] FAIL — sub=${String(payload.sub)} expected ${userId}`);
        pass = false;
      }
      const exp = Number(payload.exp);
      const ttl = exp - Math.floor(Date.now() / 1000);
      if (ttl < 30 || ttl > 600) {
        console.error(`[sso-test] FAIL — exp TTL ${ttl}s outside 30..600`);
        pass = false;
      }
    } catch (e) {
      console.error('[sso-test] FAIL — token verify error:', (e as Error).message);
      pass = false;
    }
  }
  console.log(`[sso-test] from=${from} theme=${theme}`);

  await browser.close();
  await getPool().end();

  if (!pass) {
    console.error('[sso-test] OVERALL: FAIL');
    process.exit(1);
  }
  console.log('[sso-test] OVERALL: PASS');
}

main().catch((e) => {
  console.error('[sso-test] crashed:', e);
  process.exit(1);
});
