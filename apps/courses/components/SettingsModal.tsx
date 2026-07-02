'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { SettingsActions } from './SettingsActions';
import { useTheme, type ThemePref } from './ThemeProvider';
import { locales } from '../i18n/request';
import {
  TARGETS,
  TARGET_BY_CODE,
  type NativeLang,
  type TargetLang,
} from '../lib/content-types';

interface Props {
  target: TargetLang;
  native: NativeLang;
  open: boolean;
  onClose(): void;
}

const NATIVE_LABEL: Record<string, string> = {
  ru: 'Русский',
  en: 'English',
  pl: 'Polski',
  de: 'Deutsch',
};

/**
 * Settings as a popup overlay. Pending changes accumulate in local state;
 * Save applies them (theme via setPref, language switches via router.push)
 * and closes; X / Esc / click-outside discards and closes.
 *
 * The Progress section (Export JSON / Reset progress) still acts
 * immediately on click — those are one-shot actions, not settings to
 * save. They live inside the modal because the page they used to share
 * with the language pickers is being replaced wholesale.
 */
export function SettingsModal({ target, native, open, onClose }: Props) {
  const router = useRouter();
  const t = useTranslations('settings');
  const tCommon = useTranslations('common');
  const { pref: currentTheme, setPref } = useTheme();
  // targetMeta is read inside the picker logic below — kept here in case
  // a future feature surfaces something like the endonym in the header.
  void TARGET_BY_CODE[target];

  // Pending draft state. Initialised from the current values when the
  // modal opens; reset on each open so a previous discard doesn't leak.
  const [pendingTarget, setPendingTarget] = useState<TargetLang>(target);
  const [pendingNative, setPendingNative] = useState<NativeLang>(native);
  const [pendingTheme, setPendingTheme] = useState<ThemePref>(currentTheme);

  const dialogRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  // (Re-)seed the draft each time the modal opens, so a saved-then-reopened
  // dialog reflects the new ground truth, and a discarded-then-reopened
  // dialog forgets the previous pending state.
  useEffect(() => {
    if (open) {
      setPendingTarget(target);
      setPendingNative(native);
      setPendingTheme(currentTheme);
    }
  }, [open, target, native, currentTheme]);

  // Esc closes (discard).
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const onSave = useCallback(() => {
    // Theme — only write to localStorage if it actually changed, to avoid
    // a redundant re-render and to keep the ThemeProvider's "no-op for
    // same value" optimisation honest.
    if (pendingTheme !== currentTheme) {
      setPref(pendingTheme);
    }
    // Language switches — navigate iff something changed. The new URL is
    // /<target>/<native> at root; the layout under it picks up the new
    // locale + content. We close before navigation to avoid a flash of
    // the modal over the new page during the soft-nav transition.
    onClose();
    if (pendingTarget !== target || pendingNative !== native) {
      router.push(`/${pendingTarget}/${pendingNative}`);
    }
  }, [pendingTheme, currentTheme, setPref, pendingTarget, pendingNative, target, native, onClose, router]);

  const hasChanges = useMemo(
    () =>
      pendingTarget !== target ||
      pendingNative !== native ||
      pendingTheme !== currentTheme,
    [pendingTarget, pendingNative, pendingTheme, target, native, currentTheme],
  );

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={t('title')}
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/40 dark:bg-black/60"
      />
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="relative w-full max-w-2xl max-h-[85vh] rounded-xl bg-white dark:bg-zinc-950 shadow-2xl flex flex-col overflow-hidden outline-none"
      >
        <div className="flex items-center justify-between gap-3 px-4 py-2 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
          <h2 className="text-sm font-semibold">{t('title')}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 inline-flex items-center justify-center rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-900 text-zinc-600 dark:text-zinc-300"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto p-4 md:p-5 space-y-6">
          {/* Native language picker — pending state only; commits on Save. */}
          <section>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 mb-2">
              {t('nativeLangHeading')}
            </h3>
            <p className="text-xs text-zinc-600 dark:text-zinc-400 mb-3">
              {t('nativeLangSubtitle')}
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {locales.map((l) => {
                const available =
                  TARGET_BY_CODE[pendingTarget]?.natives.includes(l as NativeLang) ?? false;
                const selected = l === pendingNative;
                const cls =
                  'rounded-md border px-3 py-2 text-center text-sm font-medium ' +
                  (selected
                    ? 'border-blue-500 dark:border-blue-400 bg-blue-50 dark:bg-blue-950/40'
                    : available
                      ? 'border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900'
                      : 'border-zinc-200 dark:border-zinc-800 opacity-40 cursor-not-allowed');
                return (
                  <button
                    key={l}
                    type="button"
                    disabled={!available}
                    onClick={() => available && setPendingNative(l as NativeLang)}
                    className={cls}
                  >
                    <div className="text-[10px] uppercase tracking-wide text-zinc-500">{l}</div>
                    <div className="mt-0.5">{NATIVE_LABEL[l]}</div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Target language picker. */}
          <section>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 mb-2">
              {t('targetLangHeading')}
            </h3>
            <p className="text-xs text-zinc-600 dark:text-zinc-400 mb-3">
              {t('targetLangSubtitle')}
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {TARGETS.map((tm) => {
                const valid = tm.natives.includes(pendingNative as NativeLang);
                const selected = tm.code === pendingTarget;
                const cls =
                  'rounded-md border px-3 py-2 text-center text-sm font-medium ' +
                  (selected
                    ? 'border-blue-500 dark:border-blue-400 bg-blue-50 dark:bg-blue-950/40'
                    : valid
                      ? 'border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900'
                      : 'border-zinc-200 dark:border-zinc-800 opacity-40 cursor-not-allowed text-zinc-400');
                return (
                  <button
                    key={tm.code}
                    type="button"
                    disabled={!valid}
                    onClick={() => valid && setPendingTarget(tm.code)}
                    className={cls}
                  >
                    <div className="text-[10px] uppercase tracking-wide text-zinc-500">
                      {tm.flag} {tm.code}
                    </div>
                    <div className="mt-0.5">{tm.endonym}</div>
                    {tm.status === 'preview' && (
                      <div className="text-[10px] mt-0.5 uppercase tracking-wide text-amber-600 dark:text-amber-400">
                        preview
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </section>

          {/* Theme — pending state, draft segmented control. */}
          <section>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 mb-2">
              {t('themeHeading')}
            </h3>
            <p className="text-xs text-zinc-600 dark:text-zinc-400 mb-3">
              {t('themeSubtitle')}
            </p>
            <div
              role="radiogroup"
              className="inline-flex items-center rounded-md border border-zinc-300 dark:border-zinc-700 overflow-hidden text-sm"
            >
              {(['light', 'dark', 'system'] as const).map((opt) => {
                const selected = pendingTheme === opt;
                return (
                  <button
                    key={opt}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setPendingTheme(opt)}
                    className={
                      'px-3 py-1.5 ' +
                      (selected
                        ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                        : 'hover:bg-zinc-50 dark:hover:bg-zinc-900')
                    }
                  >
                    {opt === 'light' ? `☀️ ${t('themeLight')}` : opt === 'dark' ? `🌙 ${t('themeDark')}` : `🖥️ ${t('themeSystem')}`}
                  </button>
                );
              })}
            </div>
          </section>

          {/* Progress: Export JSON / Reset progress — one-shot actions, not
              affected by Save/Discard (the underlying store mutation is
              irreversible). */}
          <section>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 mb-2">
              {t('progressHeading')}
            </h3>
            <p className="text-xs text-zinc-600 dark:text-zinc-400 mb-3">
              {t('progressSubtitle')}
            </p>
            <SettingsActions />
          </section>
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-zinc-200 dark:border-zinc-800 shrink-0 bg-zinc-50/60 dark:bg-zinc-900/40">
          <button
            type="button"
            onClick={onClose}
            className="text-sm px-3 py-1.5 rounded-md text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900"
          >
            {tCommon('cancel')}
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={!hasChanges}
            className="text-sm px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {tCommon('save')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
