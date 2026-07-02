'use client';

import { withBase } from '../lib/api-base';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { WritingPractice } from './WritingPractice';
import { Spinner } from './Spinner';
import { useProgressStore } from '../lib/store';
import { capture } from '../lib/analytics';
import type { CourseSlug, Exercise, NativeLang, TargetLang } from '../lib/content-types';

const PER_LESSON_CAP = 5;

interface Props {
  course: CourseSlug;
  lessonN: number;
  lessonTitle: string;
  targetLang: TargetLang;
  nativeLang: NativeLang;
}

interface ApiResponse {
  exercise?: Exercise;
  error?: string;
}

export function MoreExercises({ course, lessonN, lessonTitle, targetLang, nativeLang }: Props) {
  const t = useTranslations('moreExercises');
  const courseKey = `${course}.${targetLang}.${nativeLang}` as const;
  const generated = useProgressStore(
    (s) => s.courses[courseKey]?.lessons[lessonN]?.generated ?? EMPTY,
  );
  const addGeneratedExercise = useProgressStore((s) => s.addGeneratedExercise);
  const removeGeneratedExercise = useProgressStore((s) => s.removeGeneratedExercise);
  const bumpGenerationDifficulty = useProgressStore((s) => s.bumpGenerationDifficulty);
  const currentDifficulty = useProgressStore(
    (s) => s.courses[courseKey]?.lessons[lessonN]?.generationDifficulty ?? 0,
  );

  const [loadingMode, setLoadingMode] = useState<'writing' | 'listening' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const atCap = generated.length >= PER_LESSON_CAP;
  const loading = loadingMode !== null;

  async function onGenerate(mode: 'writing' | 'listening') {
    if (loading || atCap) return;
    setLoadingMode(mode);
    setError(null);
    const difficulty = bumpGenerationDifficulty(courseKey, lessonN);
    try {
      const res = await fetch(withBase('/api/generate-exercise'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ course, courseKey, lessonN, nativeLang, mode, difficulty }),
      });
      const data = (await res.json().catch(() => ({}))) as ApiResponse;
      if (!res.ok || !data.exercise) {
        setError(t('error'));
        capture('more_exercise_generated', {
          course_key: courseKey,
          target_lang: targetLang,
          native_lang: nativeLang,
          lesson_n: lessonN,
          mode,
          difficulty,
          success: false,
        });
        return;
      }
      addGeneratedExercise(courseKey, lessonN, data.exercise);
      capture('more_exercise_generated', {
        course_key: courseKey,
        target_lang: targetLang,
        native_lang: nativeLang,
        lesson_n: lessonN,
        mode,
        difficulty,
        success: true,
        existing_count: generated.length,
      });
    } catch {
      setError(t('error'));
    } finally {
      setLoadingMode(null);
    }
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{t('intro')}</p>

      {generated.length > 0 && (
        <WritingPractice
          exercises={generated}
          lessonN={lessonN}
          lessonTitle={lessonTitle}
          course={course}
          targetLang={targetLang}
          nativeLang={nativeLang}
          hideIntro
          deleteLabel={t('delete')}
          onDelete={(slug) => {
            if (typeof window === 'undefined') return;
            if (window.confirm(t('confirmDelete'))) {
              removeGeneratedExercise(courseKey, lessonN, slug);
            }
          }}
        />
      )}

      <div className="flex flex-col items-start gap-2 pt-2">
        <div className="flex flex-wrap items-start gap-2">
          <button
            type="button"
            onClick={() => onGenerate('writing')}
            disabled={loading || atCap}
            className={
              'inline-flex items-center gap-2 px-5 py-3 rounded-md text-sm font-medium transition-colors ' +
              (atCap
                ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-500 cursor-not-allowed'
                : loadingMode === 'writing'
                  ? 'bg-zinc-300 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 cursor-wait'
                  : 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-300')
            }
          >
            {loadingMode === 'writing' ? (
              <>
                <Spinner size={16} />
                <span>{t('generating')}</span>
              </>
            ) : atCap ? (
              <span>{t('capReached')}</span>
            ) : (
              <span>
                <span aria-hidden>💡</span> {t('generateWritingCta')}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => onGenerate('listening')}
            disabled={loading || atCap}
            className={
              'inline-flex items-center gap-2 px-5 py-3 rounded-md text-sm font-medium transition-colors border ' +
              (atCap
                ? 'border-zinc-200 dark:border-zinc-800 text-zinc-500 cursor-not-allowed'
                : loadingMode === 'listening'
                  ? 'border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 cursor-wait'
                  : 'border-zinc-900 dark:border-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-900')
            }
          >
            {loadingMode === 'listening' ? (
              <>
                <Spinner size={16} />
                <span>{t('generating')}</span>
              </>
            ) : (
              <span>
                <span aria-hidden>🎧</span> {t('generateListeningCta')}
              </span>
            )}
          </button>
        </div>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <p className={`text-xs ${atCap ? 'text-amber-700 dark:text-amber-400 font-medium' : 'text-zinc-500'}`}>
          {t('counter', { n: generated.length, max: PER_LESSON_CAP })}
          {currentDifficulty > 0 && (
            <>
              {' · '}
              {t('difficulty', { level: currentDifficulty })}
            </>
          )}
        </p>
      </div>
    </div>
  );
}

const EMPTY: Exercise[] = [];
