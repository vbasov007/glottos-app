'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiFetch, setStoredSessionId } from '../../lib/api-client';

interface SuccessBody {
  sessionId: string;
  user: { name: string | null; email: string; picture: string | null; role: string };
}

/**
 * Clamp a `?return=` value to a safe in-app destination. Must be a
 * site-relative path (`/de/ru/text/…`) — anything absolute, protocol-relative
 * (`//evil.com`), or otherwise off-origin falls back to the home page so a
 * crafted link can't turn /sso into an open redirect.
 */
function safeReturn(value: string | null | undefined): string {
  if (!value) return '/';
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return '/';
  }
  return value;
}

/**
 * Landing page for the cross-app SSO handoff. The producer side (typically
 * text-tutor) builds a URL like `https://courses.glottos.com/sso?sso=<token>`
 * and points the user at it; this page:
 *
 *   1. Reads the token from `?sso=…`.
 *   2. POSTs it to /api/auth/sso, which verifies the HMAC, upserts the user,
 *      and returns { sessionId, user }.
 *   3. Stores the new sessionId in localStorage so SessionProvider hydrates
 *      against it on the next page load — no Google round-trip, no GSI
 *      prompt, just a logged-in landing.
 *   4. router.replace('/') so the token never lingers in browser history.
 *
 * On any failure (no token, expired, malformed, network down) we still
 * router.replace('/') — the user lands on the marketing page, can sign in
 * the normal way if they want.
 *
 * This is a Suspense-bounded client component because useSearchParams()
 * suspends in Next.js 15 App Router.
 */
export default function SsoLandingPage() {
  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-12 text-sm text-zinc-600 dark:text-zinc-400">
      <SsoExchange />
    </main>
  );
}

function SsoExchange() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // StrictMode in dev mounts every effect twice. We only want one POST to
  // /api/auth/sso — a second one would burn a fresh sessionId for nothing
  // and might (depending on timing) overwrite the first.
  const fired = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    const token = searchParams?.get('sso');
    // Where to land after the exchange: the lesson the user came from
    // (round-tripped through text-tutor), validated as a site-relative path so
    // a crafted ?return= can't bounce the user to another origin.
    const dest = safeReturn(searchParams?.get('return'));
    if (!token) {
      router.replace(dest);
      return;
    }
    void exchange(token).then(() => router.replace(dest));
  }, [router, searchParams]);

  async function exchange(token: string): Promise<void> {
    try {
      const r = await apiFetch<SuccessBody & { error?: string }>('/api/auth/sso', {
        method: 'POST',
        body: JSON.stringify({ token }),
      });
      if (r.ok && r.data?.sessionId) {
        setStoredSessionId(r.data.sessionId);
        return;
      }
      // Don't show the user the wire-level error code; just surface a
      // friendly message in case the redirect happens to be slow.
      setError(r.data?.error ?? `http_${r.status}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown');
    }
  }

  return (
    <div className="text-center space-y-2">
      <div>Signing you in…</div>
      {error && (
        <div className="text-xs text-zinc-400 dark:text-zinc-500">
          (failed: {error} — redirecting anyway)
        </div>
      )}
    </div>
  );
}
