'use client';

import { withBase } from '../lib/api-base';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { SpeakButton } from './SpeakButton';
import { Spinner } from './Spinner';
import type { NativeLang, TargetLang, Exercise } from '../lib/content-types';

interface Props {
  exercise: Pick<Exercise, 'heading' | 'instruction' | 'bodyMarkdown' | 'prompts'>;
  targetLang: TargetLang;
  nativeLang: NativeLang;
  lessonN: number;
}

interface SampleResponse {
  sentences: string[];
  error?: string;
}

/**
 * Reveal panel for open-ended exercises that have no canonical answer in the
 * lesson source. On first click, POSTs the exercise body to
 * /api/open-ended-sample; the endpoint returns target-language sentences the
 * learner can hear (via Google TTS) and use as a self-check.
 *
 * Lazy: nothing is fetched until the user actually wants the sample, so
 * scrolling past dozens of open-ended exercises on a lesson page costs zero
 * model calls.
 *
 * Cached per (exercise body, target, native) by the server, so re-opening on
 * a future visit doesn't re-mint.
 */
export function OpenEndedSample({ exercise, targetLang, nativeLang, lessonN }: Props) {
  const t = useTranslations('openEndedSample');
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentences, setSentences] = useState<string[] | null>(null);

  async function reveal(): Promise<void> {
    if (sentences != null) {
      setOpen(true);
      return;
    }
    setPending(true);
    setError(null);
    try {
      const res = await fetch(withBase('/api/open-ended-sample'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          targetLang,
          nativeLang,
          lessonN,
          heading: exercise.heading,
          instruction: exercise.instruction,
          body: exercise.bodyMarkdown ?? '',
          prompts: exercise.prompts.map((p) => p.text),
        }),
      });
      if (!res.ok) {
        setError(t('error'));
        return;
      }
      const data = (await res.json()) as SampleResponse;
      setSentences(data.sentences ?? []);
      setOpen(true);
    } catch {
      setError(t('error'));
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <div className="mt-4">
        <button
          type="button"
          onClick={reveal}
          disabled={pending}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40 text-sm font-medium"
        >
          {pending ? (
            <>
              <Spinner size={14} />
              <span>{t('loading')}</span>
            </>
          ) : (
            <>
              <span aria-hidden>🔊</span>
              <span>{t('reveal')}</span>
            </>
          )}
        </button>
        {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
      </div>
    );
  }

  // Empty sample: the body was too thin for the model to produce anything.
  // Show the same italicised "say it aloud and move on" hint we use for
  // body-less exercises in WritingPractice — the panel still acknowledges
  // the click happened without leaving a dead button on screen.
  if (sentences == null || sentences.length === 0) {
    return (
      <div className="mt-4 text-xs italic text-zinc-500">{t('empty')}</div>
    );
  }

  return (
    <div className="mt-4 rounded-md border border-amber-200 dark:border-amber-900/50 bg-amber-50/40 dark:bg-amber-950/20 p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400 mb-2">
        {t('heading')}
      </div>
      <ul className="space-y-1.5">
        {sentences.map((s, i) => (
          <li key={i} className="flex items-baseline gap-2 text-sm">
            <SpeakButton text={s} lang={targetLang} />
            <span className="break-words min-w-0">{s}</span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="mt-2 text-xs text-amber-700 dark:text-amber-400 hover:underline"
      >
        {t('hide')}
      </button>
    </div>
  );
}
