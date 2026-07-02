'use client';

import { apiFetch, getStoredSessionId } from './api-client';

// Where text-tutor lives. NEXT_PUBLIC_TUTOR_URL is inlined into the client
// bundle at build time so the value matches whichever env the bundle was
// built against. Falls back to the production origin.
const TUTOR_BASE_URL =
  process.env.NEXT_PUBLIC_TUTOR_URL?.replace(/\/+$/, '') ?? 'https://t.glottos.com';

/**
 * Resolved theme to hand off to text-tutor so the new tab opens in the same
 * colour scheme. Reads the html.dark class set by ThemeProvider /
 * TelegramThemeBridge / ThemeScript — single source of truth, no media
 * query lookup here.
 */
function currentTheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

interface MintResponse {
  token?: string;
  error?: string;
}

/**
 * Navigate the CURRENT tab to a text-tutor URL (typically `/s/<code>`),
 * carrying the current signed-in identity across the handoff.
 *
 * Flow:
 *   1. If we have a local session, POST to /api/sso/mint, then assign
 *      window.location.href to `<tutor>/<path>?sso=<token>` once the
 *      token comes back.
 *   2. On any failure — anonymous user, network error, /api/sso/mint
 *      returning 401/503 — navigate to the plain share URL so the user
 *      still gets the content. The other app's /s/<code> route passes
 *      any `?sso=` it sees through to its bootstrap, so there's no
 *      contract mismatch.
 *
 * Modifier-click (cmd / middle-click) on the wrapping <a> still opens in
 * a new tab because the browser's native gesture handling runs before
 * the onClick handler — the caller's preventDefault only fires for
 * plain primary clicks.
 *
 * Caller is expected to wrap this in an onClick (preventDefault on a
 * regular <a>) — see the wiring in VocabTab / WritingPractice /
 * AudioPractice.
 */
export async function openInTutor(path: string): Promise<void> {
  // Carry the originating lesson URL so text-tutor can offer a back-link that
  // returns the user to this exact lesson rather than the courses home page.
  // Relative path only; re-validated on the courses /sso side before redirect.
  const from =
    typeof window !== 'undefined'
      ? window.location.pathname + window.location.search + window.location.hash
      : '';
  const fromParam = from ? `from=${encodeURIComponent(from)}` : '';
  // Carry the current colour scheme so the tutor opens in the same
  // appearance as the courses page. Sent on every handoff (sso path and
  // anonymous fallback) so the user doesn't get jarring light/dark flicker
  // when crossing between the two apps.
  const themeParam = `theme=${currentTheme()}`;

  const withQuery = (extra: string): string => {
    const parts = [extra, fromParam, themeParam].filter(Boolean);
    if (!parts.length) return `${TUTOR_BASE_URL}${path}`;
    const sep = path.includes('?') ? '&' : '?';
    return `${TUTOR_BASE_URL}${path}${sep}${parts.join('&')}`;
  };

  const fallback = (): void => {
    if (typeof window !== 'undefined') window.location.href = withQuery('');
  };

  if (!getStoredSessionId()) {
    fallback();
    return;
  }

  try {
    const r = await apiFetch<MintResponse>('/api/sso/mint', {
      method: 'POST',
      body: JSON.stringify({ to: 'tutor' }),
    });
    if (r.ok && r.data?.token) {
      if (typeof window !== 'undefined') {
        window.location.href = withQuery(`sso=${encodeURIComponent(r.data.token)}`);
      }
    } else {
      fallback();
    }
  } catch {
    fallback();
  }
}
