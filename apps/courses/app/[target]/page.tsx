import type { Metadata } from 'next';
import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { NextIntlClientProvider } from 'next-intl';
import { AuthMenu } from '../../components/AuthMenu';
import { JsonLd } from '../../components/JsonLd';
import { absoluteUrl } from '../../lib/site-url';
import { locales, defaultLocale, type Locale } from '../../i18n/request';
import {
  TARGETS,
  TARGET_BY_CODE,
  type NativeLang,
  type TargetLang,
} from '../../lib/content-types';

const NATIVE_LABEL: Record<NativeLang, string> = {
  en: 'English',
  ru: 'Русский',
  pl: 'Polski',
  de: 'Deutsch',
};

export function generateStaticParams() {
  return TARGETS.map((t) => ({ target: t.code }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ target: string }>;
}): Promise<Metadata> {
  const { target } = await params;
  const meta = TARGET_BY_CODE[target as TargetLang];
  if (!meta) return {};
  const title = `${meta.endonym} · Glottos Matrix`;
  const description = `${meta.endonym} · 50 lessons · 50 tests · 150 listening texts · Glottos Matrix.`;
  const url = absoluteUrl(`/${target}`);
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: 'website',
      title,
      description,
      url,
      siteName: 'Glottos Matrix',
    },
    twitter: { card: 'summary', title, description },
  };
}

export default async function TargetLanding({
  params,
}: {
  params: Promise<{ target: string }>;
}) {
  const { target } = await params;
  const meta = TARGET_BY_CODE[target as TargetLang];
  if (!meta) notFound();

  // Native picked from Accept-Language by middleware. Must intersect with
  // the natives this target actually supports — if Accept-Language said
  // 'en' but only 'ru' is shipped, drop to whatever the target has.
  const h = await headers();
  const headerLocale = (h.get('x-locale') ?? defaultLocale) as Locale;
  const preferred: NativeLang = meta.natives.includes(headerLocale as NativeLang)
    ? (headerLocale as NativeLang)
    : meta.natives[0]!;

  setRequestLocale(preferred);
  const messages = (await import(`../../messages/${preferred}.json`)).default;
  const t = await getTranslations({ locale: preferred, namespace: 'targetLanding' });
  const tCommon = await getTranslations({ locale: preferred, namespace: 'common' });

  const courseLd = {
    '@context': 'https://schema.org',
    '@type': 'Course',
    name: meta.endonym,
    description: t('subtitlePrefix') + ' · ' + t('lessonsLine'),
    url: absoluteUrl(`/${target}`),
    inLanguage: target,
    provider: { '@type': 'Organization', name: 'Glottos Matrix', url: absoluteUrl('/') },
    numberOfCredits: meta.lessons,
    hasCourseInstance: { '@type': 'CourseInstance', courseMode: 'online', inLanguage: target },
  };

  return (
    <NextIntlClientProvider locale={preferred} messages={messages}>
      <JsonLd data={courseLd} />
      <div className="mx-auto max-w-3xl px-4 py-12 md:py-20">
        <header className="flex items-start justify-between gap-4">
          <div>
            <p className="text-4xl sm:text-5xl">{meta.flag}</p>
            <h1 className="mt-4 text-3xl md:text-4xl font-bold tracking-tight">{meta.endonym}</h1>
            <p className="mt-2 text-zinc-600 dark:text-zinc-400">
              {t('subtitlePrefix')} · Glottos Matrix
            </p>
            <p className="mt-1 text-sm text-zinc-500">{t('lessonsLine')}</p>
          </div>
          <div className="shrink-0 pt-1">
            <AuthMenu />
          </div>
        </header>

        {meta.status === 'preview' && (
          <p className="mt-6 text-sm rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 px-3 py-2">
            {t('previewBanner', { available: meta.lessons })}
          </p>
        )}

        <section className="mt-10">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 mb-3">
            {t('pickNativeHeading')}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {(locales as readonly NativeLang[]).map((n) => {
              const available = meta.natives.includes(n);
              const isRecommended = n === preferred;
              const base =
                'block rounded-xl border p-5 transition-colors text-left ' +
                (available
                  ? isRecommended
                    ? 'border-zinc-900 dark:border-zinc-100 bg-zinc-50 dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                    : 'border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900'
                  : 'border-zinc-200 dark:border-zinc-800 opacity-50 cursor-not-allowed');
              const inner = (
                <>
                  <div className="text-xs uppercase tracking-wide text-zinc-500">{n}</div>
                  <div className="mt-1 text-lg font-semibold">{NATIVE_LABEL[n]}</div>
                  <div className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
                    {available
                      ? `${tCommon.has(`targetIn.${target}`) ? tCommon(`targetIn.${target}`) : meta.endonym} — ${t('openCourseCta')} →`
                      : t('notAvailableHere')}
                  </div>
                </>
              );
              return available ? (
                <Link key={n} href={`/${target}/${n}`} className={base}>
                  {inner}
                </Link>
              ) : (
                <div key={n} className={base}>
                  {inner}
                </div>
              );
            })}
          </div>
        </section>

        <section className="mt-10">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{t('signInPrompt')}</p>
        </section>

        <p className="mt-16 text-xs italic text-zinc-500">
          5% — understand the rule. 95% — train your mouth. Language is a sport. Open your mouth and speak.
        </p>
      </div>
    </NextIntlClientProvider>
  );
}
