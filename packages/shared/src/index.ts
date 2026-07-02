// @glottos/shared — the shared identity/DB/SSO layer imported by both apps.
// Extensionless relative imports (moduleResolution: Bundler) so this TypeScript
// source resolves under Next.js/webpack, Vite/Vitest, and tsx alike.
export { getPool, closePool } from './db';
export {
  signSsoToken,
  verifySsoToken,
  type SsoPayload,
  type SsoApp,
} from './sso';
export {
  SESSION_TTL_DAYS,
  sessionExpiryMs,
  adminEmail,
  roleForEmail,
} from './session';
export { googleClientId, ssoConfigured, requireEnv } from './env';
export { log } from './log';
export {
  resolveIdentities,
  identityKeys,
  type Src,
  type LegacyUserLike,
  type UnifiedUser,
  type ResolveResult,
} from './dedup';
