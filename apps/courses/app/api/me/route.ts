import { NextResponse } from 'next/server';
import { requireAuth } from '../../../lib/auth';
import { getPool } from '../../../lib/db';

export const runtime = 'nodejs';

interface UserRow {
  email: string;
  name: string | null;
  picture: string | null;
  role: string;
}

export async function GET(req: Request): Promise<NextResponse> {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { rows } = await getPool().query<UserRow>(
    'SELECT email, name, picture, role FROM users WHERE id = $1',
    [auth.userId],
  );
  if (rows.length === 0) {
    return NextResponse.json({ error: 'user_not_found' }, { status: 404 });
  }
  return NextResponse.json({ user: rows[0] });
}
