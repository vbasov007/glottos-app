import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../lib/auth';
import { readTtsOverrides, writeTtsOverrides } from '../../../../lib/tts-settings';
import { TTS_DEFAULT, TTS_PROVIDERS, type TtsProviderId } from '../../../../lib/tts-providers';
import type { TargetLang } from '../../../../lib/content-types';

export const runtime = 'nodejs';

// GET: return current overrides + the full catalog so the admin UI can render
// all dropdowns without a second round-trip.
export async function GET(req: Request): Promise<Response> {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const overrides = await readTtsOverrides();
  return NextResponse.json({
    overrides,
    defaults: TTS_DEFAULT,
    providers: TTS_PROVIDERS,
  });
}

interface PutBody {
  overrides?: Partial<Record<TargetLang, { provider: TtsProviderId; voice: string }>>;
}

// PUT: replace the overrides map. tts-settings.writeTtsOverrides sanitizes
// unknown tuples before persisting.
export async function PUT(req: Request): Promise<Response> {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  let body: PutBody;
  try {
    body = (await req.json()) as PutBody;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  await writeTtsOverrides(body.overrides ?? {});
  const overrides = await readTtsOverrides();
  return NextResponse.json({ ok: true, overrides });
}
