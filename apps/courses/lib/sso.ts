// Cross-app SSO token helper — THIN ADAPTER over the unified implementation in
// `@glottos/shared`. The real crypto/format lives there (one copy for both
// apps); this file only adapts the shared primitives to the exact API shape this
// app's routes already consume (`SsoIssuer`, the `VerifyResult` union), so no
// route logic had to change during the merge.
//
// Previously this file and text-tutor's `sso.ts` were hand-kept "in sync" but had
// silently drifted (header `typ:'JWT'` here vs `typ:'SSO'` there) so they never
// actually inter-verified. Delegating both to the shared core fixes that.

import {
  signSsoToken as coreSign,
  verifySsoToken as coreVerify,
  type SsoApp,
} from '@glottos/shared';

export type SsoIssuer = SsoApp;

export interface SsoPayload {
  iss: SsoIssuer;
  aud: SsoIssuer;
  sub: string;
  email: string;
  name: string | null;
  picture: string | null;
  iat: number;
  exp: number;
}

/** Sign a payload into an SSO token (delegates to the shared core). Returns null
 *  if `SSO_SHARED_SECRET` isn't configured — the caller surfaces that as a 503. */
export function signSsoToken(claims: Omit<SsoPayload, 'iat' | 'exp'>): string | null {
  return coreSign(claims);
}

export type VerifyResult =
  | { ok: true; payload: SsoPayload }
  | {
      ok: false;
      reason: 'no_secret' | 'malformed' | 'bad_signature' | 'expired' | 'wrong_aud';
    };

/**
 * Verify an incoming SSO token. `expectedAud` MUST be this consumer's own
 * identity (`'courses'`). Preserves the structured-reason contract the route
 * relies on: `no_secret` → 503, everything else → 401.
 */
export function verifySsoToken(token: string, expectedAud: SsoIssuer): VerifyResult {
  if (!process.env.SSO_SHARED_SECRET) return { ok: false, reason: 'no_secret' };

  const payload = coreVerify(token, expectedAud);
  if (!payload) {
    // Distinguish an audience mismatch (still a hard reject, but nice for logs)
    // from a generic bad/expired/malformed token by re-checking without aud.
    const anyAud = coreVerify(token);
    if (anyAud && anyAud.aud !== expectedAud) return { ok: false, reason: 'wrong_aud' };
    return { ok: false, reason: 'bad_signature' };
  }
  // This app requires a real email in the token (its upsert writes users.email).
  if (typeof payload.email !== 'string' || !payload.email) {
    return { ok: false, reason: 'malformed' };
  }
  return { ok: true, payload: payload as SsoPayload };
}
