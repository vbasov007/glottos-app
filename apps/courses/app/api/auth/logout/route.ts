import { NextResponse } from 'next/server';
import { getPool } from '../../../../lib/db';

export const runtime = 'nodejs';

export async function POST(req: Request): Promise<NextResponse> {
  const sessionId = req.headers.get('x-session-id');
  if (sessionId) {
    await getPool().query('DELETE FROM sessions WHERE session_id = $1', [sessionId]);
  }
  return NextResponse.json({ ok: true });
}
