// Unified cross-app SSO token helper — one implementation for BOTH apps.
//
// The two legacy repos each shipped their own copy of this helper and they had
// DRIFTED: text-tutor used header `typ:'SSO'` and `verifySsoToken(token)` (the
// caller checked `aud`), while glottos-courses used `typ:'JWT'` and
// `verifySsoToken(token, expectedAud)`. Because the signed material includes the
// header, those two never actually inter-verified — a latent bug. This shared
// module collapses them into ONE helper (fixing the drift) and supports BOTH
// call conventions so neither app's call sites need rewriting:
//   verifySsoToken(token)                -> returns payload, caller checks aud
//   verifySsoToken(token, 'courses')     -> also enforces aud === 'courses'
//
// Token: base64url(headerJson).base64url(payloadJson).base64url(sig)
//   header  = { alg: 'HS256', typ: 'SSO' }
//   sig     = HMAC-SHA256(`${headerB64}.${payloadB64}`, SSO_SHARED_SECRET)
// TTL is 120s (short-lived one-shot handoff, ~OAuth-code risk). `aud` binds the
// token to its consumer so a courses token can't be replayed at courses.
//
// NOTE: with the merged single-origin deployment, both apps share one session
// store and one localStorage origin, so this handoff is no longer REQUIRED for
// login. It is retained intact for external deep-links and the `/s/:code` share
// flow (and remains the mechanism if the apps are ever split onto subdomains).

import { createHmac, timingSafeEqual } from 'crypto';

export type SsoApp = 'courses' | 'tutor';

export interface SsoPayload {
  iss: SsoApp;
  aud: SsoApp;
  sub: string; // google_sub — the identity key
  email?: string | null;
  name?: string | null;
  picture?: string | null;
  iat: number;
  exp: number;
}

const TOKEN_TTL_SECONDS = 120;
const CLOCK_SKEW_SECONDS = 60;

function b64urlEncode(buf: Buffer | string): string {
  const b = typeof buf === 'string' ? Buffer.from(buf, 'utf8') : buf;
  return b.toString('base64url');
}

function b64urlDecode(s: string): Buffer {
  return Buffer.from(s, 'base64url');
}

function getSecret(): Buffer | null {
  const secret = process.env.SSO_SHARED_SECRET;
  if (!secret) return null;
  return Buffer.from(secret, 'utf8');
}

/** Sign an SSO token. Caller supplies iss/aud/sub + optional profile fields;
 *  this fills in iat/exp. Returns null if SSO_SHARED_SECRET is unset. */
export function signSsoToken(claims: Omit<SsoPayload, 'iat' | 'exp'>): string | null {
  const secret = getSecret();
  if (!secret) return null;
  const now = Math.floor(Date.now() / 1000);
  const payload: SsoPayload = { ...claims, iat: now, exp: now + TOKEN_TTL_SECONDS };
  const headerB64 = b64urlEncode(JSON.stringify({ alg: 'HS256', typ: 'SSO' }));
  const payloadB64 = b64urlEncode(JSON.stringify(payload));
  const sig = createHmac('sha256', secret).update(`${headerB64}.${payloadB64}`).digest();
  return `${headerB64}.${payloadB64}.${b64urlEncode(sig)}`;
}

/** Verify a token and return the payload, or null on any failure: bad shape,
 *  bad signature, expired, secret unset, or (when `expectedAud` is passed)
 *  audience mismatch. */
export function verifySsoToken(token: string, expectedAud?: SsoApp): SsoPayload | null {
  if (!token || typeof token !== 'string') return null;
  const secret = getSecret();
  if (!secret) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;
  try {
    const expected = createHmac('sha256', secret).update(`${headerB64}.${payloadB64}`).digest();
    const got = b64urlDecode(sigB64);
    if (got.length !== expected.length) return null;
    if (!timingSafeEqual(got, expected)) return null;
    const payload = JSON.parse(b64urlDecode(payloadB64).toString('utf8')) as SsoPayload;
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload?.exp !== 'number' || payload.exp < now - CLOCK_SKEW_SECONDS) return null;
    if (typeof payload?.iat === 'number' && payload.iat > now + CLOCK_SKEW_SECONDS) return null;
    if (typeof payload?.sub !== 'string' || !payload.sub) return null;
    if (payload.iss !== 'courses' && payload.iss !== 'tutor') return null;
    if (payload.aud !== 'courses' && payload.aud !== 'tutor') return null;
    if (expectedAud && payload.aud !== expectedAud) return null;
    return payload;
  } catch {
    return null;
  }
}
