'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import posthog from 'posthog-js';
import {
  apiFetch,
  clearStoredSessionId,
  getStoredSessionId,
  logToServer,
  setStoredSessionId,
} from '../lib/api-client';
import { useProgressStore } from '../lib/store';
import { capture } from '../lib/analytics';

export interface SessionUser {
  email: string;
  name: string | null;
  picture: string | null;
  role: string;
}

interface SessionState {
  user: SessionUser | null;
  /** True until the first /api/me round-trip has settled. */
  ready: boolean;
  /** Last sign-in error message, if any. Cleared on next successful sign-in or on signOut. */
  signInError: string | null;
  signInWithCredential: (credential: string) => Promise<boolean>;
  /** Telegram Mini App sign-in: posts the raw initData blob to
   *  /api/auth/telegram and stores the resulting sessionId. Same response
   *  shape as the Google path, so the downstream X-Session-Id flow is
   *  shared. */
  signInWithTelegram: (initData: string) => Promise<boolean>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<SessionState | null>(null);

interface MeResponse {
  user: SessionUser;
}

interface SignInResponse {
  sessionId: string;
  user: SessionUser;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);
  const hydrated = useRef(false);

  // On mount, if we have a stored session_id, validate it against /api/me.
  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;

    const sid = getStoredSessionId();
    if (!sid) {
      setReady(true);
      return;
    }
    apiFetch<MeResponse>('/api/me')
      .then((r) => {
        if (r.ok && r.data?.user) setUser(r.data.user);
        else if (r.unauthenticated) setUser(null);
      })
      .finally(() => setReady(true));
  }, []);

  // PostHog identity. When a user is known (post-sign-in or post-/api/me
  // restore), tie subsequent events to their email. posthog-js queues
  // calls made before init() and replays them, so this works even if
  // SessionProvider's useEffect fires before PostHogProvider's init.
  // Guard on env var so we don't grow an unbounded queue when PostHog
  // isn't configured.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) return;
    if (user) {
      posthog.identify(user.email, {
        email: user.email,
        name: user.name ?? undefined,
        role: user.role,
      });
    }
  }, [user?.email, user?.role, user?.name]);

  const signInWithCredential = useCallback(async (credential: string) => {
    setSignInError(null);
    logToServer('info', 'signIn', 'posting credential', {
      credentialLength: credential.length,
    });
    let r: Awaited<ReturnType<typeof apiFetch<SignInResponse & { error?: string }>>>;
    try {
      r = await apiFetch<SignInResponse & { error?: string }>('/api/auth/google', {
        method: 'POST',
        body: JSON.stringify({ credential }),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSignInError(`Sign-in network error: ${message}`);
      logToServer('error', 'signIn', 'apiFetch threw', { message });
      console.error('[signIn] apiFetch threw', err);
      return false;
    }
    if (!r.ok || !r.data?.sessionId) {
      const msg =
        r.status === 0
          ? 'Network error — could not reach the server.'
          : r.data?.error === 'invalid_credential'
            ? 'Google rejected the credential. The OAuth client ID on this server may not match the one used in your browser.'
            : r.data?.error === 'db_unreachable'
              ? 'Backend database is unreachable. Please try again later.'
              : `Sign-in failed (${r.status || 'unknown'}${r.data?.error ? ': ' + r.data.error : ''}).`;
      setSignInError(msg);
      logToServer('error', 'signIn', 'rejected', {
        status: r.status,
        error: r.data?.error,
        unauthenticated: r.unauthenticated,
      });
      console.error('[signIn] failed', { status: r.status, data: r.data });
      return false;
    }
    logToServer('info', 'signIn', 'success', { email: r.data.user.email });
    setStoredSessionId(r.data.sessionId);
    setUser(r.data.user);
    // Emit after setUser so the user-becoming-truthy useEffect has already
    // called posthog.identify — the sign_in_completed event is then attached
    // to the correct distinct_id rather than the prior anonymous one.
    // (posthog-js merges the anonymous distinct_id into the new identified
    // one automatically, so prior anonymous events are kept in the same
    // person profile.)
    capture('sign_in_completed', { provider: 'google', role: r.data.user.role });
    return true;
  }, []);

  const signInWithTelegram = useCallback(async (initData: string) => {
    setSignInError(null);
    logToServer('info', 'signInTelegram', 'posting initData', {
      initDataLength: initData.length,
    });
    let r: Awaited<ReturnType<typeof apiFetch<SignInResponse & { error?: string }>>>;
    try {
      r = await apiFetch<SignInResponse & { error?: string }>('/api/auth/telegram', {
        method: 'POST',
        body: JSON.stringify({ initData }),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSignInError(`Telegram sign-in network error: ${message}`);
      logToServer('error', 'signInTelegram', 'apiFetch threw', { message });
      return false;
    }
    if (!r.ok || !r.data?.sessionId) {
      const msg =
        r.status === 0
          ? 'Network error — could not reach the server.'
          : r.data?.error === 'invalid_init_data'
            ? 'Telegram rejected the launch data. Try closing and re-opening the app.'
            : r.data?.error === 'stale_init_data'
              ? 'Telegram launch data expired. Re-open the app from Telegram.'
              : r.data?.error === 'tg_not_configured'
                ? 'Telegram sign-in is not configured on this server.'
                : r.data?.error === 'db_unreachable'
                  ? 'Backend database is unreachable. Please try again later.'
                  : `Telegram sign-in failed (${r.status || 'unknown'}${r.data?.error ? ': ' + r.data.error : ''}).`;
      setSignInError(msg);
      logToServer('error', 'signInTelegram', 'rejected', {
        status: r.status,
        error: r.data?.error,
      });
      return false;
    }
    logToServer('info', 'signInTelegram', 'success', { email: r.data.user.email });
    setStoredSessionId(r.data.sessionId);
    setUser(r.data.user);
    capture('sign_in_completed', { provider: 'telegram', role: r.data.user.role });
    return true;
  }, []);

  const signOut = useCallback(async () => {
    await apiFetch('/api/auth/logout', { method: 'POST' });
    clearStoredSessionId();
    // Wipe local progress so a different user on this browser doesn't see the
    // previous account's lessons/answers/generated exercises. resetAll() flushes
    // the Zustand store; the persist middleware writes the cleared state to
    // localStorage on the next tick.
    useProgressStore.getState().resetAll();
    // Drop the PostHog distinct_id so the next anonymous session isn't
    // attributed to the signed-out user.
    if (typeof window !== 'undefined' && process.env.NEXT_PUBLIC_POSTHOG_KEY) {
      posthog.reset();
    }
    setUser(null);
    // Land on the root so all in-memory React state is rebuilt from scratch
    // (full reload, not a soft router push). This also discards anything the
    // language switcher or sync layers might be holding in closures.
    if (typeof window !== 'undefined') {
      window.location.href = '/';
    }
  }, []);

  const value = useMemo<SessionState>(
    () => ({ user, ready, signInError, signInWithCredential, signInWithTelegram, signOut }),
    [user, ready, signInError, signInWithCredential, signInWithTelegram, signOut],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession must be used inside <SessionProvider>');
  return v;
}
