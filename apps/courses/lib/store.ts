'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { CourseSlug, Exercise, NativeLang, TargetLang } from './content-types';

const GENERATED_PER_LESSON_CAP = 5;

// Versioned schema. When migrating, bump STATE_VERSION and add a `migrate` clause.
// v1: courseKey = `${TargetLang}.${NativeLang}` (e.g. "de.ru")
// v2: courseKey = `${CourseSlug}.${TargetLang}.${NativeLang}` (e.g. "classic50.de.ru")
//     — multi-course support; v1 keys get migrated by prepending "classic50."
// v3: CourseState gained `readTexts` (dropped the unused `seenWords`).
const STATE_VERSION = 3;
const STORAGE_KEY = 'gl.v1.state';

type CourseKey = `${CourseSlug}.${TargetLang}.${NativeLang}`;
export type RankName = 'Knappe' | 'Ritter' | 'Baron' | 'Graf' | 'Koenig';

export interface LessonProgress {
  startedAt: string;
  completedAt?: string;
  /** Keyed by exerciseId ("ex-1", "ex-2", …, or "gen-…" for AI-generated). */
  exercises: Record<
    string,
    {
      /** Last given answer per prompt */
      answers: string[];
      /** Pass/fail flag per prompt */
      correctMask: boolean[];
      lastTry: string;
    }
  >;
  /** AI-generated extra exercises for the "More exercises" tab. Capped at 5. */
  generated?: Exercise[];
  /** Difficulty level (1..10) used for the next "More exercises" generation.
   *  Both writing and listening buttons share this counter — each click bumps
   *  it by one, so the user "climbs" toward native-speaker level. Persisted
   *  per lesson so the climb survives page reloads. */
  generationDifficulty?: number;
}

export interface TestAttempt {
  startedAt: string;
  finishedAt?: string;
  /** Score out of 30 */
  score: number;
  perPrompt: {
    given: string;
    correct: boolean;
    /** Structured AI feedback. Replaces the old free-text `hint` field. */
    issues?: import('./checker').Issue[];
    judgedBy: 'exact' | 'claude';
  }[];
}

export interface InProgressTestAnswer {
  given: string;
  correct: boolean;
  issues?: import('./checker').Issue[];
  judgedBy: 'exact' | 'claude';
}

export interface TestProgress {
  attempts: TestAttempt[];
  /** Best score across attempts (0..30) */
  best: number;
  /** Submitted answers for the current (unfinished) attempt — survives reload.
   *  Cleared automatically when `recordTestAttempt` fires on Finish. */
  inProgress?: {
    startedAt: string;
    answers: Record<number, InProgressTestAnswer>;
  };
}

interface CourseState {
  lessons: Record<number, LessonProgress>;
  tests: Record<number, TestProgress>;
  /** Listening texts the learner has opened, as "<n>-<variant>" ids. Feeds
   *  the "words seen" metric alongside completed lessons. */
  readTexts: string[];
  streak: {
    lastDayISO: string;
    currentDays: number;
    longestDays: number;
  };
  ranks: RankName[];
}

interface ProgressState {
  v: typeof STATE_VERSION;
  user: { id: string; createdAt: string };
  prefs: { nativeLang: NativeLang; targetLang: TargetLang };
  courses: Record<CourseKey, CourseState>;
}

interface Actions {
  ensureCourse(key: CourseKey): void;
  startLesson(courseKey: CourseKey, n: number): void;
  recordExerciseAnswer(
    courseKey: CourseKey,
    lessonN: number,
    exerciseId: string,
    promptIndex: number,
    given: string,
    correct: boolean,
  ): void;
  completeLesson(courseKey: CourseKey, n: number): void;
  uncompleteLesson(courseKey: CourseKey, n: number): void;
  addGeneratedExercise(courseKey: CourseKey, lessonN: number, exercise: Exercise): boolean;
  removeGeneratedExercise(courseKey: CourseKey, lessonN: number, slug: string): void;
  /** Increment the per-lesson generation difficulty by 1 (clamped to 10) and
   *  return the new value. Called on each "Generate exercise" click —
   *  writing and listening share the counter. */
  bumpGenerationDifficulty(courseKey: CourseKey, lessonN: number): number;
  recordTestAnswer(
    courseKey: CourseKey,
    testN: number,
    promptIndex: number,
    answer: InProgressTestAnswer,
  ): void;
  recordTestAttempt(courseKey: CourseKey, testN: number, attempt: TestAttempt): void;
  clearTestInProgress(courseKey: CourseKey, testN: number): void;
  claimRank(courseKey: CourseKey, rank: RankName): void;
  markTextRead(courseKey: CourseKey, textId: string): void;
  touchStreak(courseKey: CourseKey): void;
  setPrefs(prefs: Partial<ProgressState['prefs']>): void;
  resetAll(): void;
  exportJson(): string;
}

type Store = ProgressState & Actions;

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return (crypto as { randomUUID: () => string }).randomUUID();
  }
  return Math.random().toString(36).slice(2);
}

function emptyCourse(): CourseState {
  return {
    lessons: {},
    tests: {},
    readTexts: [],
    streak: { lastDayISO: '', currentDays: 0, longestDays: 0 },
    ranks: [],
  };
}

function initialState(): ProgressState {
  return {
    v: STATE_VERSION,
    user: { id: uuid(), createdAt: new Date().toISOString() },
    prefs: { nativeLang: 'en', targetLang: 'de' },
    courses: {} as Record<CourseKey, CourseState>,
  };
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(aISO: string, bISO: string): number {
  if (!aISO || !bISO) return 999;
  const a = new Date(aISO + 'T00:00:00Z').getTime();
  const b = new Date(bISO + 'T00:00:00Z').getTime();
  return Math.round((b - a) / 86_400_000);
}

export const useProgressStore = create<Store>()(
  persist(
    (set, get) => ({
      ...initialState(),

      ensureCourse(key) {
        if (!get().courses[key]) {
          set((s) => ({ courses: { ...s.courses, [key]: emptyCourse() } }));
        }
      },

      startLesson(courseKey, n) {
        get().ensureCourse(courseKey);
        set((s) => {
          const course = s.courses[courseKey]!;
          if (course.lessons[n]) return s;
          return {
            courses: {
              ...s.courses,
              [courseKey]: {
                ...course,
                lessons: {
                  ...course.lessons,
                  [n]: { startedAt: new Date().toISOString(), exercises: {} },
                },
              },
            },
          };
        });
        get().touchStreak(courseKey);
      },

      removeGeneratedExercise(courseKey, lessonN, slug) {
        set((s) => {
          const course = s.courses[courseKey];
          const lesson = course?.lessons[lessonN];
          if (!course || !lesson) return s;
          const generated = (lesson.generated ?? []).filter((e) => e.slug !== slug);
          // Also drop any recorded answers keyed to that exercise.
          const { [slug]: _drop, ...remainingExercises } = lesson.exercises;
          void _drop;
          return {
            courses: {
              ...s.courses,
              [courseKey]: {
                ...course,
                lessons: {
                  ...course.lessons,
                  [lessonN]: { ...lesson, generated, exercises: remainingExercises },
                },
              },
            },
          };
        });
      },

      bumpGenerationDifficulty(courseKey, lessonN) {
        get().startLesson(courseKey, lessonN);
        const state = get();
        const cur = state.courses[courseKey]?.lessons[lessonN]?.generationDifficulty ?? 0;
        const next = Math.min(cur + 1, 10);
        set((s) => {
          const course = s.courses[courseKey]!;
          const lesson = course.lessons[lessonN]!;
          return {
            courses: {
              ...s.courses,
              [courseKey]: {
                ...course,
                lessons: {
                  ...course.lessons,
                  [lessonN]: { ...lesson, generationDifficulty: next },
                },
              },
            },
          };
        });
        return next;
      },

      addGeneratedExercise(courseKey, lessonN, exercise) {
        get().startLesson(courseKey, lessonN);
        const state = get();
        const lesson = state.courses[courseKey]?.lessons[lessonN];
        const existing = lesson?.generated ?? [];
        if (existing.length >= GENERATED_PER_LESSON_CAP) return false;
        set((s) => {
          const course = s.courses[courseKey]!;
          const cur = course.lessons[lessonN]!;
          return {
            courses: {
              ...s.courses,
              [courseKey]: {
                ...course,
                lessons: {
                  ...course.lessons,
                  [lessonN]: {
                    ...cur,
                    generated: [...(cur.generated ?? []), exercise],
                  },
                },
              },
            },
          };
        });
        return true;
      },

      recordExerciseAnswer(courseKey, lessonN, exerciseId, promptIndex, given, correct) {
        get().startLesson(courseKey, lessonN);
        set((s) => {
          const course = s.courses[courseKey]!;
          const lesson = course.lessons[lessonN]!;
          const prior = lesson.exercises[exerciseId] ?? { answers: [], correctMask: [], lastTry: '' };
          const answers = [...prior.answers];
          const correctMask = [...prior.correctMask];
          answers[promptIndex] = given;
          correctMask[promptIndex] = correct;
          return {
            courses: {
              ...s.courses,
              [courseKey]: {
                ...course,
                lessons: {
                  ...course.lessons,
                  [lessonN]: {
                    ...lesson,
                    exercises: {
                      ...lesson.exercises,
                      [exerciseId]: { answers, correctMask, lastTry: new Date().toISOString() },
                    },
                  },
                },
              },
            },
          };
        });
      },

      completeLesson(courseKey, n) {
        get().startLesson(courseKey, n);
        set((s) => {
          const course = s.courses[courseKey]!;
          const lesson = course.lessons[n]!;
          if (lesson.completedAt) return s;
          return {
            courses: {
              ...s.courses,
              [courseKey]: {
                ...course,
                lessons: {
                  ...course.lessons,
                  [n]: { ...lesson, completedAt: new Date().toISOString() },
                },
              },
            },
          };
        });
      },

      uncompleteLesson(courseKey, n) {
        set((s) => {
          const course = s.courses[courseKey];
          const lesson = course?.lessons[n];
          if (!course || !lesson || !lesson.completedAt) return s;
          const { completedAt: _drop, ...rest } = lesson;
          void _drop;
          return {
            courses: {
              ...s.courses,
              [courseKey]: {
                ...course,
                lessons: {
                  ...course.lessons,
                  [n]: rest,
                },
              },
            },
          };
        });
      },

      recordTestAnswer(courseKey, testN, promptIndex, answer) {
        get().ensureCourse(courseKey);
        set((s) => {
          const course = s.courses[courseKey]!;
          const prior = course.tests[testN] ?? { attempts: [], best: 0 };
          const inProgress = prior.inProgress ?? {
            startedAt: new Date().toISOString(),
            answers: {},
          };
          return {
            courses: {
              ...s.courses,
              [courseKey]: {
                ...course,
                tests: {
                  ...course.tests,
                  [testN]: {
                    ...prior,
                    inProgress: {
                      startedAt: inProgress.startedAt,
                      answers: { ...inProgress.answers, [promptIndex]: answer },
                    },
                  },
                },
              },
            },
          };
        });
      },

      clearTestInProgress(courseKey, testN) {
        set((s) => {
          const course = s.courses[courseKey];
          const test = course?.tests[testN];
          if (!course || !test?.inProgress) return s;
          const { inProgress: _drop, ...rest } = test;
          void _drop;
          return {
            courses: {
              ...s.courses,
              [courseKey]: {
                ...course,
                tests: { ...course.tests, [testN]: rest },
              },
            },
          };
        });
      },

      recordTestAttempt(courseKey, testN, attempt) {
        get().ensureCourse(courseKey);
        set((s) => {
          const course = s.courses[courseKey]!;
          const prior = course.tests[testN] ?? { attempts: [], best: 0 };
          const attempts = [...prior.attempts, attempt].slice(-5); // cap at 5
          const best = Math.max(prior.best, attempt.score);
          return {
            courses: {
              ...s.courses,
              [courseKey]: {
                ...course,
                tests: { ...course.tests, [testN]: { attempts, best } },
              },
            },
          };
        });
        get().touchStreak(courseKey);
      },

      claimRank(courseKey, rank) {
        set((s) => {
          const course = s.courses[courseKey] ?? emptyCourse();
          if (course.ranks.includes(rank)) return s;
          return {
            courses: {
              ...s.courses,
              [courseKey]: { ...course, ranks: [...course.ranks, rank] },
            },
          };
        });
      },

      markTextRead(courseKey, textId) {
        set((s) => {
          const course = s.courses[courseKey] ?? emptyCourse();
          const readTexts = course.readTexts ?? [];
          if (readTexts.includes(textId)) return s;
          return {
            courses: {
              ...s.courses,
              [courseKey]: { ...course, readTexts: [...readTexts, textId] },
            },
          };
        });
      },

      touchStreak(courseKey) {
        set((s) => {
          const course = s.courses[courseKey] ?? emptyCourse();
          const today = todayISO();
          if (course.streak.lastDayISO === today) return s;
          const dist = daysBetween(course.streak.lastDayISO, today);
          const currentDays = dist === 1 ? course.streak.currentDays + 1 : 1;
          const longestDays = Math.max(course.streak.longestDays, currentDays);
          return {
            courses: {
              ...s.courses,
              [courseKey]: {
                ...course,
                streak: { lastDayISO: today, currentDays, longestDays },
              },
            },
          };
        });
      },

      setPrefs(prefs) {
        set((s) => ({ prefs: { ...s.prefs, ...prefs } }));
      },

      resetAll() {
        set(initialState());
      },

      exportJson() {
        const { v, user, prefs, courses } = get();
        return JSON.stringify({ v, user, prefs, courses }, null, 2);
      },
    }),
    {
      name: STORAGE_KEY,
      version: STATE_VERSION,
      storage: createJSONStorage(() => localStorage),
      // v1 → v2: courseKey gained a leading course slug. Prepend "classic50." to
      // any 2-part key so existing user progress survives the refactor.
      migrate: (persisted: unknown, from: number): ProgressState => {
        const state = persisted as ProgressState;
        if (from < 2 && state && state.courses) {
          const next: Record<string, CourseState> = {};
          for (const [key, val] of Object.entries(state.courses)) {
            if (key.split('.').length === 2) {
              next[`classic50.${key}`] = val as CourseState;
            } else {
              next[key] = val as CourseState;
            }
          }
          state.courses = next as Record<CourseKey, CourseState>;
        }
        // v2 → v3: add readTexts; retire the never-populated seenWords.
        if (from < 3 && state && state.courses) {
          for (const course of Object.values(state.courses) as CourseState[]) {
            if (!Array.isArray(course.readTexts)) course.readTexts = [];
            delete (course as { seenWords?: unknown }).seenWords;
          }
        }
        state.v = STATE_VERSION;
        return state;
      },
      partialize: (state) => ({
        v: state.v,
        user: state.user,
        prefs: state.prefs,
        courses: state.courses,
      }),
    },
  ),
);

// Convenience selectors -------------------------------------------------------

export function selectCourse(state: Store, key: CourseKey): CourseState | null {
  return state.courses[key] ?? null;
}

export function selectLessonStatus(
  state: Store,
  key: CourseKey,
  n: number,
): 'untouched' | 'in_progress' | 'completed' {
  const course = state.courses[key];
  if (!course) return 'untouched';
  const lesson = course.lessons[n];
  if (!lesson) return 'untouched';
  return lesson.completedAt ? 'completed' : 'in_progress';
}

export function selectRankClaimed(
  state: Store,
  key: CourseKey,
  rank: RankName,
): boolean {
  return state.courses[key]?.ranks.includes(rank) ?? false;
}

/** Rank threshold map: pass rate ≥80% on this test number to claim rank. */
export const RANK_THRESHOLDS: { rank: RankName; testN: number }[] = [
  { rank: 'Knappe', testN: 8 },
  { rank: 'Ritter', testN: 18 },
  { rank: 'Baron', testN: 25 },
  { rank: 'Graf', testN: 35 },
  { rank: 'Koenig', testN: 46 },
];
