'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

// Three values keep the option set human-readable:
//   light  → force the light palette, ignore OS
//   dark   → force dark, ignore OS
//   system → follow `prefers-color-scheme` and react to OS changes live
//
// The Telegram bridge also writes the html.dark class when running inside a
// Telegram WebView, but a user explicit choice on the courses settings page
// always wins — `localStorage.theme` is the authority everywhere.
export type ThemePref = 'light' | 'dark' | 'system';

interface ThemeState {
  /** What the user picked: light / dark / system. */
  pref: ThemePref;
  /** Resolved (the actual class on <html>): light or dark. Useful for code
   *  that needs to switch styles based on the current paint, e.g.
   *  openInTutor() carrying the theme through SSO. */
  resolved: 'light' | 'dark';
  setPref(next: ThemePref): void;
}

const Ctx = createContext<ThemeState | null>(null);

const FALLBACK_RESOLVED: 'light' | 'dark' = 'light';

function readPref(): ThemePref {
  if (typeof window === 'undefined') return 'system';
  try {
    const v = window.localStorage.getItem('theme');
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    /* ignore */
  }
  return 'system';
}

function osPrefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function resolve(pref: ThemePref): 'light' | 'dark' {
  if (pref === 'light') return 'light';
  if (pref === 'dark') return 'dark';
  return osPrefersDark() ? 'dark' : 'light';
}

function apply(resolved: 'light' | 'dark'): void {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', resolved === 'dark');
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // SSR-safe defaults — readPref() returns 'system' on the server because
  // `window.localStorage` isn't reachable. The effect below replaces these
  // with the real saved preference on the client immediately after mount.
  // The pre-paint script (components/ThemeScript.tsx) has already toggled
  // the html.dark class, so the page is visually correct even during this
  // brief sync window — only the segmented control's "selected" button
  // catches up a tick later.
  const [pref, setPrefState] = useState<ThemePref>('system');
  const [resolved, setResolved] = useState<'light' | 'dark'>('light');
  const [hydrated, setHydrated] = useState(false);

  // First mount: pull the real saved preference into state.
  useEffect(() => {
    const stored = readPref();
    setPrefState(stored);
    const r = resolve(stored);
    setResolved(r);
    setHydrated(true);
  }, []);

  // Apply on every pref change AFTER hydration. We deliberately skip the
  // first render — the pre-paint script already set the class, no need to
  // re-apply with a stale 'system' value while we're still syncing.
  useEffect(() => {
    if (!hydrated) return;
    const r = resolve(pref);
    setResolved(r);
    apply(r);
  }, [pref, hydrated]);

  // Live-react to OS changes when the user is in `system` mode. Removed
  // when they pick light/dark explicitly so the OS can't override their
  // choice mid-session.
  useEffect(() => {
    if (pref !== 'system' || typeof window === 'undefined' || !window.matchMedia) {
      return;
    }
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (): void => {
      const r = mq.matches ? 'dark' : 'light';
      setResolved(r);
      apply(r);
    };
    // addEventListener is the modern API; older Safari needs addListener.
    if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange);
    else mq.addListener(onChange);
    return () => {
      if (typeof mq.removeEventListener === 'function') mq.removeEventListener('change', onChange);
      else mq.removeListener(onChange);
    };
  }, [pref]);

  const setPref = useCallback((next: ThemePref) => {
    setPrefState(next);
    try {
      window.localStorage.setItem('theme', next);
    } catch {
      /* private mode etc. — still flip in-memory */
    }
  }, []);

  const value = useMemo<ThemeState>(() => ({ pref, resolved, setPref }), [pref, resolved, setPref]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeState {
  // Components outside the provider (e.g. unit-test setups) see a stable
  // light-mode no-op so they don't need to wrap in <ThemeProvider> to
  // render.
  return (
    useContext(Ctx) ?? {
      pref: 'system',
      resolved: FALLBACK_RESOLVED,
      setPref: () => undefined,
    }
  );
}
