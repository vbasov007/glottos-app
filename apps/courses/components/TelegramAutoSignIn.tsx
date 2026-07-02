'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from './SessionProvider';
import { useTelegram, type TgUserClient } from './TelegramProvider';

// Telegram returns 2-letter language codes (sometimes regional suffixed). Map
// to our supported natives; default English so a Spanish or French Telegram
// user gets the English UI rather than a broken locale fallback.
function nativeFor(code: string | null | undefined): 'ru' | 'en' | 'pl' | 'de' {
  if (!code) return 'en';
  const prefix = code.slice(0, 2).toLowerCase();
  if (prefix === 'ru' || prefix === 'uk' || prefix === 'be') return 'ru';
  if (prefix === 'pl') return 'pl';
  if (prefix === 'de' || prefix === 'at' || prefix === 'ch') return 'de';
  return 'en';
}

// start_param values currently supported: "lesson_<course>_<n>". Anything we
// don't recognise routes to the default landing.
function parseStartParam(s: string | null): { course: string; lessonN: number } | null {
  if (!s) return null;
  const m = s.match(/^lesson_([a-z0-9_-]{3,32})_(\d{1,2})$/i);
  if (!m) return null;
  const n = parseInt(m[2]!, 10);
  if (!Number.isFinite(n) || n < 1 || n > 50) return null;
  return { course: m[1]!.toLowerCase(), lessonN: n };
}

function landingPath(tgUser: TgUserClient | null, startParam: string | null): string {
  const native = nativeFor(tgUser?.language_code);
  // v1: flagship target is German. NEXT_PUBLIC_TMA_DEFAULT_TARGET lets us
  // flip without a redeploy if we ever change flagships.
  const target = process.env.NEXT_PUBLIC_TMA_DEFAULT_TARGET || 'de';
  const dl = parseStartParam(startParam);
  if (dl) return `/${target}/${native}/lesson/${dl.course}/${dl.lessonN}`;
  return `/${target}/${native}`;
}

/**
 * Runs once on every TMA mount:
 *   - If user is already signed-in (sessionId from prior visit re-hydrated
 *     by SessionProvider against /api/me), redirect to landing if we're on
 *     the marketing root.
 *   - Otherwise POST initData to /api/auth/telegram, get a session, redirect.
 *
 * Outside Telegram this component is inert — there's no initData to post,
 * and Google sign-in continues to handle web auth.
 */
export function TelegramAutoSignIn() {
  const { isTma, initData, tgUser, startParam } = useTelegram();
  const { user, ready, signInWithTelegram } = useSession();
  const router = useRouter();
  // Guard against StrictMode double-mount + against re-firing after a
  // successful sign-in when the user state propagates.
  const fired = useRef(false);

  useEffect(() => {
    if (!isTma) return;
    if (!ready) return;
    if (fired.current) return;

    // Already signed in — just route them somewhere useful.
    if (user) {
      if (window.location.pathname === '/') {
        router.replace(landingPath(tgUser, startParam));
      }
      fired.current = true;
      return;
    }

    if (!initData) return;
    fired.current = true;
    void signInWithTelegram(initData).then((ok) => {
      if (ok) router.replace(landingPath(tgUser, startParam));
      else fired.current = false; // allow retry on next prop change
    });
  }, [isTma, ready, user, initData, tgUser, startParam, signInWithTelegram, router]);

  return null;
}
