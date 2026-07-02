// Runtime accessors for the build-time generated JSON.
// Used by RSC pages. Keep imports synchronous to let Next.js statically resolve.

import path from 'node:path';
import { readFileSync } from 'node:fs';
import type {
  ContentManifest,
  CourseKey,
  CourseSlug,
  Curriculum,
  Dictionary,
  Lesson,
  NativeLang,
  TargetLang,
  Test,
  Text,
} from './content-types';

const GENERATED = path.join(process.cwd(), 'content', '.generated');

function read<T>(...parts: string[]): T {
  return JSON.parse(readFileSync(path.join(GENERATED, ...parts), 'utf8')) as T;
}

export function getManifest(): ContentManifest {
  return read<ContentManifest>('manifest.json');
}

export function getCourseKey(target: TargetLang, native: NativeLang): CourseKey {
  return `${target}.${native}` as CourseKey;
}

export function getCurriculum(course: CourseSlug, target: TargetLang, native: NativeLang): Curriculum {
  return read<Curriculum>(course, getCourseKey(target, native), 'curriculum.json');
}

export function getLesson(course: CourseSlug, target: TargetLang, native: NativeLang, n: number): Lesson {
  return read<Lesson>(course, getCourseKey(target, native), 'lessons', `${n}.json`);
}

export function getTest(course: CourseSlug, target: TargetLang, native: NativeLang, n: number): Test {
  return read<Test>(course, getCourseKey(target, native), 'tests', `${n}.json`);
}

export function getText(
  course: CourseSlug,
  target: TargetLang,
  native: NativeLang,
  n: number,
  variant: string,
): Text {
  return read<Text>(course, getCourseKey(target, native), 'texts', `${n}-${variant}.json`);
}

export function getDictionary(course: CourseSlug, target: TargetLang, native: NativeLang): Dictionary {
  return read<Dictionary>(course, getCourseKey(target, native), 'dictionary.json');
}

/** Consolidated global dictionary for a (target, native) pair, aggregating
 *  every course's lesson-derived entries plus the shared supplement. This is
 *  the source the unified /<target>/<native>/dictionary route reads. */
export function getGlobalDictionary(target: TargetLang, native: NativeLang): Dictionary {
  return read<Dictionary>('_shared', 'dictionaries', target, `${native}.json`);
}

export interface CourseIndex {
  course: CourseSlug;
  courseKey: CourseKey;
  target: TargetLang;
  native: NativeLang;
  curriculumTitle: string;
  blockCount: number;
  lessons: { n: number; title: string }[];
  tests: { n: number; title: string }[];
  texts: { n: number; variant: string; title: string }[];
  dictionaryEntries: number;
}

export function getCourseIndex(course: CourseSlug, target: TargetLang, native: NativeLang): CourseIndex {
  return read<CourseIndex>(course, getCourseKey(target, native), 'index.json');
}

/** List the courses that have content for the given (target, native) pair.
 *  Reads the manifest and filters by target+native. Returns course slugs in
 *  the registry order from COURSES. */
export function getCoursesForPair(target: TargetLang, native: NativeLang): CourseSlug[] {
  const manifest = getManifest();
  return manifest.courses
    .filter((c) => c.target === target && c.native === native)
    .map((c) => c.course);
}
