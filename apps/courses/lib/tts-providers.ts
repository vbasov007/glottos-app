// TTS provider abstraction. Two providers ship today:
// - google: Google Cloud Text-to-Speech (existing)
// - azure:  Microsoft Azure Cognitive Services Speech
//
// Each provider offers a curated voice list per target language and a
// synthesize() that returns an MP3 buffer. The /api/tts route picks the
// provider+voice per target from the admin-controlled settings table,
// falling back to the per-target defaults declared here.

import type { TargetLang } from './content-types';

export type TtsProviderId = 'google' | 'azure';

export interface VoiceOption {
  /** Provider-specific voice name (e.g. "de-DE-Standard-B", "de-DE-KatjaNeural"). */
  id: string;
  /** Human-friendly label shown in the admin picker. */
  label: string;
  /** Gender — informational only; used to group voices in the picker. */
  gender: 'male' | 'female' | 'neutral';
}

export interface ProviderInfo {
  id: TtsProviderId;
  label: string;
  /** Per-target voice catalog. `null` means the provider has no coverage for
   *  that target — admin UI hides the option. */
  voices: Record<TargetLang, VoiceOption[] | null>;
  /** BCP-47 locale per target (provider-specific dialect choice). */
  locales: Record<TargetLang, string | null>;
}

// ---- Google catalog --------------------------------------------------------
// Curated subset. The full Google voice list has hundreds of entries; these
// are the ones with reasonable quality in each target. Wavenet > Standard >
// Neural2 in cost but also generally in quality.
const GOOGLE: ProviderInfo = {
  id: 'google',
  label: 'Google Cloud TTS',
  locales: {
    de: 'de-DE',
    fr: 'fr-FR',
    es: 'es-ES',
    sr: null,
    ka: null,
    he: 'he-IL',
    en: 'en-US',
    it: 'it-IT',
  },
  voices: {
    de: [
      { id: 'de-DE-Standard-B', label: 'Standard · Male B',   gender: 'male' },
      { id: 'de-DE-Standard-A', label: 'Standard · Female A', gender: 'female' },
      { id: 'de-DE-Standard-F', label: 'Standard · Female F', gender: 'female' },
      { id: 'de-DE-Wavenet-B',  label: 'Wavenet · Male B',    gender: 'male' },
      { id: 'de-DE-Wavenet-C',  label: 'Wavenet · Female C',  gender: 'female' },
    ],
    fr: [
      { id: 'fr-FR-Standard-B', label: 'Standard · Male B',   gender: 'male' },
      { id: 'fr-FR-Standard-A', label: 'Standard · Female A', gender: 'female' },
      { id: 'fr-FR-Wavenet-B',  label: 'Wavenet · Male B',    gender: 'male' },
      { id: 'fr-FR-Wavenet-C',  label: 'Wavenet · Female C',  gender: 'female' },
    ],
    es: [
      { id: 'es-ES-Standard-B', label: 'Standard · Male B',   gender: 'male' },
      { id: 'es-ES-Standard-A', label: 'Standard · Female A', gender: 'female' },
      { id: 'es-ES-Wavenet-B',  label: 'Wavenet · Male B',    gender: 'male' },
      { id: 'es-ES-Wavenet-C',  label: 'Wavenet · Female C',  gender: 'female' },
    ],
    sr: null, // Google has no Serbian voice
    ka: null, // Google has no Georgian voice
    he: [
      { id: 'he-IL-Standard-B', label: 'Standard · Male B',   gender: 'male' },
      { id: 'he-IL-Standard-A', label: 'Standard · Female A', gender: 'female' },
      { id: 'he-IL-Wavenet-B',  label: 'Wavenet · Male B',    gender: 'male' },
      { id: 'he-IL-Wavenet-C',  label: 'Wavenet · Female C',  gender: 'female' },
    ],
    en: [
      { id: 'en-US-Standard-B', label: 'US Standard · Male B',   gender: 'male' },
      { id: 'en-US-Standard-C', label: 'US Standard · Female C', gender: 'female' },
      { id: 'en-US-Wavenet-D',  label: 'US Wavenet · Male D',    gender: 'male' },
      { id: 'en-US-Wavenet-F',  label: 'US Wavenet · Female F',  gender: 'female' },
      { id: 'en-GB-Standard-B', label: 'UK Standard · Male B',   gender: 'male' },
      { id: 'en-GB-Standard-A', label: 'UK Standard · Female A', gender: 'female' },
      { id: 'en-GB-Wavenet-B',  label: 'UK Wavenet · Male B',    gender: 'male' },
      { id: 'en-GB-Wavenet-A',  label: 'UK Wavenet · Female A',  gender: 'female' },
    ],
    it: [
      { id: 'it-IT-Standard-B', label: 'Standard · Male B',   gender: 'male' },
      { id: 'it-IT-Standard-A', label: 'Standard · Female A', gender: 'female' },
      { id: 'it-IT-Wavenet-B',  label: 'Wavenet · Male B',    gender: 'male' },
      { id: 'it-IT-Wavenet-C',  label: 'Wavenet · Female C',  gender: 'female' },
    ],
  },
};

// ---- Azure catalog ---------------------------------------------------------
// All Neural voices (Azure standard tier is being deprecated). Coverage is
// broader than Google: Serbian and Georgian both have voices.
const AZURE: ProviderInfo = {
  id: 'azure',
  label: 'Microsoft Azure TTS',
  locales: {
    de: 'de-DE',
    fr: 'fr-FR',
    es: 'es-ES',
    sr: 'sr-RS',
    ka: 'ka-GE',
    he: 'he-IL',
    en: 'en-US',
    it: 'it-IT',
  },
  voices: {
    de: [
      { id: 'de-DE-ConradNeural', label: 'Conrad · Male',      gender: 'male' },
      { id: 'de-DE-KillianNeural', label: 'Killian · Male',    gender: 'male' },
      { id: 'de-DE-KatjaNeural',  label: 'Katja · Female',     gender: 'female' },
      { id: 'de-DE-AmalaNeural',  label: 'Amala · Female',     gender: 'female' },
    ],
    fr: [
      { id: 'fr-FR-HenriNeural',  label: 'Henri · Male',       gender: 'male' },
      { id: 'fr-FR-DeniseNeural', label: 'Denise · Female',    gender: 'female' },
      { id: 'fr-FR-EloiseNeural', label: 'Eloise · Female',    gender: 'female' },
    ],
    es: [
      { id: 'es-ES-AlvaroNeural',  label: 'Álvaro · Male',     gender: 'male' },
      { id: 'es-ES-ElviraNeural',  label: 'Elvira · Female',   gender: 'female' },
      { id: 'es-ES-XimenaNeural',  label: 'Ximena · Female',   gender: 'female' },
    ],
    sr: [
      { id: 'sr-RS-NicholasNeural', label: 'Nicholas · Male',  gender: 'male' },
      { id: 'sr-RS-SophieNeural',   label: 'Sophie · Female',  gender: 'female' },
    ],
    ka: [
      { id: 'ka-GE-GiorgiNeural', label: 'Giorgi · Male',      gender: 'male' },
      { id: 'ka-GE-EkaNeural',    label: 'Eka · Female',       gender: 'female' },
    ],
    he: [
      { id: 'he-IL-AvriNeural',  label: 'Avri · Male',         gender: 'male' },
      { id: 'he-IL-HilaNeural',  label: 'Hila · Female',       gender: 'female' },
    ],
    en: [
      { id: 'en-US-AndrewNeural', label: 'US Andrew · Male',   gender: 'male' },
      { id: 'en-US-AvaNeural',    label: 'US Ava · Female',    gender: 'female' },
      { id: 'en-GB-RyanNeural',   label: 'UK Ryan · Male',     gender: 'male' },
      { id: 'en-GB-SoniaNeural',  label: 'UK Sonia · Female',  gender: 'female' },
    ],
    it: [
      { id: 'it-IT-DiegoNeural',    label: 'Diego · Male',     gender: 'male' },
      { id: 'it-IT-ElsaNeural',     label: 'Elsa · Female',    gender: 'female' },
      { id: 'it-IT-IsabellaNeural', label: 'Isabella · Female', gender: 'female' },
    ],
  },
};

export const TTS_PROVIDERS: Record<TtsProviderId, ProviderInfo> = {
  google: GOOGLE,
  azure: AZURE,
};

// Hard-coded defaults (per target). Picked to match the old TTS_VOICES so
// behavior on a fresh deploy doesn't regress before the admin chooses anything.
export const TTS_DEFAULT: Record<TargetLang, { provider: TtsProviderId; voice: string }> = {
  de: { provider: 'google', voice: 'de-DE-Standard-B' },
  fr: { provider: 'google', voice: 'fr-FR-Standard-B' },
  es: { provider: 'google', voice: 'es-ES-Standard-B' },
  he: { provider: 'google', voice: 'he-IL-Standard-B' },
  en: { provider: 'google', voice: 'en-US-Standard-B' },
  it: { provider: 'google', voice: 'it-IT-Standard-B' },
  // Serbian / Georgian have no Google voice — pick Azure where it exists.
  sr: { provider: 'azure',  voice: 'sr-RS-NicholasNeural' },
  ka: { provider: 'azure',  voice: 'ka-GE-GiorgiNeural' },
};

/** Returns whether a (provider, target, voice) tuple is a known option. */
export function isKnownVoice(provider: TtsProviderId, target: TargetLang, voice: string): boolean {
  return (TTS_PROVIDERS[provider]?.voices[target] ?? []).some((v) => v.id === voice);
}

/** Pick a provider for a target language given an override map. Falls through
 *  to TTS_DEFAULT if the override is missing, the provider has no coverage,
 *  or the voice is unknown for that target. */
export function resolveTts(
  target: TargetLang,
  overrides: Partial<Record<TargetLang, { provider: TtsProviderId; voice: string }>> = {},
): { provider: TtsProviderId; voice: string; locale: string } | null {
  const o = overrides[target];
  if (o && isKnownVoice(o.provider, target, o.voice)) {
    const locale = TTS_PROVIDERS[o.provider].locales[target];
    if (locale) return { provider: o.provider, voice: o.voice, locale };
  }
  const def = TTS_DEFAULT[target];
  if (def && isKnownVoice(def.provider, target, def.voice)) {
    const locale = TTS_PROVIDERS[def.provider].locales[target];
    if (locale) return { provider: def.provider, voice: def.voice, locale };
  }
  return null;
}

// ---- synthesis -------------------------------------------------------------

export interface SynthesizeArgs {
  text: string;
  target: TargetLang;
  provider: TtsProviderId;
  voice: string;
  locale: string;
  speakingRate?: number;
}

export interface SynthesizeError {
  error: string;
  status?: number;
  detail?: string;
}

export type SynthesizeResult = { ok: true; audio: Uint8Array } | { ok: false; error: SynthesizeError };

const GOOGLE_ENDPOINT = 'https://texttospeech.googleapis.com/v1/text:synthesize';

async function synthesizeGoogle(a: SynthesizeArgs): Promise<SynthesizeResult> {
  const key = process.env.GOOGLE_TTS_API_KEY;
  if (!key) return { ok: false, error: { error: 'tts_not_configured', detail: 'GOOGLE_TTS_API_KEY missing' } };
  const body = {
    input: { text: a.text },
    voice: { languageCode: a.locale, name: a.voice },
    audioConfig: { audioEncoding: 'MP3', speakingRate: a.speakingRate ?? 0.9 },
  };
  const res = await fetch(`${GOOGLE_ENDPOINT}?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return { ok: false, error: { error: 'upstream_error', status: res.status, detail: detail.slice(0, 300) } };
  }
  const data = (await res.json()) as { audioContent?: string };
  if (!data.audioContent) return { ok: false, error: { error: 'empty_audio' } };
  return { ok: true, audio: Buffer.from(data.audioContent, 'base64') };
}

async function synthesizeAzure(a: SynthesizeArgs): Promise<SynthesizeResult> {
  const key = process.env.AZURE_TTS_KEY;
  const region = process.env.AZURE_TTS_REGION;
  if (!key || !region) {
    return { ok: false, error: { error: 'tts_not_configured', detail: 'AZURE_TTS_KEY / AZURE_TTS_REGION missing' } };
  }
  // SSML body. The prosody rate matches Google's speakingRate=0.9 (slightly slower than default).
  const rate = a.speakingRate ?? 0.9;
  const ratePct = `${Math.round((rate - 1) * 100)}%`;
  // Escape the four XML-sensitive characters in the input text.
  const safeText = a.text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  const ssml =
    `<speak version='1.0' xml:lang='${a.locale}'>` +
    `<voice name='${a.voice}'>` +
    `<prosody rate='${ratePct}'>${safeText}</prosody>` +
    `</voice>` +
    `</speak>`;
  const endpoint = `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': key,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
      'User-Agent': 'glottos-matrix-tts',
    },
    body: ssml,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return { ok: false, error: { error: 'upstream_error', status: res.status, detail: detail.slice(0, 300) } };
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength === 0) return { ok: false, error: { error: 'empty_audio' } };
  return { ok: true, audio: buf };
}

export async function synthesize(a: SynthesizeArgs): Promise<SynthesizeResult> {
  if (a.provider === 'google') return synthesizeGoogle(a);
  if (a.provider === 'azure') return synthesizeAzure(a);
  return { ok: false, error: { error: 'unknown_provider' } };
}

/** True iff any voice exists for this target across any provider. The
 *  SpeakButton hides for targets where every provider returns null. */
export function hasAnyVoice(target: TargetLang): boolean {
  return Object.values(TTS_PROVIDERS).some((p) => (p.voices[target] ?? []).length > 0);
}
