'use client';

import { withBase } from '../lib/api-base';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { AnswerInput } from './AnswerInput';
import { Spinner } from './Spinner';
import type { CourseSlug, NativeLang, TargetLang } from '../lib/content-types';

interface SimilarItem {
  prompt: string;
  canonical: string;
  alternates: string[];
}

interface Props {
  /** True iff the parent prompt has been solved correctly. The "one more
   *  like this" button only appears once the learner has fixed all errors
   *  on the original — chain-clicking before solving the example would
   *  produce items that don't actually anchor to a solved pattern. */
  parentSolved: boolean;
  /** The original prompt + canonical the chain branches off from. */
  example: { prompt: string; canonical: string };
  /** Lesson context plumbed through to the AI: course / lesson / langs. */
  course: CourseSlug;
  courseKey: string;
  lessonN: number;
  targetLang: TargetLang;
  nativeLang: NativeLang;
  /** Label for the AnswerInput's check-answer context tag. */
  context: string;
}

export function SimilarPromptChain({
  parentSolved,
  example,
  course,
  courseKey,
  lessonN,
  targetLang,
  nativeLang,
  context,
}: Props): React.ReactElement | null {
  const t = useTranslations('similarPrompt');
  const [items, setItems] = useState<SimilarItem[]>([]);
  const [solved, setSolved] = useState<boolean[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lastSolved = items.length === 0 ? parentSolved : (solved[items.length - 1] ?? false);
  const canGenerate = parentSolved && lastSolved && !loading;

  // Hide the whole chain entirely until the parent prompt is solved — keeps
  // the writing tab clean for unanswered prompts.
  if (!parentSolved && items.length === 0) return null;

  async function generate(): Promise<void> {
    if (!canGenerate) return;
    setLoading(true);
    setError(null);
    try {
      const existing = [example.prompt, ...items.map((it) => it.prompt)];
      const res = await fetch(withBase('/api/similar-prompt'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          course,
          courseKey,
          lessonN,
          nativeLang,
          example,
          existing,
        }),
      });
      if (!res.ok) {
        setError(t('error'));
        return;
      }
      const data = (await res.json()) as SimilarItem;
      setItems((arr) => [...arr, data]);
      setSolved((arr) => [...arr, false]);
    } catch {
      setError(t('error'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-3 space-y-3">
      {items.map((it, idx) => (
        <div
          key={idx}
          className="border-l-2 border-zinc-200 dark:border-zinc-800 pl-3 sm:pl-4"
        >
          <div className="flex items-start gap-2 text-sm mb-2">
            <span aria-hidden className="text-zinc-400 mt-0.5 select-none">
              ↳
            </span>
            <span className="flex-1 break-words min-w-0">{it.prompt}</span>
          </div>
          <div className="pl-5">
            <AnswerInput
              canonical={it.canonical}
              alternates={it.alternates}
              context={context}
              targetLang={targetLang}
              nativeLang={nativeLang}
              prompt={it.prompt}
              compact
              onResult={(r) => {
                setSolved((arr) => {
                  const next = [...arr];
                  next[idx] = r.correct;
                  return next;
                });
              }}
            />
          </div>
        </div>
      ))}
      <div className="flex items-center gap-3 pl-3 sm:pl-4">
        <button
          type="button"
          onClick={generate}
          disabled={!canGenerate}
          className={
            'inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ' +
            (canGenerate
              ? 'border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-900'
              : 'border-zinc-200 dark:border-zinc-800 text-zinc-400 cursor-not-allowed')
          }
        >
          {loading ? (
            <>
              <Spinner size={12} />
              <span>{t('generating')}</span>
            </>
          ) : (
            <>
              <span aria-hidden>↻</span>
              <span>{t('cta')}</span>
            </>
          )}
        </button>
        {error && <span className="text-xs text-red-600 dark:text-red-400">{error}</span>}
      </div>
    </div>
  );
}
