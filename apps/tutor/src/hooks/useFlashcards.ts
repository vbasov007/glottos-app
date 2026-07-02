import { useState, useRef, useCallback, useEffect, type MutableRefObject } from 'react';
import { deriveCard, type FlashcardItem } from '../lib/deriveCard';

export type { FlashcardItem };

interface ExplanationResultLike {
  input_type: 'word' | 'sentence';
  selection: string;
  meanings?: string[];
  lemma_translation?: string | null;
  translation?: string | null;
  target_translations?: Array<{ text: string }>;
  morphology?: { lemma?: string | null; gender?: 'm' | 'f' | 'n' | null } | null;
}

interface UseFlashcardsParams {
  explanationCacheRef: MutableRefObject<Map<string, ExplanationResultLike>>;
  speakPhrase: (phrase?: string, onEnded?: () => void, languageOverride?: string, cleanAudio?: boolean) => Promise<void>;
  prefetchSentences: (sentences: string[], langOverride?: string) => Promise<number>;
  textLanguage: string;
  explanationLanguage: string;
  /** Callback to stop all ongoing TTS audio (full-text playback, current source, heartbeat, etc.) */
  stopAllAudio: () => void;
  /** Callback to start a heartbeat tone that keeps audio context alive. Returns a cleanup function. */
  startHeartbeat: () => (() => void);
  /** Ref to know if TTS is currently speaking */
  speakingRef: MutableRefObject<boolean>;
}

export function useFlashcards({
  explanationCacheRef,
  speakPhrase,
  prefetchSentences,
  textLanguage,
  explanationLanguage,
  stopAllAudio,
  startHeartbeat,
  speakingRef,
}: UseFlashcardsParams) {
  // --- State ---
  const [showFlashcards, setShowFlashcards] = useState(false);
  const [flashcards, setFlashcards] = useState<FlashcardItem[]>([]);
  const [flashcardIndex, setFlashcardIndex] = useState(0);
  const [flashcardFlipped, setFlashcardFlipped] = useState(false);
  const [flashcardReversed, setFlashcardReversed] = useState(false);
  const [flashcardFrontHidden, setFlashcardFrontHidden] = useState(false);
  const [flashcardAutoplay, setFlashcardAutoplay] = useState(false);
  const [flashcardPrefetching, setFlashcardPrefetching] = useState(false);
  const [flashcardDelay, setFlashcardDelay] = useState(2);

  // --- Refs ---
  const flashcardDelayRef = useRef(2);
  const flashcardAutoplayRef = useRef(false);
  const flashcardAutoplaySessionRef = useRef(0);

  // Keep ref in sync with state for use in async callbacks
  useEffect(() => { flashcardAutoplayRef.current = flashcardAutoplay; }, [flashcardAutoplay]);

  // --- Build cards from explanation cache ---
  const buildCardsFromCache = useCallback((): FlashcardItem[] => {
    const cache = explanationCacheRef.current;
    if (!cache || cache.size === 0) return [];
    const cards: FlashcardItem[] = [];
    cache.forEach((r, phrase) => {
      const card = deriveCard(r, textLanguage, phrase);
      if (card) cards.push(card);
    });
    return cards;
  }, [explanationCacheRef, textLanguage]);

  // --- Fisher-Yates shuffle (in-place) ---
  const shuffleArray = <T,>(arr: T[]): T[] => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  // --- Start flashcard game ---
  const startFlashcards = useCallback(() => {
    const cards = buildCardsFromCache();
    if (cards.length === 0) return;
    shuffleArray(cards);
    setFlashcards(cards);
    setFlashcardIndex(0);
    setFlashcardFlipped(false);
    setFlashcardReversed(false);
    setShowFlashcards(true);
  }, [buildCardsFromCache]);

  // --- Start flashcard game from a pre-derived list (e.g. saved deck) ---
  const startFlashcardsFromCards = useCallback((cards: FlashcardItem[]) => {
    if (cards.length === 0) return;
    const copy = [...cards];
    shuffleArray(copy);
    setFlashcards(copy);
    setFlashcardIndex(0);
    setFlashcardFlipped(false);
    setFlashcardReversed(false);
    setShowFlashcards(true);
  }, []);

  // --- Shuffle cards ---
  const shuffleFlashcards = useCallback(() => {
    setFlashcards(prev => {
      const copy = [...prev];
      shuffleArray(copy);
      return copy;
    });
    setFlashcardIndex(0);
    setFlashcardFlipped(false);
  }, []);

  // --- Delete current card ---
  const deleteFlashcard = useCallback(() => {
    setFlashcards(prev => {
      const copy = [...prev];
      copy.splice(flashcardIndex, 1);
      if (copy.length === 0) {
        setShowFlashcards(false);
        return copy;
      }
      setFlashcardIndex(i => i >= copy.length ? 0 : i);
      setFlashcardFlipped(false);
      return copy;
    });
  }, [flashcardIndex]);

  // --- Navigation ---
  const nextFlashcard = useCallback(() => {
    setFlashcardIndex(i => (i + 1) % flashcards.length);
    setFlashcardFlipped(false);
  }, [flashcards.length]);

  const prevFlashcard = useCallback(() => {
    setFlashcardIndex(i => (i - 1 + flashcards.length) % flashcards.length);
    setFlashcardFlipped(false);
  }, [flashcards.length]);

  // --- Stop autoplay ---
  const stopFlashcardAutoplay = useCallback(() => {
    flashcardAutoplayRef.current = false;
    flashcardAutoplaySessionRef.current++;
    setFlashcardAutoplay(false);
    setFlashcardPrefetching(false);
    stopAllAudio();
  }, [stopAllAudio]);

  // --- Start autoplay ---
  const startFlashcardAutoplay = useCallback(async () => {
    if (flashcards.length === 0) return;

    // Stop any ongoing audio playback first
    stopAllAudio();

    // Bump session so any lingering old loop dies
    const session = ++flashcardAutoplaySessionRef.current;
    flashcardAutoplayRef.current = true;
    setFlashcardAutoplay(true);

    const alive = () => flashcardAutoplayRef.current && flashcardAutoplaySessionRef.current === session;

    const reversed = flashcardReversed;
    // Resolve per-card front/back languages, falling back to workspace defaults
    // when a card doesn't carry its own (session-mode cards are workspace-bound).
    const cardFrontLang = (c: FlashcardItem) => reversed
      ? (c.backLang || explanationLanguage)
      : (c.frontLang || textLanguage);
    const cardBackLang = (c: FlashcardItem) => reversed
      ? (c.frontLang || textLanguage)
      : (c.backLang || explanationLanguage);

    // Group phrases by language so each prefetch batch goes out under the right
    // textLanguage — mixed-language decks (e.g. cards saved from different
    // workspaces) used to all share the workspace's textLanguage and synthesize
    // in the wrong voice.
    const groupByLang = (
      cards: FlashcardItem[],
      pick: (c: FlashcardItem) => string,
      lang: (c: FlashcardItem) => string,
    ): Map<string, string[]> => {
      const groups = new Map<string, string[]>();
      for (const c of cards) {
        const key = lang(c);
        const arr = groups.get(key);
        if (arr) arr.push(pick(c)); else groups.set(key, [pick(c)]);
      }
      return groups;
    };
    const frontGroups = groupByLang(
      flashcards,
      c => reversed ? c.back : c.front,
      cardFrontLang,
    );
    const backGroups = groupByLang(
      flashcards,
      c => reversed ? c.front : c.back,
      cardBackLang,
    );

    // Prefetch all audio in parallel. Show a spinner on the play button while
    // this runs — for a cold deck this can take several seconds, and without
    // feedback the button looks hung between the press and the first word.
    setFlashcardPrefetching(true);
    try {
      const prefetchPromises: Promise<unknown>[] = [];
      frontGroups.forEach((sents, lang) => prefetchPromises.push(prefetchSentences(sents, lang)));
      backGroups.forEach((sents, lang) => prefetchPromises.push(prefetchSentences(sents, lang)));
      await Promise.all(prefetchPromises);
    } catch (_) { /* individual failures handled inside prefetchSentences */ }
    finally { setFlashcardPrefetching(false); }

    if (!alive()) return;

    // Keep audio hardware awake throughout autoplay
    const stopHeartbeat = startHeartbeat();

    const speakAndWait = (phrase: string, lang: string): Promise<void> =>
      new Promise((resolve) => {
        const trySpeak = () => {
          if (!alive()) { resolve(); return; }
          if (speakingRef.current) {
            setTimeout(trySpeak, 100);
            return;
          }
          speakPhrase(phrase, () => resolve(), lang, true);
        };
        trySpeak();
      });

    const delay = (ms: number): Promise<void> =>
      new Promise((resolve) => {
        const timer = setTimeout(resolve, ms);
        const check = setInterval(() => {
          if (!alive()) {
            clearTimeout(timer);
            clearInterval(check);
            resolve();
          }
        }, 100);
        setTimeout(() => clearInterval(check), ms + 50);
      });

    // Build playback order: start from current index, then loop with shuffled order
    let order = Array.from({ length: flashcards.length }, (_, i) => i);
    // On first pass, start from current card
    order = order.slice(flashcardIndex).concat(order.slice(0, flashcardIndex));

    while (alive()) {
      for (const i of order) {
        if (!alive()) break;

        setFlashcardIndex(i);
        setFlashcardFlipped(false);

        await delay(150);
        if (!alive()) break;

        const card = flashcards[i];
        const frontPhrase = reversed ? card.back : card.front;
        try { await speakAndWait(frontPhrase, cardFrontLang(card)); } catch (_) {}
        await delay(100);
        if (!alive()) break;

        await delay(flashcardDelayRef.current * 1000);
        if (!alive()) break;

        setFlashcardFlipped(true);
        await delay(150);
        if (!alive()) break;

        const backPhrase = reversed ? card.front : card.back;
        try { await speakAndWait(backPhrase, cardBackLang(card)); } catch (_) {}
        await delay(100);
        if (!alive()) break;

        await delay(2000);
      }

      if (!alive()) break;

      // Shuffle order for next loop iteration
      order = Array.from({ length: flashcards.length }, (_, i) => i);
      for (let j = order.length - 1; j > 0; j--) {
        const k = Math.floor(Math.random() * (j + 1));
        [order[j], order[k]] = [order[k], order[j]];
      }
    }

    // Stop heartbeat
    stopHeartbeat();

    // Only clean up if this is still the active session
    if (flashcardAutoplaySessionRef.current === session) {
      flashcardAutoplayRef.current = false;
      setFlashcardAutoplay(false);
    }
  }, [flashcards, flashcardIndex, flashcardReversed, textLanguage, explanationLanguage, prefetchSentences, speakPhrase, stopAllAudio, startHeartbeat, speakingRef]);

  // --- Delay control ---
  const cycleDelay = useCallback(() => {
    const next = flashcardDelay >= 8 ? 1 : flashcardDelay + 1;
    setFlashcardDelay(next);
    flashcardDelayRef.current = next;
  }, [flashcardDelay]);

  return {
    // State
    showFlashcards,
    setShowFlashcards,
    flashcards,
    flashcardIndex,
    flashcardFlipped,
    setFlashcardFlipped,
    flashcardReversed,
    setFlashcardReversed,
    flashcardFrontHidden,
    setFlashcardFrontHidden,
    flashcardAutoplay,
    flashcardPrefetching,
    flashcardDelay,
    flashcardDelayRef,

    // Actions
    startFlashcards,
    startFlashcardsFromCards,
    shuffleFlashcards,
    deleteFlashcard,
    nextFlashcard,
    prevFlashcard,
    startFlashcardAutoplay,
    stopFlashcardAutoplay,
    cycleDelay,
  };
}
