import fs from 'node:fs';
import path from 'node:path';

import type { CefrEntry } from './cefr-types';

export { CEFR_LEVELS } from './cefr-types';
export type { CefrLevel, CefrBreakdown, CefrEntry } from './cefr-types';

type CefrMap = Record<string, CefrEntry>;

const CACHE_PATH = path.resolve(process.cwd(), 'content/cefr-levels.json');

let cached: CefrMap | null = null;

function load(): CefrMap {
  if (cached) return cached;
  try {
    cached = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8')) as CefrMap;
  } catch {
    cached = {};
  }
  return cached;
}

/** Returns the cached CEFR contribution for a lesson, or null if not generated yet. */
export function getCefrLevels(target: string, lessonN: number): CefrEntry | null {
  const map = load();
  return map[`${target}:${lessonN}`] ?? null;
}

/** Returns every lesson's contribution for a target — used by the client-side cumulative calculator. */
export function getAllCefrLevels(target: string): Record<number, CefrEntry> {
  const map = load();
  const out: Record<number, CefrEntry> = {};
  for (const k of Object.keys(map)) {
    const [t, nStr] = k.split(':');
    if (t === target) {
      const n = parseInt(nStr!, 10);
      if (Number.isFinite(n)) out[n] = map[k]!;
    }
  }
  return out;
}
