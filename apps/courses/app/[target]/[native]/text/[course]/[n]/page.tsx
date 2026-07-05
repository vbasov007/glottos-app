import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCourseIndex, getCoursesForPair, getText } from '../../../../../../lib/content';
import { CourseUnavailable } from '../../../../../../components/CourseUnavailable';
import { TextRead } from '../../../../../../components/TextRead';
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

export default async function TextPage({
  params,
  searchParams,
}: {
  params: Promise<{ target: string; native: string; course: string; n: string }>;
  searchParams: Promise<{ v?: string }>;
}) {
  const { target, native, course, n: nStr } = await params;
  const { v } = await searchParams;
  const variant = v && ['a', 'b', 'c'].includes(v) ? v : 'a';
  const n = parseInt(nStr, 10);
  const targetMeta = TARGET_BY_CODE[target as TargetLang];
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

  const text = getText(crs, tgt, lang, n, variant);
  const idx = getCourseIndex(crs, tgt, lang);
  const lessonTitle = idx.lessons.find((l) => l.n === n)?.title;

  return (
    <article className="py-6 md:py-10">
      <TextRead course={crs} targetLang={tgt} nativeLang={lang} textN={n} variant={variant} />
      {/* Header */}
      <div className="text-xs text-zinc-500 mb-2">
        <Link
          href={`/${tgt}/${native}/lesson/${crs}/${n}`}
          className="inline-flex items-center min-h-[32px] -my-1 hover:underline"
        >
          ← Lesson {n}
        </Link>
      </div>
      <h1 className="text-2xl md:text-3xl font-bold tracking-tight leading-tight">
        {text.title}
      </h1>
      {text.theme && (
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{text.theme}</p>
      )}

      {/* Variant tabs */}
      <div className="mt-6 flex items-center gap-2">
        {(['a', 'b', 'c'] as const).map((vv) => (
          <Link
            key={vv}
            href={`/${tgt}/${native}/text/${crs}/${n}?v=${vv}`}
            className={
              'px-3 py-1.5 rounded-md text-sm font-medium ' +
              (vv === variant
                ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900'
                : 'bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700')
            }
          >
            Variant {vv.toUpperCase()}
          </Link>
        ))}
        <a
          href="https://glottos.com"
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-sm font-medium bg-amber-100 dark:bg-amber-900/40 text-amber-900 dark:text-amber-200 hover:bg-amber-200 dark:hover:bg-amber-800/40"
          title="Audio coming via glottos.com integration"
        >
          🔊 Open in glottos.com
        </a>
      </div>

      {/* Sentences */}
      <section className="mt-8">
        <h2 className="text-xs uppercase tracking-wide text-zinc-500 mb-3">
          Listen and repeat ({text.sentences.length} sentences)
        </h2>
        <ol className="space-y-2 list-decimal list-inside marker:text-zinc-400 marker:font-mono marker:text-xs">
          {text.sentences.map((s, i) => (
            <li
              key={i}
              className="text-base leading-relaxed py-1 px-2 rounded hover:bg-zinc-50 dark:hover:bg-zinc-900"
            >
              {s}
            </li>
          ))}
        </ol>
      </section>

      {/* Vocab */}
      {text.vocab.length > 0 && (
        <section className="mt-10">
          <h2 className="text-xs uppercase tracking-wide text-zinc-500 mb-3">
            Vocabulary ({text.vocab.length})
          </h2>
          <div className="overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 dark:bg-zinc-900">
                <tr>
                  <th className="text-left py-2 px-3 font-semibold border-b border-zinc-200 dark:border-zinc-800">
                    German
                  </th>
                  <th className="text-left py-2 px-3 font-semibold border-b border-zinc-200 dark:border-zinc-800 w-16">
                    {text.vocab.some((v) => v.gender) ? 'Gender' : ''}
                  </th>
                  <th className="text-left py-2 px-3 font-semibold border-b border-zinc-200 dark:border-zinc-800">
                    Translation
                  </th>
                </tr>
              </thead>
              <tbody>
                {text.vocab.map((v, i) => (
                  <tr key={i} className="border-b border-zinc-100 dark:border-zinc-800 last:border-0">
                    <td className="py-2 px-3 font-medium">{v.german}</td>
                    <td className="py-2 px-3 font-mono text-xs text-zinc-500">{v.gender ?? ''}</td>
                    <td className="py-2 px-3 text-zinc-700 dark:text-zinc-300">{v.native}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Footer note */}
      <p className="mt-12 text-xs text-zinc-500">
        Audio playback coming via{' '}
        <a href="https://glottos.com" className="underline">
          glottos.com
        </a>{' '}
        integration.
      </p>
    </article>
  );
}
