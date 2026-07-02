import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { SettingsActions } from '../../../../components/SettingsActions';
import { AdminSettingsLink } from '../../../../components/AdminSettingsLink';
import { ThemeToggle } from '../../../../components/ThemeToggle';
import { locales } from '../../../../i18n/request';
import {
  TARGETS,
  TARGET_BY_CODE,
  type NativeLang,
  type TargetLang,
} from '../../../../lib/content-types';

const NATIVE_LABEL: Record<string, string> = {
  ru: 'Русский',
  en: 'English',
  pl: 'Polski',
  de: 'Deutsch',
};

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

export default async function SettingsPage({
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
  const t = await getTranslations({ locale: native, namespace: 'settings' });

  return (
    <div className="py-6 md:py-10 max-w-xl">
      <h1 className="text-2xl md:text-3xl font-bold tracking-tight">{t('title')}</h1>

      <AdminSettingsLink />

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 mb-3">
          {t('nativeLangHeading')}
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-3">{t('nativeLangSubtitle')}</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {locales.map((l) => {
            const available = targetMeta.natives.includes(l as NativeLang);
            const baseClass =
              'rounded-md border px-3 py-3 text-center font-medium ' +
              (l === native
                ? 'border-zinc-900 dark:border-zinc-100 bg-zinc-50 dark:bg-zinc-900'
                : available
                  ? 'border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900'
                  : 'border-zinc-200 dark:border-zinc-800 opacity-40 cursor-not-allowed');
            const inner = (
              <>
                <div className="text-xs uppercase tracking-wide text-zinc-500">{l}</div>
                <div className="mt-0.5">{NATIVE_LABEL[l]}</div>
              </>
            );
            return available ? (
              <Link key={l} href={`/${tgt}/${l}`} className={baseClass}>
                {inner}
              </Link>
            ) : (
              <div key={l} className={baseClass} title={t('notAvailableForTarget')}>
                {inner}
              </div>
            );
          })}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 mb-3">
          {t('targetLangHeading')}
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-3">{t('targetLangSubtitle')}</p>
        <div className="grid grid-cols-3 gap-2">
          {TARGETS.map((tm) => {
            const valid = tm.natives.includes(native as NativeLang);
            const current = tm.code === target;
            const baseClass =
              'rounded-md border px-3 py-3 text-center font-medium ' +
              (current
                ? 'border-zinc-900 dark:border-zinc-100 bg-zinc-50 dark:bg-zinc-900'
                : valid
                  ? 'border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900'
                  : 'border-zinc-200 dark:border-zinc-800 opacity-40 cursor-not-allowed text-zinc-400');
            const inner = (
              <>
                <div className="text-xs uppercase tracking-wide text-zinc-500">{tm.flag} {tm.code}</div>
                <div className="mt-0.5 text-sm">{tm.endonym}</div>
                {tm.status === 'preview' && (
                  <div className="text-[10px] mt-0.5 uppercase tracking-wide text-amber-600 dark:text-amber-400">
                    preview
                  </div>
                )}
              </>
            );
            return valid && !current ? (
              <Link key={tm.code} href={`/${tm.code}/${native}`} className={baseClass}>
                {inner}
              </Link>
            ) : (
              <div key={tm.code} className={baseClass}>
                {inner}
              </div>
            );
          })}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 mb-3">
          {t('themeHeading')}
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-3">{t('themeSubtitle')}</p>
        <ThemeToggle
          labels={{
            light: t('themeLight'),
            dark: t('themeDark'),
            system: t('themeSystem'),
          }}
        />
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 mb-3">
          {t('progressHeading')}
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-3">{t('progressSubtitle')}</p>
        <SettingsActions />
      </section>
    </div>
  );
}
