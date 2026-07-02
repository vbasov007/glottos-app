import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import {
  COURSE_BY_SLUG,
  TARGET_BY_CODE,
  type CourseSlug,
  type NativeLang,
  type TargetLang,
} from '../lib/content-types';

const NATIVE_LABEL: Record<NativeLang, string> = {
  ru: 'Русский',
  en: 'English',
  pl: 'Polski',
  de: 'Deutsch',
};

const COURSE_LABEL: Record<CourseSlug, string> = {
  classic50: 'Classic 50',
  losreden50: 'Loslegen 50',
};

/**
 * Friendly "course not available in this native yet" page. Replaces the
 * 404 that used to fire when the LangSwitcher landed the user on a
 * (target, native) pair the chosen course doesn't ship content for.
 *
 * Renders in the chosen native language so the message itself is readable,
 * plus links back to the natives that DO have the course and to the
 * target's full course list.
 */
export async function CourseUnavailable({
  target,
  native,
  course,
}: {
  target: TargetLang;
  native: NativeLang;
  course: CourseSlug;
}) {
  const t = await getTranslations({ locale: native, namespace: 'courseUnavailable' });
  const targetMeta = TARGET_BY_CODE[target];
  const supportedNatives = COURSE_BY_SLUG[course].available
    .filter((p) => p.target === target)
    .map((p) => p.native);
  return (
    <div className="py-10 md:py-16 max-w-2xl">
      <p className="text-5xl">⏳</p>
      <h1 className="mt-6 text-2xl md:text-3xl font-bold tracking-tight">
        {t('title', { course: COURSE_LABEL[course] })}
      </h1>
      <p className="mt-3 text-base text-zinc-700 dark:text-zinc-300">
        {t('message', {
          course: COURSE_LABEL[course],
          target: targetMeta?.endonym ?? target,
          native: NATIVE_LABEL[native],
        })}
      </p>
      {supportedNatives.length > 0 && (
        <div className="mt-6">
          <p className="text-sm font-semibold uppercase tracking-wide text-zinc-500 mb-2">
            {t('availableIn')}
          </p>
          <div className="flex flex-wrap gap-2">
            {supportedNatives.map((n) => (
              <Link
                key={n}
                href={`/${target}/${n}/${course}`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-zinc-300 dark:border-zinc-700 hover:border-blue-400 dark:hover:border-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors text-sm"
              >
                <span className="font-mono text-xs uppercase">{n}</span>
                <span>{NATIVE_LABEL[n]}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
      <div className="mt-8">
        <Link
          href={`/${target}/${native}`}
          className="inline-flex items-center gap-1 text-sm text-blue-700 dark:text-blue-300 hover:underline"
        >
          ← {t('otherCourses')}
        </Link>
      </div>
    </div>
  );
}
