'use client';

import posthog from 'posthog-js';

// Thin wrapper around posthog.capture so callers don't have to deal with the
// "PostHog not configured" no-op case or the SSR-no-window guard. Module is
// 'use client' but the runtime check on window keeps it safe to import from
// modules that may also be evaluated server-side.

export function capture(event: string, properties?: Record<string, unknown>): void {
  if (typeof window === 'undefined') return;
  if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) return;
  posthog.capture(event, properties);
}
