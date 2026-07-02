import { NextResponse } from 'next/server';
import { requireAuth } from '../../../../lib/auth';
import { getPool } from '../../../../lib/db';

export const runtime = 'nodejs';

// Activity event → server-side point bucket.
//
// POST: increments today's points for (user, courseKey) by `points`.
// GET:  returns the daily point totals for the last N days (default 84 ≈
//       12 weeks) for the heatmap on the course-home page.

const KNOWN_EVENTS = {
  exercise: 1,            // one line of an exercise answered
  text_open: 5,           // opened a listening text on glottos.com
  block_test_passed: 5,   // finished a block-end test with ≥80% correct
  lesson_complete: 10,    // marked a lesson complete
} as const;

type EventType = keyof typeof KNOWN_EVENTS;

interface PostBody {
  courseKey?: string;
  event?: EventType;
  // Optional multiplier — e.g. submitted 3 exercise answers in a batch.
  count?: number;
}

export async function POST(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (typeof body.courseKey !== 'string' || !body.event) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  const perPoint = KNOWN_EVENTS[body.event];
  if (!perPoint) {
    return NextResponse.json({ error: 'unknown_event' }, { status: 400 });
  }
  const count = Math.max(1, Math.min(50, body.count ?? 1));
  const points = perPoint * count;

  const pool = getPool();
  await pool.query(
    `INSERT INTO courses_daily_activity (user_id, course_key, day, points, updated_at)
       VALUES ($1, $2, (NOW() AT TIME ZONE 'UTC')::date, $3, NOW())
     ON CONFLICT (user_id, course_key, day)
       DO UPDATE SET points = courses_daily_activity.points + EXCLUDED.points,
                     updated_at = NOW()`,
    [auth.userId, body.courseKey, points],
  );
  return NextResponse.json({ ok: true, awarded: points });
}

export async function GET(req: Request): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const url = new URL(req.url);
  const courseKey = url.searchParams.get('course')?.trim();
  if (!courseKey) {
    return NextResponse.json({ error: 'missing_course' }, { status: 400 });
  }
  const days = Math.max(7, Math.min(365, parseInt(url.searchParams.get('days') ?? '84', 10) || 84));

  const pool = getPool();
  const { rows } = await pool.query<{ day: string; points: number }>(
    `SELECT to_char(day, 'YYYY-MM-DD') AS day, points
       FROM courses_daily_activity
      WHERE user_id = $1 AND course_key = $2
        AND day >= ((NOW() AT TIME ZONE 'UTC')::date - ($3::int - 1) * INTERVAL '1 day')
      ORDER BY day ASC`,
    [auth.userId, courseKey, days],
  );

  return NextResponse.json({
    days,
    entries: rows,
  });
}
