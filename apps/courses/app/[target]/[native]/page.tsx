import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getCoursesForPair, getCourseIndex } from '../../../lib/content';
import { JsonLd } from '../../../components/JsonLd';
import { buildLanguageAlternates } from '../../../lib/seo';
import { absoluteUrl } from '../../../lib/site-url';
import { locales } from '../../../i18n/request';
import {
  COURSES,
  TARGETS,
  TARGET_BY_CODE,
  type NativeLang,
  type TargetLang,
} from '../../../lib/content-types';

export function generateStaticParams() {
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

export async function generateMetadata({
  params,
}: {
  params: Promise<{ target: string; native: string }>;
}): Promise<Metadata> {
  const { target, native } = await params;
  const targetMeta = TARGET_BY_CODE[target as TargetLang];
  if (
    !targetMeta ||
    !(locales as readonly string[]).includes(native) ||
    !targetMeta.natives.includes(native as NativeLang)
  ) {
    return {};
  }
  const tMeta = await getTranslations({ locale: native, namespace: 'courseSelection' });
  const title = `${targetMeta.endonym} · ${tMeta('heading')} · Glottos Matrix`;
  const description = `${targetMeta.endonym} · Glottos Matrix.`;
  const alternates = buildLanguageAlternates(target as TargetLang, native as NativeLang, '');
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

export default async function CourseSelection({
  params,
}: {
  params: Promise<{ target: string; native: string }>;
}) {
  const { target, native } = await params;
  const targetMeta = TARGET_BY_CODE[target as TargetLang];
  if (!targetMeta) notFound();
  if (!(locales as readonly string[]).includes(native)) notFound();
  if (!targetMeta.natives.includes(native as NativeLang)) notFound();
  const lang = native as NativeLang;
  const tgt = target as TargetLang;

  const availableSlugs = new Set(getCoursesForPair(tgt, lang));
  const courses = COURSES.filter((c) => availableSlugs.has(c.slug)).sort((a, b) => a.order - b.order);

  const t = await getTranslations({ locale: native, namespace: 'courseSelection' });
  const tCourseNames = await getTranslations({ locale: native, namespace: 'courseNames' });

  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Glottos Matrix', item: absoluteUrl('/') },
      { '@type': 'ListItem', position: 2, name: targetMeta.endonym, item: absoluteUrl(`/${tgt}/${native}`) },
    ],
  };

  return (
    <div className="py-6 md:py-10">
      <JsonLd data={breadcrumbLd} />
      <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
        <span aria-hidden className="mr-2">{targetMeta.flag}</span>
        {targetMeta.endonym}
      </h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{t('heading')}</p>

      {courses.length === 0 ? (
        <p className="mt-8 text-sm text-zinc-500 italic">{t('none')}</p>
      ) : (
        <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {courses.map((c) => {
            const idx = getCourseIndex(c.slug, tgt, lang);
            return (
              <Link
                key={c.slug}
                href={`/${tgt}/${native}/${c.slug}`}
                className="block rounded-xl border border-zinc-200 dark:border-zinc-800 px-5 py-4 hover:bg-zinc-50 dark:hover:bg-zinc-900 hover:border-zinc-400 dark:hover:border-zinc-600 transition-colors"
              >
                <div className="text-base md:text-lg font-semibold leading-snug">
                  {tCourseNames.has(c.slug) ? tCourseNames(c.slug) : c.slug}
                </div>
                <p className="mt-1 text-xs text-zinc-500">
                  {idx.curriculumTitle}
                </p>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
                  <span>{idx.lessons.length} {t('lessonsLabel')}</span>
                  <span>{idx.tests.length} {t('testsLabel')}</span>
                  <span>{idx.texts.length} {t('textsLabel')}</span>
                  <span>{idx.dictionaryEntries.toLocaleString()} {t('entriesLabel')}</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
