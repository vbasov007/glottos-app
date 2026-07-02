// @glottos/shared — the shared identity/DB/SSO layer imported by both apps.
export { getPool, closePool } from './db.js';
export {
  signSsoToken,
  verifySsoToken,
  type SsoPayload,
  type SsoApp,
} from './sso.js';
export {
  SESSION_TTL_DAYS,
  sessionExpiryMs,
  adminEmail,
  roleForEmail,
} from './session.js';
export { googleClientId, ssoConfigured, requireEnv } from './env.js';
export { log } from './log.js';
