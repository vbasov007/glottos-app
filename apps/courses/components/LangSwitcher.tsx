'use client';

import { usePathname, useRouter } from 'next/navigation';
import { locales, type Locale } from '../i18n/request';
import { TARGET_BY_CODE, type TargetLang } from '../lib/content-types';

interface Props {
  current: string;
  /** Current target (de/fr/es/sr/ka/he). Used to filter to native langs that
   *  have content for this target — switching to an unavailable native lands
   *  the user on the landing page instead of a 404. */
  target: string;
}

const LABELS: Record<Locale, string> = {
  ru: 'RU',
  en: 'EN',
  pl: 'PL',
  de: 'DE',
};

export function LangSwitcher({ current, target }: Props) {
  const router = useRouter();
  const pathname = usePathname() ?? '/';
  const targetMeta = TARGET_BY_CODE[target as TargetLang];

  function go(nextNative: Locale) {
    if (nextNative === current) return;
    // If the target doesn't have content for the chosen native, drop the
    // user back at the landing page where they can re-pick a target.
    const validForTarget = targetMeta?.natives.includes(nextNative) ?? false;
    if (!validForTarget) {
      router.push(`/?native=${nextNative}`);
      return;
    }
    // Pathname looks like "/<target>/<native>/...". Replace the native segment
    // (index 2). Preserve any deeper segments + the hash.
    const parts = pathname.split('/');
    const hash = typeof window !== 'undefined' ? window.location.hash : '';
    if (parts.length > 2 && parts[1] === target && (locales as readonly string[]).includes(parts[2] ?? '')) {
      parts[2] = nextNative;
      const next = parts.join('/') || `/${target}/${nextNative}`;
      router.push(`${next}${hash}`);
      return;
    }
    router.push(`/${target}/${nextNative}${hash}`);
  }

  return (
    <div role="group" aria-label="Language" className="flex items-center gap-0.5 rounded-md border border-zinc-200 dark:border-zinc-800 p-0.5">
      {locales.map((l) => {
        const active = l === current;
        const valid = targetMeta?.natives.includes(l) ?? true;
        return (
          <button
            key={l}
            type="button"
            onClick={() => go(l)}
            aria-pressed={active}
            disabled={!valid}
            title={!valid ? `${LABELS[l]} not yet available for ${target.toUpperCase()}` : undefined}
            className={
              // min-w/h keeps the tap area touch-friendly (≥32px) even with
              // the compact "RU"/"EN" labels.
              'inline-flex items-center justify-center min-w-[34px] min-h-[32px] px-2 text-xs font-medium rounded transition-colors ' +
              (active
                ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900'
                : valid
                  ? 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-900'
                  : 'text-zinc-300 dark:text-zinc-700 cursor-not-allowed')
            }
          >
            {LABELS[l]}
          </button>
        );
      })}
    </div>
  );
}
