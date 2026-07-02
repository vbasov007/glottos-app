/** Backend magic numbers extracted from server.ts — behaviour-preserving refactor. */

// Session TTL comes from the shared layer so both apps agree (reads
// SESSION_TTL_DAYS env, default 30). Re-exported here to keep server.ts's
// existing `import { SESSION_TTL_DAYS } from './server-constants'` working.
export { SESSION_TTL_DAYS } from '@glottos/shared';

export const TIMEOUTS = {
  /** Azure / Yandex TTS request timeout */
  TTS: 30_000,
  /** DeepSeek API request timeout */
  DEEPSEEK: 60_000,
  /** Forced shutdown if connections don't drain */
  GRACEFUL_SHUTDOWN: 10_000,
};

/** PostgreSQL connection pool settings */
export const POOL = {
  MAX_CONNECTIONS: 20,
  IDLE_TIMEOUT_MS: 30_000,
  CONNECTION_TIMEOUT_MS: 5_000,
};

/** Rate-limiter window (shared across all limiters) */
export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

export const RATE_LIMITS = {
  /** General API — ~1 req/sec sustained */
  API_MAX: 1000,
  /** TTS — expensive but users do lots of listening */
  TTS_MAX: 300,
  /** Auth attempts — keep strict to prevent brute force */
  AUTH_MAX: 20,
};

/** Interval for cleaning up anonymous users */
export const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
