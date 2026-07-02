'use client';

import { useTranslations } from 'next-intl';
import { MarkdownRenderer } from './MarkdownRenderer';
import { SpeakButton } from './SpeakButton';
import { capture } from '../lib/analytics';
import { recordActivity } from '../lib/activity';
import { openInTutor } from '../lib/open-in-tutor';
import type { LessonSection, TargetLang } from '../lib/content-types';

interface TextVariant {
  variant: 'a' | 'b' | 'c';
  title: string;
  sentences: string[];
}

interface Props {
  sections: LessonSection[];
  /** Per-section share codes for matrix/scales blocks. Same length as
   *  `sections`, indexed by section ordinal. `null` when the section has
   *  no code yet (build-audio-section-codes.ts hasn't been run for it) —
   *  the UI silently omits the chip in that case. */
  sectionCodes: (string | null)[];
  lessonN: number;
  shareCodes: { a: string | null; b: string | null; c: string | null };
  texts: TextVariant[];
  targetLang: TargetLang;
  /** "<course>.<target>.<native>" — used to bucket the heatmap point that
   *  fires when the user opens a listening text in glottos. */
  courseKey: string;
}

const GLOTTOS_SHARE_BASE = 'https://t.glottos.com/s';

export function AudioPractice({
  sections,
  sectionCodes,
  lessonN,
  shareCodes,
  texts,
  targetLang,
  courseKey,
}: Props) {
  const t = useTranslations('audio');
  const textsByVariant = new Map(texts.map((x) => [x.variant, x]));

  return (
    <div className="space-y-10">
      <section>
        <h3 className="text-lg font-semibold mb-1">{t('listeningHeading')}</h3>
        <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">{t('listeningSubtitle')}</p>
        <div className="space-y-3">
          {(['a', 'b', 'c'] as const).map((v) => {
            const code = shareCodes[v];
            const text = textsByVariant.get(v);
            return (
              <details
                key={v}
                className="group rounded-md border border-amber-200 dark:border-amber-900/50 bg-amber-50/60 dark:bg-amber-950/20 overflow-hidden"
              >
                <summary className="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer list-none hover:bg-amber-100/60 dark:hover:bg-amber-900/30 transition-colors">
                  <div className="min-w-0">
                    <div className="text-xs uppercase tracking-wide text-amber-700 dark:text-amber-400 font-semibold">
                      {t('textLabel')} {v.toUpperCase()}
                    </div>
                    {text && (
                      <div className="text-sm font-medium mt-0.5 truncate">{text.title}</div>
                    )}
                  </div>
                  <span className="shrink-0 flex items-center gap-3 text-xs text-amber-700 dark:text-amber-400">
                    {code ? (
                      <a
                        href={`${GLOTTOS_SHARE_BASE}/${code}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={t('openInGlottosTooltip')}
                        onClick={(e) => {
                          // stopPropagation keeps the parent <details> from
                          // toggling when the user clicks the open-in-tutor
                          // link; preventDefault lets openInTutor own the
                          // window.open + SSO mint.
                          e.stopPropagation();
                          e.preventDefault();
                          recordActivity(courseKey, 'text_open');
                          capture('glottos_text_opened', {
                            target_lang: targetLang,
                            lesson_n: lessonN,
                            variant: v,
                            share_code: code,
                          });
                          openInTutor('/s/' + code);
                        }}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded bg-amber-100 dark:bg-amber-900/50 hover:bg-amber-200 dark:hover:bg-amber-800/60 transition-colors"
                      >
                        {t('openInGlottos')} ↗
                      </a>
                    ) : (
                      <span className="italic text-zinc-500">{t('preparing')}</span>
                    )}
                    <span className="text-zinc-500 group-open:rotate-180 transition-transform" aria-hidden>
                      ▾
                    </span>
                  </span>
                </summary>
                {text && (
                  <ol className="px-5 py-3 border-t border-amber-200 dark:border-amber-900/50 bg-white/40 dark:bg-zinc-950/40 text-sm space-y-1.5 list-decimal list-inside">
                    {text.sentences.map((s, i) => (
                      <li key={i} className="leading-relaxed">
                        <span className="inline-flex items-baseline gap-1.5">
                          <SpeakButton text={s} lang={targetLang} />
                          <span>{s}</span>
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </details>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-zinc-500">{t('glottosNote')}</p>
      </section>

      {sections.length > 0 ? (
        <section>
          <h3 className="text-lg font-semibold mb-1">{t('mouthHeading')}</h3>
          <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">{t('mouthSubtitle')}</p>
          <div className="space-y-6">
            {sections.map((s, idx) => {
              const code = sectionCodes[idx] ?? null;
              return (
                <article
                  key={`${idx}-${s.slug}`}
                  className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4"
                >
                  {/* Heading row: section title on the left, "🔊 Аудио-
                      практика" chip on the right (when a share code is
                      available). Pairing them inline makes the chip
                      unambiguously about this section — placing it at
                      the bottom of the article left readers wondering
                      what it referred to. */}
                  <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
                    <h2 className="text-2xl font-semibold tracking-tight min-w-0">
                      {s.heading}
                    </h2>
                    {code && (
                      <a
                        href={`${GLOTTOS_SHARE_BASE}/${code}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={t('openInGlottosTooltip')}
                        onClick={(e) => {
                          e.preventDefault();
                          recordActivity(courseKey, 'text_open');
                          capture('glottos_audio_section_opened', {
                            target_lang: targetLang,
                            lesson_n: lessonN,
                            section_idx: idx,
                            section_slug: s.slug,
                            share_code: code,
                          });
                          openInTutor('/s/' + code);
                        }}
                        className="shrink-0 inline-flex items-center gap-2 px-3 py-2 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40 text-sm font-medium"
                      >
                        <span>{t('openInGlottos')}</span>
                        <span aria-hidden>↗</span>
                      </a>
                    )}
                  </div>
                  {/* Heading is rendered above; pass only the markdown body
                      to the renderer so we don't render the H2 twice. */}
                  <MarkdownRenderer source={s.markdown} />
                </article>
              );
            })}
          </div>
        </section>
      ) : (
        <section className="rounded-md border border-dashed border-zinc-300 dark:border-zinc-700 p-6 text-center">
          <p className="text-sm text-zinc-600 dark:text-zinc-400 italic">{t('emptyState')}</p>
        </section>
      )}
    </div>
  );
}
