import { NextResponse } from 'next/server';
import { requireAdmin } from '../../../../lib/auth';
import {
  TTS_PROVIDERS,
  isKnownVoice,
  synthesize,
  type TtsProviderId,
} from '../../../../lib/tts-providers';
import type { TargetLang } from '../../../../lib/content-types';

export const runtime = 'nodejs';

// Sample phrases per target — short, illustrative, recognizable.
const SAMPLES: Record<TargetLang, string> = {
  de: 'Guten Tag, wie geht es Ihnen?',
  fr: 'Bonjour, comment allez-vous ?',
  es: 'Hola, ¿cómo estás?',
  sr: 'Здраво, како си?',
  ka: 'გამარჯობა, როგორ ხარ?',
  he: 'שלום, מה שלומך?',
  en: 'Hello, how are you doing today?',
  it: 'Ciao, come stai oggi?',
};

interface TestQuery {
  target: TargetLang;
  provider: TtsProviderId;
  voice: string;
  text?: string;
}

// Test endpoint. Synthesizes a sample phrase (or admin-provided text) using
// the specified provider/voice without persisting anything. Used by the
// "Test" button next to each row in the admin TTS panel.
export async function GET(req: Request): Promise<Response> {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const url = new URL(req.url);
  const q: TestQuery = {
    target: url.searchParams.get('target') as TargetLang,
    provider: url.searchParams.get('provider') as TtsProviderId,
    voice: url.searchParams.get('voice') ?? '',
    text: url.searchParams.get('text') ?? undefined,
  };
  if (!q.target || !q.provider || !q.voice) {
    return NextResponse.json({ error: 'missing_params' }, { status: 400 });
  }
  if (!(q.provider in TTS_PROVIDERS)) {
    return NextResponse.json({ error: 'unknown_provider' }, { status: 400 });
  }
  if (!isKnownVoice(q.provider, q.target, q.voice)) {
    return NextResponse.json({ error: 'unknown_voice' }, { status: 400 });
  }
  const locale = TTS_PROVIDERS[q.provider].locales[q.target];
  if (!locale) {
    return NextResponse.json({ error: 'unsupported_target' }, { status: 400 });
  }

  const text = (q.text?.trim() || SAMPLES[q.target]).slice(0, 200);
  const result = await synthesize({
    text,
    target: q.target,
    provider: q.provider,
    voice: q.voice,
    locale,
  });
  if (!result.ok) {
    return NextResponse.json(result.error, {
      status: result.error.error === 'tts_not_configured' ? 503 : 502,
    });
  }
  const body = result.audio.buffer.slice(
    result.audio.byteOffset,
    result.audio.byteOffset + result.audio.byteLength,
  ) as ArrayBuffer;
  return new Response(body, {
    headers: {
      'content-type': 'audio/mpeg',
      'cache-control': 'no-store',
      'content-length': String(result.audio.byteLength),
    },
  });
}
