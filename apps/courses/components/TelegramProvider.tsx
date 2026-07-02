'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

// Minimal slice of the Telegram WebApp surface we actually consume. The full
// SDK adds dozens of methods (HapticFeedback, CloudStorage, SecondaryButton …)
// that we don't bind to today — extending this interface as we adopt more is
// safe and additive.
export interface TelegramWebApp {
  initData: string;
  initDataUnsafe: {
    user?: {
      id: number;
      first_name?: string;
      last_name?: string;
      username?: string;
      photo_url?: string;
      language_code?: string;
      is_premium?: boolean;
    };
    start_param?: string;
    auth_date?: number;
    hash?: string;
  };
  colorScheme: 'light' | 'dark';
  themeParams: Record<string, string>;
  isExpanded: boolean;
  viewportHeight: number;
  viewportStableHeight: number;
  ready(): void;
  expand(): void;
  close(): void;
  onEvent(name: string, cb: () => void): void;
  offEvent(name: string, cb: () => void): void;
  MainButton: {
    text: string;
    isVisible: boolean;
    isActive: boolean;
    showProgress(leaveActive?: boolean): void;
    hideProgress(): void;
    setText(text: string): void;
    setParams(p: {
      text?: string;
      color?: string;
      text_color?: string;
      is_active?: boolean;
      is_visible?: boolean;
    }): void;
    show(): void;
    hide(): void;
    enable(): void;
    disable(): void;
    onClick(cb: () => void): void;
    offClick(cb: () => void): void;
  };
  BackButton: {
    isVisible: boolean;
    show(): void;
    hide(): void;
    onClick(cb: () => void): void;
    offClick(cb: () => void): void;
  };
}

export interface TgUserClient {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  language_code?: string;
}

interface TelegramState {
  /** True iff this page is actually running inside a Telegram WebView. */
  isTma: boolean;
  webApp: TelegramWebApp | null;
  /** Raw initData string — pass to /api/auth/telegram for HMAC verification. */
  initData: string;
  /** Convenience: parsed user from initDataUnsafe. */
  tgUser: TgUserClient | null;
  /** Deep-link payload from initDataUnsafe.start_param (e.g. "lesson_classic50_3"). */
  startParam: string | null;
  /** "light" | "dark" — mirrors webApp.colorScheme. */
  colorScheme: 'light' | 'dark';
}

const Ctx = createContext<TelegramState | null>(null);

const FALLBACK: TelegramState = {
  isTma: false,
  webApp: null,
  initData: '',
  tgUser: null,
  startParam: null,
  colorScheme: 'light',
};

// Cookie name read by middleware to flip data-tma="true" on <html>
// server-side. Long-lived because once a device is identified as a TMA we
// stay chromeless on subsequent visits to the same origin.
const TMA_COOKIE = 'tma';

function readWebApp(): TelegramWebApp | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { Telegram?: { WebApp?: TelegramWebApp } };
  return w.Telegram?.WebApp ?? null;
}

function setTmaCookie(): void {
  if (typeof document === 'undefined') return;
  // Long-lived so server-side render in subsequent visits is already chromeless.
  document.cookie = 'tma=1; path=/; max-age=31536000; SameSite=Lax; Secure';
}

function clearTmaCookie(): void {
  if (typeof document === 'undefined') return;
  document.cookie = 'tma=; path=/; max-age=0; SameSite=Lax; Secure';
}

function readTmaCookie(): boolean {
  if (typeof document === 'undefined') return false;
  return document.cookie.split(';').some((c) => c.trim().startsWith(`${TMA_COOKIE}=1`));
}

export function TelegramProvider({ children }: { children: ReactNode }) {
  // Detect synchronously on first render. The Telegram SDK is loaded with
  // strategy="beforeInteractive" so window.Telegram.WebApp exists by the time
  // React hydrates. We still need useState to bind state to renders.
  const [state, setState] = useState<TelegramState>(() => {
    const webApp = readWebApp();
    const initData = webApp?.initData ?? '';
    const isTma = initData.length > 0;
    if (!isTma) return FALLBACK;
    const tgUser = webApp?.initDataUnsafe?.user ?? null;
    return {
      isTma,
      webApp,
      initData,
      tgUser,
      startParam: webApp?.initDataUnsafe?.start_param ?? null,
      colorScheme: webApp?.colorScheme ?? 'light',
    };
  });

  useEffect(() => {
    const webApp = readWebApp();
    const initData = webApp?.initData ?? '';
    const isTma = initData.length > 0;

    // Cookie reconciliation. We always do this AFTER mount because
    // document.cookie writes have no effect during SSR.
    if (isTma) {
      if (!readTmaCookie()) setTmaCookie();
      // ready() + expand() are idempotent and cheap. Telegram requires ready()
      // before MainButton.show() will work on some platforms.
      try {
        webApp!.ready();
        if (!webApp!.isExpanded) webApp!.expand();
      } catch {
        /* defensive — older Telegram clients */
      }
    } else if (readTmaCookie()) {
      // User opened a previously-tagged TMA URL in a regular browser tab —
      // unstick the cookie so they get the web chrome back.
      clearTmaCookie();
      try {
        document.documentElement.removeAttribute('data-tma');
      } catch {
        /* ignore */
      }
    }

    // Subscribe to colorScheme changes so the context value flips when the
    // user toggles Telegram's theme without reloading.
    if (!webApp || !isTma) return;
    const onTheme = (): void => {
      setState((prev) => ({
        ...prev,
        colorScheme: webApp.colorScheme,
      }));
    };
    webApp.onEvent('themeChanged', onTheme);
    return () => {
      try {
        webApp.offEvent('themeChanged', onTheme);
      } catch {
        /* ignore */
      }
    };
  }, []);

  const value = useMemo(() => state, [state]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTelegram(): TelegramState {
  // Returning a stable FALLBACK when no provider is present means hooks like
  // useTelegramMainButton can be called from any component without crashing
  // tests or Storybook setups. The real provider always wins.
  return useContext(Ctx) ?? FALLBACK;
}
