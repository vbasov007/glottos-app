import { hasAnyVoice } from './tts-providers';
import type { TargetLang } from './content-types';

// Legacy shim. The SpeakButton calls hasTts(target) to decide whether to
// render at all. With the provider/voice catalogs now per-provider, we just
// check whether ANY provider has a voice for this target.

export function hasTts(target: TargetLang): boolean {
  return hasAnyVoice(target);
}
