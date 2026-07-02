'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import MiniSearch from 'minisearch';
import { useTranslations } from 'next-intl';
import { SpeakButton } from './SpeakButton';
import { DictionaryEntryDetails } from './DictionaryEntryDetails';
import type { DictionaryEntry, NativeLang, TargetLang } from '../lib/content-types';
import { genderColorClass } from '../lib/gender';

interface Props {
  entries: DictionaryEntry[];
  /** Letter-section anchor IDs available (for alphabet bar) */
  letters: string[];
  /** lemma → first lesson where it appears in course content (1..50). */
  firstLessons: Record<string, number>;
  targetLang: TargetLang;
  nativeLang: NativeLang;
}

export function DictionarySearch({ entries, letters, firstLessons, targetLang, nativeLang }: Props) {
  const t = useTranslations('dictionary');
  const td = useTranslations('dictionary.details');
  const targetIn = useTranslations('common')(`targetIn.${targetLang}`);
  const [query, setQuery] = useState('');
  // Active letter: when no query is typed, only this letter's entries render.
  // Rendering the full 3-4 K-entry alphabet at once was making the page slow
  // to scroll; require a deliberate letter pick or a search to surface words.
  const [activeLetter, setActiveLetter] = useState<string | null>(null);
  // Pinned snapshot of the search query at the moment the user clicked "Try
  // AI". We don't track `query` live for the AI lookup — the user may keep
  // typing afterward and that shouldn't refire the request.
  const [aiQuery, setAiQuery] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Honor an inbound URL hash like #letter-ש on first paint so deep links from
  // outside the page still work.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const m = window.location.hash.match(/^#letter-(.+)$/);
    if (m && letters.includes(m[1]!)) setActiveLetter(m[1]!);
  }, [letters]);

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

  // Keyboard "/" focuses the input
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Embed mode (dictionary opened as a modal via `g v` / `g d`): autofocus
  // the search box so the user can start typing immediately. Gated on the
  // server-rendered html[data-embed] attribute so a bookmark / direct
  // navigation to /dictionary doesn't steal focus.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (document.documentElement.dataset.embed !== 'true') return;
    // Brief tick so the parent's iframe.focus() lands first; otherwise the
    // input focuses inside an unfocused iframe and the caret is invisible.
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, []);

  const results = query.trim() ? mini.search(query, { fuzzy: 0.2, prefix: true }) : null;

  return (
    <div>
      {/* Search input */}
      <div className="sticky top-14 z-20 -mx-4 px-4 py-3 bg-white dark:bg-zinc-950 border-b border-zinc-200 dark:border-zinc-800">
        <input
          ref={inputRef}
          type="search"
          placeholder={t('searchPlaceholder', { target: targetIn })}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className="w-full px-4 py-2 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Alphabet bar — clicking a letter pins it as the active section so
          only that letter's entries render. Clicking the same letter again
          (or the × pill) clears the selection back to the empty state. */}
      {!query.trim() && (
        <nav className="my-4 flex flex-wrap gap-1 text-sm">
          {letters.map((l) => {
            const active = l === activeLetter;
            return (
              <button
                key={l}
                type="button"
                onClick={() => setActiveLetter(active ? null : l)}
                aria-pressed={active}
                className={
                  // Square-ish tap area (≥34×34) so a thumb hits the right
                  // letter on mobile. Compact A–Z grid still wraps cleanly.
                  'inline-flex items-center justify-center min-w-[34px] min-h-[34px] px-1 rounded font-mono transition-colors ' +
                  (active
                    ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900'
                    : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800')
                }
              >
                {l}
              </button>
            );
          })}
          {activeLetter && (
            <button
              type="button"
              onClick={() => setActiveLetter(null)}
              className="inline-flex items-center justify-center min-w-[34px] min-h-[34px] px-1 rounded font-mono text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 ml-1"
              title="Clear letter filter"
            >
              ×
            </button>
          )}
        </nav>
      )}

      {/* Results or full list */}
      {query.trim() ? (
        <div className="mt-4">
          <div className="flex items-center gap-3 mb-2 text-xs text-zinc-500">
            <span>{results?.length ?? 0} {t('matches')} "{query}"</span>
            <button
              type="button"
              onClick={() => setAiQuery(query.trim())}
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
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {results?.slice(0, 200).map((r) => (
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
        </div>
      ) : activeLetter ? (
        <LetterSection
          letter={activeLetter}
          entries={entries.filter((e) => e.letter === activeLetter)}
          firstLessons={firstLessons}
          targetLang={targetLang}
          nativeLang={nativeLang}
        />
      ) : (
        <p className="mt-8 text-sm text-zinc-500 dark:text-zinc-400 text-center">
          {t('pickLetterOrSearch')}
        </p>
      )}
    </div>
  );
}

function LetterSection({
  letter,
  entries,
  firstLessons,
  targetLang,
  nativeLang,
}: {
  letter: string;
  entries: DictionaryEntry[];
  firstLessons: Record<string, number>;
  targetLang: TargetLang;
  nativeLang: NativeLang;
}) {
  return (
    <section id={`letter-${letter}`} className="mt-4 scroll-mt-32">
      <h2 className="text-xl font-bold mb-2 sticky top-32 bg-white/95 dark:bg-zinc-950/95 backdrop-blur py-1 z-10">
        {letter}
      </h2>
      <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
        {entries.map((e, i) => (
          <EntryRow
            key={`${letter}-${i}`}
            entry={e}
            firstLesson={firstLessons[e.lemma]}
            targetLang={targetLang}
            nativeLang={nativeLang}
          />
        ))}
      </ul>
    </section>
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
      href={`/de/${nativeLang}/lesson/classic50/${firstLesson}`}
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
      {/* Mobile: speaker + German + gender + L# + ▾ on row 1, translation
          on row 2 — so long Cyrillic / Polish phrases break at word
          boundaries instead of mid-word in a narrow column. */}
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

      {/* Desktop: original six-column grid preserved — the column alignment
          is useful for scanning a long letter section. */}
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

// Panel rendered above the search results when the user clicks "Try AI" on
// a query that didn't match the local index. Owns its own close button; the
// `query` prop is pinned at click time so live typing doesn't refire.
export function TryAiPanel({
  query,
  onDismiss,
  targetLang,
  nativeLang,
}: {
  query: string;
  onDismiss: () => void;
  targetLang: TargetLang;
  nativeLang: NativeLang;
}) {
  return (
    <div className="relative mb-3 rounded-md border border-blue-200 dark:border-blue-900/50 bg-blue-50/40 dark:bg-blue-950/20 p-2 pr-7">
      <div className="text-xs text-zinc-600 dark:text-zinc-400 mb-1 pl-1">
        <span className="font-mono font-semibold">{query}</span>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Close"
        className="absolute top-1 right-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 px-1.5 leading-none text-lg"
      >
        ×
      </button>
      {/* key forces a fresh mount when the pinned query changes — otherwise
          DictionaryEntryDetails caches the first query for its lifetime. */}
      <DictionaryEntryDetails
        key={query}
        german={query}
        targetLang={targetLang}
        nativeLang={nativeLang}
      />
    </div>
  );
}

