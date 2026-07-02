import fs from 'node:fs';
import path from 'node:path';

export interface ShareCodeMap {
  [key: string]: string;
}

const CACHE_PATH = path.resolve(process.cwd(), 'content/share-codes.json');

let cached: ShareCodeMap | null = null;

function load(): ShareCodeMap {
  if (cached) return cached;
  try {
    const raw = fs.readFileSync(CACHE_PATH, 'utf8');
    cached = JSON.parse(raw) as ShareCodeMap;
  } catch {
    cached = {};
  }
  return cached;
}

export function shareKey(
  course: string,
  target: string,
  native: string,
  lessonN: number,
  variant: string,
): string {
  return `${course}:${target}:${native}:${lessonN}:${variant}`;
}

export function getShareCode(
  course: string,
  target: string,
  native: string,
  lessonN: number,
  variant: 'a' | 'b' | 'c',
): string | null {
  const map = load();
  return map[shareKey(course, target, native, lessonN, variant)] ?? null;
}
