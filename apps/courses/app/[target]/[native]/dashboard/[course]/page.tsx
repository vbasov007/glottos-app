import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { DashboardClient } from '../../../../../components/DashboardClient';
import { CefrProgressBars } from '../../../../../components/CefrProgressBars';
import { getCourseIndex, getCoursesForPair } from '../../../../../lib/content';
import { CourseUnavailable } from '../../../../../components/CourseUnavailable';
import { getAllCefrLevels } from '../../../../../lib/cefr-levels';
import { locales } from '../../../../../i18n/request';
import {
  COURSES,
  TARGETS,
  TARGET_BY_CODE,
  type CourseSlug,
  type NativeLang,
  type TargetLang,
} from '../../../../../lib/content-types';

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

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ target: string; native: string; course: string }>;
}) {
  const { target, native, course } = await params;
  const targetMeta = TARGET_BY_CODE[target as TargetLang];
  if (
    !targetMeta ||
    !(locales as readonly string[]).includes(native) ||
    !targetMeta.natives.includes(native as NativeLang) ||
    !COURSES.some((c) => c.slug === course)
  ) {
    notFound();
  }
  const tgt = target as TargetLang;
  const lang = native as NativeLang;
  const crs = course as CourseSlug;
  if (!getCoursesForPair(tgt, lang).includes(crs)) {
    return <CourseUnavailable target={tgt} native={lang} course={crs} />;
  }

  const idx = getCourseIndex(crs, tgt, lang);
  const t = await getTranslations({ locale: native, namespace: 'dashboard' });
  const tCefr = await getTranslations({ locale: native, namespace: 'cefr' });
  const cefrPerLesson = getAllCefrLevels(tgt);
  const hasCefr = Object.keys(cefrPerLesson).length > 0;

  return (
    <div className="py-6 md:py-10">
      <h1 className="text-2xl md:text-3xl font-bold tracking-tight">{t('title')}</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{t('subtitle')}</p>

      {hasCefr && (
        <CefrProgressBars
          perLesson={cefrPerLesson}
          course={crs}
          targetLang={tgt}
          nativeLang={lang}
          labels={{
            vocabulary: tCefr('vocabulary'),
            grammar: tCefr('grammar'),
            completedNone: tCefr('completedNone'),
          }}
        />
      )}

      <DashboardClient
        course={crs}
        targetLang={tgt}
        nativeLang={lang}
        totalLessons={idx.lessons.length}
        totalTests={idx.tests.length}
        totalTexts={idx.texts.length}
        totalDictionaryEntries={idx.dictionaryEntries}
      />

      <div className="mt-8 text-sm">
        <Link
          href={`/${tgt}/${native}/${crs}`}
          className="inline-block rounded-md bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 px-4 py-2 font-medium hover:bg-zinc-700 dark:hover:bg-zinc-300"
        >
          {t('goToCourse')}
        </Link>
      </div>
    </div>
  );
}
