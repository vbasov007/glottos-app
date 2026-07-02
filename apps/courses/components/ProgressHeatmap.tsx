'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api-client';
import { useSession } from './SessionProvider';

interface Entry {
  day: string; // YYYY-MM-DD
  points: number;
}

interface Props {
  courseKey: string;
  /** Number of days to show. Default 84 = 12 weeks. */
  days?: number;
}

// Course-page activity heatmap.
//
// Renders a GitHub-style grid: weeks horizontally (Mon–Sun rows), each cell
// shaded by the day's activity points normalised against the user's median
// non-zero day. Visible only to signed-in users; for anonymous browsers we
// don't even hit the API (the route would 401 anyway).
//
// Scoring lives on the server: 1pt per exercise answered, 5pt per listening
// text opened, 10pt per lesson completed. The heatmap reads back daily
// totals and decides the color bucket per cell.
export function ProgressHeatmap({ courseKey, days = 84 }: Props) {
  const { user, ready } = useSession();
  const [data, setData] = useState<Map<string, number> | null>(null);
  const [median, setMedian] = useState(1);

  useEffect(() => {
    if (!ready || !user) return;
    let cancelled = false;
    void apiFetch<{ entries: Entry[] }>(
      `/api/progress/activity?course=${encodeURIComponent(courseKey)}&days=${days}`,
    ).then((r) => {
      if (cancelled || !r.ok || !r.data) return;
      const map = new Map<string, number>();
      for (const e of r.data.entries) map.set(e.day, e.points);
      setData(map);
      // Median of positive days. Falls back to 1 when there's no activity yet
      // so the very first +1 lights up as the deepest color rather than the
      // lightest.
      const positives = r.data.entries
        .map((e) => e.points)
        .filter((p) => p > 0)
        .sort((a, b) => a - b);
      if (positives.length > 0) {
        setMedian(positives[Math.floor(positives.length / 2)] ?? 1);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [ready, user, courseKey, days]);

  if (!ready || !user) return null;

  const weeks = buildWeeks(days);

  return (
    <section className="mt-6">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 mb-3">
        Your activity
      </h3>
      <div className="overflow-x-auto pb-2">
        {/* Single grid: row 1 = ISO week labels, rows 2-8 = day cells. One
            grid means the label and its 7 days share a column by construction
            — no separate-container alignment drift. */}
        <div
          className="inline-grid gap-[3px]"
          style={{
            gridTemplateRows: '12px repeat(7, 12px)',
            gridAutoFlow: 'column',
            gridAutoColumns: '12px',
          }}
        >
          {weeks.flatMap((wk, wi) => [
            <div
              key={`hdr-${wi}`}
              className="text-[9px] leading-[12px] text-zinc-400 text-center tabular-nums overflow-visible"
              title={`Week ${wk.weekNumber}`}
            >
              {wk.weekNumber}
            </div>,
            ...wk.days.map((d, di) =>
              d === null ? (
                <div key={`b-${wi}-${di}`} className="w-3 h-3" />
              ) : (
                <div
                  key={d.iso}
                  title={`${d.iso} · ${data?.get(d.iso) ?? 0} pt${(data?.get(d.iso) ?? 0) === 1 ? '' : 's'}`}
                  className={`w-3 h-3 rounded-sm ${colorBucket(data?.get(d.iso) ?? 0, median)}`}
                />
              ),
            ),
          ])}
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs text-zinc-500">
        <span>Less</span>
        <span className={`w-3 h-3 rounded-sm ${BUCKET_CLASSES[0]}`} />
        <span className={`w-3 h-3 rounded-sm ${BUCKET_CLASSES[1]}`} />
        <span className={`w-3 h-3 rounded-sm ${BUCKET_CLASSES[2]}`} />
        <span className={`w-3 h-3 rounded-sm ${BUCKET_CLASSES[3]}`} />
        <span className={`w-3 h-3 rounded-sm ${BUCKET_CLASSES[4]}`} />
        <span>More</span>
      </div>
    </section>
  );
}

const BUCKET_CLASSES = [
  'bg-zinc-100 dark:bg-zinc-900',
  'bg-blue-200 dark:bg-blue-900/70',
  'bg-blue-400 dark:bg-blue-700',
  'bg-blue-600 dark:bg-blue-500',
  'bg-blue-800 dark:bg-blue-300',
] as const;

// Pick a bucket 0..4. 0 = no activity. The other four are quartile-ish
// thresholds against the user's own median: <0.5×, <1×, <2×, ≥2×.
function colorBucket(points: number, median: number): string {
  if (points <= 0) return BUCKET_CLASSES[0];
  const ratio = points / Math.max(1, median);
  if (ratio < 0.5) return BUCKET_CLASSES[1];
  if (ratio < 1.0) return BUCKET_CLASSES[2];
  if (ratio < 2.0) return BUCKET_CLASSES[3];
  return BUCKET_CLASSES[4];
}

interface DayCell {
  iso: string;
}

interface WeekColumn {
  weekNumber: number;
  // Always 7 entries. Mon..Sun. `null` for slots outside the displayed
  // window (leading blanks in the oldest column, trailing blanks in the
  // newest column).
  days: (DayCell | null)[];
}

// Build the column-by-column structure for the heatmap: the last `days`
// calendar days bucketed into Mon-anchored weeks, oldest week first.
function buildWeeks(days: number): WeekColumn[] {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const firstDayDate = new Date(today);
  firstDayDate.setUTCDate(firstDayDate.getUTCDate() - (days - 1));

  const leadingBlanks = mondayAnchoredWeekday(firstDayDate.getUTCDay());
  const trailingBlanks = 6 - mondayAnchoredWeekday(today.getUTCDay());
  const totalSlots = leadingBlanks + days + trailingBlanks;
  const totalColumns = totalSlots / 7;

  const firstMonday = new Date(firstDayDate);
  firstMonday.setUTCDate(firstMonday.getUTCDate() - leadingBlanks);

  const out: WeekColumn[] = [];
  for (let w = 0; w < totalColumns; w++) {
    const monday = new Date(firstMonday);
    monday.setUTCDate(monday.getUTCDate() + w * 7);
    const week: WeekColumn = { weekNumber: getISOWeek(monday), days: [] };
    for (let d = 0; d < 7; d++) {
      const day = new Date(monday);
      day.setUTCDate(day.getUTCDate() + d);
      // Out-of-window check: before firstDayDate or after today.
      if (day < firstDayDate || day > today) {
        week.days.push(null);
      } else {
        week.days.push({ iso: day.toISOString().slice(0, 10) });
      }
    }
    out.push(week);
  }
  return out;
}

// JS getUTCDay(): Sun=0, Mon=1, ..., Sat=6. We want Mon=0..Sun=6 so the grid
// rows align with the more common week layout in language-learning apps.
function mondayAnchoredWeekday(jsDay: number): number {
  return (jsDay + 6) % 7;
}

// ISO-8601 week number (1..53). Week 1 is the week containing the first
// Thursday of the year.
function getISOWeek(date: Date): number {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setUTCMonth(0, 1);
  if (target.getUTCDay() !== 4) {
    target.setUTCMonth(0, 1 + ((4 - target.getUTCDay()) + 7) % 7);
  }
  return 1 + Math.round((firstThursday - target.valueOf()) / 604800000);
}
