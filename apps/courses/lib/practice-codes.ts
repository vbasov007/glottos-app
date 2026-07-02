import fs from 'node:fs';
import path from 'node:path';

export interface PracticeCodeMap {
  [key: string]: string;
}

const CACHE_PATH = path.resolve(process.cwd(), 'content/practice-codes.json');

let cached: PracticeCodeMap | null = null;

function load(): PracticeCodeMap {
  if (cached) return cached;
  try {
    cached = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8')) as PracticeCodeMap;
  } catch {
    cached = {};
  }
  return cached;
}

export function practiceKey(course: string, target: string, native: string, lessonN: number): string {
  return `${course}:${target}:${native}:${lessonN}`;
}

/** Returns the cached polyGlottos share code for a lesson's practice exercises, or null if not generated yet. */
export function getPracticeCode(course: string, target: string, native: string, lessonN: number): string | null {
  const map = load();
  return map[practiceKey(course, target, native, lessonN)] ?? null;
}
