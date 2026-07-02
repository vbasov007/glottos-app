import { getNounArticle } from '../i18n/grammar';
import type { ExplanationResult } from '../types';

export interface FlashcardItem {
  front: string;
  back: string;
  /** Language of the front text. Used by the speak button so deck cards keep
   *  their own voice even when the workspace's textLanguage differs. */
  frontLang?: string;
  /** Language of the back text — the user's explanation/native language. */
  backLang?: string;
  /** Example sentences from the source explanation, when the card was built from
   *  one. Populated for deck-sourced cards; absent for session-cache cards that
   *  travel without their original explanation payload. */
  examples?: Array<{ text: string; translation: string }>;
  /** Full ExplanationResult so popovers (Examples / Forms / Meanings) can read
   *  the rest of the payload without re-fetching. Populated for deck-sourced
   *  cards only; session cards omit it. */
  explanation?: ExplanationResult;
}

interface ExplanationResultLike {
  input_type: 'word' | 'sentence';
  selection: string;
  meanings?: string[];
  lemma_translation?: string | null;
  translation?: string | null;
  target_translations?: Array<{ text: string }>;
  part_of_speech?: string | null;
  morphology?: { lemma?: string | null; gender?: 'm' | 'f' | 'n' | null } | null;
  forms?: { verb?: { infinitive?: string | null } | null } | null;
}

/**
 * Pure transform from an ExplanationResult-like value to a flashcard {front, back}.
 * Front for words is "<article> <lemma>" using the target language's article rules;
 * back picks the first available translation field. Returns null if no usable back.
 *
 * For verbs the infinitive form is preferred over the bare lemma, because the
 * infinitive carries an inherent reflexive pronoun/particle (German "sich
 * umziehen", Romance "vestirse"/"se lever", Slavic "одеваться") that the lemma
 * usually strips.
 */
export function deriveCard(r: ExplanationResultLike, textLanguage: string, fallbackKey?: string): FlashcardItem | null {
  const isWord = r.input_type === 'word';
  let front: string;
  if (isWord) {
    const isVerb = (r.part_of_speech || '').trim().toLowerCase() === 'verb';
    const infinitive = r.forms?.verb?.infinitive?.trim();
    front = (isVerb && infinitive ? infinitive : (r.morphology?.lemma || r.selection || fallbackKey || ''));
    const article = getNounArticle(textLanguage, r.morphology?.gender, front);
    // A trailing apostrophe (l') signals elision — attach with no space.
    if (article) front = article.endsWith("'") ? `${article}${front}` : `${article} ${front}`;
  } else {
    front = r.selection || fallbackKey || '';
  }
  let back = '';
  if (isWord) {
    if (r.lemma_translation) back = r.lemma_translation;
    else if (r.meanings?.length) back = r.meanings.join(', ');
    else if (r.target_translations?.length) back = r.target_translations.map(tt => tt.text).join(', ');
  } else {
    if (r.meanings?.length) back = r.meanings.join(', ');
    else if (r.translation) back = r.translation;
    else if (r.target_translations?.length) back = r.target_translations.map(tt => tt.text).join(', ');
  }
  if (!back || !front) return null;
  return { front, back };
}
