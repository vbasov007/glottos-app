'use client';

import { useEffect, useState } from 'react';
import { useProgressStore } from '../lib/store';
import type { CourseSlug, NativeLang, TargetLang } from '../lib/content-types';

interface Props {
  course: CourseSlug;
  targetLang: TargetLang;
  nativeLang: NativeLang;
  lessonN: number;
}

export function LessonProgressDot({ course, targetLang, nativeLang, lessonN }: Props) {
  const courseKey = `${course}.${targetLang}.${nativeLang}` as const;
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const lesson = useProgressStore((s) => s.courses[courseKey]?.lessons[lessonN] ?? null);

  if (!hydrated) return <span className="inline-block w-2 h-2" />;

  let cls = 'bg-zinc-300 dark:bg-zinc-700'; // untouched
  if (lesson?.completedAt) cls = 'bg-green-500';
  else if (lesson?.startedAt) cls = 'bg-amber-400';

  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${cls}`}
      title={lesson?.completedAt ? 'Completed' : lesson?.startedAt ? 'In progress' : 'Not started'}
      aria-label={lesson?.completedAt ? 'Completed' : lesson?.startedAt ? 'In progress' : 'Not started'}
    />
  );
}

export function TestProgressBadge({
  course,
  targetLang,
  nativeLang,
  testN,
}: {
  course: CourseSlug;
  targetLang: TargetLang;
  nativeLang: NativeLang;
  testN: number;
}) {
  const courseKey = `${course}.${targetLang}.${nativeLang}` as const;
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const test = useProgressStore((s) => s.courses[courseKey]?.tests[testN] ?? null);
  if (!hydrated || !test) return null;
  const pct = Math.round((test.best / 30) * 100);
  const passed = pct >= 80;
  return (
    <span
      className={`ml-1 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${
        passed
          ? 'bg-green-100 dark:bg-green-950/40 text-green-700 dark:text-green-300'
          : 'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300'
      }`}
    >
      Best {pct}%
    </span>
  );
}
