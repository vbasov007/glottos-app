'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { useProgressStore } from '../lib/store';
import { CEFR_LEVELS, type CefrBreakdown, type CefrEntry, type CefrLevel } from '../lib/cefr-types';
import { approximateLevel, cumulative, positionOnScale } from '../lib/cefr-progress';
import type { CourseSlug, NativeLang, TargetLang } from '../lib/content-types';

interface Props {
  perLesson: Record<number, CefrEntry>;
  course: CourseSlug;
  targetLang: TargetLang;
  nativeLang: NativeLang;
  labels: {
    vocabulary: string;
    grammar: string;
    completedNone: string;
  };
}

const LEVEL_TINT: Record<CefrLevel, string> = {
  A1: 'bg-emerald-500',
  A2: 'bg-teal-500',
  B1: 'bg-blue-500',
  B2: 'bg-violet-500',
  C1: 'bg-amber-500',
};

const EMPTY_LESSONS: Record<number, unknown> = {};

export function CefrProgressBars({ perLesson, course, targetLang, nativeLang, labels }: Props) {
  // Translate inside the component so the {level} interpolation goes through
  // next-intl with the concrete level value. Previously the dashboard called
  // tCefr('currentLevel') without supplying {level}, which threw
  // FORMATTING_ERROR and rendered the raw key text on screen.
  const tCefr = useTranslations('cefr');
  const courseKey = `${course}.${targetLang}.${nativeLang}` as const;
  const lessons = useProgressStore(
    (s) => s.courses[courseKey]?.lessons ?? EMPTY_LESSONS,
  );

  const completedNs = useMemo(
    () =>
      Object.entries(lessons)
        .filter(([, p]) => (p as { completedAt?: string }).completedAt)
        .map(([n]) => parseInt(n, 10))
        .filter((n) => Number.isFinite(n)),
    [lessons],
  );

  const totals = useMemo(() => cumulative(perLesson, completedNs), [perLesson, completedNs]);
  const vocabPos = positionOnScale(totals.vocabulary);
  const gramPos = positionOnScale(totals.grammar);
  const vocabLevel = approximateLevel(totals.vocabulary);
  const gramLevel = approximateLevel(totals.grammar);

  return (
    <div className="mt-3 space-y-3 rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/40 p-3">
      <Bar
        label={labels.vocabulary}
        position={vocabPos}
        levelLabel={tCefr('currentLevel', { level: vocabLevel })}
        breakdown={totals.vocabulary}
      />
      <Bar
        label={labels.grammar}
        position={gramPos}
        levelLabel={tCefr('currentLevel', { level: gramLevel })}
        breakdown={totals.grammar}
      />
      {completedNs.length === 0 && (
        <p className="text-xs italic text-zinc-500">{labels.completedNone}</p>
      )}
    </div>
  );
}

function Bar({
  label,
  position,
  levelLabel,
  breakdown,
}: {
  label: string;
  position: number;
  levelLabel: string;
  breakdown: CefrBreakdown;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">{label}</span>
        <span className="text-xs text-zinc-500 font-mono">
          {position.toFixed(0)}% · {levelLabel}
        </span>
      </div>

      {/* The track is 5 equal-width segments tinted by CEFR level. The fill is a
          single black/white overlay clipped to the current `position`. */}
      <div className="relative h-3 rounded-sm overflow-hidden border border-zinc-300 dark:border-zinc-700">
        <div className="absolute inset-0 flex">
          {CEFR_LEVELS.map((lvl) => (
            <div
              key={lvl}
              className={`flex-1 opacity-25 ${LEVEL_TINT[lvl]}`}
              title={`${lvl}: ${(breakdown[lvl] ?? 0).toFixed(0)}% of canon`}
            />
          ))}
        </div>
        <div
          className="absolute inset-y-0 left-0 flex"
          style={{ width: `${position}%` }}
        >
          {CEFR_LEVELS.map((lvl) => (
            <div key={lvl} className={`flex-1 ${LEVEL_TINT[lvl]}`} />
          ))}
        </div>
        {/* level boundary tick marks at 20/40/60/80 */}
        <div className="absolute inset-0 flex pointer-events-none">
          {CEFR_LEVELS.slice(0, -1).map((_, i) => (
            <div
              key={i}
              className="flex-1 border-r border-zinc-400/60 dark:border-zinc-600/60 last:border-0"
            />
          ))}
        </div>
      </div>
      <div className="mt-1 flex text-[10px] font-mono uppercase text-zinc-500 select-none">
        {CEFR_LEVELS.map((lvl) => (
          <div key={lvl} className="flex-1 text-center">
            {lvl}
          </div>
        ))}
      </div>
    </div>
  );
}
