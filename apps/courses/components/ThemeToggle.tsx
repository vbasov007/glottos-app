'use client';

import { useTranslations } from 'next-intl';
import { useTheme, type ThemePref } from './ThemeProvider';

interface Labels {
  light: string;
  dark: string;
  system: string;
}

/**
 * Segmented control for the appearance preference. Renders three buttons —
 * Light / Dark / System — and writes the choice through useTheme(), which
 * persists it in localStorage and toggles the html.dark class.
 *
 * `System` follows the OS preference live (the provider listens for media
 * query changes), so a user who picks System sees the page flip when they
 * toggle their device theme without refreshing.
 *
 * The actual button styling stays minimal — three equal cells with the
 * active one tinted, matching the language/target pickers on the same
 * settings page.
 */
export function ThemeToggle({ labels }: { labels: Labels }) {
  const { pref, setPref } = useTheme();
  const options: { value: ThemePref; label: string; emoji: string }[] = [
    { value: 'light', label: labels.light, emoji: '☀️' },
    { value: 'dark', label: labels.dark, emoji: '🌙' },
    { value: 'system', label: labels.system, emoji: '🖥️' },
  ];
  return (
    <div role="group" aria-label="Appearance" className="grid grid-cols-3 gap-2">
      {options.map((o) => {
        const active = o.value === pref;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => setPref(o.value)}
            className={
              'rounded-md border px-3 py-3 text-center font-medium transition-colors ' +
              (active
                ? 'border-zinc-900 dark:border-zinc-100 bg-zinc-50 dark:bg-zinc-900'
                : 'border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900')
            }
          >
            <div className="text-base leading-none">{o.emoji}</div>
            <div className="mt-1 text-sm">{o.label}</div>
          </button>
        );
      })}
    </div>
  );
}
