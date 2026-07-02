import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { MarkdownRenderer } from '../../../../../../components/MarkdownRenderer';
import { JsonLd } from '../../../../../../components/JsonLd';
import { LessonInteractive } from '../../../../../../components/LessonInteractive';
import { LessonTabs } from '../../../../../../components/LessonTabs';
import { WritingPractice } from '../../../../../../components/WritingPractice';
import { AudioPractice } from '../../../../../../components/AudioPractice';
import { MoreExercises } from '../../../../../../components/MoreExercises';
import { VocabTab } from '../../../../../../components/VocabTab';
import { CefrLessonContribution } from '../../../../../../components/CefrLessonContribution';
import { partitionSections } from '../../../../../../lib/lesson-sections';
import { getCourseIndex, getCoursesForPair, getDictionary, getLesson, getText } from '../../../../../../lib/content';
import { CourseUnavailable } from '../../../../../../components/CourseUnavailable';
import { getFirstLessons } from '../../../../../../lib/dictionary-first-lessons';
import { getShareCode } from '../../../../../../lib/share-codes';
import { getVocabCode } from '../../../../../../lib/vocab-codes';
import { getPracticeCode } from '../../../../../../lib/practice-codes';
import { getAudioSectionCode } from '../../../../../../lib/audio-section-codes';
import { getCefrLevels } from '../../../../../../lib/cefr-levels';
import { buildLanguageAlternates, stripBoldMarkers } from '../../../../../../lib/seo';
import { absoluteUrl } from '../../../../../../lib/site-url';
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
  const lesson = getLesson(course as CourseSlug, target as TargetLang, native as NativeLang, n);
  const subtitle = lesson.vocabSubtitle ? stripBoldMarkers(lesson.vocabSubtitle) : '';
  const title = `${lesson.title} · ${targetMeta.endonym} · Glottos Matrix`;
  const description = subtitle
    ? `${subtitle}. ${lesson.title}. ${targetMeta.endonym} · Glottos Matrix.`
    : `${lesson.title}. ${targetMeta.endonym} · Glottos Matrix.`;
  const alternates = buildLanguageAlternates(
    target as TargetLang,
    native as NativeLang,
    `/lesson/${course}/${n}`,
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
    twitter: {
      card: 'summary',
      title,
      description,
    },
  };
}

export default async function LessonPage({
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

  const lesson = getLesson(crs, tgt, lang, n);
  const idx = getCourseIndex(crs, tgt, lang);
  const prev = idx.lessons.find((l) => l.n === n - 1);
  const next = idx.lessons.find((l) => l.n === n + 1);
  const tLesson = await getTranslations({ locale: native, namespace: 'lesson' });
  const tCourseHome = await getTranslations({ locale: native, namespace: 'courseHome' });
  const tCefr = await getTranslations({ locale: native, namespace: 'cefr' });

  const { intro, theory, audio, cheatsheet } = partitionSections(lesson.sections);

  const shareCodes = {
    a: getShareCode(crs, tgt, lang, n, 'a'),
    b: getShareCode(crs, tgt, lang, n, 'b'),
    c: getShareCode(crs, tgt, lang, n, 'c'),
  };
  // Per-section share codes for the matrix/scales blocks. idx matches the
  // ordinal in audio[] above, so AudioPractice just maps over them
  // alongside the section itself.
  const audioSectionCodes = audio.map((_, idx) =>
    getAudioSectionCode(crs, tgt, lang, n, idx),
  );

  const texts = (['a', 'b', 'c'] as const)
    .map((variant) => {
      try {
        const tx = getText(crs, tgt, lang, n, variant);
        return { variant, title: tx.title, sentences: tx.sentences };
      } catch {
        return null;
      }
    })
    .filter((x): x is { variant: 'a' | 'b' | 'c'; title: string; sentences: string[] } => !!x);

  const cefrContribution = getCefrLevels(tgt, n);
  const vocabCode = getVocabCode(crs, tgt, lang, n);
  const practiceCode = getPracticeCode(crs, tgt, lang, n);

  const courseDict = getDictionary(crs, tgt, lang);
  const dictFirstLessons = tgt === 'de' ? getFirstLessons() : {};

  const courseUrl = absoluteUrl(`/${tgt}/${native}/${crs}`);
  const lessonUrl = absoluteUrl(`/${tgt}/${native}/lesson/${crs}/${n}`);
  const cleanSubtitle = lesson.vocabSubtitle ? stripBoldMarkers(lesson.vocabSubtitle) : '';
  const lessonLd = {
    '@context': 'https://schema.org',
    '@type': 'LearningResource',
    name: lesson.title,
    description: cleanSubtitle || lesson.title,
    inLanguage: tgt,
    learningResourceType: 'Lesson',
    position: n,
    url: lessonUrl,
    isPartOf: { '@type': 'Course', name: idx.curriculumTitle, url: courseUrl },
  };
  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Glottos Matrix', item: absoluteUrl('/') },
      { '@type': 'ListItem', position: 2, name: targetMeta.endonym, item: courseUrl },
      { '@type': 'ListItem', position: 3, name: lesson.title, item: lessonUrl },
    ],
  };

  return (
    <article className="py-6 md:py-10">
      <JsonLd data={lessonLd} />
      <JsonLd data={breadcrumbLd} />
      <div className="text-xs text-zinc-500 mb-2">
        <Link
          href={`/${tgt}/${native}/${crs}`}
          className="inline-flex items-center min-h-[32px] -my-1 hover:underline"
        >
          {tLesson('backToCourse')}
        </Link>
      </div>
      <h1 className="text-2xl md:text-3xl font-bold tracking-tight leading-tight">
        {lesson.title}
      </h1>
      {lesson.vocabSubtitle && (
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400 font-medium">
          {lesson.vocabSubtitle.replace(/^\*\*/, '').replace(/\*\*$/, '')}
        </p>
      )}

      {cefrContribution && (
        <CefrLessonContribution
          entry={cefrContribution}
          labels={{
            intro: tCefr('lessonContributionIntro'),
            vocabulary: tCefr('vocabulary'),
            grammar: tCefr('grammar'),
          }}
        />
      )}

      <div className="mt-4">
        <div className="min-w-0">
          <LessonTabs
            targetLang={tgt}
            nativeLang={lang}
            lessonN={lesson.n}
            course={crs}
            writingExercises={lesson.exercises}
            nextLessonHref={next ? `/${tgt}/${native}/lesson/${crs}/${next.n}` : undefined}
            nextLessonTitle={next?.title}
            panels={{
              // Each panel carries an explicit `key`. The elements are created
              // in this Server Component but rendered inside LessonTabs (a
              // Client Component); the RSC payload marks unkeyed elements
              // crossing that boundary as `validated=2`, which triggers a
              // spurious "missing key" warning in the browser. Naming each
              // element after its tab is the cheap, correct fix.
              theory: (
                <div key="theory" className="space-y-6">
                  {intro && (
                    <section className="rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/30 p-4">
                      <MarkdownRenderer
                        source={`## ${intro.heading}\n\n${intro.markdown}`}
                        targetLang={tgt}
                      />
                    </section>
                  )}
                  {theory.map((s) => (
                    <section key={s.slug} id={s.slug} className="scroll-mt-28">
                      <MarkdownRenderer source={`## ${s.heading}\n\n${s.markdown}`} targetLang={tgt} />
                    </section>
                  ))}
                </div>
              ),
              writing: (
                <WritingPractice
                  key="writing"
                  exercises={lesson.exercises}
                  lessonN={lesson.n}
                  lessonTitle={lesson.title}
                  course={crs}
                  targetLang={tgt}
                  nativeLang={lang}
                  practiceCode={practiceCode}
                />
              ),
              audio: (
                <AudioPractice
                  key="audio"
                  sections={audio}
                  sectionCodes={audioSectionCodes}
                  lessonN={lesson.n}
                  shareCodes={shareCodes}
                  texts={texts}
                  targetLang={tgt}
                  courseKey={`${crs}.${tgt}.${lang}`}
                />
              ),
              // Omit when the lesson has no cheat-sheet section so the tab
              // itself is hidden (LessonTabs filters by panels[key] != null).
              cheatsheet: cheatsheet ? (
                <section key="cheatsheet" className="rounded-lg border-2 border-amber-200 dark:border-amber-900/50 bg-amber-50/40 dark:bg-amber-950/20 p-4">
                  <MarkdownRenderer source={cheatsheet.markdown} targetLang={tgt} />
                </section>
              ) : undefined,
              moreExercises: (
                <MoreExercises
                  key="moreExercises"
                  course={crs}
                  lessonN={lesson.n}
                  lessonTitle={lesson.title}
                  targetLang={tgt}
                  nativeLang={lang}
                />
              ),
              vocabulary: (
                <VocabTab
                  key="vocabulary"
                  vocab={lesson.vocab}
                  vocabCode={vocabCode}
                  targetLang={tgt}
                  nativeLang={lang}
                  lessonN={lesson.n}
                  courseDictionary={courseDict.entries}
                  firstLessons={dictFirstLessons}
                />
              ),
            }}
          />

          <LessonInteractive course={crs} lessonN={lesson.n} targetLang={tgt} nativeLang={lang} />

          {lesson.nextUp && (
            <div className="mt-8 pt-6 border-t border-zinc-200 dark:border-zinc-800">
              <MarkdownRenderer source={lesson.nextUp} targetLang={tgt} />
            </div>
          )}

          <nav className="mt-10 pt-6 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-4 text-sm">
            {prev ? (
              <Link
                href={`/${tgt}/${native}/lesson/${crs}/${prev.n}`}
                data-shortcut="prev-lesson"
                className="flex-1 max-w-[48%] px-4 py-3 rounded-md border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900"
              >
                <div className="text-xs text-zinc-500">← {tCourseHome('lessonLabel')} {prev.n}</div>
                <div className="font-medium truncate">{prev.title}</div>
              </Link>
            ) : (
              <div className="flex-1" />
            )}
            {next ? (
              <Link
                href={`/${tgt}/${native}/lesson/${crs}/${next.n}`}
                data-shortcut="next-lesson"
                className="flex-1 max-w-[48%] px-4 py-3 rounded-md border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 text-right"
              >
                <div className="text-xs text-zinc-500">{tCourseHome('lessonLabel')} {next.n} →</div>
                <div className="font-medium truncate">{next.title}</div>
              </Link>
            ) : (
              <div className="flex-1" />
            )}
          </nav>
        </div>
      </div>
    </article>
  );
}
