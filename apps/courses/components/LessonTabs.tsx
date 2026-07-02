'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { AuthMenu } from './AuthMenu';
import { useSession } from './SessionProvider';
import { useTelegram } from './TelegramProvider';
import { useTelegramMainButton } from '../lib/use-telegram-main-button';
import { useProgressStore } from '../lib/store';
import { capture } from '../lib/analytics';
import type { CourseSlug, Exercise, NativeLang, TargetLang } from '../lib/content-types';

export type TabKey =
  | 'theory'
  | 'writing'
  | 'audio'
  | 'cheatsheet'
  | 'moreExercises'
  | 'vocabulary';

interface Props {
  /** Tab content keyed by tab. A null/undefined value hides the tab. Passed as
   *  a named prop (not `children`) because React 19's RSC boundary doesn't
   *  validate elements stored inside an arbitrary object children value, which
   *  produced a spurious "missing key" warning. */
  panels: Partial<Record<TabKey, ReactNode>>;
  initialTab?: TabKey;
  /** Lesson context used to annotate the lesson_tab_selected analytics event. */
  targetLang: TargetLang;
  nativeLang: NativeLang;
  lessonN: number;
  /** For the writing-tab completion checkmark (computed from progress store). */
  course: CourseSlug;
  writingExercises: Exercise[];
  /** Last-tab "Next lesson →" CTA target. Undefined on the final lesson. */
  nextLessonHref?: string;
  nextLessonTitle?: string;
}

// Public tabs render for anonymous users — they're pure reference content
// with no progress tracking and no API-token spend. Theory is the SEO landing
// for the lesson page; cheatsheet is the recap at the bottom that visitors
// often skim to decide whether to engage. Every other tab (writing, more
// exercises, audio practice, vocab) records progress or hits Claude/TTS APIs,
// so it requires sign-in.
function tabRequiresAuth(tab: TabKey): boolean {
  return tab !== 'theory' && tab !== 'cheatsheet';
}

// Order matches the recommended study flow: read the theory, learn the
// vocab, drill the writing exercises, push for more, finish with audio.
// Cheatsheet stays at the end as an optional recap.
const TABS: { key: TabKey; emoji: string }[] = [
  { key: 'theory', emoji: '📖' },
  { key: 'vocabulary', emoji: '📚' },
  { key: 'writing', emoji: '✍️' },
  { key: 'moreExercises', emoji: '💡' },
  { key: 'audio', emoji: '🔊' },
  { key: 'cheatsheet', emoji: '📝' },
];

function isTabKey(s: string): s is TabKey {
  return (
    s === 'theory' ||
    s === 'writing' ||
    s === 'audio' ||
    s === 'cheatsheet' ||
    s === 'moreExercises' ||
    s === 'vocabulary'
  );
}

export function LessonTabs({
  panels,
  initialTab = 'theory',
  targetLang,
  nativeLang,
  lessonN,
  course,
  writingExercises,
  nextLessonHref,
  nextLessonTitle,
}: Props) {
  const t = useTranslations('lesson.tabs');
  const tLesson = useTranslations('lesson');
  const { user, ready } = useSession();
  // Hide tabs whose panels entry is null — the lesson page omits content
  // for empty sections (e.g. losreden50 lessons have no cheatsheet) so the
  // tab strip doesn't show empty tabs that lead to "—" panels.
  const visibleTabs = TABS.filter((t) => panels[t.key] != null);
  const visibleSet = useMemo(() => new Set(visibleTabs.map((t) => t.key)), [visibleTabs]);
  const startTab: TabKey = visibleSet.has(initialTab) ? initialTab : visibleTabs[0]?.key ?? 'theory';
  const [active, setActive] = useState<TabKey>(startTab);

  // Writing-tab "done" signal: every prompt of every (non-open-ended) exercise
  // has a recorded correct answer. Read straight from the persisted progress
  // store; falls back to false during SSR and pre-hydration.
  const courseKey = `${course}.${targetLang}.${nativeLang}` as const;
  const writingDone = useProgressStore((s) => {
    const progress = s.courses[courseKey]?.lessons[lessonN]?.exercises;
    if (!progress || writingExercises.length === 0) return false;
    for (const ex of writingExercises) {
      if (ex.isOpenEnded || ex.prompts.length === 0) continue;
      const p = progress[ex.slug];
      if (!p) return false;
      for (let i = 0; i < ex.prompts.length; i++) {
        if (!p.correctMask?.[i]) return false;
      }
    }
    return true;
  });

  useEffect(() => {
    const fromHash = window.location.hash.slice(1);
    if (isTabKey(fromHash)) setActive(fromHash);
    const onHashChange = () => {
      const k = window.location.hash.slice(1);
      if (isTabKey(k)) setActive(k);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  function selectTab(k: TabKey, via: 'click' | 'next' = 'click'): void {
    setActive(k);
    history.replaceState(null, '', `#${k}`);
    capture('lesson_tab_selected', {
      course_key: `${targetLang}.${nativeLang}`,
      target_lang: targetLang,
      native_lang: nativeLang,
      lesson_n: lessonN,
      tab: k,
      via,
    });
  }

  // Telegram MainButton mirrors the inline tab-bottom CTA so the learner
  // can advance with the prominent system button at the bottom of the
  // WebView. AnswerInput claims the MainButton while typing; this hook's
  // claim is reasserted whenever no answer is in flight, so the tab CTA
  // takes over between answers. Inert outside Telegram.
  const router = useRouter();
  const { isTma } = useTelegram();
  const activeIdx = visibleTabs.findIndex((t) => t.key === active);
  const nextTabForActive = activeIdx >= 0 ? visibleTabs[activeIdx + 1] ?? null : null;
  const isLastTabActive = activeIdx >= 0 && nextTabForActive === null;
  // Always register so the claim stack snaps back to "next step" when an
  // AnswerInput unmounts. `visible` decides whether anything actually
  // shows.
  useTelegramMainButton({
    text: nextTabForActive
      ? `${tLesson('nextStep')}: ${t(nextTabForActive.key)} →`
      : isLastTabActive && nextLessonHref && nextLessonTitle
        ? `${tLesson('nextLesson')}: ${nextLessonTitle} →`
        : isLastTabActive && nextLessonHref
          ? `${tLesson('nextLesson')} →`
          : '',
    onClick: () => {
      if (nextTabForActive) {
        selectTab(nextTabForActive.key, 'next');
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            window.scrollTo({ top: 0, behavior: 'auto' });
          });
        });
      } else if (isLastTabActive && nextLessonHref) {
        router.push(nextLessonHref);
      }
    },
    visible:
      isTma &&
      (nextTabForActive != null || (isLastTabActive && !!nextLessonHref)),
  });

  return (
    <>
      <nav
        role="tablist"
        className="sticky top-14 z-20 -mx-4 px-4 bg-white/95 dark:bg-zinc-950/95 backdrop-blur border-b border-zinc-200 dark:border-zinc-800"
      >
        {/* Mobile: emoji-only single row (six tabs × ~44 px fits on a 320 px
            viewport without scrolling). Mobile screen-reader users still
            get the label via aria-label + the visible "tabDone"/lock chip.
            md+ shows emoji + the localized label inline as before. */}
        <div className="flex flex-nowrap md:flex-nowrap gap-1 py-2 -mb-px overflow-x-auto">
          {visibleTabs.map((tab) => {
            const isActive = active === tab.key;
            const locked = ready && !user && tabRequiresAuth(tab.key);
            const done = tab.key === 'writing' && writingDone;
            const label = t(tab.key);
            return (
              <button
                key={tab.key}
                role="tab"
                aria-selected={isActive}
                aria-controls={`tabpanel-${tab.key}`}
                id={`tab-${tab.key}`}
                type="button"
                onClick={() => selectTab(tab.key)}
                aria-label={label}
                title={locked ? tLesson('locked') : label}
                className={
                  'flex items-center gap-1.5 px-2.5 md:px-3 py-2 text-sm font-medium whitespace-nowrap rounded-t-md border-b-2 transition-colors min-h-[40px] ' +
                  (isActive
                    ? 'border-zinc-900 dark:border-zinc-100 text-zinc-900 dark:text-zinc-100'
                    : 'border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100')
                }
              >
                <span aria-hidden className="text-base leading-none">{tab.emoji}</span>
                <span className="hidden md:inline">{label}</span>
                {locked && (
                  <span aria-hidden className="text-xs opacity-70" title={tLesson('locked')}>🔒</span>
                )}
                {done && (
                  <span aria-hidden className="text-xs text-green-600 dark:text-green-400">{tLesson('tabDone')}</span>
                )}
              </button>
            );
          })}
        </div>
      </nav>

      {visibleTabs.map((tab, i) => {
        // Continuous chain: every tab forwards to the next one. The last tab
        // jumps to the next lesson when one exists, so the learner is never
        // dropped without a clear next action.
        const nextTab = visibleTabs[i + 1] ?? null;
        const isLast = nextTab === null;
        // Gate only after we know the auth answer (ready). During SSR /
        // pre-hydration, ready=false so we render the real children — this
        // keeps initial paint stable and avoids a hydration mismatch warning.
        const gated = ready && !user && tabRequiresAuth(tab.key);
        return (
          <div
            key={tab.key}
            role="tabpanel"
            id={`tabpanel-${tab.key}`}
            aria-labelledby={`tab-${tab.key}`}
            hidden={active !== tab.key}
            className="pt-6"
          >
            {gated ? (
              <SignInRequired message={tLesson('signInRequired')} />
            ) : (
              <>
                {panels[tab.key]}
                {nextTab && (
                  <div className="mt-10 pt-6 border-t border-zinc-200 dark:border-zinc-800 flex justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        selectTab(nextTab.key, 'next');
                        // Scroll AFTER React commits the tab switch — otherwise
                        // the previous tab's bottom-of-page scrollY survives the
                        // layout shift and the new tab opens scrolled to where
                        // the old tab ended. Two rAFs guarantee the commit + a
                        // paint have happened; instant behavior avoids the
                        // smooth-scroll animation fighting the layout shift.
                        requestAnimationFrame(() => {
                          requestAnimationFrame(() => {
                            window.scrollTo({ top: 0, behavior: 'auto' });
                          });
                        });
                      }}
                      className="inline-flex items-center gap-2 px-5 py-3 rounded-md bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-medium hover:bg-zinc-700 dark:hover:bg-zinc-300 transition-colors"
                    >
                      <span>{tLesson('nextStep')}:</span>
                      <span aria-hidden>{nextTab.emoji}</span>
                      <span>{t(nextTab.key)} →</span>
                    </button>
                  </div>
                )}
                {isLast && nextLessonHref && (
                  <div className="mt-10 pt-6 border-t border-zinc-200 dark:border-zinc-800 flex justify-end">
                    <Link
                      href={nextLessonHref}
                      className="inline-flex items-center gap-2 px-5 py-3 rounded-md bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-medium hover:bg-zinc-700 dark:hover:bg-zinc-300 transition-colors"
                    >
                      <span>{tLesson('nextLesson')}:</span>
                      {nextLessonTitle && <span className="font-normal opacity-90 max-w-[200px] truncate">{nextLessonTitle}</span>}
                      <span aria-hidden>→</span>
                    </Link>
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}
    </>
  );
}

function SignInRequired({ message }: { message: string }) {
  return (
    <div className="py-12 max-w-md">
      <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">{message}</p>
      <AuthMenu />
    </div>
  );
}
