import { NextResponse } from 'next/server';
import { checkRateLimit, clientKey } from '../../../lib/rate-limit';
import { resolveTts, synthesize } from '../../../lib/tts-providers';
import { readTtsOverrides } from '../../../lib/tts-settings';
import { stripSpokenSymbols } from '../../../lib/normalize';
import type { TargetLang } from '../../../lib/content-types';

export const runtime = 'nodejs';

const MAX_LEN = 200;
const DEFAULT_TARGET: TargetLang = 'de';

export async function GET(req: Request): Promise<Response> {
  const rl = checkRateLimit(`tts:${clientKey(req)}`, 120);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'rate_limited' },
      { status: 429, headers: { 'retry-after': String(rl.retryAfterSec ?? 60) } },
    );
  }

  const url = new URL(req.url);
  // Drop symbols the voice would read aloud ("→", "✗", "∅"…). Central gate:
  // every TTS request lands here regardless of which component asked for it.
  const text = stripSpokenSymbols(url.searchParams.get('text') ?? '');
  if (!text) {
    return NextResponse.json({ error: 'missing_text' }, { status: 400 });
  }
  if (text.length > MAX_LEN) {
    return NextResponse.json({ error: 'text_too_long' }, { status: 400 });
  }

  // ?lang=<target>. Missing → German (backwards compat for any caller that
  // hasn't been updated). Unknown / unsupported → 404 so the SpeakButton can
  // distinguish "TTS not configured here" from "this target has no voice".
  const langParam = url.searchParams.get('lang')?.trim().toLowerCase();
  const target = (langParam ?? DEFAULT_TARGET) as TargetLang;

  const overrides = await readTtsOverrides();
  const resolved = resolveTts(target, overrides);
  if (!resolved) {
    return NextResponse.json({ error: 'unsupported_lang' }, { status: 404 });
  }

  const result = await synthesize({
    text,
    target,
    provider: resolved.provider,
    voice: resolved.voice,
    locale: resolved.locale,
  });
  if (!result.ok) {
    return NextResponse.json(result.error, {
      status: result.error.error === 'tts_not_configured' ? 503 : 502,
    });
  }
  return new Response(toBodyInit(result.audio), {
    headers: {
      'content-type': 'audio/mpeg',
      'cache-control': 'public, max-age=2592000, immutable',
      'content-length': String(result.audio.byteLength),
    },
  });
}

// BodyInit's TS type only permits `ArrayBuffer`, not `Uint8Array`/`Buffer`;
// runtime accepts both. Slice the underlying buffer view to satisfy TS.
function toBodyInit(buf: Uint8Array): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}
