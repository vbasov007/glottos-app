'use client';

import { withBase } from '../lib/api-base';
import { useEffect, useRef } from 'react';
import { apiFetch, getStoredSessionId } from '../lib/api-client';
import { useSession } from './SessionProvider';
import { useProgressStore } from '../lib/store';

interface Props {
  /** Course key for the page (e.g. "de.ru"). Sync runs only for this slice. */
  courseKey: string;
}

interface ProgressGetResponse {
  state: unknown | null;
}

const PUT_DEBOUNCE_MS = 1000;

/**
 * Mounted once per [native] layout. While the user is signed in:
 *   1. On mount (and whenever sign-in or courseKey changes), pull the server
 *      snapshot for this courseKey and overwrite the corresponding slice in
 *      the Zustand store. Per the v1 decision, server is authoritative on
 *      every fresh session — any anonymous local progress for this course
 *      is discarded.
 *   2. Subscribe to changes in `courses[courseKey]` and debounce-PUT the
 *      whole slice back to /api/progress.
 *
 * While signed out, this component is a no-op; localStorage continues to
 * persist progress on its own.
 */
export function ProgressSync({ courseKey }: Props) {
  const { user, ready } = useSession();
  const userId = user ? user.email : null; // re-run sync when user identity changes
  const lastPushedRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 1. Initial pull on sign-in / courseKey change.
  useEffect(() => {
    if (!ready || !user) return;
    let cancelled = false;
    (async () => {
      const r = await apiFetch<ProgressGetResponse>(
        `/api/progress?courseKey=${encodeURIComponent(courseKey)}`,
      );
      if (cancelled) return;
      if (r.ok && r.data) {
        // Either replace with server's state, or wipe the local slice if server is empty.
        const serverState = r.data.state;
        useProgressStore.setState((s) => {
          const next = { ...s.courses };
          if (serverState && typeof serverState === 'object') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            next[courseKey as keyof typeof next] = serverState as any;
          } else {
            delete next[courseKey as keyof typeof next];
          }
          return { courses: next } as Partial<typeof s>;
        });
        // Mark the slice we just installed as "already pushed" so the
        // subscribe-driven PUT doesn't immediately echo it back.
        const slice = (useProgressStore.getState().courses as Record<string, unknown>)[courseKey];
        lastPushedRef.current = slice ? JSON.stringify(slice) : null;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, userId, courseKey]);

  // 2. Write-through PUT on local changes.
  useEffect(() => {
    if (!ready || !user) return;

    // Flush the pending PUT immediately via a keepalive fetch. Called from
    // cleanup (language switch, sign-out, layout teardown) and from the
    // `beforeunload` handler (tab close, navigation away from the SPA).
    // Keepalive lets the request finish even after the page is being torn down.
    function flushPending(): void {
      if (!timerRef.current) return;
      clearTimeout(timerRef.current);
      timerRef.current = null;
      const fresh = (useProgressStore.getState().courses as Record<string, unknown>)[courseKey];
      if (!fresh) return;
      const freshSerialized = JSON.stringify(fresh);
      if (freshSerialized === lastPushedRef.current) return;
      const sid = getStoredSessionId();
      if (!sid) return;
      const body = JSON.stringify({ courseKey, state: fresh });
      try {
        fetch(withBase('/api/progress'), {
          method: 'PUT',
          headers: { 'content-type': 'application/json', 'X-Session-Id': sid },
          body,
          keepalive: true,
        }).catch(() => {
          /* best-effort during teardown */
        });
        lastPushedRef.current = freshSerialized;
      } catch {
        /* ignore */
      }
    }

    const unsubscribe = useProgressStore.subscribe((state) => {
      const slice = (state.courses as Record<string, unknown>)[courseKey];
      if (!slice) return;
      const serialized = JSON.stringify(slice);
      if (serialized === lastPushedRef.current) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        const fresh = (useProgressStore.getState().courses as Record<string, unknown>)[courseKey];
        if (!fresh) return;
        const freshSerialized = JSON.stringify(fresh);
        if (freshSerialized === lastPushedRef.current) return;
        void apiFetch('/api/progress', {
          method: 'PUT',
          body: JSON.stringify({ courseKey, state: fresh }),
        }).then((r) => {
          if (r.ok) lastPushedRef.current = freshSerialized;
        });
      }, PUT_DEBOUNCE_MS);
    });

    // Tab close / hard navigation: flush before the page disappears.
    const onBeforeUnload = () => flushPending();
    window.addEventListener('beforeunload', onBeforeUnload);
    // Mobile Safari / background tabs: pagehide is more reliable than beforeunload.
    window.addEventListener('pagehide', onBeforeUnload);

    return () => {
      // Cleanup runs on courseKey change, sign-out, layout unmount —
      // flush any pending change so it doesn't vanish.
      flushPending();
      unsubscribe();
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('pagehide', onBeforeUnload);
    };
  }, [ready, userId, courseKey]);

  return null;
}
