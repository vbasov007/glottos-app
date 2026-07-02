/**
 * Dialog-aware TTS helpers.
 *
 * In "read all" mode a line like `John: Where are we?` is treated as a dialog
 * replica: the speaker name is detected (so a per-speaker, gender-matched voice
 * can be assigned and the name is NOT read aloud). These helpers are pure so the
 * playback hook stays testable.
 */
import type { TtsVoiceOption } from '../types';

export type Gender = 'male' | 'female' | 'neutral';

/**
 * Parse a single line as a dialog replica `Speaker: phrase`.
 *
 * The speaker label is 1–2 letter-words (Unicode, case-agnostic so caseless
 * scripts like Japanese/Georgian work), no digits, ≤ 24 chars, followed by a
 * colon and a non-empty phrase. Returns `null` for non-dialog lines.
 *
 * Note: a stray label such as `Note:` or `TODO:` will also match — harmless for
 * this feature (the label is dropped and the phrase is read in a neutral/random
 * voice). Times like `12:30` don't match (the speaker must start with a letter).
 */
export function parseDialogLine(line: string): { speaker: string; phrase: string } | null {
  const m = line.match(/^\s*(\p{L}[\p{L}'.\-]*(?:\s+\p{L}[\p{L}'.\-]*)?)\s*:\s+(\S.*)$/u);
  if (!m) return null;
  const speaker = m[1].trim();
  const phrase = m[2].trim();
  if (!speaker || speaker.length > 24 || !phrase) return null;
  return { speaker, phrase };
}

/**
 * Pick a voice id for a speaker of `gender` from `catalog`.
 *
 * Prefers voices matching the gender; if none match (or gender is neutral with
 * no neutral voices), falls back to the whole catalog. Prefers a voice not in
 * `used` so distinct speakers sound different, but reuses one if the pool is
 * exhausted. Returns `null` only for an empty catalog. `rng` is injectable for
 * deterministic tests.
 */
/**
 * Indices of the `tokens` that form a dialog speaker label (`Name:` at a line
 * start), where `tokens` concatenate back to `text` exactly (e.g. the result of
 * `text.split(/(\s+)/)`). Used to render speaker names gray and exclude them
 * from selection for explain/listen. The colon is included; whitespace tokens
 * inside a two-word name are not (they don't need styling).
 */
export function speakerLabelTokenIndices(text: string, tokens: string[]): Set<number> {
  const set = new Set<number>();
  if (!text) return set;
  const tokenStart: number[] = [];
  let off = 0;
  for (const tk of tokens) { tokenStart.push(off); off += tk.length; }
  let pos = 0;
  for (const line of text.split('\n')) {
    const lineStart = pos;
    if (parseDialogLine(line)) {
      const prefixEnd = lineStart + line.indexOf(':') + 1; // through the colon
      for (let i = 0; i < tokens.length; i++) {
        const ts = tokenStart[i];
        if (ts >= prefixEnd) break;
        if (ts >= lineStart && ts + tokens[i].length <= prefixEnd && !/^\s+$/.test(tokens[i])) set.add(i);
      }
    }
    pos += line.length + 1; // + the newline that split() dropped
  }
  return set;
}

export function pickVoiceForGender(
  catalog: TtsVoiceOption[],
  gender: Gender,
  used: Set<string>,
  rng: () => number = Math.random,
): string | null {
  if (catalog.length === 0) return null;
  const byGender = catalog.filter(v => v.gender === gender);
  const pool = byGender.length > 0 ? byGender : catalog;
  const fresh = pool.filter(v => !used.has(v.id));
  const pick = fresh.length > 0 ? fresh : pool;
  return pick[Math.floor(rng() * pick.length) % pick.length].id;
}
