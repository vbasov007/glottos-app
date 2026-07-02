'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Spinner } from './Spinner';
import { useSession } from './SessionProvider';
import { useProgressStore } from '../lib/store';
import { apiFetch } from '../lib/api-client';
import {
  COURSE_BY_SLUG,
  TARGETS,
  TARGET_BY_CODE,
  coursesForPair,
  type CourseSlug,
  type NativeLang,
  type TargetLang,
  type TargetMeta,
} from '../lib/content-types';

type Native = NativeLang;

const NATIVE_LABEL: Record<Native, { label: string; greeting: string }> = {
  en: { label: 'English', greeting: 'Hi!' },
  ru: { label: 'Русский', greeting: 'Привет!' },
  pl: { label: 'Polski',  greeting: 'Cześć!' },
  de: { label: 'Deutsch', greeting: 'Hallo!' },
};

// Display names for course slugs, in each native. Keep terse — these label
// secondary course cards under "Other courses".
const COURSE_LABEL: Record<Native, Record<CourseSlug, string>> = {
  en: { classic50: 'Classic 50', losreden50: 'Loslegen 50' },
  ru: { classic50: 'Classic 50', losreden50: 'Loslegen 50' },
  pl: { classic50: 'Classic 50', losreden50: 'Loslegen 50' },
  de: { classic50: 'Classic 50', losreden50: 'Loslegen 50' },
};

const COPY: Record<Native, {
  iSpeak: string;
  iLearn: string;
  notAvailable: string;
  currentLessonHeading: string;
  startHeading: string;
  startCta: string;
  continueCta: string;
  otherCoursesHeading: string;
  progressLine: (current: number, total: number, completed: number) => string;
  noCoursesForPair: string;
  signInHint: string;
}> = {
  en: {
    iSpeak: 'I speak',
    iLearn: 'I want to learn',
    notAvailable: 'Not yet available for this native',
    currentLessonHeading: 'Continue where you left off',
    startHeading: 'Start a course',
    startCta: 'Start lesson 1',
    continueCta: 'Resume',
    otherCoursesHeading: 'Courses available',
    progressLine: (current, total, completed) =>
      `Lesson ${current} of ${total} · ${completed} completed`,
    noCoursesForPair: 'No courses available for this pair yet.',
    signInHint: 'Sign in (top right) to save your progress across devices.',
  },
  ru: {
    iSpeak: 'Мой родной язык',
    iLearn: 'Хочу выучить',
    notAvailable: 'Пока недоступно для этого родного языка',
    currentLessonHeading: 'Продолжить с того же места',
    startHeading: 'Начать курс',
    startCta: 'Начать урок 1',
    continueCta: 'Продолжить',
    otherCoursesHeading: 'Доступные курсы',
    progressLine: (current, total, completed) =>
      `Урок ${current} из ${total} · завершено ${completed}`,
    noCoursesForPair: 'Для этой пары курсов пока нет.',
    signInHint: 'Войди (справа сверху), чтобы прогресс синхронизировался между устройствами.',
  },
  pl: {
    iSpeak: 'Mój język ojczysty',
    iLearn: 'Chcę się uczyć',
    notAvailable: 'Niedostępne dla tego języka ojczystego',
    currentLessonHeading: 'Wróć tam, gdzie skończyłeś',
    startHeading: 'Zacznij kurs',
    startCta: 'Zacznij lekcję 1',
    continueCta: 'Wznów',
    otherCoursesHeading: 'Dostępne kursy',
    progressLine: (current, total, completed) =>
      `Lekcja ${current} z ${total} · ukończono ${completed}`,
    noCoursesForPair: 'Brak kursów dla tej pary.',
    signInHint: 'Zaloguj się (prawy górny róg), by synchronizować postęp.',
  },
  de: {
    iSpeak: 'Meine Muttersprache',
    iLearn: 'Ich will lernen',
    notAvailable: 'Für diese Muttersprache noch nicht verfügbar',
    currentLessonHeading: 'Da weitermachen, wo du aufgehört hast',
    startHeading: 'Kurs starten',
    startCta: 'Lektion 1 starten',
    continueCta: 'Fortsetzen',
    otherCoursesHeading: 'Verfügbare Kurse',
    progressLine: (current, total, completed) =>
      `Lektion ${current} von ${total} · ${completed} abgeschlossen`,
    noCoursesForPair: 'Für diese Sprachkombination sind noch keine Kurse verfügbar.',
    signInHint: 'Melde dich an (oben rechts), damit dein Fortschritt zwischen Geräten synchronisiert wird.',
  },
};

type Copy = (typeof COPY)[Native];

// Per-course progress derived from the local Zustand store.
interface CourseProgress {
  course: CourseSlug;
  lastLessonN: number;
  lessonsCompleted: number;
  lastActivityISO: string;
}

const NATIVE_STORAGE_KEY = 'gl.landing.native';
const TARGET_STORAGE_KEY = 'gl.landing.target';

function detectBrowserNative(): Native {
  if (typeof navigator === 'undefined') return 'en';
  const langs = (navigator.languages?.length ? navigator.languages : [navigator.language]) ?? [];
  for (const l of langs) {
    const head = l.slice(0, 2).toLowerCase();
    if (head === 'ru' || head === 'pl' || head === 'en' || head === 'de') return head as Native;
  }
  return 'en';
}

function firstAvailableTarget(n: Native): TargetMeta | undefined {
  return TARGETS.find((t) => t.natives.includes(n));
}

export function LandingClient() {
  const { user, ready } = useSession();
  const searchParams = useSearchParams();

  // Native: query → localStorage → browser → 'en'. Initialized to 'en' to
  // match SSR; client effect overwrites on mount.
  const [native, setNative] = useState<Native>('en');
  // Target initialized to first target matching current native. Real value
  // comes from the same mount effect.
  const [target, setTarget] = useState<TargetLang>('de');

  useEffect(() => {
    const qp = searchParams?.get('native');
    let n: Native;
    if (qp === 'ru' || qp === 'en' || qp === 'pl') {
      n = qp;
    } else {
      const stored = localStorage.getItem(NATIVE_STORAGE_KEY);
      if (stored === 'ru' || stored === 'en' || stored === 'pl') {
        n = stored;
      } else {
        n = detectBrowserNative();
      }
    }
    setNative(n);

    const tStored = localStorage.getItem(TARGET_STORAGE_KEY);
    const tCandidate = TARGET_BY_CODE[tStored as TargetLang];
    if (tCandidate && tCandidate.natives.includes(n)) {
      setTarget(tCandidate.code);
    } else {
      const fallback = firstAvailableTarget(n);
      if (fallback) setTarget(fallback.code);
    }
  }, [searchParams]);

  // Persist + auto-correct target when native changes and the current target
  // doesn't support it.
  function pickNative(n: Native) {
    setNative(n);
    try { localStorage.setItem(NATIVE_STORAGE_KEY, n); } catch { /* private mode */ }
    const tm = TARGET_BY_CODE[target];
    if (!tm || !tm.natives.includes(n)) {
      const fallback = firstAvailableTarget(n);
      if (fallback) {
        setTarget(fallback.code);
        try { localStorage.setItem(TARGET_STORAGE_KEY, fallback.code); } catch {}
      }
    }
  }

  function pickTarget(t: TargetLang) {
    setTarget(t);
    try { localStorage.setItem(TARGET_STORAGE_KEY, t); } catch { /* private mode */ }
  }

  if (!ready) {
    return (
      <div className="mt-10 flex items-center gap-2 text-zinc-500">
        <Spinner size={18} /> <span className="text-sm">Loading…</span>
      </div>
    );
  }

  const copy = COPY[native];
  const targetMeta = TARGET_BY_CODE[target];

  return (
    <div className="mt-8 space-y-8">
      {/* Global "continue where you left off" hero. Only renders for signed-in
          users with at least one course they've actually opened — independent
          of the currently-selected language pair. Hides silently otherwise. */}
      <LastActivityHero user={user} copy={copy} />

      {/* Native picker. */}
      <Picker
        heading={copy.iSpeak}
        items={(['en', 'ru', 'pl', 'de'] as const).map((n) => ({
          key: n,
          active: n === native,
          available: true,
          onSelect: () => pickNative(n),
          subtitle: n.toUpperCase(),
          title: NATIVE_LABEL[n].label,
        }))}
        cols={4}
      />

      {/* Target picker — all 6 targets, disabled when the chosen native isn't
          supported. */}
      <Picker
        heading={copy.iLearn}
        items={TARGETS.map((t) => ({
          key: t.code,
          active: t.code === target,
          available: t.natives.includes(native),
          onSelect: () => pickTarget(t.code),
          subtitle: t.flag,
          title: t.endonym,
          tooltipUnavailable: copy.notAvailable,
        }))}
        cols={3}
      />

      {/* All courses available for the chosen (target, native) pair. */}
      <CoursesForPair
        user={user}
        target={targetMeta}
        native={native}
        copy={copy}
      />
    </div>
  );
}

// Generic two-row picker (subtitle on top, title on bottom). Used for both
// native and target rows so they share styling, focus behavior, and disabled
// rendering.
function Picker({
  heading,
  items,
  cols,
}: {
  heading: string;
  items: {
    key: string;
    active: boolean;
    available: boolean;
    onSelect: () => void;
    subtitle: string;
    title: string;
    tooltipUnavailable?: string;
  }[];
  cols: 3 | 4 | 6;
}) {
  return (
    <section>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 mb-3">{heading}</h2>
      <div
        className={
          'grid gap-2 ' +
          (cols === 3
            ? 'grid-cols-3 max-w-sm'
            : cols === 4
              ? 'grid-cols-2 sm:grid-cols-4 max-w-md'
              : 'grid-cols-3 sm:grid-cols-6 max-w-2xl')
        }
      >
        {items.map((it) => {
          if (!it.available) {
            return (
              <div
                key={it.key}
                title={it.tooltipUnavailable}
                className="rounded-md border border-zinc-200 dark:border-zinc-800 px-3 py-3 text-center font-medium opacity-40 cursor-not-allowed"
              >
                <div className="text-xs uppercase tracking-wide text-zinc-500">{it.subtitle}</div>
                <div className="mt-0.5 truncate">{it.title}</div>
              </div>
            );
          }
          return (
            <button
              key={it.key}
              type="button"
              onClick={it.onSelect}
              aria-pressed={it.active}
              className={
                'rounded-md border px-3 py-3 text-center font-medium transition-colors ' +
                (it.active
                  ? 'border-zinc-900 dark:border-zinc-100 bg-zinc-50 dark:bg-zinc-900'
                  : 'border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900')
              }
            >
              <div className="text-xs uppercase tracking-wide text-zinc-500">{it.subtitle}</div>
              <div className="mt-0.5 truncate">{it.title}</div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

// Global "continue where you left off" hero. Walks ALL course-progress
// entries in the Zustand store (not just the currently-selected pair),
// picks the most recent activity, and renders a single big link to that
// lesson. Renders nothing when the user is signed out or has no activity.
function LastActivityHero({
  user,
  copy,
}: {
  user: { email: string } | null;
  copy: Copy;
}) {
  const courses = useProgressStore((s) => s.courses);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  // Seed the store from the server on first sign-in so the hero is accurate
  // even for users who arrive on a fresh device.
  useEffect(() => {
    if (!hydrated || !user) return;
    let cancelled = false;
    apiFetch<{ courses: Record<string, { state: unknown; updatedAt: string }> }>(
      '/api/progress/all',
    ).then((r) => {
      if (cancelled || !r.ok || !r.data) return;
      const incoming = r.data.courses;
      useProgressStore.setState((s) => {
        const merged = { ...s.courses };
        for (const [k, slice] of Object.entries(incoming)) {
          if (merged[k as keyof typeof merged]) continue;
          if (slice.state && typeof slice.state === 'object') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            merged[k as keyof typeof merged] = slice.state as any;
          }
        }
        return { courses: merged };
      });
    });
    return () => {
      cancelled = true;
    };
  }, [hydrated, user?.email]);

  if (!user) return null;

  const latest = findLatestActivity(courses);
  if (!latest) return null;

  const t = TARGET_BY_CODE[latest.target];
  if (!t || !t.natives.includes(latest.native)) return null;
  const href = `/${latest.target}/${latest.native}/lesson/${latest.course}/${latest.lessonN}`;
  const courseLabel = COURSE_LABEL[latest.native]?.[latest.course] ?? latest.course;

  return (
    <section>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 mb-3">
        {copy.currentLessonHeading}
      </h2>
      <Link
        href={href}
        className="block rounded-2xl border-2 border-zinc-900 dark:border-zinc-100 p-6 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
      >
        <div className="flex items-start gap-4">
          <span className="text-4xl shrink-0" aria-hidden>{t.flag}</span>
          <div className="min-w-0 flex-1">
            <div className="text-lg sm:text-xl font-semibold">{t.endonym}</div>
            <div className="mt-1 text-xs uppercase tracking-wide text-zinc-500">
              {courseLabel}
            </div>
            <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              {copy.progressLine(latest.lessonN, t.lessons, latest.lessonsCompleted)}
            </div>
          </div>
          <span
            className="shrink-0 self-center inline-flex items-center gap-1 px-4 py-2 rounded-md bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-medium"
            aria-hidden
          >
            {copy.continueCta} →
          </span>
        </div>
      </Link>
    </section>
  );
}

// All courses available for the selected (target, native) pair, with per-
// course progress (or a "start" hint if none yet). Replaces the older
// per-pair "Continue / Other courses" split — the global LastActivityHero
// above already covers "where did I leave off".
function CoursesForPair({
  user,
  target,
  native,
  copy,
}: {
  user: { email: string } | null;
  target: TargetMeta;
  native: Native;
  copy: Copy;
}) {
  const courses = useProgressStore((s) => s.courses);
  const availableCourses = useMemo(
    () => coursesForPair(target.code, native),
    [target.code, native],
  );

  if (availableCourses.length === 0) {
    return (
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 mb-3">
          {copy.otherCoursesHeading}
        </h2>
        <p className="text-sm text-zinc-500">{copy.noCoursesForPair}</p>
      </section>
    );
  }

  return (
    <section>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 mb-3">
        {copy.otherCoursesHeading}
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {availableCourses.map((slug) => {
          const p = deriveProgress(courses, slug, target.code, native);
          const lessonN = p?.lastLessonN ?? 1;
          // Link to the course-home page (lesson grid + intro), not directly
          // to a lesson — the user picks where to go from there. The global
          // "continue" hero above still deep-links to the actual lesson.
          const href = `/${target.code}/${native}/${slug}`;
          return (
            <Link
              key={slug}
              href={href}
              className="block rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl shrink-0" aria-hidden>{target.flag}</span>
                <div className="min-w-0">
                  <div className="font-semibold">{COURSE_LABEL[native][slug]}</div>
                  <div className="text-xs text-zinc-500 mt-0.5">
                    {p
                      ? copy.progressLine(lessonN, target.lessons, p.lessonsCompleted)
                      : `${COURSE_BY_SLUG[slug].slug} · ${copy.startCta}`}
                  </div>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
      {!user && (
        <p className="mt-3 text-xs text-zinc-500">{copy.signInHint}</p>
      )}
    </section>
  );
}

// Walk every entry in the progress store, parse its courseKey, and return
// the (target, native, course, lesson, completed-count) of the most-recent
// activity. Returns null when nothing has been started.
function findLatestActivity(
  courses: Record<string, unknown>,
): {
  course: CourseSlug;
  target: TargetLang;
  native: NativeLang;
  lessonN: number;
  lessonsCompleted: number;
  iso: string;
} | null {
  let best: {
    course: CourseSlug;
    target: TargetLang;
    native: NativeLang;
    lessonN: number;
    lessonsCompleted: number;
    iso: string;
  } | null = null;
  for (const key of Object.keys(courses)) {
    const parts = key.split('.');
    if (parts.length !== 3) continue;
    const [course, target, native] = parts as [CourseSlug, TargetLang, NativeLang];
    if (!COURSE_BY_SLUG[course]) continue;
    if (!TARGET_BY_CODE[target]) continue;
    if (!(native === 'ru' || native === 'en' || native === 'pl' || native === 'de')) continue;
    const p = deriveProgress(courses, course, target, native);
    if (!p) continue;
    if (!best || p.lastActivityISO > best.iso) {
      best = {
        course,
        target,
        native,
        lessonN: p.lastLessonN,
        lessonsCompleted: p.lessonsCompleted,
        iso: p.lastActivityISO,
      };
    }
  }
  return best;
}

// Walk the Zustand course state for one (course, target, native) triple and
// summarise: completed lessons, the most recent lesson the user touched, and
// the ISO timestamp of that activity. Returns null if the course has nothing
// started — the caller treats that as "no progress" and shows the start CTA.
function deriveProgress(
  courses: Record<string, unknown>,
  course: CourseSlug,
  target: TargetLang,
  native: NativeLang,
): CourseProgress | null {
  const courseKey = `${course}.${target}.${native}`;
  const raw = courses[courseKey];
  if (!raw || typeof raw !== 'object') return null;
  const state = raw as {
    lessons: Record<string, {
      startedAt?: string;
      completedAt?: string;
      exercises?: Record<string, { lastTry?: string }>;
    }>;
    tests: Record<string, { attempts?: { startedAt?: string; finishedAt?: string }[] }>;
  };

  const lessonEntries = Object.entries(state.lessons ?? {});
  if (lessonEntries.length === 0) return null;

  let lessonsCompleted = 0;
  let lastActivityISO = '';
  let lastLessonN = 0;
  for (const [nStr, lp] of lessonEntries) {
    if (lp.completedAt) lessonsCompleted += 1;
    let lessonLatest = lp.startedAt ?? '';
    if (lp.completedAt && lp.completedAt > lessonLatest) lessonLatest = lp.completedAt;
    for (const ex of Object.values(lp.exercises ?? {})) {
      if (ex.lastTry && ex.lastTry > lessonLatest) lessonLatest = ex.lastTry;
    }
    if (lessonLatest && lessonLatest > lastActivityISO) {
      lastActivityISO = lessonLatest;
      lastLessonN = parseInt(nStr, 10);
    }
  }
  for (const [nStr, tp] of Object.entries(state.tests ?? {})) {
    for (const att of tp.attempts ?? []) {
      const t = att.finishedAt ?? att.startedAt ?? '';
      if (t && t > lastActivityISO) {
        lastActivityISO = t;
        lastLessonN = parseInt(nStr, 10);
      }
    }
  }
  if (!lastLessonN) return null;
  return { course, lastLessonN, lessonsCompleted, lastActivityISO };
}
