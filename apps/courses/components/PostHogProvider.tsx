'use client';

import { Suspense, useEffect, type ReactNode } from 'react';
import posthog from 'posthog-js';
import { PostHogProvider as PHProvider, usePostHog } from 'posthog-js/react';
import { usePathname, useSearchParams } from 'next/navigation';

// PostHog client-side analytics. Initializes once on first browser mount.
//
// We deliberately disable PostHog's built-in pageview capture and emit
// $pageview ourselves below — Next.js App Router uses soft navigations
// that posthog-js doesn't see by default. Subsequent in-app route changes
// would otherwise be invisible.
//
// person_profiles: 'identified_only' keeps anonymous traffic out of the
// "Persons" table — only users who explicitly identify (e.g. after sign-in)
// produce profiles. Saves quota and avoids tracking bots as people.
export function PostHogProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    if (!key) return; // not configured (e.g. local dev) — silently no-op
    posthog.init(key, {
      api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://eu.i.posthog.com',
      person_profiles: 'identified_only',
      capture_pageview: false,
      capture_pageleave: true,
    });
  }, []);

  return (
    <PHProvider client={posthog}>
      <Suspense fallback={null}>
        <PageViewCapture />
      </Suspense>
      {children}
    </PHProvider>
  );
}

function PageViewCapture() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const ph = usePostHog();

  useEffect(() => {
    if (!pathname || !ph) return;
    let url = window.origin + pathname;
    const q = searchParams?.toString();
    if (q) url += '?' + q;
    ph.capture('$pageview', { $current_url: url });
  }, [pathname, searchParams, ph]);

  return null;
}
