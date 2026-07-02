import fs from 'node:fs';
import path from 'node:path';

export interface AudioSectionCodeMap {
  [key: string]: string;
}

const CACHE_PATH = path.resolve(process.cwd(), 'content/audio-section-codes.json');

let cached: AudioSectionCodeMap | null = null;

function load(): AudioSectionCodeMap {
  if (cached) return cached;
  try {
    const raw = fs.readFileSync(CACHE_PATH, 'utf8');
    cached = JSON.parse(raw) as AudioSectionCodeMap;
  } catch {
    cached = {};
  }
  return cached;
}

/**
 * Look up the share code for an audio (matrix/scales) section of a lesson.
 * Returns null when no code has been minted yet — the UI quietly omits
 * the "🔊 Audio practice" chip in that case so the page still works on a
 * fresh deploy where build-audio-section-codes.ts hasn't been run.
 *
 * `idx` is the position of the section in the `audio[]` array returned by
 * `partitionSections` — i.e. the same order they're rendered in.
 */
export function getAudioSectionCode(
  course: string,
  target: string,
  native: string,
  lessonN: number,
  idx: number,
): string | null {
  const map = load();
  return map[`${course}:${target}:${native}:${lessonN}:${idx}`] ?? null;
}
