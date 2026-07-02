'use client';

import { useTranslations } from 'next-intl';
import type { Issue, IssueCategory } from '../lib/checker';

interface Props {
  issues: Issue[] | undefined;
  /** Distinguishes a real AI verdict (show generic fallback when issues is
   *  empty/missing) from a network failure (show "couldn't check" hint). */
  judgedBy: 'exact' | 'claude';
}

const CATEGORY_TONE: Record<IssueCategory, string> = {
  spelling:
    'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  wrongWord:
    'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200',
  wordOrder:
    'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200',
  wordForm:
    'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200',
  missingWord:
    'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  syntax:
    'bg-slate-200 text-slate-800 dark:bg-slate-700/60 dark:text-slate-100',
};

export function IssueList({ issues, judgedBy }: Props): React.ReactElement | null {
  const t = useTranslations('lesson');
  if (issues && issues.length > 0) {
    return (
      <ul className="space-y-1.5 text-sm">
        {issues.map((iss, i) => (
          <li key={i} className="flex items-baseline gap-2 flex-wrap">
            <span
              className={
                'shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ' +
                CATEGORY_TONE[iss.category]
              }
            >
              {t(`issueCategories.${iss.category}`)}
            </span>
            <span className="font-mono font-medium text-zinc-800 dark:text-zinc-100">
              {iss.word}
            </span>
            <span className="text-zinc-700 dark:text-zinc-300">— {iss.comment}</span>
          </li>
        ))}
      </ul>
    );
  }
  // Wrong, but no structured issues: either local exact-mismatch (judgedBy=exact)
  // or network failure that dropped us back here.
  if (judgedBy === 'exact') {
    return (
      <div className="text-sm italic text-zinc-700 dark:text-zinc-300">
        {t('verdict.couldNotCheck')}
      </div>
    );
  }
  return null;
}
