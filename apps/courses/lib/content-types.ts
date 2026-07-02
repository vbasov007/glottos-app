// Typed shape of every piece of parsed course content.
// Emitted as JSON under content/.generated/<native>/

export type NativeLang = 'ru' | 'en' | 'pl' | 'de';
export type TargetLang = 'de' | 'fr' | 'es' | 'sr' | 'ka' | 'he' | 'en' | 'it';
/** Slug of a course (e.g., "classic50"). A course is the top-level grouping
 *  above target+native — one course can ship multiple (target, native) pairs,
 *  and one (target, native) pair can appear in multiple courses. */
export type CourseSlug = 'classic50' | 'losreden50';
export type CourseKey = `${TargetLang}.${NativeLang}`;

/** Metadata about a course. Display names come from i18n via `courseNames.<slug>`. */
export interface CourseMeta {
  slug: CourseSlug;
  /** Default ordering on the course-selection page. Lower number first. */
  order: number;
  /** (target, native) pairs this course ships content for. The landing page
   *  filters the course list down to those matching the user's selection. */
  available: readonly { target: TargetLang; native: NativeLang }[];
}

export const COURSES: readonly CourseMeta[] = [
  {
    slug: 'classic50',
    order: 0,
    available: [
      { target: 'de', native: 'ru' }, { target: 'de', native: 'en' }, { target: 'de', native: 'pl' },
      { target: 'fr', native: 'ru' }, { target: 'fr', native: 'en' }, { target: 'fr', native: 'pl' }, { target: 'fr', native: 'de' },
      { target: 'es', native: 'ru' }, { target: 'es', native: 'en' }, { target: 'es', native: 'pl' },
      { target: 'sr', native: 'ru' },
      { target: 'ka', native: 'ru' },
      { target: 'he', native: 'ru' }, { target: 'he', native: 'en' }, { target: 'he', native: 'de' }, { target: 'he', native: 'pl' },
      { target: 'en', native: 'ru' }, { target: 'en', native: 'pl' }, { target: 'en', native: 'de' },
      { target: 'it', native: 'ru' }, { target: 'it', native: 'en' },
    ],
  },
  {
    slug: 'losreden50',
    order: 1,
    available: [{ target: 'de', native: 'ru' }],
  },
];

export const COURSE_BY_SLUG: Record<CourseSlug, CourseMeta> = Object.fromEntries(
  COURSES.map((c) => [c.slug, c]),
) as Record<CourseSlug, CourseMeta>;

/** Course slugs that ship content for the given (target, native) pair, in
 *  registry order. Client-safe — no filesystem access. */
export function coursesForPair(target: TargetLang, native: NativeLang): CourseSlug[] {
  return COURSES
    .filter((c) => c.available.some((p) => p.target === target && p.native === native))
    .map((c) => c.slug);
}

/** Display-readiness of a target. "full" = all 50 lessons, "preview" = pilot
 *  (L1-only), grayed-out card. Used by the landing page picker. */
export type TargetStatus = 'full' | 'preview';

export interface TargetMeta {
  code: TargetLang;
  /** Latin-script display name, e.g. "Deutsch", "Français" */
  endonym: string;
  /** Flag emoji used on the picker card */
  flag: string;
  /** Lesson count actually authored (the rest of the 50 are placeholders) */
  lessons: number;
  status: TargetStatus;
  /** Native langs that have content for this target */
  natives: readonly NativeLang[];
}

export const TARGETS: readonly TargetMeta[] = [
  { code: 'de', endonym: 'Deutsch',    flag: '🇩🇪', lessons: 50, status: 'full',    natives: ['ru', 'en', 'pl'] },
  { code: 'fr', endonym: 'Français',   flag: '🇫🇷', lessons: 50, status: 'full',    natives: ['ru', 'en', 'pl', 'de'] },
  { code: 'es', endonym: 'Español',    flag: '🇪🇸', lessons: 50, status: 'full',    natives: ['en', 'pl', 'ru'] },
  { code: 'sr', endonym: 'Српски',     flag: '🇷🇸', lessons: 50, status: 'full',    natives: ['ru'] },
  { code: 'ka', endonym: 'ქართული',    flag: '🇬🇪', lessons: 50, status: 'full',    natives: ['ru'] },
  { code: 'he', endonym: 'עברית',      flag: '🇮🇱', lessons: 50, status: 'full',    natives: ['ru', 'en', 'de', 'pl'] },
  { code: 'en', endonym: 'English',    flag: '🇬🇧', lessons: 50, status: 'full',    natives: ['ru', 'pl', 'de'] },
  { code: 'it', endonym: 'Italiano',   flag: '🇮🇹', lessons: 50, status: 'full',    natives: ['ru', 'en'] },
];

/** O(1) lookup by code. */
export const TARGET_BY_CODE: Record<TargetLang, TargetMeta> = Object.fromEntries(
  TARGETS.map((t) => [t.code, t]),
) as Record<TargetLang, TargetMeta>;

// Curriculum -----------------------------------------------------------------

export interface CurriculumBlock {
  /** 1..6 */
  id: number;
  /** "BLOCK 1: SURVIVAL" — exactly as in source (in native language) */
  title: string;
  /** "Knappe / Knappin", "Ritter / Ritterin", etc. */
  rankLabel: string | null;
  /** Lesson summary line per row in the block table */
  lessons: CurriculumLessonRef[];
  /** Block intro paragraph if present (e.g. "Heads up for English speakers...") */
  intro: string | null;
  /** Practice-related description shown on the block-end test card.
   *  Extracted from the trailing "→ TEST «...» (Rank): ..." line. */
  testDescription: string | null;
}

export interface CurriculumLessonRef {
  /** 1..50 */
  n: number;
  /** Grammar topic text */
  grammar: string;
  /** Vocabulary topic text */
  vocab: string;
}

export interface Curriculum {
  course: CourseSlug;
  courseKey: CourseKey;
  /** H1 title of the file, e.g. "German Course Curriculum (50 units)" */
  title: string;
  /** Optional bolded subtitle line that follows the H1, if present. */
  subtitle: string | null;
  blocks: CurriculumBlock[];
  /** "How to work with each unit" + "Memory hacks" trailing sections, kept as raw markdown */
  trailingMarkdown: string | null;
}

// Lessons --------------------------------------------------------------------

export interface LessonSection {
  /** "Part 1: ..." or just "How to work with this lesson" — used as section anchor */
  heading: string;
  /** Anchor slug for TOC links */
  slug: string;
  /** Raw markdown for this section (without the H2 header line itself) */
  markdown: string;
}

export interface ExercisePrompt {
  /** Numbered prompt text as authored, e.g. "Ich ___ (lernen) Deutsch." */
  text: string;
}

export interface ExerciseAnswer {
  /** The canonical answer (italics stripped, e.g. "Hallo!") */
  canonical: string;
  /** Optional alternates split out of "(или: A; B)" / "(or: A)" / "(lub: A)" markers */
  alternates: string[];
  /** Any free-text note that followed the answer (e.g. " (объяснение)") */
  note: string | null;
}

export interface Exercise {
  /** 1..N within the lesson */
  n: number;
  /** Heading line, e.g. "Exercise 1. Conjugation — fill in the right form" */
  heading: string;
  /** Anchor slug */
  slug: string;
  /** Instruction sentence(s) above the numbered list */
  instruction: string | null;
  /** Numbered prompts */
  prompts: ExercisePrompt[];
  /** Parallel answers (same length as prompts when applicable) */
  answers: ExerciseAnswer[];
  /** True if this is a "matrix from memory" / read-aloud style with no keys */
  isOpenEnded: boolean;
  /**
   * Raw markdown of everything between this exercise's H3 heading and the next
   * H3/H2 (exclusive of the `<details>` answer key). Rendered as-is for
   * open-ended exercises that don't fit the "ordered list of prompts" shape
   * (e.g. read-aloud drills, dialogues, blockquote sequences).
   */
  bodyMarkdown: string;
  /**
   * Optional exercise mode. Default 'writing': learner reads a native-language
   * prompt and types the target-language canonical answer. 'listening': learner
   * hears the target-language sentence (TTS of canonical) and transcribes it
   * back; prompts[i].text is empty and the UI renders an audio button.
   */
  mode?: 'writing' | 'listening';
}

export interface VocabRow {
  /** German entry as written, including article and plural marker */
  german: string;
  /** "m" | "f" | "n" | "Pl" | null */
  gender: string | null;
  /** Native-language translation */
  native: string;
}

export interface Lesson {
  course: CourseSlug;
  courseKey: CourseKey;
  /** 1..50 */
  n: number;
  /** "Lesson 9: Introduction to Akkusativ (direct object case)" */
  title: string;
  /** "Vocabulary: Supermarket: basket, cart, ..." (the line 2 bolded line) */
  vocabSubtitle: string;
  /** Ordered sections in document order */
  sections: LessonSection[];
  /** Extracted exercises */
  exercises: Exercise[];
  /** First vocabulary table found, parsed into rows */
  vocab: VocabRow[];
  /** "> **Next up:** Lesson N+1 — ..." closing blockquote, raw */
  nextUp: string | null;
}

// Tests ----------------------------------------------------------------------

export interface Test {
  course: CourseSlug;
  courseKey: CourseKey;
  /** 1..50 */
  n: number;
  title: string;
  /** Instruction sentence below the title */
  instruction: string;
  /** 30 prompts */
  prompts: ExercisePrompt[];
  /** 30 answers (canonical + alternates) */
  answers: ExerciseAnswer[];
}

// Listening texts ------------------------------------------------------------

export interface Text {
  course: CourseSlug;
  courseKey: CourseKey;
  /** 1..50 */
  n: number;
  /** "a" | "b" | "c" */
  variant: string;
  title: string;
  /** "Theme: ..." line if present */
  theme: string | null;
  /** 30 German sentences */
  sentences: string[];
  /** Word list table (variable size) */
  vocab: VocabRow[];
}

// Dictionary -----------------------------------------------------------------

export interface DictionaryEntry {
  /** Full German entry as written, e.g. "der Abend", "die Brücke", "sich freuen" */
  german: string;
  /** Lemma for sorting/search: article and reflexive "sich" stripped, lowercased */
  lemma: string;
  /** "m" | "f" | "n" | "Pl" | null */
  gender: string | null;
  /** Native-language translation */
  native: string;
  /** Letter section the entry belongs to ("A", "B", ...) */
  letter: string;
}

export interface Dictionary {
  course: CourseSlug;
  courseKey: CourseKey;
  title: string;
  totalEntries: number;
  entries: DictionaryEntry[];
}

// Manifest -------------------------------------------------------------------

export interface ContentManifest {
  /** ISO timestamp of the build */
  builtAt: string;
  /** Random short ID for cache busting */
  buildId: string;
  /** Available { course, target, native } triples and their slug inventories.
   *  Same (target, native) pair can appear in multiple courses. */
  courses: {
    course: CourseSlug;
    courseKey: CourseKey;
    target: TargetLang;
    native: NativeLang;
    lessonCount: number;
    testCount: number;
    textCount: number;
    dictionaryEntries: number;
    blockCount: number;
  }[];
}
