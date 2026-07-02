import fs from 'node:fs';
import path from 'node:path';

export type FirstLessonsMap = Record<string, number>;

const CACHE_PATH = path.resolve(process.cwd(), 'content/dictionary-first-lessons.json');

let cached: FirstLessonsMap | null = null;

export function getFirstLessons(): FirstLessonsMap {
  if (cached) return cached;
  try {
    cached = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8')) as FirstLessonsMap;
  } catch {
    cached = {};
  }
  return cached;
}
