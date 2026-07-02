import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getCurriculum, getCourseIndex, getCoursesForPair } from '../../../../lib/content';
import { getCourseIntro } from '../../../../lib/course-intros';
import { CourseUnavailable } from '../../../../components/CourseUnavailable';
import { LessonProgressDot, TestProgressBadge } from '../../../../components/ProgressDots';
import { ProgressHeatmap } from '../../../../components/ProgressHeatmap';
import { JsonLd } from '../../../../components/JsonLd';
import { buildLanguageAlternates } from '../../../../lib/seo';
import { absoluteUrl } from '../../../../lib/site-url';
import { locales } from '../../../../i18n/request';
import {
  COURSES,
  TARGETS,
  TARGET_BY_CODE,
  type CourseSlug,
  type NativeLang,
  type TargetLang,
} from '../../../../lib/content-types';

export function generateStaticParams() {
  const params: { target: string; native: string; course: string }[] = [];
  for (const t of TARGETS) {
    for (const n of t.natives) {
      if (!(locales as readonly string[]).includes(n)) continue;
      for (const c of COURSES) {
        params.push({ target: t.code, native: n, course: c.slug });
      }
    }
  }
  return params;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ target: string; native: string; course: string }>;
}): Promise<Metadata> {
  const { target, native, course } = await params;
  const targetMeta = TARGET_BY_CODE[target as TargetLang];
  if (
    !targetMeta ||
    !(locales as readonly string[]).includes(native) ||
    !targetMeta.natives.includes(native as NativeLang) ||
    !COURSES.some((c) => c.slug === course)
  ) {
    return {};
  }
  const curriculum = getCurriculum(course as CourseSlug, target as TargetLang, native as NativeLang);
  const title = `${curriculum.title} · Glottos Matrix`;
  const description =
    curriculum.subtitle ??
    `${targetMeta.endonym} · 50 lessons · 150 listening texts · 50 tests · Glottos Matrix.`;
  const alternates = buildLanguageAlternates(target as TargetLang, native as NativeLang, `/${course}`);
  return {
    title,
    description,
    alternates,
    openGraph: {
      type: 'website',
      title,
      description,
      url: alternates.canonical as string,
      siteName: 'Glottos Matrix',
      locale: native,
    },
    twitter: { card: 'summary', title, description },
  };
}

export default async function CourseHome({
  params,
}: {
  params: Promise<{ target: string; native: string; course: string }>;
}) {
  const { target, native, course } = await params;
  const targetMeta = TARGET_BY_CODE[target as TargetLang];
  if (!targetMeta) notFound();
  if (!(locales as readonly string[]).includes(native)) notFound();
  if (!targetMeta.natives.includes(native as NativeLang)) notFound();
  if (!COURSES.some((c) => c.slug === course)) notFound();
  const lang = native as NativeLang;
  const tgt = target as TargetLang;
  const crs = course as CourseSlug;

  // If the course isn't yet authored for this (target, native) pair, render
  // a friendly "coming soon" page instead of 404 — the LangSwitcher can land
  // here when the user swaps native mid-course (e.g. losreden50 → en).
  if (!getCoursesForPair(tgt, lang).includes(crs)) {
    return <CourseUnavailable target={tgt} native={lang} course={crs} />;
  }

  const curriculum = getCurriculum(crs, tgt, lang);
  const idx = getCourseIndex(crs, tgt, lang);
  const testsByN = new Map(idx.tests.map((tt) => [tt.n, tt.title]));
  const t = await getTranslations({ locale: native, namespace: 'courseHome' });

  const availableLessons = new Set(idx.lessons.map((l) => l.n));

  const blockTestAfterLesson = (b: { lessons: { n: number }[] }) =>
    b.lessons.length > 0 ? b.lessons[b.lessons.length - 1]!.n : null;

  const courseUrl = absoluteUrl(`/${tgt}/${native}/${crs}`);
  const courseLd = {
    '@context': 'https://schema.org',
    '@type': 'Course',
    name: curriculum.title,
    description: curriculum.subtitle ?? curriculum.title,
    url: courseUrl,
    inLanguage: tgt,
    provider: { '@type': 'Organization', name: 'Glottos Matrix', url: absoluteUrl('/') },
    numberOfCredits: idx.lessons.length,
    hasCourseInstance: {
      '@type': 'CourseInstance',
      courseMode: 'online',
      inLanguage: tgt,
    },
  };
  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Glottos Matrix', item: absoluteUrl('/') },
      { '@type': 'ListItem', position: 2, name: targetMeta.endonym, item: absoluteUrl(`/${tgt}/${native}`) },
      { '@type': 'ListItem', position: 3, name: curriculum.title, item: courseUrl },
    ],
  };

  return (
    <div className="py-6 md:py-10">
      <JsonLd data={courseLd} />
      <JsonLd data={breadcrumbLd}/>
      <h1 className="text-3xl md:text-4xl font-bold tracking-tight">{curriculum.title}</h1>
      {curriculum.subtitle && (
        <p className="mt-2 text-zinc-600 dark:text-zinc-400 text-sm">{curriculum.subtitle}</p>
      )}
      {targetMeta.status === 'preview' && (
        <p className="mt-3 text-sm rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 px-3 py-2">
          {t.has('previewBanner')
            ? t('previewBanner')
            : `Курс в разработке: доступно ${targetMeta.lessons} ${targetMeta.lessons === 1 ? 'урок' : 'уроков'} из 50.`}
        </p>
      )}

      {/* Introduction card — shown above the curriculum blocks when the
          course has authored an intro for this native language. Acts as
          "Lesson 0": read it before Lesson 1. */}
      {getCourseIntro(crs, lang) !== null && (
        <section className="mt-6 rounded-xl border-2 border-zinc-900 dark:border-zinc-100 p-4 sm:p-5 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors">
          <Link href={`/${tgt}/${native}/${crs}/intro`} className="block">
            <div className="flex items-center gap-4">
              <span className="text-3xl shrink-0" aria-hidden>📖</span>
              <div className="min-w-0 flex-1">
                <div className="text-lg font-semibold">{t('introTitle')}</div>
                <div className="text-sm text-zinc-600 dark:text-zinc-400 mt-0.5">
                  {t('introSubtitle')}
                </div>
              </div>
              <span className="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-medium" aria-hidden>
                {t('introOpen')} →
              </span>
            </div>
          </Link>
        </section>
      )}

      {/* Activity heatmap. Self-hides for signed-out users. */}
      <ProgressHeatmap courseKey={`${crs}.${tgt}.${lang}`} />

      <div className="mt-8 space-y-6">
        {curriculum.blocks.map((block) => {
          const testAfter = blockTestAfterLesson(block);
          const testAvailable = testAfter != null && idx.tests.some((tt) => tt.n === testAfter);
          return (
            <section
              key={block.id}
              className="rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden"
            >
              <header className="bg-zinc-50 dark:bg-zinc-900 px-4 py-3 border-b border-zinc-200 dark:border-zinc-800">
                <h2 className="text-base md:text-lg font-semibold leading-snug">
                  {block.title}
                </h2>
                {block.rankLabel && (
                  <p className="text-xs text-zinc-500 mt-0.5">{t('rankLabel')}: {block.rankLabel}</p>
                )}
              </header>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-zinc-200 dark:bg-zinc-800">
                {block.lessons.map((l) => {
                  const ready = availableLessons.has(l.n);
                  const inner = (
                    <>
                      <div className="flex items-center gap-2 text-xs text-zinc-500">
                        {ready ? (
                          <LessonProgressDot
                            course={crs}
                            targetLang={tgt}
                            nativeLang={lang}
                            lessonN={l.n}
                          />
                        ) : (
                          <span className="inline-block w-2 h-2 rounded-full bg-zinc-200 dark:bg-zinc-800" />
                        )}
                        {t('lessonLabel')} {l.n}
                        {!ready && (
                          <span className="ml-auto text-[10px] uppercase tracking-wide text-zinc-400">
                            {t.has('comingSoon') ? t('comingSoon') : 'скоро'}
                          </span>
                        )}
                      </div>
                      <div className="font-medium mt-0.5 text-sm leading-snug">{l.grammar}</div>
                      <div className="text-xs text-zinc-600 dark:text-zinc-400 mt-1 leading-snug line-clamp-2">
                        {l.vocab}
                      </div>
                    </>
                  );
                  return ready ? (
                    <Link
                      key={l.n}
                      href={`/${tgt}/${lang}/lesson/${crs}/${l.n}`}
                      className="bg-white dark:bg-zinc-950 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900"
                    >
                      {inner}
                    </Link>
                  ) : (
                    <div
                      key={l.n}
                      className="bg-zinc-50/40 dark:bg-zinc-900/40 px-4 py-3 opacity-60 cursor-not-allowed"
                    >
                      {inner}
                    </div>
                  );
                })}
                {testAfter != null && testAvailable && (
                  <Link
                    href={`/${tgt}/${lang}/test/${crs}/${testAfter}`}
                    className="bg-amber-50 dark:bg-amber-950/30 px-4 py-3 hover:bg-amber-100 dark:hover:bg-amber-900/40 col-span-full md:col-span-1 lg:col-span-1"
                  >
                    <div className="text-xs text-amber-700 dark:text-amber-400 font-semibold flex items-center gap-2">
                      <span>{t('testAfter')} {testAfter}</span>
                      <TestProgressBadge course={crs} targetLang={tgt} nativeLang={lang} testN={testAfter} />
                    </div>
                    <div className="font-medium mt-0.5 text-sm leading-snug">
                      {testsByN.get(testAfter) ?? `Test ${testAfter}`}
                    </div>
                    {block.testDescription && (
                      <div className="text-xs text-zinc-600 dark:text-zinc-400 mt-1 leading-snug">
                        {block.testDescription}
                      </div>
                    )}
                  </Link>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
