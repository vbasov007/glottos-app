import { NextResponse } from 'next/server';
import { requireAuth } from '../../../../lib/auth';
import { getPool } from '../../../../lib/db';

export const runtime = 'nodejs';

// Returns every course slice the authenticated user has on the server.
// Used by the landing dashboard to seed the local progress store after a
// sign-in or fresh load — without this, the "Continue learning" card stays
// empty on the landing because the per-course ProgressSync component
// only runs inside the [target]/[native] layout, never at /.

interface CourseRow {
  course_key: string;
  state: unknown;
  updated_at: Date;
}

export async function GET(req: Request): Promise<NextResponse> {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { rows } = await getPool().query<CourseRow>(
    'SELECT course_key, state, updated_at FROM courses_progress WHERE user_id = $1',
    [auth.userId],
  );

  const courses: Record<string, { state: unknown; updatedAt: string }> = {};
  for (const r of rows) {
    courses[r.course_key] = {
      state: r.state,
      updatedAt: r.updated_at.toISOString(),
    };
  }
  return NextResponse.json({ courses });
}
