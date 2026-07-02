// Cross-app SSO token helper — now a THIN RE-EXPORT of the unified implementation
// in `@glottos/shared`. The real crypto/format lives there (one copy shared by
// both apps). This app's server.ts imports `signSsoToken` / `verifySsoToken`
// from here exactly as before; the signatures are unchanged
// (`verifySsoToken(token)` still works — pass an expected audience as an optional
// second arg if you want it enforced).
//
// Previously this file and glottos-courses' `web/lib/sso.ts` were hand-kept "in
// sync" but had drifted (header `typ:'SSO'` here vs `typ:'JWT'` there) so they
// never actually inter-verified. Sharing one core fixes that.
export {
  signSsoToken,
  verifySsoToken,
  type SsoPayload,
  type SsoApp,
} from '@glottos/shared';
