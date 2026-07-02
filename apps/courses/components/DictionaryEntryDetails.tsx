'use client';

import { withBase } from '../lib/api-base';
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { SpeakButton } from './SpeakButton';
import { Spinner } from './Spinner';
import { IssueList } from './IssueList';
import type { NativeLang, TargetLang } from '../lib/content-types';
import { genderColorClass } from '../lib/gender';
import { checkAnswer, type CheckResult } from '../lib/checker';

interface DetailsPayload {
  exists: boolean;
  reason: string;
  /** Citation form (with article for de/fr/it/es). Bare word for he/sr/en/ka.
   *  Empty when !exists. */
  headword: string;
  meaning: string;
  /** Mirror of the AI's POS tag; not rendered yet but useful for future
   *  badges and for debugging the server-side gender guard. */
  partOfSpeech: string;
  /** "m" | "f" | "n" | "pl" | null. */
  gender: string | null;
  forms: { label: string; form: string }[];
  example: { sentence: string; translation: string };
}

interface ExampleItem {
  sentence: string;
  translation: string;
}

interface PracticePayload {
  prompt: string;
  canonical: string;
  alternates: string[];
  hint: string;
}

interface Props {
  german: string;
  targetLang: TargetLang;
  nativeLang: NativeLang;
}

// Process-lifetime cache on the client too — opening, closing, and re-opening
// the same entry should not retrigger a fetch. Storage lives for the page's
// lifetime; we don't bother with localStorage because the server caches too.
const clientCache = new Map<string, DetailsPayload>();
function cacheKey(target: TargetLang, native: NativeLang, german: string): string {
  return `${target}|${native}|${german.toLowerCase()}`;
}

export function DictionaryEntryDetails({ german, targetLang, nativeLang }: Props) {
  const t = useTranslations('dictionary.details');
  const [data, setData] = useState<DetailsPayload | null>(() =>
    clientCache.get(cacheKey(targetLang, nativeLang, german)) ?? null,
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const k = cacheKey(targetLang, nativeLang, german);
    const cached = clientCache.get(k);
    if (cached) {
      setData(cached);
      return;
    }
    let cancelled = false;
    setPending(true);
    setError(null);
    fetch(withBase('/api/dictionary/details'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ german, target: targetLang, native: nativeLang }),
    })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(res.status === 429 ? 'rate_limited' : `http_${res.status}`);
        }
        return (await res.json()) as DetailsPayload;
      })
      .then((payload) => {
        if (cancelled) return;
        clientCache.set(k, payload);
        setData(payload);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setPending(false);
      });
    return () => {
      cancelled = true;
    };
  }, [german, targetLang, nativeLang]);

  if (pending && !data) {
    return (
      <div className="mt-2 ml-8 flex items-center gap-2 text-xs text-zinc-500">
        <Spinner size={14} />
        <span>{t('loading')}</span>
      </div>
    );
  }
  if (error && !data) {
    return (
      <div className="mt-2 ml-8 text-xs text-red-600 dark:text-red-400">
        {t('error')}
      </div>
    );
  }
  if (!data) return null;

  if (!data.exists) {
    return (
      <div className="mt-2 ml-8 rounded-md border border-amber-200 dark:border-amber-900/50 bg-amber-50/60 dark:bg-amber-950/30 p-3 text-sm text-amber-800 dark:text-amber-300 flex items-start gap-2">
        <span aria-hidden>⚠️</span>
        <span>
          <span className="font-medium">{t('notFound', { word: german })}</span>
          {data.reason && (
            <span className="block text-xs mt-0.5 opacity-90">{data.reason}</span>
          )}
        </span>
      </div>
    );
  }

  // Show the AI's citation form (with article for de/fr/it/es) when it
  // differs from the row's static-dictionary heading — otherwise we'd
  // duplicate the same string at two zoom levels. For free-text "Try AI"
  // queries the static heading is just the user's typing, so the headword
  // almost always carries new information.
  const showHeadword =
    !!data.headword &&
    data.headword.toLowerCase().trim() !== german.toLowerCase().trim();

  // Citation form for downstream features. Prefer the AI-citation form
  // (with article) when available — the AI lookups use it as the entry
  // identifier and the example/practice generators key on it too.
  const citation = data.headword || german;

  return (
    <div className="mt-2 ml-8 rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/40 p-3 space-y-3">
      {(showHeadword || data.gender) && (
        <section className="flex items-baseline gap-2">
          {showHeadword && (
            <>
              <SpeakButton text={data.headword} lang={targetLang} />
              <h3 className={`text-base font-semibold break-words min-w-0 ${genderColorClass(data.gender) || 'text-zinc-900 dark:text-zinc-100'}`}>
                {data.headword}
              </h3>
            </>
          )}
          {data.gender && (
            <span
              className="text-xs font-mono text-zinc-500 uppercase shrink-0"
              title={t('genderLabel')}
            >
              {data.gender}
            </span>
          )}
        </section>
      )}

      {data.meaning && (
        <section>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 mb-1.5">
            {t('meaning')}
          </div>
          <div className="text-sm text-zinc-800 dark:text-zinc-200">{data.meaning}</div>
        </section>
      )}

      <section>
        <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 mb-1.5">
          {t('forms')}
        </div>
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1">
          {data.forms.map((f, i) => (
            <li key={i} className="flex items-baseline gap-2 text-sm">
              <SpeakButton text={f.form} lang={targetLang} />
              <span className="text-xs text-zinc-500 shrink-0">{f.label}</span>
              <span className="font-medium break-words min-w-0">{f.form}</span>
            </li>
          ))}
        </ul>
      </section>

      <ExamplesSection
        first={data.example}
        citation={citation}
        targetLang={targetLang}
        nativeLang={nativeLang}
      />

      <PracticeSection
        citation={citation}
        targetLang={targetLang}
        nativeLang={nativeLang}
      />
    </div>
  );
}

// ---- Examples section -----------------------------------------------------

function ExamplesSection({
  first,
  citation,
  targetLang,
  nativeLang,
}: {
  first: { sentence: string; translation: string };
  citation: string;
  targetLang: TargetLang;
  nativeLang: NativeLang;
}) {
  const t = useTranslations('dictionary.details');
  const [extras, setExtras] = useState<ExampleItem[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allSentences = [first.sentence, ...extras.map((e) => e.sentence)];

  async function generate(): Promise<void> {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(withBase('/api/dictionary/more-example'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          german: citation,
          target: targetLang,
          native: nativeLang,
          existing: allSentences,
        }),
      });
      if (!res.ok) throw new Error(`http_${res.status}`);
      const next = (await res.json()) as ExampleItem;
      setExtras((prev) => [...prev, next]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <section>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 mb-1.5">
        {t('example')}
      </div>
      <ExampleRow item={first} targetLang={targetLang} />
      {extras.map((ex, i) => (
        <div key={i} className="mt-2">
          <ExampleRow item={ex} targetLang={targetLang} />
        </div>
      ))}
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={generate}
          disabled={pending}
          className="text-sm font-medium inline-flex items-center gap-2 px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {pending ? <Spinner size={14} /> : <span aria-hidden>+</span>}
          <span>{pending ? t('generating') : t('moreExamples')}</span>
        </button>
        {error && (
          <span className="text-xs text-red-600 dark:text-red-400">{t('practiceGenericError')}</span>
        )}
      </div>
    </section>
  );
}

function ExampleRow({
  item,
  targetLang,
}: {
  item: ExampleItem;
  targetLang: TargetLang;
}) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <SpeakButton text={item.sentence} lang={targetLang} />
      <div className="min-w-0">
        <div className="break-words">{item.sentence}</div>
        <div className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5 break-words">
          {item.translation}
        </div>
      </div>
    </div>
  );
}

// ---- Practice section -----------------------------------------------------

function PracticeSection({
  citation,
  targetLang,
  nativeLang,
}: {
  citation: string;
  targetLang: TargetLang;
  nativeLang: NativeLang;
}) {
  const t = useTranslations('dictionary.details');
  // The "Accepted, but watch case/punctuation" labels are owned by the
  // lesson namespace where they were first introduced; reuse rather than
  // duplicate strings into dictionary.details.
  const tLesson = useTranslations('lesson');
  const [exercise, setExercise] = useState<PracticePayload | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState('');
  const [checking, setChecking] = useState(false);
  const [verdict, setVerdict] = useState<CheckResult | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow the textarea: reset to "auto" so scrollHeight can shrink,
  // then size to the current content. Fires on every value change so
  // typing past the first line expands naturally.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [answer, exercise]);
  const [hintRevealed, setHintRevealed] = useState(false);
  const [showAnswer, setShowAnswer] = useState(false);

  async function generate(): Promise<void> {
    if (pending) return;
    setPending(true);
    setError(null);
    setExercise(null);
    setAnswer('');
    setVerdict(null);
    setHintRevealed(false);
    setShowAnswer(false);
    try {
      const res = await fetch(withBase('/api/dictionary/practice'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          german: citation,
          target: targetLang,
          native: nativeLang,
        }),
      });
      if (!res.ok) throw new Error(`http_${res.status}`);
      const payload = (await res.json()) as PracticePayload;
      setExercise(payload);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  }

  async function onCheck(): Promise<void> {
    if (!exercise || checking) return;
    setChecking(true);
    try {
      const result = await checkAnswer({
        given: answer,
        canonical: exercise.canonical,
        alternates: exercise.alternates,
        nativeLang: nativeLang as 'ru' | 'en' | 'pl' | 'de',
        targetLang,
        prompt: exercise.prompt,
      });
      setVerdict(result);
    } finally {
      setChecking(false);
    }
  }

  if (!exercise && !pending && !error) {
    // Initial CTA only — the rest of the UI mounts when the user opts in.
    return (
      <section>
        <button
          type="button"
          onClick={generate}
          className="text-sm font-medium inline-flex items-center gap-2 px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition-colors"
        >
          <span aria-hidden>✍️</span>
          <span>{t('practice')}</span>
        </button>
      </section>
    );
  }

  if (pending) {
    return (
      <section className="flex items-center gap-2 text-xs text-zinc-500">
        <Spinner size={14} />
        <span>{t('generating')}</span>
      </section>
    );
  }

  if (error || !exercise) {
    return (
      <section className="flex items-center gap-2">
        <span className="text-xs text-red-600 dark:text-red-400">{t('practiceGenericError')}</span>
        <button
          type="button"
          onClick={generate}
          className="text-xs px-2 py-1 rounded border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-900"
        >
          {t('practiceTryAnother')}
        </button>
      </section>
    );
  }

  const verdictKind = verdict
    ? verdict.correct
      ? 'correct'
      : 'wrong'
    : null;

  return (
    <section className="space-y-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
        {t('practicePrompt')}
      </div>
      <div className="text-sm break-words">{exercise.prompt}</div>

      <textarea
        ref={inputRef}
        rows={1}
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        onKeyDown={(e) => {
          // Enter submits (single-line UX); Shift+Enter inserts newline.
          if (
            e.key === 'Enter' &&
            !e.shiftKey &&
            !e.nativeEvent.isComposing &&
            !checking
          ) {
            e.preventDefault();
            void onCheck();
          }
        }}
        disabled={!!verdict?.correct}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        className="w-full px-3 py-2 text-sm resize-none overflow-hidden leading-snug min-h-[2.25rem] rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
      />

      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={onCheck}
          disabled={checking || !answer.trim() || !!verdict?.correct}
          className="text-xs inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {checking ? <Spinner size={12} /> : null}
          <span>{t('practiceCheck')}</span>
        </button>
        <button
          type="button"
          onClick={() => setShowAnswer((v) => !v)}
          className="text-xs text-zinc-600 dark:text-zinc-400 underline-offset-2 hover:underline"
        >
          {t('practiceShowAnswer')}
        </button>
        <button
          type="button"
          onClick={generate}
          className="text-xs text-zinc-600 dark:text-zinc-400 underline-offset-2 hover:underline ml-auto"
        >
          {t('practiceTryAnother')}
        </button>
      </div>

      {/* Blurred hint — click anywhere on the chip to reveal. Filter blur
          is reversible, so the hint can stay in place after revealing
          without remounting. */}
      <div className="flex items-baseline gap-2 flex-wrap text-xs">
        <span className="text-zinc-500 shrink-0">{t('practiceHint')}</span>
        <button
          type="button"
          onClick={() => setHintRevealed(true)}
          aria-label={hintRevealed ? exercise.hint : t('practiceHintReveal')}
          className={
            'min-w-0 text-left rounded px-1.5 py-0.5 transition-[filter] ' +
            (hintRevealed
              ? 'text-zinc-700 dark:text-zinc-300'
              : 'select-none cursor-pointer filter blur-sm hover:blur-[2px] text-zinc-700 dark:text-zinc-300')
          }
        >
          {exercise.hint}
        </button>
      </div>

      {verdictKind === 'correct' && (
        <div className="flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-400 flex-wrap">
          <SpeakButton text={exercise.canonical} lang={targetLang} />
          <span>✓ {t('practiceCorrect')}</span>
          {/* AI judge accepted a paraphrase / alternate — surface that so
              the learner knows their wording was different but valid. */}
          {verdict?.judgedBy === 'claude' && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500">
              AI
            </span>
          )}
        </div>
      )}
      {/* Accepted-but-watch: case / punctuation drift on an otherwise
          correct answer. Same affordance the lesson exercises give. */}
      {verdictKind === 'correct' && verdict?.warning && (
        <div className="text-xs text-amber-700 dark:text-amber-400 flex items-start gap-1.5">
          <span aria-hidden>💡</span>
          <span>
            {verdict.warning.case && verdict.warning.punctuation
              ? tLesson('verdict.warningCaseAndPunctuation')
              : verdict.warning.case
                ? tLesson('verdict.warningCase')
                : tLesson('verdict.warningPunctuation')}
          </span>
        </div>
      )}
      {verdictKind === 'wrong' && (
        <>
          <div className="flex items-center gap-1.5 text-sm text-red-700 dark:text-red-400 flex-wrap">
            <span>✗ {t('practiceWrong')}</span>
            {verdict?.judgedBy === 'claude' && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500">
                AI
              </span>
            )}
          </div>
          {/* Categorised issues from the AI judge — spelling / wrongWord
              / wordOrder / wordForm / missingWord / syntax. Same component
              the lesson exercises use, so the styling and translations
              stay consistent across the app. */}
          {verdict && <IssueList issues={verdict.issues} judgedBy={verdict.judgedBy} />}
        </>
      )}

      {/* Canonical reveal: show whenever (a) the user clicked "Show answer"
          OR (b) the AI accepted a paraphrase that differs from the
          canonical — so the learner sees the reference form alongside
          their valid alternate. */}
      {(showAnswer ||
        (verdictKind === 'correct' && verdict?.judgedBy === 'claude')) && (
        <div className="flex items-baseline gap-1.5 text-xs text-zinc-600 dark:text-zinc-400 break-words">
          <SpeakButton text={exercise.canonical} lang={targetLang} />
          <span>
            <span className="font-semibold">→ </span>
            {exercise.canonical}
          </span>
        </div>
      )}
    </section>
  );
}
