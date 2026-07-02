'use client';

import { apiFetch } from './api-client';

export type ActivityEvent =
  | 'exercise'
  | 'text_open'
  | 'block_test_passed'
  | 'lesson_complete';

/** Fire-and-forget activity ping. Used by:
 *   - AnswerInput on every check  → 'exercise'
 *   - AudioPractice / VocabTab on "open in glottos" → 'text_open'
 *   - TestRunner when a block-end test passes ≥80% → 'block_test_passed'
 *   - LessonInteractive on mark-complete → 'lesson_complete'
 *
 *  The server-side route normalises this into per-day point buckets that the
 *  course-page heatmap reads back. Calls are deliberately not awaited — they
 *  must never block the UI. Failures (no session, offline) are swallowed. */
export function recordActivity(courseKey: string, event: ActivityEvent, count = 1): void {
  if (typeof window === 'undefined') return;
  // Fire-and-forget; never throw into a click handler.
  void apiFetch('/api/progress/activity', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ courseKey, event, count }),
  }).catch(() => undefined);
}
