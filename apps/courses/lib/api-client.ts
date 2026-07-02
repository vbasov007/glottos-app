'use client';

/**
 * Tiny `fetch` wrapper that attaches `X-Session-Id` and surfaces 401s so the
 * caller can clear the bad session. Centralising it here means every API
 * call (progress sync, /api/me, /api/auth/logout) uses identical session
 * + error handling.
 */

import { withBase } from './api-base';

const SESSION_KEY = 'session_id';

export function getStoredSessionId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

export function setStoredSessionId(sessionId: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SESSION_KEY, sessionId);
  } catch {
    /* quota or disabled */
  }
}

export function clearStoredSessionId(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data?: T;
  /** True iff a 401 was received — caller should treat the session as dead. */
  unauthenticated: boolean;
}

/**
 * Fire-and-forget — pushes a structured event to /api/log so the runtime log
 * shows client-side failures we can't reproduce locally. Never throws; uses
 * keepalive so it works during navigation/unload.
 */
export function logToServer(
  level: 'info' | 'warn' | 'error',
  tag: string,
  msg: string,
  data?: unknown,
): void {
  if (typeof window === 'undefined') return;
  try {
    fetch(withBase('/api/log'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        level,
        tag,
        msg,
        data,
        userAgent: navigator.userAgent,
        url: window.location.href,
      }),
    }).catch(() => {
      /* best effort */
    });
  } catch {
    /* ignore */
  }
}

export async function apiFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<ApiResult<T>> {
  const headers = new Headers(init.headers);
  const sid = getStoredSessionId();
  if (sid) headers.set('X-Session-Id', sid);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  let res: Response;
  try {
    res = await fetch(withBase(path), { ...init, headers });
  } catch {
    return { ok: false, status: 0, unauthenticated: false };
  }

  if (res.status === 401) {
    clearStoredSessionId();
    return { ok: false, status: 401, unauthenticated: true };
  }

  let data: T | undefined;
  try {
    data = (await res.json()) as T;
  } catch {
    /* non-JSON body, ignore */
  }
  return { ok: res.ok, status: res.status, data, unauthenticated: false };
}
