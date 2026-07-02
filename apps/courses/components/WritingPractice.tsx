'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { AnswerInput } from './AnswerInput';
import { MarkdownRenderer } from './MarkdownRenderer';
import { OpenEndedSample } from './OpenEndedSample';
import { SimilarPromptChain } from './SimilarPromptChain';
import { SpeakButton } from './SpeakButton';
import { useProgressStore } from '../lib/store';
import { capture } from '../lib/analytics';
import { recordActivity } from '../lib/activity';
import { openInTutor } from '../lib/open-in-tutor';
import type { CourseSlug, Exercise, NativeLang, TargetLang } from '../lib/content-types';

// Stable empty record so the selector returns the same reference when the
// lesson hasn't been touched yet — avoids needless re-renders.
const EMPTY_EXERCISES: Record<string, never> = {};

interface Props {
  exercises: Exercise[];
  lessonN: number;
  lessonTitle: string;
  course: CourseSlug;
  targetLang: TargetLang;
  nativeLang: NativeLang;
  /** polyGlottos share-code wrapping the lesson's canonical answers, when ready. */
  practiceCode?: string | null;
  /** Hide the writing-tab intro blurb (used by MoreExercises which has its own). */
  hideIntro?: boolean;
  /** When provided, each card gets a trash button that calls back with the slug. */
  onDelete?: (slug: string) => void;
  /** aria-label / confirm text for the delete button. */
  deleteLabel?: string;
}

export function WritingPractice({
  exercises,
  lessonN,
  lessonTitle,
  course,
  targetLang,
  nativeLang,
  practiceCode,
  hideIntro = false,
  onDelete,
  deleteLabel,
}: Props) {
  const t = useTranslations('writing');
  const tCommon = useTranslations('common');
  const courseKey = `${course}.${targetLang}.${nativeLang}` as const;
  const targetIn = tCommon(`targetIn.${targetLang}`);
  const recordExerciseAnswer = useProgressStore((s) => s.recordExerciseAnswer);
  // Restore prior answers from the persisted store so they survive remounts
  // (navigating to a different lesson and back, page reload, etc.).
  const exerciseProgress = useProgressStore(
    (s) => s.courses[courseKey]?.lessons[lessonN]?.exercises ?? EMPTY_EXERCISES,
  );

  if (exercises.length === 0) {
    return (
      <div className="text-sm text-zinc-500 italic py-8">{t('noExercises')}</div>
    );
  }

  return (
    <div className="space-y-8">
      {!hideIntro && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {t('intro', { target: targetIn })}
        </p>
      )}

      {practiceCode && (
        <a
          href={`https://t.glottos.com/s/${practiceCode}`}
          target="_blank"
          rel="noopener noreferrer"
          title={t('openInGlottosTooltip')}
          onClick={(e) => {
            e.preventDefault();
            capture('glottos_practice_opened', {
              course_key: courseKey,
              target_lang: targetLang,
              lesson_n: lessonN,
              practice_code: practiceCode,
            });
            openInTutor('/s/' + practiceCode);
          }}
          className="flex flex-col gap-1 px-4 py-3 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40"
        >
          <span className="flex items-center justify-between gap-2 text-sm font-medium">
            <span>{t('openInGlottos')}</span>
            <span aria-hidden>↗</span>
          </span>
          <span className="text-xs opacity-80">{t('openInGlottosTooltip')}</span>
        </a>
      )}

      {exercises.map((ex) => (
        <ExerciseCard
          key={ex.slug}
          exercise={ex}
          prior={exerciseProgress[ex.slug]}
          openEndedNote={t('openEndedNote')}
          onResult={(promptIndex, given, correct) => {
            recordExerciseAnswer(courseKey, lessonN, ex.slug, promptIndex, given, correct);
            recordActivity(courseKey, 'exercise');
            capture('exercise_attempted', {
              course_key: courseKey,
              target_lang: targetLang,
              native_lang: nativeLang,
              lesson_n: lessonN,
              exercise_slug: ex.slug,
              prompt_index: promptIndex,
              correct,
              is_generated: ex.slug.startsWith('gen-'),
            });
          }}
          context={`${lessonTitle} · ${ex.heading}`}
          course={course}
          courseKey={courseKey}
          lessonN={lessonN}
          targetLang={targetLang}
          nativeLang={nativeLang}
          onDelete={onDelete ? () => onDelete(ex.slug) : undefined}
          deleteLabel={deleteLabel}
        />
      ))}
    </div>
  );
}

interface PriorAnswers {
  answers: string[];
  correctMask: boolean[];
  lastTry: string;
}

function ExerciseCard({
  exercise,
  prior,
  openEndedNote,
  onResult,
  context,
  course,
  courseKey,
  lessonN,
  targetLang,
  nativeLang,
  onDelete,
  deleteLabel,
}: {
  exercise: Exercise;
  prior: PriorAnswers | undefined;
  openEndedNote: string;
  onResult: (promptIndex: number, given: string, correct: boolean) => void;
  context: string;
  course: CourseSlug;
  courseKey: string;
  lessonN: number;
  targetLang: TargetLang;
  nativeLang: NativeLang;
  onDelete?: () => void;
  deleteLabel?: string;
}) {
  const tMore = useTranslations('moreExercises');
  const openEnded = exercise.isOpenEnded || exercise.answers.length === 0;

  return (
    <section className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 overflow-hidden">
      <header className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold leading-snug">{exercise.heading}</h3>
          {exercise.instruction && (
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{exercise.instruction}</p>
          )}
        </div>
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            aria-label={deleteLabel ?? 'Delete'}
            title={deleteLabel ?? 'Delete'}
            className="shrink-0 p-1.5 rounded-md text-zinc-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-zinc-200/60 dark:hover:bg-zinc-800 transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6" />
              <path d="M14 11v6" />
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
            </svg>
          </button>
        )}
      </header>

      {openEnded ? (
        <div className="px-4 py-4 text-sm">
          {exercise.bodyMarkdown ? (
            <MarkdownRenderer source={exercise.bodyMarkdown} />
          ) : (
            <p className="italic text-zinc-600 dark:text-zinc-400">{openEndedNote}</p>
          )}
          {/* Audio self-check: lazy-fetched model answer (target language)
              the learner can hear, replacing the gap left by the missing
              auto-check. Server caches per (body, target, native), so a
              re-open is free. */}
          <OpenEndedSample
            exercise={exercise}
            targetLang={targetLang}
            nativeLang={nativeLang}
            lessonN={lessonN}
          />
          <p className="mt-3 text-xs italic text-zinc-500">{openEndedNote}</p>
        </div>
      ) : (
        <div className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
          {exercise.prompts.map((p, i) => {
            const ans = exercise.answers[i];
            return (
              <PromptRow
                key={i}
                index={i}
                exerciseSlug={exercise.slug}
                isListening={exercise.mode === 'listening'}
                promptText={p.text}
                // When the lesson source doesn't supply a canonical for this
                // prompt (sample-only "Образец:" keys, fluency exercises with
                // no single right answer), still render the input — the AI
                // judge will invent a plausible canonical from the prompt.
                canonical={ans?.canonical ?? ''}
                alternates={ans?.alternates ?? []}
                prior={prior}
                onResult={(given, correct) => onResult(i, given, correct)}
                context={context}
                course={course}
                courseKey={courseKey}
                lessonN={lessonN}
                targetLang={targetLang}
                nativeLang={nativeLang}
                listeningLabel={tMore('listeningPrompt')}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}

function PromptRow({
  index,
  exerciseSlug,
  isListening,
  promptText,
  canonical,
  alternates,
  prior,
  onResult,
  context,
  course,
  courseKey,
  lessonN,
  targetLang,
  nativeLang,
  listeningLabel,
}: {
  index: number;
  exerciseSlug: string;
  isListening: boolean;
  promptText: string;
  canonical: string;
  alternates: string[];
  prior: PriorAnswers | undefined;
  onResult: (given: string, correct: boolean) => void;
  context: string;
  course: CourseSlug;
  courseKey: string;
  lessonN: number;
  targetLang: TargetLang;
  nativeLang: NativeLang;
  listeningLabel: string;
}) {
  // Solved-state seed: a previously-passed answer (persisted in the store) or
  // false. Flipped to true the first time the learner gets it correct in this
  // session. Drives whether SimilarPromptChain reveals the "one more like
  // this" button.
  const [solved, setSolved] = useState<boolean>(
    !!(prior && prior.answers[index] !== undefined && prior.correctMask[index]),
  );

  return (
    <div className="px-3 sm:px-4 py-4">
      <div className="flex items-start gap-2 text-sm mb-2">
        <span className="font-mono text-xs text-zinc-500 mt-0.5 select-none">
          {index + 1}.
        </span>
        {isListening ? (
          <span className="flex-1 flex items-center gap-2 min-w-0">
            <SpeakButton text={canonical} lang={targetLang} />
            <span className="text-zinc-500 italic break-words">{listeningLabel}</span>
          </span>
        ) : (
          <span className="flex-1 break-words min-w-0">{promptText}</span>
        )}
      </div>
      {/* No left indent on mobile — every pixel goes to the answer input.
          Indent returns at sm+ to align with the prompt text. */}
      <div className="pl-0 sm:pl-6">
        <AnswerInput
          key={`${exerciseSlug}-${index}`}
          canonical={canonical}
          alternates={alternates}
          context={context}
          targetLang={targetLang}
          nativeLang={nativeLang}
          prompt={isListening ? canonical : promptText}
          compact
          initialValue={prior?.answers[index] ?? ''}
          initialCorrect={
            prior && prior.answers[index] !== undefined
              ? !!prior.correctMask[index]
              : null
          }
          onResult={(r, given) => {
            if (r.correct) setSolved(true);
            onResult(given, r.correct);
          }}
        />
        {/* Skip the "more like this" chain for listening mode — the example
            we'd anchor to has no native-language prompt to vary from. */}
        {!isListening && canonical && (
          <SimilarPromptChain
            parentSolved={solved}
            example={{ prompt: promptText, canonical }}
            course={course}
            courseKey={courseKey}
            lessonN={lessonN}
            targetLang={targetLang}
            nativeLang={nativeLang}
            context={context}
          />
        )}
      </div>
    </div>
  );
}
