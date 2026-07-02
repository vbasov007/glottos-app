import fs from 'node:fs';
import path from 'node:path';

export interface VocabCodeMap {
  [key: string]: string;
}

const CACHE_PATH = path.resolve(process.cwd(), 'content/vocab-codes.json');

let cached: VocabCodeMap | null = null;

function load(): VocabCodeMap {
  if (cached) return cached;
  try {
    cached = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8')) as VocabCodeMap;
  } catch {
    cached = {};
  }
  return cached;
}

export function vocabKey(course: string, target: string, native: string, lessonN: number): string {
  return `${course}:${target}:${native}:${lessonN}`;
}

/** Returns the cached polyGlottos share code for a lesson's vocab workspace, or null if not generated yet. */
export function getVocabCode(course: string, target: string, native: string, lessonN: number): string | null {
  const map = load();
  return map[vocabKey(course, target, native, lessonN)] ?? null;
}
