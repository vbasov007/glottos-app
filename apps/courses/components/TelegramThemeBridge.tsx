'use client';

import { useEffect } from 'react';
import { useTelegram } from './TelegramProvider';

// Telegram's documented theme keys we mirror into CSS variables. Keys that
// aren't present on older clients are silently skipped.
const KEY_TO_VAR: Record<string, string> = {
  bg_color: '--tg-bg',
  text_color: '--tg-text',
  hint_color: '--tg-hint',
  link_color: '--tg-link',
  button_color: '--tg-button',
  button_text_color: '--tg-button-text',
  secondary_bg_color: '--tg-secondary-bg',
};

/**
 * Mirrors Telegram's themeParams onto :root as CSS variables and flips the
 * `data-tg-theme` attribute on <html> so Tailwind's `dark:` variants
 * (configured to follow `[data-tg-theme="dark"]`) light up automatically.
 *
 * Re-runs whenever colorScheme changes so toggling Telegram's theme without
 * reloading the page updates colors in-place.
 */
export function TelegramThemeBridge() {
  const { isTma, webApp, colorScheme } = useTelegram();

  useEffect(() => {
    if (!isTma || !webApp) return;
    const root = document.documentElement;
    const apply = (): void => {
      const params = webApp.themeParams ?? {};
      for (const [k, v] of Object.entries(params)) {
        const cssVar = KEY_TO_VAR[k];
        if (cssVar && typeof v === 'string') {
          root.style.setProperty(cssVar, v);
        }
      }
      const scheme = webApp.colorScheme ?? 'light';
      root.setAttribute('data-tg-theme', scheme);
      // Mirror onto the html.dark class so Tailwind's class-based
      // darkMode lights up inside TMA. Telegram's chosen theme always
      // wins over the user's localStorage preference inside the
      // WebView — they can't reach the courses settings page from
      // there to toggle it anyway.
      root.classList.toggle('dark', scheme === 'dark');
    };
    apply();
    // colorScheme changes are surfaced through the provider's state; this
    // effect re-runs on each change because colorScheme is in the dep list.
  }, [isTma, webApp, colorScheme]);

  return null;
}
