'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { SpeakButton } from './SpeakButton';
import { CourseDictionaryInline } from './CourseDictionaryInline';
import { DictionaryEntryDetails } from './DictionaryEntryDetails';
import { capture } from '../lib/analytics';
import { openInTutor } from '../lib/open-in-tutor';
import type {
  DictionaryEntry,
  NativeLang,
  TargetLang,
  VocabRow,
} from '../lib/content-types';
import { genderColorClass } from '../lib/gender';

interface Props {
  vocab: VocabRow[];
  vocabCode?: string | null;
  targetLang: TargetLang;
  nativeLang: NativeLang;
  lessonN: number;
  /** Course-level dictionary entries for the embedded search box. */
  courseDictionary: DictionaryEntry[];
  /** lemma → first lesson where the term appears (German-only for now). */
  firstLessons: Record<string, number>;
}

export function VocabTab({
  vocab,
  vocabCode,
  targetLang,
  nativeLang,
  lessonN,
  courseDictionary,
  firstLessons,
}: Props) {
  const t = useTranslations('vocab');

  const hasGender = vocab.some((v) => v.gender);

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-lg font-semibold mb-3">{t('title')}</h2>

        {vocab.length === 0 ? (
          <div className="text-sm text-zinc-500 italic py-4">—</div>
        ) : (
          <div className="space-y-4">
            {vocabCode && (
              <a
                // href preserves the right-click "open in new tab" affordance
                // and graceful degradation when JS is off. The onClick path
                // is what runs in practice — it adds the SSO token to the
                // URL so text-tutor inherits the current user.
                href={`https://t.glottos.com/s/${vocabCode}`}
                target="_blank"
                rel="noopener noreferrer"
                title={t('openInGlottosTooltip')}
                onClick={(e) => {
                  e.preventDefault();
                  capture('glottos_vocab_opened', {
                    target_lang: targetLang,
                    lesson_n: lessonN,
                    vocab_code: vocabCode,
                  });
                  openInTutor('/s/' + vocabCode);
                }}
                className="flex flex-col gap-1 px-4 py-3 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40"
              >
                <span className="flex items-center justify-between gap-2 text-sm font-medium">
                  <span>{t('openInGlottos')}</span>
                  <span aria-hidden>↗</span>
                </span>
                <span className="text-xs opacity-80">{t('openInGlottosTooltip')}</span>
              </a>
            )}

            <div className="rounded-md border border-zinc-200 dark:border-zinc-800 overflow-hidden">
              {/* Mobile: stacked card per entry — German + gender on row 1,
                  translation on row 2 — so long Cyrillic words wrap at word
                  boundaries instead of mid-word in a narrow column. md+ uses
                  the original four-column table because real estate is fine. */}
              <ul className="md:hidden divide-y divide-zinc-100 dark:divide-zinc-800/60">
                {vocab.map((v, i) => (
                  <VocabMobileCard
                    key={i}
                    row={v}
                    targetLang={targetLang}
                    nativeLang={nativeLang}
                  />
                ))}
              </ul>
              <table className="hidden md:table w-full text-sm table-fixed">
                <thead className="bg-zinc-100 dark:bg-zinc-900">
                  <tr>
                    <th className="text-left py-1.5 px-2 sm:px-3 font-semibold border-b border-zinc-200 dark:border-zinc-800 w-1/2">
                      {t('german')}
                    </th>
                    {hasGender && (
                      <th className="text-left py-1.5 px-2 font-semibold border-b border-zinc-200 dark:border-zinc-800 w-10">
                        {t('gender')}
                      </th>
                    )}
                    <th className="text-left py-1.5 px-2 sm:px-3 font-semibold border-b border-zinc-200 dark:border-zinc-800">
                      {t('native')}
                    </th>
                    <th className="border-b border-zinc-200 dark:border-zinc-800 w-24" aria-hidden />
                  </tr>
                </thead>
                <tbody>
                  {vocab.map((v, i) => (
                    <VocabTableRow
                      key={i}
                      row={v}
                      hasGender={hasGender}
                      targetLang={targetLang}
                      nativeLang={nativeLang}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {courseDictionary.length > 0 && (
        <section className="pt-6 border-t border-zinc-200 dark:border-zinc-800">
          <h2 className="text-lg font-semibold mb-3">{t('courseDictionaryHeading')}</h2>
          <CourseDictionaryInline
            entries={courseDictionary}
            firstLessons={firstLessons}
            targetLang={targetLang}
            nativeLang={nativeLang}
          />
        </section>
      )}
    </div>
  );
}

// Row + collapsible details. Details mount lazily into a second tr that
// spans the full table width — keeps the table aligned and the panel readable.
function VocabTableRow({
  row,
  hasGender,
  targetLang,
  nativeLang,
}: {
  row: VocabRow;
  hasGender: boolean;
  targetLang: TargetLang;
  nativeLang: NativeLang;
}) {
  const td = useTranslations('dictionary.details');
  const [expanded, setExpanded] = useState(false);
  const colCount = hasGender ? 4 : 3;
  return (
    <>
      <tr className="border-b border-zinc-100 dark:border-zinc-800/60 last:border-0 align-top">
        <td className="py-1.5 px-2 sm:px-3 font-medium break-words">
          <div className="flex items-start gap-1.5">
            <SpeakButton text={row.german} lang={targetLang} />
            <span className={`min-w-0 break-words ${genderColorClass(row.gender)}`}>{row.german}</span>
          </div>
        </td>
        {hasGender && (
          <td className="py-1.5 px-2 font-mono text-xs text-zinc-500">{row.gender ?? ''}</td>
        )}
        <td className="py-1.5 px-2 sm:px-3 text-zinc-700 dark:text-zinc-300 break-words">
          {row.native}
        </td>
        <td className="py-1.5 px-2 text-right">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-label={expanded ? td('hide') : td('show')}
            title={expanded ? td('hide') : td('show')}
            className="text-xs inline-flex items-center justify-center gap-1 min-h-[32px] px-2.5 rounded border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:border-blue-400 dark:hover:border-blue-600 hover:text-blue-700 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors whitespace-nowrap"
          >
            <span>{td('button')}</span>
            <span aria-hidden>{expanded ? '▴' : '▾'}</span>
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-zinc-100 dark:border-zinc-800/60 last:border-0">
          <td colSpan={colCount} className="px-2 sm:px-3 pb-2">
            <DictionaryEntryDetails
              german={row.german}
              targetLang={targetLang}
              nativeLang={nativeLang}
            />
          </td>
        </tr>
      )}
    </>
  );
}

// Mobile-only stacked card. The narrow translation column was wrapping
// Cyrillic words character-by-character ("гол овн ая бол ь"); putting the
// translation on its own row under the target word lets it use the full
// row width and break at word boundaries.
function VocabMobileCard({
  row,
  targetLang,
  nativeLang,
}: {
  row: VocabRow;
  targetLang: TargetLang;
  nativeLang: NativeLang;
}) {
  const td = useTranslations('dictionary.details');
  const [expanded, setExpanded] = useState(false);
  return (
    <li className="px-2 sm:px-3 py-2.5">
      <div className="flex items-start gap-2">
        <SpeakButton text={row.german} lang={targetLang} />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className={`font-medium break-words ${genderColorClass(row.gender)}`}>{row.german}</span>
            {row.gender && (
              <span className="font-mono text-xs text-zinc-500 shrink-0">{row.gender}</span>
            )}
          </div>
          <div className="text-sm text-zinc-700 dark:text-zinc-300 break-words mt-0.5">
            {row.native}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={expanded ? td('hide') : td('show')}
          title={expanded ? td('hide') : td('show')}
          className="text-xs inline-flex items-center justify-center gap-1 min-w-[32px] min-h-[32px] px-2.5 rounded border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:border-blue-400 dark:hover:border-blue-600 hover:text-blue-700 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors whitespace-nowrap shrink-0"
        >
          <span aria-hidden>{expanded ? '▴' : '▾'}</span>
        </button>
      </div>
      {expanded && (
        <div className="mt-2">
          <DictionaryEntryDetails
            german={row.german}
            targetLang={targetLang}
            nativeLang={nativeLang}
          />
        </div>
      )}
    </li>
  );
}
