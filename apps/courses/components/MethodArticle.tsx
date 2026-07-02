'use client';

import { useEffect, useState } from 'react';
import { MarkdownRenderer } from './MarkdownRenderer';
import { METHOD_ARTICLES } from '../lib/method-article';

type Lang = keyof typeof METHOD_ARTICLES;

const TABS: { key: Lang; label: string }[] = [
  { key: 'en', label: 'English' },
  { key: 'ru', label: 'Русский' },
  { key: 'pl', label: 'Polski' },
];

function detectBrowserLang(): Lang {
  if (typeof navigator === 'undefined') return 'en';
  const langs = (navigator.languages?.length ? navigator.languages : [navigator.language]) ?? [];
  for (const l of langs) {
    const head = l.slice(0, 2).toLowerCase();
    if (head === 'ru' || head === 'pl' || head === 'en') return head;
  }
  return 'en';
}

export function MethodArticle({ initialLang }: { initialLang?: Lang } = {}) {
  const [lang, setLang] = useState<Lang>('en');

  // When initialLang is provided (the landing page's native picker drives it),
  // follow that. Otherwise detect from the browser on first client render.
  useEffect(() => {
    if (initialLang) {
      setLang(initialLang);
      return;
    }
    const detected = detectBrowserLang();
    if (detected !== 'en') setLang(detected);
  }, [initialLang]);

  return (
    <section className="mt-14 pt-10 border-t border-zinc-200 dark:border-zinc-800">
      <div role="tablist" className="flex gap-1 mb-4 flex-wrap">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={lang === t.key}
            onClick={() => setLang(t.key)}
            className={
              'px-3 py-1.5 text-sm rounded-md border transition-colors ' +
              (lang === t.key
                ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 border-zinc-900 dark:border-zinc-100'
                : 'border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-900')
            }
          >
            {t.label}
          </button>
        ))}
      </div>
      <article className="prose prose-zinc dark:prose-invert max-w-none">
        <MarkdownRenderer source={METHOD_ARTICLES[lang]} />
      </article>
    </section>
  );
}
