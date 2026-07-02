import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../lib/auth';
import { getPool } from '../../../../lib/db';
import { SCHEMA_SQL } from '../../../../lib/db-schema';

export const runtime = 'nodejs';

// Admin-only schema apply. Equivalent to running `npm run db:init` against
// the same DATABASE_URL, but available from the running runtime image (which
// doesn't include tsx or the scripts/ folder). Every statement in
// SCHEMA_SQL is CREATE … IF NOT EXISTS, so re-runs are safe.
export async function POST(req: Request): Promise<Response> {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const pool = getPool();
  try {
    await pool.query(SCHEMA_SQL);
  } catch (err) {
    const e = err as Error & { code?: string };
    return NextResponse.json(
      { error: 'schema_apply_failed', code: e.code, message: e.message },
      { status: 500 },
    );
  }

  const { rows } = await pool.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
  );
  return NextResponse.json({
    ok: true,
    tables: rows.map((r) => r.tablename),
  });
}
