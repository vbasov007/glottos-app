// Admin-editable TTS configuration. Persisted in the `settings` table under
// key='tts'. Read-through cache (60s) on the read path so the per-target
// resolution in /api/tts doesn't hit the DB on every speak click.

import { getPool } from './db';
import {
  TTS_DEFAULT,
  TTS_PROVIDERS,
  isKnownVoice,
  type TtsProviderId,
} from './tts-providers';
import type { TargetLang } from './content-types';

export type TtsOverrides = Partial<Record<TargetLang, { provider: TtsProviderId; voice: string }>>;

const CACHE_TTL_MS = 60_000;
let cache: { value: TtsOverrides; expiresAt: number } | null = null;

/** Force the next read to bypass the cache. Called from the admin save path
 *  so a change takes effect immediately. */
export function invalidateTtsCache(): void {
  cache = null;
}

export async function readTtsOverrides(): Promise<TtsOverrides> {
  if (cache && cache.expiresAt > Date.now()) return cache.value;
  try {
    const pool = getPool();
    const { rows } = await pool.query<{ value: TtsOverrides }>(
      "SELECT value FROM courses_settings WHERE key = 'tts'",
    );
    const value = rows[0]?.value ?? {};
    const cleaned = sanitize(value);
    cache = { value: cleaned, expiresAt: Date.now() + CACHE_TTL_MS };
    return cleaned;
  } catch {
    // DB unreachable / table missing → fall back to no overrides. Defaults
    // from tts-providers.ts will be used.
    return {};
  }
}

export async function writeTtsOverrides(value: TtsOverrides): Promise<void> {
  const cleaned = sanitize(value);
  const pool = getPool();
  await pool.query(
    `INSERT INTO courses_settings (key, value, updated_at)
       VALUES ('tts', $1, NOW())
     ON CONFLICT (key)
       DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [cleaned],
  );
  invalidateTtsCache();
}

/** Drop entries whose (provider, target, voice) tuple is unknown so a stale
 *  config can't break the resolver downstream. */
function sanitize(raw: unknown): TtsOverrides {
  if (!raw || typeof raw !== 'object') return {};
  const out: TtsOverrides = {};
  for (const [target, entry] of Object.entries(raw)) {
    if (!isTargetLang(target)) continue;
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as { provider?: unknown; voice?: unknown };
    if (typeof e.provider !== 'string' || typeof e.voice !== 'string') continue;
    if (!(e.provider in TTS_PROVIDERS)) continue;
    const provider = e.provider as TtsProviderId;
    if (!isKnownVoice(provider, target, e.voice)) continue;
    out[target] = { provider, voice: e.voice };
  }
  return out;
}

function isTargetLang(s: string): s is TargetLang {
  return s in TTS_DEFAULT;
}
