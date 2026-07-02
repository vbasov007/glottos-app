// Hybrid answer checker. Pure functions client-side; falls back to /api/check-answer
// only when normalized exact match fails.

import { withBase } from './api-base';
import { checkAgainst } from './normalize';

export interface CheckRequest {
  given: string;
  canonical: string;
  alternates: string[];
  /** Context for the AI judge: e.g. "Lesson 9: Akkusativ" */
  context?: string;
  /** Native language of the learner */
  nativeLang: 'ru' | 'en' | 'pl' | 'de';
  /** The language being learned. Required for the AI judge so it knows what
   *  language to expect in `given` and what canonical to invent when missing. */
  targetLang: 'de' | 'fr' | 'es' | 'sr' | 'ka' | 'he' | 'en' | 'it';
  /** The native-language prompt the learner is responding to. Used by the AI
   *  judge when canonical is empty — the model invents a plausible answer
   *  from the prompt and judges against that. Ignored when canonical is set. */
  prompt?: string;
}

/** Structured breakdown of what's wrong with a learner's answer. The AI
 *  judge categorizes each error so the UI can present them as tagged rows
 *  instead of one fuzzy paragraph. `comment` is always in the learner's
 *  native language. */
export type IssueCategory =
  | 'spelling'      // misspelled word the learner typed
  | 'wrongWord'     // wrong vocabulary choice
  | 'wordOrder'     // misplaced word/phrase
  | 'wordForm'      // wrong case / gender / verb form / binyan
  | 'missingWord'   // required content word omitted
  | 'syntax';       // clause structure / punctuation (comma before weil, etc.)

export interface Issue {
  category: IssueCategory;
  /** Word/phrase the issue is about. For most categories this is the
   *  offending fragment from the learner's answer; for `missingWord` it's
   *  the omitted word (in the target language). */
  word: string;
  /** Short explanation in the LEARNER'S NATIVE LANGUAGE. Names the problem
   *  without revealing the full expected answer. */
  comment: string;
}

export interface CheckResult {
  correct: boolean;
  /** Structured errors from the AI judge. Empty/absent when correct, or when
   *  the AI call failed (the UI shows a fallback string in that case). */
  issues?: Issue[];
  judgedBy: 'exact' | 'claude';
  matchedAlternate?: boolean;
  /**
   * Present when the answer was accepted but differed from the expected form
   * in cosmetic ways. UI surfaces these as a "still correct, but…" note so
   * the learner can self-correct without being marked wrong.
   */
  warning?: { case?: boolean; punctuation?: boolean };
}

/**
 * Try local exact + normalized match first. Fall back to Claude only on miss.
 * The Claude call is server-side; we POST JSON to /api/check-answer.
 */
export async function checkAnswer(req: CheckRequest): Promise<CheckResult> {
  // Skip the local exact-match entirely when there's no canonical to compare
  // against — go straight to the AI, which will invent a canonical from the
  // prompt and judge.
  const local = req.canonical
    ? checkAgainst(req.given, req.canonical, req.alternates)
    : { correct: false as const, matchLevel: 'exact' as const, matchedAlternate: false };
  if (local.correct) {
    const warning =
      local.matchLevel === 'exact'
        ? undefined
        : {
            case: local.matchLevel === 'case_only' || local.matchLevel === 'case_and_punct',
            punctuation:
              local.matchLevel === 'punct_only' || local.matchLevel === 'case_and_punct',
          };
    return {
      correct: true,
      judgedBy: 'exact',
      matchedAlternate: local.matchedAlternate,
      warning,
    };
  }

  // Fall back to AI
  try {
    const res = await fetch(withBase('/api/check-answer'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        given: req.given,
        canonical: req.canonical,
        alternates: req.alternates,
        context: req.context,
        nativeLang: req.nativeLang,
        targetLang: req.targetLang,
        prompt: req.prompt,
      }),
    });
    if (!res.ok) {
      return { correct: false, judgedBy: 'exact' };
    }
    const data = (await res.json()) as { correct: boolean; issues?: Issue[] };
    return {
      correct: data.correct,
      issues: data.issues,
      judgedBy: 'claude',
    };
  } catch {
    // Network failure → fall back to exact "wrong" with no structured issues;
    // the UI shows a generic "couldn't check" message in that case.
    return { correct: false, judgedBy: 'exact' };
  }
}
