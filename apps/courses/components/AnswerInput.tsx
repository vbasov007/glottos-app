'use client';

import { useCallback, useState, useRef, useEffect, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { checkAnswer, type CheckResult } from '../lib/checker';
import { useTelegramMainButton } from '../lib/use-telegram-main-button';
import { IssueList } from './IssueList';
import { speakableText } from '../lib/normalize';
import { Spinner } from './Spinner';
import { InlineMarkdown } from './InlineMarkdown';
import { SpeakButton } from './SpeakButton';
import type { NativeLang, TargetLang } from '../lib/content-types';

interface Props {
  canonical: string;
  alternates?: string[];
  context?: string;
  targetLang: TargetLang;
  nativeLang: NativeLang;
  onResult?: (result: CheckResult, given: string) => void;
  initialValue?: string;
  /** Pass true/false to restore a previously-judged answer; null/undefined leaves it unjudged. */
  initialCorrect?: boolean | null;
  placeholder?: string;
  compact?: boolean;
  /** Native-language prompt. Forwarded to the AI judge so it can invent a
   *  plausible answer when canonical is empty (open-ended exercises). */
  prompt?: string;
}

export function AnswerInput({
  canonical,
  alternates = [],
  context,
  targetLang,
  nativeLang,
  onResult,
  initialValue = '',
  initialCorrect = null,
  placeholder,
  compact = false,
  prompt,
}: Props) {
  const t = useTranslations('lesson');
  const initialResultFromProp =
    initialCorrect === null ? null : { correct: initialCorrect, judgedBy: 'exact' as const };
  const [value, setValue] = useState(initialValue);
  const [result, setResult] = useState<CheckResult | null>(initialResultFromProp);
  const [pending, setPending] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow the textarea so long answers wrap without forcing a scrollbar.
  // Reset to "auto" first so scrollHeight can shrink back when the user
  // deletes a line; the second assignment then sets the exact height needed
  // for the current content.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  // Re-hydrate internal state when the parent supplies new initial values.
  // useState only honors its initial arg on first render, so an AnswerInput
  // preserved across a navigation (parent re-renders with new props) would
  // otherwise keep its stale local state.
  //
  // The guard: only sync when initialValue differs from the current value.
  // Reason — when the user submits, our onResult callback writes to the store,
  // the store fires our parent's selector, the parent re-renders, and our
  // initialValue/initialCorrect props echo our own state back at us. We must
  // NOT overwrite `result` then (the hint from the Claude response only lives
  // in local state and would get clobbered to a minimal {correct, judgedBy}).
  useEffect(() => {
    if (initialValue === value) return;
    setValue(initialValue);
    setResult(
      initialCorrect === null ? null : { correct: initialCorrect, judgedBy: 'exact' as const },
    );
    setRevealed(false);
  // We deliberately omit `value` from deps — including it would re-fire on
  // every keystroke and undo the user's typing.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialValue, initialCorrect]);

  // Placeholder is per-target ("Type the German…" / "Введи по-французски…") so
  // the cue matches what language the learner is actually producing.
  const ph = placeholder ?? t(`input.placeholder.${targetLang}`);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    await runCheck();
  }

  // Extracted so the Telegram MainButton handler can call it without
  // synthesising a form event. Both paths go through one entrypoint so the
  // pending guard / onResult callback fire exactly once per attempt.
  const runCheck = useCallback(async (): Promise<void> => {
    if (!value.trim() || pending) return;
    setPending(true);
    try {
      const r = await checkAnswer({
        given: value,
        canonical,
        alternates,
        context,
        nativeLang,
        targetLang,
        prompt,
      });
      setResult(r);
      onResult?.(r, value);
    } finally {
      setPending(false);
    }
  }, [value, pending, canonical, alternates, context, nativeLang, targetLang, prompt, onResult]);

  // Telegram MainButton — when this AnswerInput is on screen and has typed
  // input, the prominent system button at the bottom of the WebView says
  // "Check" and fires the same handler. Inert outside Telegram.
  useTelegramMainButton({
    text: t('checkAnswer'),
    onClick: () => void runCheck(),
    visible: value.trim().length > 0 && !(result?.correct ?? false),
    enabled: !pending,
    showProgress: pending,
  });

  const stateClass =
    result == null
      ? 'border-zinc-300 dark:border-zinc-700'
      : result.correct
      ? 'border-green-500 bg-green-50 dark:bg-green-950/20'
      : 'border-red-400 bg-red-50 dark:bg-red-950/20';

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      {/* Mobile: input full-width, button drops to the next line.
          sm+: side-by-side as before. */}
      <div className="flex flex-col sm:flex-row sm:gap-2 gap-2">
        <textarea
          ref={inputRef}
          rows={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            // Enter submits (single-line UX); Shift+Enter inserts a newline
            // so users CAN paste / type multi-line answers explicitly when
            // they want to. IME composition is excluded so kana / pinyin
            // assemblers don't get cut off mid-character.
            if (
              e.key === 'Enter' &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder={ph}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className={`w-full sm:flex-1 min-w-0 ${compact ? 'px-3 py-1.5 text-sm min-h-[2.25rem]' : 'px-4 py-2 min-h-[2.5rem]'} resize-none overflow-hidden leading-snug rounded-md border bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${stateClass}`}
        />
        <button
          type="submit"
          disabled={pending || !value.trim()}
          className={`${compact ? 'px-3 py-1.5 text-sm' : 'px-4 py-2'} self-start sm:self-auto rounded-md bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 font-medium hover:bg-zinc-700 dark:hover:bg-zinc-300 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-2`}
        >
          {pending && <Spinner size={compact ? 14 : 16} />}
          <span>{pending ? t('checking') : t('checkAnswer')}</span>
        </button>
      </div>

      {result && (
        <div
          className={`text-sm flex items-center gap-2 ${
            result.correct
              ? 'text-green-700 dark:text-green-300'
              : 'text-red-700 dark:text-red-300'
          }`}
        >
          <span aria-hidden>{result.correct ? '✓' : '✗'}</span>
          <span>
            {result.correct
              ? result.matchedAlternate
                ? t('verdict.correctAlternate')
                : t('verdict.correct')
              : t('verdict.wrong')}
          </span>
          {result.judgedBy === 'claude' && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500">
              {t('verdict.aiJudged')}
            </span>
          )}
        </div>
      )}

      {result?.correct && result.warning && (
        <div className="text-sm text-amber-700 dark:text-amber-400 flex items-start gap-1.5">
          <span aria-hidden>💡</span>
          <span>
            {result.warning.case && result.warning.punctuation
              ? t('verdict.warningCaseAndPunctuation')
              : result.warning.case
                ? t('verdict.warningCase')
                : t('verdict.warningPunctuation')}
          </span>
        </div>
      )}

      {/* When accepted, surface the canonical so the learner sees the
          reference form alongside whatever they typed — useful when they
          matched an alternate or the AI judge accepted a paraphrase. Skip
          when canonical is empty (open-ended prompts where the AI invented
          one) since we have nothing useful to display.

          Canonical can contain inline markdown — bold for the target form
          being drilled, italic for a parenthetical hint — so render through
          InlineMarkdown instead of raw text. */}
      {result?.correct && canonical && (
        <div className="text-xs text-zinc-600 dark:text-zinc-400 flex items-baseline gap-1.5">
          <SpeakButton text={speakableText(canonical)} lang={targetLang} />
          <span>{t('verdict.reference')}</span>
          <InlineMarkdown
            source={canonical}
            className="font-mono font-semibold text-zinc-800 dark:text-zinc-200"
          />
        </div>
      )}

      {result && !result.correct && (
        <IssueList issues={result.issues} judgedBy={result.judgedBy} />
      )}

      {result && !result.correct && (
        <div className="text-xs">
          {revealed ? (
            <div className="font-mono text-zinc-700 dark:text-zinc-300 flex items-baseline gap-1.5">
              <SpeakButton text={speakableText(canonical)} lang={targetLang} />
              <span>{t('hint.expectedShort')}</span>
              <InlineMarkdown source={canonical} className="font-semibold" />
              {alternates.length > 0 && (
                <span className="text-zinc-500"> · {t('hint.or')}: {alternates.join(' / ')}</span>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setRevealed(true)}
              className="text-blue-600 dark:text-blue-400 hover:underline"
            >
              {t('showAnswer')}
            </button>
          )}
        </div>
      )}
    </form>
  );
}
