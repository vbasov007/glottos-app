import { describe, it, expect } from 'vitest';
import { resolveIdentities, identityKeys, type LegacyUserLike } from '../src/dedup.js';

// courses: id = google sub (or "tg-<id>"); no google_sub column, email NOT NULL.
const cUser = (o: Partial<LegacyUserLike> & { id: string }): LegacyUserLike => ({
  email: null, name: null, picture: null, role: 'user', ...o,
});
// tutor: id may be a UUID; google_sub / telegram_id columns present; email nullable.
const tUser = (o: Partial<LegacyUserLike> & { id: string }): LegacyUserLike => ({
  email: null, name: null, picture: null, role: 'user', google_sub: null, telegram_id: null, ...o,
});

describe('identityKeys', () => {
  it('treats a courses id as the google sub', () => {
    expect(identityKeys(cUser({ id: 'sub-123', email: 'a@b.com' }), 'courses')).toEqual({
      gsub: 'sub-123', tgid: null, email: 'a@b.com',
    });
  });
  it('parses a courses tg-<id> user as telegram', () => {
    expect(identityKeys(cUser({ id: 'tg-999' }), 'courses')).toEqual({
      gsub: null, tgid: '999', email: null,
    });
  });
  it('reads tutor google_sub/telegram_id columns and ignores synthetic emails', () => {
    expect(
      identityKeys(tUser({ id: 'uuid-1', google_sub: 'sub-123', email: 'tg+5@telegram.local' }), 'tutor'),
    ).toEqual({ gsub: 'sub-123', tgid: null, email: null });
  });
});

describe('resolveIdentities — dedup by google sub / telegram / email', () => {
  it('merges a Google user present in BOTH apps into one account (same id = sub)', () => {
    const courses = [cUser({ id: 'sub-1', email: 'x@y.com', name: 'X' })];
    const tutor = [tUser({ id: 'sub-1', google_sub: 'sub-1', email: 'x@y.com', subscription_status: 'active' })];
    const r = resolveIdentities(courses, tutor);
    expect(r.unifieds).toHaveLength(1);
    expect(r.mergedCount).toBe(1);
    const u = r.unifieds[0];
    expect(u.id).toBe('sub-1');
    expect(u.row.google_sub).toBe('sub-1');
    // courses progress AND tutor subscription both land on the one account.
    expect(u.row.subscription_status).toBe('active');
    expect(r.coursesRemap.get('sub-1')).toBe('sub-1');
    expect(r.tutorRemap.get('sub-1')).toBe('sub-1');
  });

  it('merges when tutor id is a UUID but google_sub matches courses id', () => {
    const courses = [cUser({ id: 'sub-2', email: 'p@q.com' })];
    const tutor = [tUser({ id: 'uuid-abc', google_sub: 'sub-2', email: 'p@q.com' })];
    const r = resolveIdentities(courses, tutor);
    expect(r.unifieds).toHaveLength(1);
    expect(r.unifieds[0].id).toBe('sub-2'); // canonical = google sub
    // tutor's product rows (keyed by uuid-abc) remap onto sub-2.
    expect(r.tutorRemap.get('uuid-abc')).toBe('sub-2');
  });

  it('merges by email when neither side exposes a google sub match directly', () => {
    const courses = [cUser({ id: 'sub-3', email: 'Same@Example.com' })];
    // tutor telegram-rooted user who happens to share the verified email
    const tutor = [tUser({ id: 'uuid-x', telegram_id: 42, email: 'same@example.com' })];
    const r = resolveIdentities(courses, tutor);
    expect(r.unifieds).toHaveLength(1);
    expect(r.mergedCount).toBe(1);
    // gains the telegram id from the tutor side.
    expect(String(r.unifieds[0].row.telegram_id)).toBe('42');
  });

  it('merges a Telegram user across apps (courses tg-<id> ↔ tutor telegram_id)', () => {
    const courses = [cUser({ id: 'tg-777', email: 'tg+777@telegram.local' })];
    const tutor = [tUser({ id: 'uuid-t', telegram_id: 777 })];
    const r = resolveIdentities(courses, tutor);
    expect(r.unifieds).toHaveLength(1);
    expect(r.unifieds[0].id).toBe('tg-777');
    expect(r.tutorRemap.get('uuid-t')).toBe('tg-777');
  });

  it('keeps distinct users separate and preserves both remaps', () => {
    const courses = [cUser({ id: 'sub-a', email: 'a@a.com' })];
    const tutor = [tUser({ id: 'uuid-b', google_sub: 'sub-b', email: 'b@b.com' })];
    const r = resolveIdentities(courses, tutor);
    expect(r.unifieds).toHaveLength(2);
    expect(r.mergedCount).toBe(0);
  });

  it('unions admin role from either side', () => {
    const courses = [cUser({ id: 'sub-9', email: 'boss@co.com', role: 'admin' })];
    const tutor = [tUser({ id: 'sub-9', google_sub: 'sub-9', email: 'boss@co.com', role: 'user' })];
    const r = resolveIdentities(courses, tutor);
    expect(r.unifieds[0].row.role).toBe('admin');
  });

  it('does not merge two different emails / subs', () => {
    const r = resolveIdentities(
      [cUser({ id: 'sub-1', email: 'one@x.com' }), cUser({ id: 'sub-2', email: 'two@x.com' })],
      [],
    );
    expect(r.unifieds).toHaveLength(2);
  });
});
