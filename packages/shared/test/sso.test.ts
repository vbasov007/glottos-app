import { describe, it, expect, beforeEach } from 'vitest';
import { signSsoToken, verifySsoToken } from '../src/sso.js';

const SECRET = 'test-secret-at-least-32-bytes-long-xxxxxx';

describe('sso token helper (unified, shared by both apps)', () => {
  beforeEach(() => {
    process.env.SSO_SHARED_SECRET = SECRET;
  });

  it('signs and verifies a round-trip token', () => {
    const token = signSsoToken({ iss: 'courses', aud: 'tutor', sub: 'google-123', email: 'a@b.com' });
    expect(token).toBeTruthy();
    const payload = verifySsoToken(token!);
    expect(payload).not.toBeNull();
    expect(payload!.sub).toBe('google-123');
    expect(payload!.iss).toBe('courses');
    expect(payload!.aud).toBe('tutor');
    expect(payload!.email).toBe('a@b.com');
  });

  it('enforces audience when expectedAud is passed (courses convention)', () => {
    const token = signSsoToken({ iss: 'courses', aud: 'tutor', sub: 'x' })!;
    expect(verifySsoToken(token, 'tutor')).not.toBeNull();
    // A tutor-bound token must be rejected when courses expects its own aud.
    expect(verifySsoToken(token, 'courses')).toBeNull();
  });

  it('returns payload without aud check when expectedAud omitted (tutor convention)', () => {
    const token = signSsoToken({ iss: 'tutor', aud: 'courses', sub: 'y' })!;
    const payload = verifySsoToken(token);
    expect(payload!.aud).toBe('courses');
  });

  it('rejects a tampered signature', () => {
    const token = signSsoToken({ iss: 'courses', aud: 'tutor', sub: 'x' })!;
    const parts = token.split('.');
    parts[2] = Buffer.from('tampered-signature-bytes').toString('base64url');
    expect(verifySsoToken(parts.join('.'))).toBeNull();
  });

  it('rejects a token signed with a different secret', () => {
    const token = signSsoToken({ iss: 'courses', aud: 'tutor', sub: 'x' })!;
    process.env.SSO_SHARED_SECRET = 'a-completely-different-secret-value-yyyy';
    expect(verifySsoToken(token)).toBeNull();
  });

  it('rejects an expired token', () => {
    // Hand-build a token with exp in the past by signing then checking rejection.
    const token = signSsoToken({ iss: 'courses', aud: 'tutor', sub: 'x' })!;
    const [h, p] = token.split('.');
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
    payload.exp = Math.floor(Date.now() / 1000) - 10_000;
    payload.iat = payload.exp - 120;
    const { createHmac } = require('crypto');
    const newP = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = createHmac('sha256', SECRET).update(`${h}.${newP}`).digest().toString('base64url');
    expect(verifySsoToken(`${h}.${newP}.${sig}`)).toBeNull();
  });

  it('returns null when the secret is unset', () => {
    delete process.env.SSO_SHARED_SECRET;
    expect(signSsoToken({ iss: 'courses', aud: 'tutor', sub: 'x' })).toBeNull();
    expect(verifySsoToken('a.b.c')).toBeNull();
  });

  it('rejects malformed tokens', () => {
    expect(verifySsoToken('')).toBeNull();
    expect(verifySsoToken('only-one-part')).toBeNull();
    expect(verifySsoToken('two.parts')).toBeNull();
  });
});
