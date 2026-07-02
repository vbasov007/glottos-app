import { NextResponse } from 'next/server';
import { checkRateLimit, clientKey } from '../../../lib/rate-limit';

export const runtime = 'nodejs';

interface LogBody {
  level?: 'info' | 'warn' | 'error';
  tag?: string;
  msg?: string;
  data?: unknown;
  userAgent?: string;
  url?: string;
}

// Lightweight client-error sink. The browser POSTs structured events here and
// we re-emit them on stdout — DO's runtime log viewer picks them up alongside
// the server logs, giving us a unified timeline when diagnosing user-side
// failures we can't reproduce locally.
export async function POST(req: Request): Promise<NextResponse> {
  // Generous limit — failing flows might burst-log. Per-IP, 200/min.
  const rl = checkRateLimit(`log:${clientKey(req)}`, 200);
  if (!rl.allowed) return NextResponse.json({ ok: false }, { status: 429 });

  let body: LogBody = {};
  try {
    body = (await req.json()) as LogBody;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  const ip = clientKey(req);
  const ua = req.headers.get('user-agent') ?? body.userAgent ?? null;
  const level = body.level ?? 'info';
  const tag = body.tag ?? 'client';
  const msg = body.msg ?? '';
  const entry = {
    ts: new Date().toISOString(),
    ip,
    ua,
    url: body.url ?? null,
    tag,
    msg,
    data: body.data ?? null,
  };
  const out = `[${tag}] ${msg} ${JSON.stringify(entry)}`;
  if (level === 'error') console.error(out);
  else if (level === 'warn') console.warn(out);
  else console.log(out);

  return NextResponse.json({ ok: true });
}
