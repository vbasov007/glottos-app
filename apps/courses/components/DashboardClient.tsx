'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useProgressStore, RANK_THRESHOLDS, type RankName } from '../lib/store';
import type { CourseSlug, NativeLang, TargetLang } from '../lib/content-types';

interface Props {
  course: CourseSlug;
  targetLang: TargetLang;
  nativeLang: NativeLang;
  totalLessons: number;
  totalTests: number;
  totalTexts: number;
  totalDictionaryEntries: number;
}

export function DashboardClient({
  course,
  targetLang,
  nativeLang,
  totalLessons,
  totalTests,
  totalDictionaryEntries,
}: Props) {
  const t = useTranslations('dashboard');
  const tCommon = useTranslations('common');
  const courseKey = `${course}.${targetLang}.${nativeLang}` as const;
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  const courseState = useProgressStore((s) => s.courses[courseKey] ?? null);

  if (!hydrated) {
    return <div className="mt-6 text-sm text-zinc-500">{tCommon('loading')}</div>;
  }

  const lessonsCompleted = courseState
    ? Object.values(courseState.lessons).filter((l) => l.completedAt).length
    : 0;
  const lessonsStarted = courseState ? Object.keys(courseState.lessons).length : 0;
  const testsTaken = courseState ? Object.keys(courseState.tests).length : 0;
  const testsPassed = courseState
    ? Object.values(courseState.tests).filter((t) => t.best / 30 >= 0.8).length
    : 0;
  const wordsSeen = courseState?.seenWords.length ?? 0;
  const streak = courseState?.streak.currentDays ?? 0;
  const ranksClaimed = new Set<RankName>(courseState?.ranks ?? []);

  return (
    <div className="mt-6 space-y-8">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          label={t('stats.lessons')}
          value={`${lessonsCompleted} / ${totalLessons}`}
          subtitle={
            lessonsStarted > lessonsCompleted
              ? `${lessonsStarted - lessonsCompleted} ${t('stats.inProgress')}`
              : null
          }
        />
        <StatCard
          label={t('stats.testsPassed')}
          value={`${testsPassed} / ${totalTests}`}
          subtitle={testsTaken > 0 ? `${testsTaken} ${t('stats.attempted')}` : null}
        />
        <StatCard
          label={t('stats.dayStreak')}
          value={streak}
          subtitle={streak === 1 ? t('stats.keepGoing') : null}
        />
        <StatCard
          label={t('stats.wordsSeen')}
          value={wordsSeen}
          subtitle={`${t('stats.of')} ${totalDictionaryEntries.toLocaleString()}`}
        />
      </div>

      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 mb-3">
          {t('ranks')}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {RANK_THRESHOLDS.map((r) => {
            const claimed = ranksClaimed.has(r.rank);
            return (
              <div
                key={r.rank}
                className={`p-4 rounded-md border ${
                  claimed
                    ? 'border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800'
                    : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50/30 dark:bg-zinc-900/30'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="font-semibold">{r.rank}</div>
                  {claimed && <span className="text-amber-600 dark:text-amber-400">★</span>}
                </div>
                <div className="text-xs text-zinc-500 mt-1">
                  {t('rankUnlock')} {r.testN}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  subtitle,
}: {
  label: string;
  value: string | number;
  subtitle?: string | null;
}) {
  return (
    <div className="p-4 rounded-md border border-zinc-200 dark:border-zinc-800">
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      <div className="text-xs text-zinc-500 mt-1">{label}</div>
      {subtitle && <div className="text-xs text-zinc-400 mt-0.5">{subtitle}</div>}
    </div>
  );
}
