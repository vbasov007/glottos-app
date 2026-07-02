import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { TestRunner } from '../../../../../../components/TestRunner';
import { getTest, getCourseIndex, getCoursesForPair } from '../../../../../../lib/content';
import { CourseUnavailable } from '../../../../../../components/CourseUnavailable';
import { buildLanguageAlternates } from '../../../../../../lib/seo';
import { locales } from '../../../../../../i18n/request';
import {
  COURSES,
  TARGETS,
  TARGET_BY_CODE,
  type CourseSlug,
  type NativeLang,
  type TargetLang,
} from '../../../../../../lib/content-types';

export function generateStaticParams() {
  const params: { target: string; native: string; course: string; n: string }[] = [];
  for (const t of TARGETS) {
    for (const native of t.natives) {
      if (!(locales as readonly string[]).includes(native)) continue;
      for (const c of COURSES) {
        for (let n = 1; n <= t.lessons; n++) {
          params.push({ target: t.code, native, course: c.slug, n: String(n) });
        }
      }
    }
  }
  return params;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ target: string; native: string; course: string; n: string }>;
}): Promise<Metadata> {
  const { target, native, course, n: nStr } = await params;
  const targetMeta = TARGET_BY_CODE[target as TargetLang];
  const n = parseInt(nStr, 10);
  if (
    !targetMeta ||
    !(locales as readonly string[]).includes(native) ||
    !targetMeta.natives.includes(native as NativeLang) ||
    !COURSES.some((c) => c.slug === course) ||
    !Number.isFinite(n) ||
    n < 1 ||
    n > targetMeta.lessons
  ) {
    return {};
  }
  let title: string;
  let description: string;
  try {
    const test = getTest(course as CourseSlug, target as TargetLang, native as NativeLang, n);
    title = `${test.title} · ${targetMeta.endonym} · Glottos Matrix`;
    description = test.instruction || `${test.title}. ${targetMeta.endonym} · Glottos Matrix.`;
  } catch {
    title = `Test ${n} · ${targetMeta.endonym} · Glottos Matrix`;
    description = `${targetMeta.endonym} · Glottos Matrix.`;
  }
  const alternates = buildLanguageAlternates(
    target as TargetLang,
    native as NativeLang,
    `/test/${course}/${n}`,
  );
  return {
    title,
    description,
    alternates,
    openGraph: {
      type: 'article',
      title,
      description,
      url: alternates.canonical as string,
      siteName: 'Glottos Matrix',
      locale: native,
    },
    twitter: { card: 'summary', title, description },
  };
}

export default async function TestPage({
  params,
}: {
  params: Promise<{ target: string; native: string; course: string; n: string }>;
}) {
  const { target, native, course, n: nStr } = await params;
  const targetMeta = TARGET_BY_CODE[target as TargetLang];
  const n = parseInt(nStr, 10);
  if (
    !targetMeta ||
    !(locales as readonly string[]).includes(native) ||
    !targetMeta.natives.includes(native as NativeLang) ||
    !COURSES.some((c) => c.slug === course) ||
    !Number.isFinite(n) ||
    n < 1 ||
    n > targetMeta.lessons
  ) {
    notFound();
  }
  const lang = native as NativeLang;
  const tgt = target as TargetLang;
  const crs = course as CourseSlug;
  if (!getCoursesForPair(tgt, lang).includes(crs)) {
    return <CourseUnavailable target={tgt} native={lang} course={crs} />;
  }

  const test = getTest(crs, tgt, lang, n);
  const idx = getCourseIndex(crs, tgt, lang);
  const lessonTitle = idx.lessons.find((l) => l.n === n)?.title;
  const t = await getTranslations({ locale: native, namespace: 'test' });
  const tCourseHome = await getTranslations({ locale: native, namespace: 'courseHome' });

  return (
    <article className="py-6 md:py-10">
      <div className="text-xs text-zinc-500 mb-2">
        <Link
          href={`/${tgt}/${native}/lesson/${crs}/${n}`}
          className="inline-flex items-center min-h-[32px] -my-1 hover:underline"
        >
          ← {tCourseHome('lessonLabel')} {n}{lessonTitle ? ` · ${lessonTitle}` : ''}
        </Link>
      </div>
      <h1 className="text-2xl md:text-3xl font-bold tracking-tight leading-tight">
        {test.title}
      </h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        {test.instruction}
      </p>
      <div className="mt-2 text-xs text-zinc-500">
        {test.prompts.length} {t('promptsLabel')}
      </div>

      <TestRunner test={test} course={crs} targetLang={tgt} nativeLang={lang} />
    </article>
  );
}
