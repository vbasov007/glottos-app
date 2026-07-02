'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AnswerInput } from './AnswerInput';
import { IssueList } from './IssueList';
import { InlineMarkdown } from './InlineMarkdown';
import { SpeakButton } from './SpeakButton';
import { speakableText } from '../lib/normalize';
import { useProgressStore, RANK_THRESHOLDS, type RankName } from '../lib/store';
import { capture } from '../lib/analytics';
import { recordActivity } from '../lib/activity';
import type { CourseSlug, Test, NativeLang, TargetLang } from '../lib/content-types';
import type { CheckResult } from '../lib/checker';

// Block-end test positions. German uses a 6-block curriculum with checkpoints
// at L8/18/25/35/46/50; every other target uses 5 blocks ending at
// L10/20/30/40/50. Tests at these positions are cumulative; passing one
// awards bonus activity points.
const BLOCK_END_DE = new Set([8, 18, 25, 35, 46, 50]);
const BLOCK_END_DEFAULT = new Set([10, 20, 30, 40, 50]);

const EMPTY_RANKS: readonly RankName[] = [];

interface Props {
  test: Test;
  course: CourseSlug;
  targetLang: TargetLang;
  nativeLang: NativeLang;
}

interface PerPromptState {
  given: string;
  result: CheckResult;
}

export function TestRunner({ test, course, targetLang, nativeLang }: Props) {
  const t = useTranslations('test');
  const courseKey = `${course}.${targetLang}.${nativeLang}` as const;
  const recordTestAnswer = useProgressStore((s) => s.recordTestAnswer);
  const recordTestAttempt = useProgressStore((s) => s.recordTestAttempt);
  const clearTestInProgress = useProgressStore((s) => s.clearTestInProgress);
  const claimRank = useProgressStore((s) => s.claimRank);
  // IMPORTANT: select a stable reference (the ranks array itself) — building a
  // Set inside the selector returns a fresh object on every render and triggers
  // "The result of getServerSnapshot should be cached" infinite-loop warning.
  const ranks = useProgressStore(
    (s) => s.courses[courseKey]?.ranks ?? EMPTY_RANKS,
  );
  const rankAlreadyClaimed = useMemo(() => new Set<RankName>(ranks), [ranks]);

  // Submitted answers are persisted to the store under tests[n].inProgress, so
  // they survive a page reload. We derive the local `results` map directly
  // from the store — no separate React state, no rehydration bugs.
  const inProgress = useProgressStore(
    (s) => s.courses[courseKey]?.tests[test.n]?.inProgress,
  );
  const results = useMemo<Record<number, PerPromptState>>(() => {
    if (!inProgress) return {};
    const out: Record<number, PerPromptState> = {};
    for (const [k, v] of Object.entries(inProgress.answers)) {
      out[Number(k)] = {
        given: v.given,
        result: { correct: v.correct, issues: v.issues, judgedBy: v.judgedBy },
      };
    }
    return out;
  }, [inProgress]);

  // Snapshot of per-prompt results taken at Finish time. The review screen
  // reads from this, NOT from `results` above — because `recordTestAttempt`
  // clears `inProgress` from the store, which would empty `results` and make
  // the review render every prompt as wrong with no "You typed" text.
  const [finished, setFinished] = useState<{
    score: number;
    results: Record<number, PerPromptState>;
  } | null>(null);

  const PER_PAGE_MOBILE = 10;
  const [page, setPage] = useState(0);
  const totalPages = Math.ceil(test.prompts.length / PER_PAGE_MOBILE);
  const visibleRange = useMemo(
    () => ({ start: page * PER_PAGE_MOBILE, end: (page + 1) * PER_PAGE_MOBILE }),
    [page],
  );

  const score = Object.values(results).filter((r) => r.result.correct).length;
  const completed = Object.keys(results).length;

  function handleFinish() {
    const perPrompt = test.prompts.map((_p, i) => {
      const r = results[i];
      return r
        ? {
            given: r.given,
            correct: r.result.correct,
            issues: r.result.issues,
            judgedBy: r.result.judgedBy,
          }
        : { given: '', correct: false, judgedBy: 'exact' as const };
    });
    const finalScore = perPrompt.filter((p) => p.correct).length;
    // Snapshot BEFORE recordTestAttempt — that call clears `inProgress`,
    // which would zero out the `results` map the review screen needs.
    setFinished({ score: finalScore, results: { ...results } });
    recordTestAttempt(courseKey, test.n, {
      startedAt: inProgress?.startedAt ?? new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      score: finalScore,
      perPrompt,
    });
    const passed = finalScore / test.prompts.length >= 0.8;
    capture('test_finished', {
      course_key: courseKey,
      target_lang: targetLang,
      native_lang: nativeLang,
      test_n: test.n,
      score: finalScore,
      total: test.prompts.length,
      passed,
    });
    // Bonus activity points for clearing a block-end checkpoint test.
    const blockEndSet = targetLang === 'de' ? BLOCK_END_DE : BLOCK_END_DEFAULT;
    if (passed && blockEndSet.has(test.n)) {
      recordActivity(courseKey, 'block_test_passed');
    }
  }

  const claimable = RANK_THRESHOLDS.find(
    (rt) => rt.testN === test.n && !rankAlreadyClaimed.has(rt.rank),
  );

  if (finished !== null) {
    const pct = Math.round((finished.score / test.prompts.length) * 100);
    const passed = pct >= 80;
    return (
      <div className="mt-6 space-y-6">
        <div
          className={`rounded-xl p-6 ${
            passed
              ? 'bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800'
              : 'bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800'
          }`}
        >
          <div className="text-xs uppercase tracking-wide text-zinc-500">{t('complete')}</div>
          <div className="mt-2 text-4xl font-bold tabular-nums">
            {finished.score} / {test.prompts.length}
          </div>
          <div className="mt-1 text-lg">
            {pct}% · {passed ? t('passed') : t('tryAgainToPass')}
          </div>
          {claimable && passed && (
            <button
              type="button"
              onClick={() => claimRank(courseKey, claimable.rank)}
              className="mt-4 inline-block px-5 py-2.5 rounded-md bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 font-semibold hover:bg-zinc-700 dark:hover:bg-zinc-300"
            >
              {t('claimRank')} {claimable.rank}
            </button>
          )}
        </div>

        <div>
          <h3 className="font-semibold mb-3">{t('review')}</h3>
          <div className="space-y-3">
            {test.prompts.map((p, i) => {
              const r = finished.results[i];
              const correct = r?.result.correct ?? false;
              if (correct) return null;
              return (
                <div
                  key={i}
                  className="rounded-md border border-red-200 dark:border-red-900/50 p-3 text-sm"
                >
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-mono text-zinc-500">{i + 1}.</span>
                    <span className="text-red-700 dark:text-red-300">{t('wrongLabel')}</span>
                  </div>
                  <div className="mt-1">
                    <span className="text-zinc-500">{t('promptLabel')}</span> {p.text}
                  </div>
                  {r && (
                    <div>
                      <span className="text-zinc-500">{t('youTypedLabel')}</span>{' '}
                      <span className="font-mono">{r.given}</span>
                    </div>
                  )}
                  <div className="flex items-baseline gap-1.5">
                    <SpeakButton
                      text={speakableText(test.answers[i]?.canonical ?? '')}
                      lang={targetLang}
                    />
                    <span className="text-zinc-500">{t('expectedLabel')}</span>
                    <InlineMarkdown
                      source={test.answers[i]?.canonical ?? ''}
                      className="font-mono"
                    />
                  </div>
                  {r?.result.issues && r.result.issues.length > 0 && (
                    <div className="mt-1.5">
                      <IssueList issues={r.result.issues} judgedBy={r.result.judgedBy} />
                    </div>
                  )}
                </div>
              );
            })}
            {finished.score === test.prompts.length && (
              <div className="text-sm text-zinc-500 italic">{t('noWrongAnswers')}</div>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            clearTestInProgress(courseKey, test.n);
            setFinished(null);
            setPage(0);
          }}
          className="px-4 py-2 rounded-md border border-zinc-200 dark:border-zinc-800 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900"
        >
          {t('tryAgain')}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-6">
      <div className="sticky top-14 z-10 -mx-4 px-4 py-2 bg-white/95 dark:bg-zinc-950/95 backdrop-blur border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">
            {completed} / {test.prompts.length} {t('answered')} · {score} {t('correctSoFar')}
          </span>
          <button
            type="button"
            onClick={handleFinish}
            disabled={completed === 0}
            className="px-3 py-1.5 rounded-md bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-medium hover:bg-zinc-700 dark:hover:bg-zinc-300 disabled:opacity-40"
          >
            {t('finish')}
          </button>
        </div>
        <div className="mt-1 h-1 w-full bg-zinc-200 dark:bg-zinc-800 rounded">
          <div
            className="h-1 bg-zinc-900 dark:bg-zinc-100 rounded transition-[width]"
            style={{ width: `${(completed / test.prompts.length) * 100}%` }}
          />
        </div>
      </div>

      <div className="space-y-4">
        {test.prompts.map((p, i) => {
          const inRange = i >= visibleRange.start && i < visibleRange.end;
          return (
            <div
              key={i}
              className={`rounded-md border border-zinc-200 dark:border-zinc-800 p-4 ${
                inRange ? '' : 'hidden lg:block'
              }`}
            >
              <div className="flex items-start gap-2 mb-2">
                <span className="font-mono text-xs text-zinc-500 mt-1">{i + 1}.</span>
                <span className="flex-1 min-w-0 break-words text-sm">{p.text}</span>
              </div>
              <AnswerInput
                canonical={test.answers[i]?.canonical ?? ''}
                alternates={test.answers[i]?.alternates ?? []}
                context={`${test.title}`}
                targetLang={targetLang}
                nativeLang={nativeLang}
                compact
                initialValue={results[i]?.given ?? ''}
                initialCorrect={results[i] ? results[i].result.correct : null}
                onResult={(result, given) => {
                  recordTestAnswer(courseKey, test.n, i, {
                    given,
                    correct: result.correct,
                    issues: result.issues,
                    judgedBy: result.judgedBy,
                  });
                  capture('test_prompt_attempted', {
                    course_key: courseKey,
                    target_lang: targetLang,
                    native_lang: nativeLang,
                    test_n: test.n,
                    prompt_index: i,
                    correct: result.correct,
                    judged_by: result.judgedBy,
                    given_length: given.length,
                  });
                }}
              />
            </div>
          );
        })}
      </div>

      <div className="lg:hidden flex items-center justify-between gap-3">
        <button
          type="button"
          disabled={page === 0}
          onClick={() => setPage((p) => Math.max(0, p - 1))}
          className="px-3 py-2 rounded-md border border-zinc-200 dark:border-zinc-800 text-sm disabled:opacity-40"
        >
          {t('pagePrev')}
        </button>
        <span className="text-xs text-zinc-500">
          {t('pageOf')} {page + 1} / {totalPages}
        </span>
        <button
          type="button"
          disabled={page >= totalPages - 1}
          onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
          className="px-3 py-2 rounded-md border border-zinc-200 dark:border-zinc-800 text-sm disabled:opacity-40"
        >
          {t('pageNext')}
        </button>
      </div>
    </div>
  );
}
