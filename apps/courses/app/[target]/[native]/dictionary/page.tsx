import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { DictionarySearch } from '../../../../components/DictionarySearch';
import { getGlobalDictionary } from '../../../../lib/content';
import { getFirstLessons } from '../../../../lib/dictionary-first-lessons';
import { buildLanguageAlternates } from '../../../../lib/seo';
import { locales } from '../../../../i18n/request';
import {
  TARGETS,
  TARGET_BY_CODE,
  type NativeLang,
  type TargetLang,
} from '../../../../lib/content-types';

export function generateStaticParams() {
  const params: { target: string; native: string }[] = [];
  for (const t of TARGETS) {
    for (const n of t.natives) {
      if (!(locales as readonly string[]).includes(n)) continue;
      params.push({ target: t.code, native: n });
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
  let dict;
  try {
    dict = getGlobalDictionary(target as TargetLang, native as NativeLang);
  } catch {
    return {};
  }
  const tMeta = await getTranslations({ locale: native, namespace: 'dictionary' });
  const title = `${dict.title} · Glottos Matrix`;
  const description = `${dict.totalEntries.toLocaleString()} ${tMeta('entriesLabel')} · ${targetMeta.endonym} · Glottos Matrix.`;
  const alternates = buildLanguageAlternates(
    target as TargetLang,
    native as NativeLang,
    '/dictionary',
  );
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

export default async function DictionaryPage({
  params,
}: {
  params: Promise<{ target: string; native: string }>;
}) {
  const { target, native } = await params;
  const targetMeta = TARGET_BY_CODE[target as TargetLang];
  if (
    !targetMeta ||
    !(locales as readonly string[]).includes(native) ||
    !targetMeta.natives.includes(native as NativeLang)
  ) {
    notFound();
  }
  const tgt = target as TargetLang;
  const lang = native as NativeLang;

  let dict;
  try {
    dict = getGlobalDictionary(tgt, lang);
  } catch {
    notFound();
  }
  const letters = Array.from(new Set(dict.entries.map((e) => e.letter))).sort();
  const t = await getTranslations({ locale: native, namespace: 'dictionary' });
  const firstLessons = tgt === 'de' ? getFirstLessons() : {};

  return (
    <div className="py-6 md:py-10">
      <h1 className="text-2xl md:text-3xl font-bold tracking-tight">{dict.title}</h1>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        {dict.totalEntries.toLocaleString()} {t('entriesLabel')}
      </p>
      <DictionarySearch
        entries={dict.entries}
        letters={letters}
        firstLessons={firstLessons}
        targetLang={tgt}
        nativeLang={lang}
      />
    </div>
  );
}
