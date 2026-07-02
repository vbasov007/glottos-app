'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import MiniSearch from 'minisearch';
import { SpeakButton } from './SpeakButton';
import { DictionaryEntryDetails } from './DictionaryEntryDetails';
import { TryAiPanel } from './DictionarySearch';
import type { DictionaryEntry, NativeLang, TargetLang } from '../lib/content-types';
import { genderColorClass } from '../lib/gender';

interface Props {
  entries: DictionaryEntry[];
  /** lemma → first lesson where the term appears (empty when not authored). */
  firstLessons: Record<string, number>;
  targetLang: TargetLang;
  nativeLang: NativeLang;
}

// Lightweight in-tab dictionary search. Unlike DictionarySearch (the full
// /dictionary page) this has no sticky header, no alphabet bar, and no
// full-list fallback when the query is empty — it's a search-only UI sized
// to live beneath the per-lesson vocab table.
export function CourseDictionaryInline({
  entries,
  firstLessons,
  targetLang,
  nativeLang,
}: Props) {
  const t = useTranslations('dictionary');
  const td = useTranslations('dictionary.details');
  const targetIn = useTranslations('common')(`targetIn.${targetLang}`);
  const [query, setQuery] = useState('');
  const [aiQuery, setAiQuery] = useState<string | null>(null);

  const mini = useMemo(() => {
    const ms = new MiniSearch<DictionaryEntry & { id: number }>({
      fields: ['german', 'lemma', 'native'],
      storeFields: ['german', 'gender', 'native', 'letter', 'lemma'],
      searchOptions: {
        boost: { lemma: 2, german: 1.5 },
        fuzzy: 0.2,
        prefix: true,
      },
    });
    ms.addAll(entries.map((e, i) => ({ ...e, id: i })));
    return ms;
  }, [entries]);

  const trimmed = query.trim();
  const results = trimmed ? mini.search(trimmed, { fuzzy: 0.2, prefix: true }) : null;

  return (
    <div>
      <input
        type="search"
        placeholder={t('searchPlaceholder', { target: targetIn })}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        className="w-full px-4 py-2 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      {results === null ? (
        <p className="mt-3 text-xs text-zinc-500 italic">
          {entries.length.toLocaleString()} {t('entriesLabel')}
        </p>
      ) : (
        <div className="mt-3">
          <div className="flex items-center gap-3 mb-2 text-xs text-zinc-500">
            <span>{results.length} {t('matches')} &quot;{trimmed}&quot;</span>
            <button
              type="button"
              onClick={() => setAiQuery(trimmed)}
              className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded border border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors whitespace-nowrap"
              title={td('tryAi')}
            >
              <span aria-hidden>✨</span>
              <span>{td('tryAi')}</span>
            </button>
          </div>
          {aiQuery && (
            <TryAiPanel
              query={aiQuery}
              onDismiss={() => setAiQuery(null)}
              targetLang={targetLang}
              nativeLang={nativeLang}
            />
          )}
          {results.length > 0 && (
            <ul className="divide-y divide-zinc-200 dark:divide-zinc-800 max-h-[60vh] overflow-y-auto">
              {results.slice(0, 100).map((r) => (
                <EntryRow
                  key={r.id}
                  entry={{
                    german: r.german,
                    gender: r.gender,
                    native: r.native,
                    letter: r.letter,
                    lemma: r.lemma,
                  }}
                  firstLesson={firstLessons[r.lemma]}
                  targetLang={targetLang}
                  nativeLang={nativeLang}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function EntryRow({
  entry,
  firstLesson,
  targetLang,
  nativeLang,
}: {
  entry: DictionaryEntry;
  firstLesson?: number;
  targetLang: TargetLang;
  nativeLang: NativeLang;
}) {
  const t = useTranslations('dictionary.details');
  const [expanded, setExpanded] = useState(false);
  const lessonChip = firstLesson ? (
    <Link
      href={`/${targetLang}/${nativeLang}/lesson/classic50/${firstLesson}`}
      className="text-xs font-mono text-zinc-500 hover:text-blue-600 dark:hover:text-blue-400 px-1.5 py-0.5 rounded border border-zinc-200 dark:border-zinc-800 hover:border-blue-300 dark:hover:border-blue-700"
      title={`First used in lesson ${firstLesson}`}
    >
      L{firstLesson}
    </Link>
  ) : null;
  const detailsToggle = (
    <button
      type="button"
      onClick={() => setExpanded((v) => !v)}
      aria-expanded={expanded}
      aria-label={expanded ? t('hide') : t('show')}
      title={expanded ? t('hide') : t('show')}
      className="text-xs inline-flex items-center justify-center gap-1 min-w-[32px] min-h-[32px] px-2.5 rounded border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:border-blue-400 dark:hover:border-blue-600 hover:text-blue-700 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors whitespace-nowrap shrink-0"
    >
      <span className="hidden sm:inline">{t('button')}</span>
      <span aria-hidden>{expanded ? '▴' : '▾'}</span>
    </button>
  );
  return (
    <li className="py-2 text-sm">
      {/* Same mobile-card pattern as VocabTab and the global Dictionary:
          German + gender + L# + ▾ on row 1, translation full-width on
          row 2, so the translation never wraps mid-word in a narrow
          column. */}
      <div className="md:hidden flex items-start gap-2">
        <SpeakButton text={entry.german} lang={targetLang} />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className={`font-medium break-words ${genderColorClass(entry.gender)}`}>{entry.german}</span>
            {entry.gender && (
              <span className="font-mono text-xs text-zinc-500 shrink-0">{entry.gender}</span>
            )}
            {lessonChip && <span className="shrink-0">{lessonChip}</span>}
          </div>
          <div className="text-zinc-700 dark:text-zinc-300 break-words mt-0.5">
            {entry.native}
          </div>
        </div>
        {detailsToggle}
      </div>

      <div className="hidden md:grid grid-cols-[auto_1fr_40px_1.2fr_auto_auto] gap-2 sm:gap-3 items-baseline">
        <SpeakButton text={entry.german} lang={targetLang} />
        <span className={`font-medium break-words min-w-0 ${genderColorClass(entry.gender)}`}>{entry.german}</span>
        <span className="text-xs text-zinc-500 font-mono">{entry.gender ?? ''}</span>
        <span className="text-zinc-700 dark:text-zinc-300 break-words min-w-0">{entry.native}</span>
        {firstLesson ? (
          <span className="self-center">{lessonChip}</span>
        ) : (
          <span className="text-xs text-zinc-300 dark:text-zinc-700 self-center px-1.5">—</span>
        )}
        <span className="self-center">{detailsToggle}</span>
      </div>

      {expanded && (
        <DictionaryEntryDetails
          german={entry.german}
          targetLang={targetLang}
          nativeLang={nativeLang}
        />
      )}
    </li>
  );
}
