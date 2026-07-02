// Shared env helpers. Kept deliberately tiny — both legacy apps read process.env
// directly and inline; this just centralises the couple of cross-cutting reads
// and provides typed accessors so the shared layer has one place to look.

/** Google OAuth client id — the SAME value in both apps (that is why the Google
 *  `sub` is a portable identity key across the merged user table). */
export function googleClientId(): string | undefined {
  return process.env.GOOGLE_CLIENT_ID;
}

/** Whether the cross-app SSO handoff is configured. */
export function ssoConfigured(): boolean {
  return !!process.env.SSO_SHARED_SECRET;
}

/** Read a required env var or throw with a clear message. */
export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}
