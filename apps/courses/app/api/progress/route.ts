import { NextResponse } from 'next/server';
import { requireAuth } from '../../../lib/auth';
import { getPool } from '../../../lib/db';

export const runtime = 'nodejs';

// course.target.native — 3 parts. Course slug allows digits (classic50, losreden50).
// Accept legacy 2-part keys too so an old client mid-migration isn't rejected;
// they'll be normalized client-side on next hydration.
const COURSE_KEY_PATTERN = /^[a-z0-9_-]{3,32}\.[a-z]{2,8}\.[a-z]{2,8}$|^[a-z]{2,8}\.[a-z]{2,8}$/;

export async function GET(req: Request): Promise<NextResponse> {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const courseKey = new URL(req.url).searchParams.get('courseKey');
  if (!courseKey || !COURSE_KEY_PATTERN.test(courseKey)) {
    return NextResponse.json({ error: 'bad_course_key' }, { status: 400 });
  }

  const { rows } = await getPool().query<{ state: unknown; updated_at: Date }>(
    'SELECT state, updated_at FROM courses_progress WHERE user_id = $1 AND course_key = $2',
    [auth.userId, courseKey],
  );
  if (rows.length === 0) {
    return NextResponse.json({ state: null });
  }
  return NextResponse.json({ state: rows[0]!.state, updatedAt: rows[0]!.updated_at });
}

export async function PUT(req: Request): Promise<NextResponse> {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  let body: { courseKey?: unknown; state?: unknown };
  try {
    body = (await req.json()) as { courseKey?: unknown; state?: unknown };
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (typeof body.courseKey !== 'string' || !COURSE_KEY_PATTERN.test(body.courseKey)) {
    return NextResponse.json({ error: 'bad_course_key' }, { status: 400 });
  }
  if (body.state === null || typeof body.state !== 'object') {
    return NextResponse.json({ error: 'bad_state' }, { status: 400 });
  }
  // Soft cap: serialized state must stay under ~1 MB to keep DB rows lean.
  const serialized = JSON.stringify(body.state);
  if (serialized.length > 1_048_576) {
    return NextResponse.json({ error: 'state_too_large' }, { status: 413 });
  }

  await getPool().query(
    `INSERT INTO courses_progress (user_id, course_key, state, updated_at)
     VALUES ($1, $2, $3::jsonb, NOW())
     ON CONFLICT (user_id, course_key) DO UPDATE
       SET state = EXCLUDED.state,
           updated_at = NOW()`,
    [auth.userId, body.courseKey, serialized],
  );
  return NextResponse.json({ ok: true });
}
