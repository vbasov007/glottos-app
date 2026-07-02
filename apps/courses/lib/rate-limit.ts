// Simple in-memory rate limiter for self-host parity. Swap for @upstash/ratelimit
// when deploying to Vercel with multi-region.

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 60; // tune per route

/** Returns true if request is allowed, false if rate-limited. */
export function checkRateLimit(key: string, limit = MAX_PER_WINDOW): {
  allowed: boolean;
  retryAfterSec?: number;
} {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true };
  }
  if (b.count >= limit) {
    return {
      allowed: false,
      retryAfterSec: Math.ceil((b.resetAt - now) / 1000),
    };
  }
  b.count += 1;
  return { allowed: true };
}

/** Extract an IP-like key from a Next.js request. */
export function clientKey(req: Request): string {
  const xff = req.headers.get('x-forwarded-for') ?? '';
  const cf = req.headers.get('cf-connecting-ip') ?? '';
  return cf || xff.split(',')[0]?.trim() || 'unknown';
}
