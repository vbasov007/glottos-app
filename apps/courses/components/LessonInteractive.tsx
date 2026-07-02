'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useProgressStore } from '../lib/store';
import { capture } from '../lib/analytics';
import { recordActivity } from '../lib/activity';
import type { CourseSlug, NativeLang, TargetLang } from '../lib/content-types';

interface Props {
  course: CourseSlug;
  lessonN: number;
  targetLang: TargetLang;
  nativeLang: NativeLang;
}

export function LessonInteractive({ course, lessonN, targetLang, nativeLang }: Props) {
  const t = useTranslations('lesson');
  const courseKey = `${course}.${targetLang}.${nativeLang}` as const;
  const startLesson = useProgressStore((s) => s.startLesson);
  const completeLesson = useProgressStore((s) => s.completeLesson);
  const uncompleteLesson = useProgressStore((s) => s.uncompleteLesson);
  const lessonState = useProgressStore(
    (s) => s.courses[courseKey]?.lessons[lessonN] ?? null,
  );

  // Fire lesson_started only when the lesson is genuinely new — startLesson
  // itself is idempotent, but the analytics event should not be. Reading the
  // pre-state via getState() avoids a separate selector subscription.
  useEffect(() => {
    const alreadyStarted = !!useProgressStore.getState().courses[courseKey]?.lessons[lessonN];
    startLesson(courseKey, lessonN);
    if (!alreadyStarted) {
      capture('lesson_started', {
        course_key: courseKey,
        target_lang: targetLang,
        native_lang: nativeLang,
        lesson_n: lessonN,
      });
    }
  }, [courseKey, lessonN, startLesson, targetLang, nativeLang]);

  const isCompleted = !!lessonState?.completedAt;

  function handleComplete(): void {
    completeLesson(courseKey, lessonN);
    recordActivity(courseKey, 'lesson_complete');
    capture('lesson_completed', {
      course_key: courseKey,
      target_lang: targetLang,
      native_lang: nativeLang,
      lesson_n: lessonN,
    });
  }

  function handleUncomplete(): void {
    uncompleteLesson(courseKey, lessonN);
    capture('lesson_uncompleted', {
      course_key: courseKey,
      target_lang: targetLang,
      native_lang: nativeLang,
      lesson_n: lessonN,
    });
  }

  return (
    <div className="mt-10 flex items-center gap-3 pt-6 border-t border-zinc-200 dark:border-zinc-800">
      {isCompleted ? (
        <>
          <span className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-300 text-sm font-medium">
            {t('completed')}
          </span>
          <button
            type="button"
            onClick={handleUncomplete}
            className="text-xs text-zinc-500 hover:text-red-600 dark:hover:text-red-400 underline-offset-2 hover:underline"
          >
            {t('uncomplete')}
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={handleComplete}
          className="px-4 py-2 rounded-md bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 font-medium hover:bg-zinc-700 dark:hover:bg-zinc-300"
        >
          {t('markComplete')}
        </button>
      )}
    </div>
  );
}
