'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useProgressStore } from '../lib/store';

export function SettingsActions() {
  const t = useTranslations('settings');
  const tCommon = useTranslations('common');
  const exportJson = useProgressStore((s) => s.exportJson);
  const resetAll = useProgressStore((s) => s.resetAll);
  const [confirming, setConfirming] = useState(false);

  function download() {
    const json = exportJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `language-matrix-progress-${date}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={download}
        className="px-4 py-2 rounded-md border border-zinc-200 dark:border-zinc-800 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900"
      >
        {t('exportJson')}
      </button>
      {confirming ? (
        <>
          <button
            type="button"
            onClick={() => {
              resetAll();
              setConfirming(false);
            }}
            className="px-4 py-2 rounded-md bg-red-600 text-white text-sm font-medium hover:bg-red-700"
          >
            {t('resetConfirm')}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="px-4 py-2 rounded-md border border-zinc-200 dark:border-zinc-800 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900"
          >
            {tCommon('cancel')}
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="px-4 py-2 rounded-md border border-red-300 dark:border-red-900 text-red-700 dark:text-red-300 text-sm hover:bg-red-50 dark:hover:bg-red-950/30"
        >
          {t('reset')}
        </button>
      )}
    </div>
  );
}
