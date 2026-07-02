import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { MarkdownRenderer } from '../../../../../components/MarkdownRenderer';
import { getCourseIntro } from '../../../../../lib/course-intros';
import { getCoursesForPair } from '../../../../../lib/content';
import { CourseUnavailable } from '../../../../../components/CourseUnavailable';
import { buildLanguageAlternates } from '../../../../../lib/seo';
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
        // Only emit params for (course, native) pairs that have intro content
        // authored — otherwise the route would 404 anyway and bloat the build.
        if (getCourseIntro(c.slug, n) === null) continue;
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
  const intro = getCourseIntro(course as CourseSlug, native as NativeLang);
  if (!intro) return {};
  // Pull the H1 title from the markdown.
  const m = intro.match(/^#\s+(.+?)\s*$/m);
  const title = `${m ? m[1] : 'Introduction'} · Glottos Matrix`;
  const alternates = buildLanguageAlternates(
    target as TargetLang,
    native as NativeLang,
    `/${course}/intro`,
  );
  return {
    title,
    alternates,
    openGraph: {
      type: 'article',
      title,
      url: alternates.canonical as string,
      siteName: 'Glottos Matrix',
      locale: native,
    },
    twitter: { card: 'summary', title },
  };
}

export default async function CourseIntro({
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
  const crs = course as CourseSlug;
  const tgt = target as TargetLang;
  const lang = native as NativeLang;
  if (!getCoursesForPair(tgt, lang).includes(crs)) {
    return <CourseUnavailable target={tgt} native={lang} course={crs} />;
  }

  const intro = getCourseIntro(crs, lang);
  if (!intro) notFound();

  const t = await getTranslations({ locale: native, namespace: 'courseIntro' });

  return (
    <div className="py-6 md:py-10">
      <Link
        href={`/${tgt}/${lang}/${crs}`}
        className="text-sm text-zinc-500 hover:text-blue-600 dark:hover:text-blue-400 inline-flex items-center gap-1 min-h-[32px] -my-1"
      >
        ← {t('backToCourse')}
      </Link>
      <article className="mt-6">
        <MarkdownRenderer source={intro} />
      </article>
    </div>
  );
}
