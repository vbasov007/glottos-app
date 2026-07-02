// Pure identity-resolution for the legacy data migration. No DB access — takes
// the two legacy `users` row sets and produces the deduplicated unified users
// plus per-source id remaps. Extracted here so it can be unit-tested in
// isolation (see test/dedup.test.ts) and reused by migrations/migrate_legacy_data.ts.
//
// Dedup rule: two legacy accounts are the SAME person iff they share, in
// precedence order, (1) a Google sub, (2) a Telegram id, or (3) a real
// (non-synthetic) email. Matched accounts collapse to one unified row that
// unions both sides' profile fields.

export type Src = 'courses' | 'tutor';

export interface LegacyUserLike {
  id: string;
  email?: string | null;
  name?: string | null;
  picture?: string | null;
  role?: string | null;
  preferences?: unknown;
  created_at?: unknown;
  active_workspace_id?: string | null;
  google_sub?: string | null;
  telegram_id?: string | number | null;
  source_code?: string | null;
  stripe_customer_id?: string | null;
  subscription_status?: string | null;
  subscription_id?: string | null;
  subscription_period_end?: unknown;
  cancel_at_period_end?: boolean | null;
}

export interface UnifiedUser {
  id: string;
  row: Record<string, any>;
  fromCourses?: string;
  fromTutor?: string;
}

export interface ResolveResult {
  unifieds: UnifiedUser[];
  coursesRemap: Map<string, string>;
  tutorRemap: Map<string, string>;
  mergedCount: number; // accounts present in BOTH apps (deduplicated)
}

const norm = (e: string | null | undefined) =>
  e && !e.endsWith('@telegram.local') ? e.trim().toLowerCase() : null;

interface Keys {
  gsub: string | null;
  tgid: string | null;
  email: string | null;
}

/** Identity keys for a legacy user, per source semantics. */
export function identityKeys(u: LegacyUserLike, src: Src): Keys {
  let gsub: string | null = null;
  let tgid: string | null = null;
  if (src === 'tutor') {
    gsub = u.google_sub ?? null;
    tgid = u.telegram_id != null ? String(u.telegram_id) : null;
  } else {
    // courses: `id` IS the Google sub, unless it's a "tg-<id>" Telegram user.
    if (typeof u.id === 'string' && u.id.startsWith('tg-')) tgid = u.id.slice(3);
    else gsub = u.id;
  }
  return { gsub, tgid, email: norm(u.email) };
}

function canonicalId(k: Keys, fallback: string): string {
  if (k.gsub) return k.gsub;
  if (k.tgid) return `tg-${k.tgid}`;
  return fallback;
}

function coalesce(a: any, b: any, prefer: 'a' | 'b') {
  const has = (v: any) => v !== null && v !== undefined && v !== '';
  if (prefer === 'b') return has(b) ? b : has(a) ? a : (b ?? a ?? null);
  return has(a) ? a : has(b) ? b : (a ?? b ?? null);
}

function baseRow(u: LegacyUserLike, k: Keys, id: string): Record<string, any> {
  return {
    id,
    email: u.email ?? null,
    name: u.name ?? null,
    picture: u.picture ?? null,
    role: u.role ?? 'user',
    preferences: u.preferences ?? null,
    created_at: u.created_at ?? null,
    active_workspace_id: u.active_workspace_id ?? null,
    google_sub: k.gsub ?? null,
    telegram_id: k.tgid ?? null,
    source_code: u.source_code ?? null,
    stripe_customer_id: u.stripe_customer_id ?? null,
    subscription_status: u.subscription_status ?? 'free',
    subscription_id: u.subscription_id ?? null,
    subscription_period_end: u.subscription_period_end ?? null,
    cancel_at_period_end: u.cancel_at_period_end ?? false,
  };
}

/**
 * Resolve two legacy user sets into deduplicated unified users + remaps.
 * Courses users are ingested first so Google users take `id = sub` (the stable
 * canonical id both apps already use for Google accounts).
 */
export function resolveIdentities(
  courses: LegacyUserLike[],
  tutor: LegacyUserLike[],
): ResolveResult {
  const byGsub = new Map<string, UnifiedUser>();
  const byTg = new Map<string, UnifiedUser>();
  const byEmail = new Map<string, UnifiedUser>();
  const unifieds: UnifiedUser[] = [];
  const coursesRemap = new Map<string, string>();
  const tutorRemap = new Map<string, string>();

  const findExisting = (k: Keys) =>
    (k.gsub && byGsub.get(k.gsub)) ||
    (k.tgid && byTg.get(k.tgid)) ||
    (k.email && byEmail.get(k.email)) ||
    undefined;

  const index = (u: UnifiedUser, k: Keys) => {
    if (k.gsub) byGsub.set(k.gsub, u);
    if (k.tgid) byTg.set(k.tgid, u);
    if (k.email) byEmail.set(k.email, u);
  };

  const ingest = (u: LegacyUserLike, src: Src) => {
    const k = identityKeys(u, src);
    const existing = findExisting(k);
    if (existing) {
      const incoming = baseRow(u, k, existing.id);
      const prefer = src === 'tutor' ? 'b' : 'a';
      // Admin is sticky: if EITHER side is admin the merged account is admin.
      const isAdmin = existing.row.role === 'admin' || (u.role ?? '') === 'admin';
      for (const col of Object.keys(incoming)) {
        if (col === 'id') continue;
        existing.row[col] = coalesce(existing.row[col], incoming[col], prefer);
      }
      if (isAdmin) existing.row.role = 'admin';
      if (k.gsub) existing.row.google_sub = k.gsub;
      if (k.tgid) existing.row.telegram_id = k.tgid;
      if (src === 'courses') existing.fromCourses = u.id;
      else existing.fromTutor = u.id;
      index(existing, k);
      (src === 'courses' ? coursesRemap : tutorRemap).set(u.id, existing.id);
      return;
    }
    const id = canonicalId(k, u.id);
    const uni: UnifiedUser = { id, row: baseRow(u, k, id) };
    if (src === 'courses') uni.fromCourses = u.id;
    else uni.fromTutor = u.id;
    unifieds.push(uni);
    index(uni, k);
    (src === 'courses' ? coursesRemap : tutorRemap).set(u.id, id);
  };

  for (const u of courses) ingest(u, 'courses');
  for (const u of tutor) ingest(u, 'tutor');

  const mergedCount = unifieds.filter((u) => u.fromCourses && u.fromTutor).length;
  return { unifieds, coursesRemap, tutorRemap, mergedCount };
}
