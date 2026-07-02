// Shared session/auth constants and helpers used by both apps' Google/Telegram/
// SSO login handlers. Session storage itself stays exactly as both legacy apps
// had it — an opaque `crypto.randomUUID()` row in the shared `sessions` table,
// returned to the client and sent back as the `X-Session-Id` header. No cookies,
// no JWT. On a single origin the browser's localStorage token is shared across
// both apps, so one login authenticates both.

/** Session lifetime in days. Both legacy apps defaulted to 30 via SESSION_TTL_DAYS. */
export const SESSION_TTL_DAYS = parseInt(process.env.SESSION_TTL_DAYS || '30', 10);

/** Milliseconds until a fresh session expires. */
export function sessionExpiryMs(ttlDays: number = SESSION_TTL_DAYS): number {
  return Date.now() + ttlDays * 24 * 60 * 60 * 1000;
}

/** The admin email is configured differently in the two legacy apps: courses
 *  used ADMIN_USER, tutor used ADMIN_EMAIL. Accept BOTH so neither app's
 *  existing environment breaks after the merge. */
export function adminEmail(): string | null {
  const v = process.env.ADMIN_USER || process.env.ADMIN_EMAIL || '';
  return v.trim() ? v.trim() : null;
}

/** Resolve the role for a signing-in user by email (admin iff it matches the
 *  configured admin email). Mirrors the identical logic both apps inlined. */
export function roleForEmail(email: string | null | undefined): 'admin' | 'user' {
  const admin = adminEmail();
  return admin && email && email === admin ? 'admin' : 'user';
}
