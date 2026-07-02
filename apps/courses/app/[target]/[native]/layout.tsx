import { notFound } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { LangSwitcher } from '../../../components/LangSwitcher';
import { AuthMenu } from '../../../components/AuthMenu';
import { ProgressSync } from '../../../components/ProgressSync';
import { TelegramBackButtonBridge } from '../../../components/TelegramBackButtonBridge';
import { TutorLink } from '../../../components/TutorLink';
import { ModalNavLink } from '../../../components/ModalNavLink';
import { KeyboardShortcuts } from '../../../components/KeyboardShortcuts';
import { getCoursesForPair } from '../../../lib/content';
import { locales, type Locale } from '../../../i18n/request';
import {
  TARGETS,
  TARGET_BY_CODE,
  type NativeLang,
  type TargetLang,
} from '../../../lib/content-types';

export function generateStaticParams() {
  // Cross-product targets × their permitted natives. Skips combos with no
  // content (e.g. fr/en, sr/pl). The dashboard / dictionary / lesson / etc.
  // pages each layer their own generateStaticParams on top of these.
  const params: { target: string; native: string }[] = [];
  for (const t of TARGETS) {
    for (const n of t.natives) {
      if ((locales as readonly string[]).includes(n)) {
        params.push({ target: t.code, native: n });
      }
    }
  }
  return params;
}

export default async function NativeLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ target: string; native: string }>;
}) {
  const { target, native } = await params;
  if (!(locales as readonly string[]).includes(native)) notFound();
  const targetMeta = TARGET_BY_CODE[target as TargetLang];
  if (!targetMeta) notFound();
  if (!targetMeta.natives.includes(native as NativeLang)) notFound();
  setRequestLocale(native);

  const messages = (await import(`../../../messages/${native}.json`)).default;
  const tNav = await getTranslations({ locale: native, namespace: 'nav' });

  // One progress slice per course available for this (target, native) pair.
  // Each ProgressSync instance owns its own debounced PUT loop.
  const availableCourses = getCoursesForPair(target as TargetLang, native as NativeLang);

  return (
    <NextIntlClientProvider locale={native as Locale} messages={messages}>
      <TelegramBackButtonBridge target={target} native={native} />
      <KeyboardShortcuts />
      {availableCourses.map((courseSlug) => (
        <ProgressSync
          key={courseSlug}
          courseKey={`${courseSlug}.${target}.${native}`}
        />
      ))}
      <div className="min-h-screen flex flex-col overflow-x-clip">
        {/* TopBar and MobileBottomNav both carry data-tma-hide on their own
            outer element (not on a wrapper) so they hide cleanly inside a
            Telegram Mini App without disturbing the sticky positioning.
            The cookie → x-tma header → <html data-tma="true"> chain set up
            in middleware + root layout makes globals.css hide
            [data-tma-hide] elements on first paint with no flicker. */}
        <TopBar
          target={target}
          targetEndonym={targetMeta.endonym}
          native={native}
          labels={{
            course: tNav('course'),
            dictionary: tNav('dictionary'),
            progress: tNav('progress'),
            settings: tNav('settings'),
            tutor: tNav('tutor'),
            signOut: tNav('signOut'),
          }}
        />
        <main
          data-app-main
          className="flex-1 mx-auto w-full max-w-5xl px-4 pb-24 lg:pb-8 min-w-0 overflow-x-clip"
        >
          {children}
        </main>
        <MobileBottomNav
          target={target}
          native={native}
          labels={{
            course: tNav('course'),
            dictionaryShort: tNav('dictionaryShort'),
            progress: tNav('progress'),
            tutor: tNav('tutor'),
          }}
        />
      </div>
    </NextIntlClientProvider>
  );
}

interface NavLabels {
  course: string;
  dictionary: string;
  progress: string;
  /** Used as the avatar-dropdown entry now that the standalone nav link is
   *  gone — passed through to AuthMenu. */
  settings: string;
  /** Top-nav link that opens text-tutor (via openInTutor SSO handoff). */
  tutor: string;
  /** Localised "Sign out" label for the AuthMenu dropdown. */
  signOut: string;
}

function TopBar({
  target,
  targetEndonym,
  native,
  labels,
}: {
  target: string;
  targetEndonym: string;
  native: string;
  labels: NavLabels;
}) {
  const upper = target.toUpperCase();
  return (
    <header
      data-tma-hide
      className="sticky top-0 z-30 border-b border-zinc-200 dark:border-zinc-800 bg-white/95 dark:bg-zinc-950/95 backdrop-blur"
    >
      <div className="mx-auto max-w-5xl px-3 sm:px-4 h-14 flex items-center justify-between gap-2 min-w-0">
        <Link
          href="/"
          className="inline-flex items-center min-h-[36px] -my-1 font-semibold tracking-tight min-w-0 truncate text-sm sm:text-base"
        >
          <span className="sm:hidden">Glottos · {upper}</span>
          <span className="hidden sm:inline">Glottos Matrix · {targetEndonym}</span>
        </Link>
        <nav className="hidden lg:flex items-center gap-1 text-sm">
          <ModalNavLink
            id="nav-courses"
            href={`/${target}/${native}`}
            label={labels.course}
            shortcut={['g', 'c']}
          />
          {/* Dictionary is consolidated per (target, native). Dashboard is
              still course-scoped, so it defaults to classic50. */}
          <ModalNavLink
            id="nav-dictionary"
            href={`/${target}/${native}/dictionary`}
            label={labels.dictionary}
            shortcut={['g', 'v']}
          />
          <ModalNavLink
            id="nav-progress"
            href={`/${target}/${native}/dashboard/classic50`}
            label={labels.progress}
            shortcut={['g', 'p']}
          />
          <TutorLink style="nav" label={labels.tutor} />
        </nav>
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <AuthMenu
            target={target as TargetLang}
            native={native as NativeLang}
            settingsLabel={labels.settings}
            signOutLabel={labels.signOut}
          />
          <LangSwitcher current={native} target={target} />
        </div>
      </div>
    </header>
  );
}

function MobileBottomNav({
  target,
  native,
  labels,
}: {
  target: string;
  native: string;
  labels: { course: string; dictionaryShort: string; progress: string; tutor: string };
}) {
  return (
    <nav
      data-tma-hide
      // Lean strip: icon (≈18 px) + tiny caption fits in ~46 px of vertical
      // chrome so the bar doesn't eat the bottom of a small-screen view.
      // Each cell is its own tap target ≥44 px wide via grid-cols-4.
      className="lg:hidden fixed bottom-0 left-0 right-0 z-30 border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950"
    >
      <div className="grid grid-cols-4">
        {/* Same iframe-modal pattern the desktop top bar uses: tapping a
            tile pops the target page over the current one instead of
            navigating away, so in-progress state (an open test, a typed
            answer) survives the peek. Course / Dictionary / Progress all
            need this — the test page in particular held everything in
            local state and a real navigation wiped it. */}
        {/* Icons go in as `children` (React elements), not as function
            refs — passing a function across the Server→Client boundary
            into ModalNavLink fails RSC serialization. The server renders
            each <IconX /> here, then hands the resulting element down. */}
        <ModalNavLink
          style="bottom"
          href={`/${target}/${native}`}
          label={labels.course}
        >
          <IconCourse />
        </ModalNavLink>
        <ModalNavLink
          style="bottom"
          href={`/${target}/${native}/dictionary`}
          label={labels.dictionaryShort}
        >
          <IconDictionary />
        </ModalNavLink>
        <ModalNavLink
          style="bottom"
          href={`/${target}/${native}/dashboard/classic50`}
          label={labels.progress}
        >
          <IconProgress />
        </ModalNavLink>
        {/* Tutor replaces Settings in the bottom strip — Settings now lives
            in the avatar dropdown so this slot can advertise the
            cross-app handoff instead. */}
        <TutorLink style="bottom" label={labels.tutor} />
      </div>
    </nav>
  );
}

// ---- Inline icons ---------------------------------------------------------
// Minimal stroked glyphs (1.75 stroke width) so they read at 18 px without
// extra vendor weight. Each is a pure function — no props — because every
// instance in the nav strip uses the same size/color/style.

function IconCourse() {
  // Open-book glyph for "Courses" — reads as "lessons / studying" on mobile.
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2 4.5h7a3 3 0 0 1 3 3v12a3 3 0 0 0-3-3H2z" />
      <path d="M22 4.5h-7a3 3 0 0 0-3 3v12a3 3 0 0 1 3-3h7z" />
    </svg>
  );
}

function IconDictionary() {
  // "Aa" mark inside a card — unambiguous on a language-learning app.
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="3.5" width="18" height="17" rx="2" />
      <path d="M7 16l2.5-6 2.5 6M8 14h3M14 16l1.5-4 1.5 4M14.5 15h2" />
    </svg>
  );
}

function IconProgress() {
  // Ascending bars — "progress" in any culture.
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 20V14M10 20V10M16 20V6M22 20H2" />
    </svg>
  );
}

