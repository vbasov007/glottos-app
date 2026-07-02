import { useState, type RefObject, type MutableRefObject, type FC } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  BookOpen,
  Loader2,
  Info,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Table as TableIcon,
  Quote,
  Volume2,
  Trash2,
  ArrowUp,
  List,
  Plus,
  Check,
  ChevronDown,
  Wand2,
  ArrowLeftRight,
  RefreshCw,
  Layers,
  Type,
  Puzzle,
} from 'lucide-react';
import { t, getGrammar } from '../i18n';
import { isExplanationStale } from '../utils';
import type { ExplanationResult, DeckSummary } from '../types';

/** One row of the Examples list with the "more like this" affordance.
 *  Variants are stacked beneath the original (indented) and each variant
 *  itself has its own speak + more-like-this buttons so the user can keep
 *  iterating. State is per-row and isolated. */
interface ExampleVariant { text: string; translation: string; loading?: boolean; error?: string }
interface ExampleCardProps {
  ex: { text: string; translation: string };
  /** Other example texts on the card — passed to the LLM so it doesn't repeat them. */
  peers: string[];
  speakPhrase: (phrase?: string) => void;
  requestVariant: (currentExample: { text: string; translation: string }, otherExamples: string[]) => Promise<{ text: string; translation: string }>;
  interfaceLanguage: string;
  explDir: 'ltr' | 'rtl';
}
const ExampleCard: FC<ExampleCardProps> = ({ ex, peers, speakPhrase, requestVariant, interfaceLanguage, explDir }) => {
  const [variants, setVariants] = useState<ExampleVariant[]>([]);

  const handleMore = async (source: { text: string; translation: string }) => {
    setVariants(prev => [...prev, { text: '', translation: '', loading: true }]);
    try {
      const others = Array.from(new Set([
        ex.text,
        ...peers,
        ...variants.map(v => v.text).filter(Boolean),
      ])).filter(t => t && t !== source.text);
      const res = await requestVariant(source, others);
      setVariants(prev => {
        const next = [...prev];
        const slotIdx = next.findIndex(v => v.loading);
        if (slotIdx >= 0) next[slotIdx] = { text: res.text, translation: res.translation };
        return next;
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setVariants(prev => {
        const next = [...prev];
        const slotIdx = next.findIndex(v => v.loading);
        if (slotIdx >= 0) next[slotIdx] = { text: '', translation: '', error: msg };
        return next;
      });
    }
  };

  return (
    <div className="bg-[var(--bg-panel)] p-4 rounded-xl border border-[var(--border-main)] shadow-sm">
      <div className="flex items-start gap-2">
        <p className="font-serif italic text-lg text-[var(--text-primary)] flex-1">"{ex.text}"</p>
        <button
          onClick={() => speakPhrase(ex.text)}
          className="text-[var(--text-faint)] hover:text-[var(--text-secondary)] transition-colors mt-1 shrink-0 p-1 -m-1"
          title={t('LISTEN', interfaceLanguage)}
          aria-label={t('LISTEN', interfaceLanguage)}
        >
          <Volume2 className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => handleMore(ex)}
          className="text-[var(--text-faint)] hover:text-[var(--text-secondary)] transition-colors mt-1 shrink-0 p-1 -m-1"
          title={t('MORE_LIKE_THIS', interfaceLanguage)}
          aria-label={t('MORE_LIKE_THIS', interfaceLanguage)}
        >
          <Wand2 className="w-3.5 h-3.5" />
        </button>
      </div>
      <p className="text-sm text-[var(--text-tertiary)] mt-2" dir={explDir}>— {ex.translation}</p>

      {variants.map((v, vi) => (
        <div key={vi} className="mt-3 ml-2 pl-3 border-l-2 border-[var(--border-main)]">
          {v.loading ? (
            <div className="flex items-center gap-2 text-sm text-[var(--text-tertiary)] py-1">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            </div>
          ) : v.error ? (
            <p className="text-xs text-red-500 py-1">{v.error}</p>
          ) : (
            <>
              <div className="flex items-start gap-2">
                <p className="font-serif italic text-base text-[var(--text-primary)] flex-1">"{v.text}"</p>
                <button
                  onClick={() => speakPhrase(v.text)}
                  className="text-[var(--text-faint)] hover:text-[var(--text-secondary)] transition-colors mt-1 shrink-0 p-1 -m-1"
                  title={t('LISTEN', interfaceLanguage)}
                  aria-label={t('LISTEN', interfaceLanguage)}
                >
                  <Volume2 className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => handleMore({ text: v.text, translation: v.translation })}
                  className="text-[var(--text-faint)] hover:text-[var(--text-secondary)] transition-colors mt-1 shrink-0 p-1 -m-1"
                  title={t('MORE_LIKE_THIS', interfaceLanguage)}
                  aria-label={t('MORE_LIKE_THIS', interfaceLanguage)}
                >
                  <Wand2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <p className="text-xs text-[var(--text-tertiary)] mt-1" dir={explDir}>— {v.translation}</p>
            </>
          )}
        </div>
      ))}
    </div>
  );
};

export interface ExplanationPanelProps {
  result: ExplanationResult | null;
  loading: boolean;
  error: string | null;
  /** Admin-only: shows a re-generate button that drops the cached entry and
   *  refetches a fresh explanation. */
  isAdmin: boolean;
  explainHistory: string[];
  setExplainHistory: (v: string[]) => void;
  explainNavIdx: number;
  setExplainNavIdx: (v: number) => void;
  explanationCacheRef: MutableRefObject<Map<string, ExplanationResult>>;
  setResult: (v: ExplanationResult | null) => void;
  setError: (v: string | null) => void;
  speakPhrase: (phrase?: string) => void;
  speaking: boolean;
  explainPhrase: (phrase: string) => void;
  lastExplainedPhraseRef: MutableRefObject<string>;
  interfaceLanguage: string;
  /** Language the explanation/back was generated in. Passed down so cards can
   *  freeze the back's language at create time (otherwise a later user-pref
   *  change would TTS the back in the wrong voice). */
  explanationLanguage: string;
  textLanguage: string;
  textDir: 'ltr' | 'rtl';
  explDir: 'ltr' | 'rtl';
  resultSectionRef: RefObject<HTMLElement | null>;
  isTouchDevice: boolean;
  backToTextBtnRef: RefObject<HTMLButtonElement | null>;
  savedScrollYRef: MutableRefObject<number>;
  // --- Deck integration ---
  decks: DeckSummary[];
  activeDeckId: string | null;
  setActiveDeck: (id: string | null) => void;
  addCardToActiveDeck: (result: ExplanationResult, textLanguage: string, explanationLanguage: string) => Promise<boolean | 'no-deck'>;
  /** Bulk-add every explanation in the current list to the active deck. */
  addAllToActiveDeck: (results: ExplanationResult[], textLanguage: string, explanationLanguage: string) => Promise<{ added: number; total: number; noDeck?: boolean }>;
  isCurrentCardInActiveDeck: boolean;
  onCreateDeck: () => void;
  onOpenReview: () => void;
  /** Toast for prompting the user to pick a deck before adding. */
  showToast: (message: string) => void;
  /** Fetch one "more like this" variant for an example. Closes over the
   *  current explanation context (selection, meanings/translations/etc) on
   *  the caller side — this component only knows about per-row example text. */
  requestExampleVariant: (currentExample: { text: string; translation: string }, otherExamples: string[]) => Promise<{ text: string; translation: string }>;
}

export function ExplanationPanel({
  result,
  loading,
  error,
  isAdmin,
  explainHistory,
  setExplainHistory,
  explainNavIdx,
  setExplainNavIdx,
  explanationCacheRef,
  setResult,
  setError,
  speakPhrase,
  speaking,
  explainPhrase,
  lastExplainedPhraseRef,
  interfaceLanguage,
  explanationLanguage,
  textLanguage,
  textDir,
  explDir,
  resultSectionRef,
  isTouchDevice,
  backToTextBtnRef,
  savedScrollYRef,
  decks,
  activeDeckId,
  setActiveDeck,
  addCardToActiveDeck,
  addAllToActiveDeck,
  isCurrentCardInActiveDeck,
  onCreateDeck,
  onOpenReview,
  showToast,
  requestExampleVariant,
}: ExplanationPanelProps) {
  const [showExplainList, setShowExplainList] = useState(false);
  const [deckPickerOpen, setDeckPickerOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [justAdded, setJustAdded] = useState(false);
  const [addingAll, setAddingAll] = useState(false);
  const [justAddedAll, setJustAddedAll] = useState(false);
  const [addingWords, setAddingWords] = useState(false);
  const [justAddedWords, setJustAddedWords] = useState(false);
  const [addingPhrases, setAddingPhrases] = useState(false);
  const [justAddedPhrases, setJustAddedPhrases] = useState(false);

  const activeDeck = decks.find(d => d.id === activeDeckId) || null;

  // No deck selected → prompt the user to pick one (open the picker + toast)
  // instead of silently adding to an auto-created deck.
  const promptSelectDeck = () => {
    setDeckPickerOpen(true);
    showToast(t('SELECT_DECK', interfaceLanguage));
  };

  const handleAdd = async () => {
    if (!result || adding || isCurrentCardInActiveDeck) return;
    setAdding(true);
    const ok = await addCardToActiveDeck(result, textLanguage, explanationLanguage);
    setAdding(false);
    if (ok === 'no-deck') { promptSelectDeck(); return; }
    if (ok) {
      setJustAdded(true);
      setTimeout(() => setJustAdded(false), 1500);
    }
  };

  // Add EVERY explanation in the current list to the active deck. Pulls each
  // entry from the cache by its history phrase; duplicates upsert server-side.
  const handleAddAll = async () => {
    if (addingAll) return;
    const results = explainHistory
      .map(p => explanationCacheRef.current.get(p))
      .filter((r): r is ExplanationResult => !!r);
    if (results.length === 0) return;
    setAddingAll(true);
    const r = await addAllToActiveDeck(results, textLanguage, explanationLanguage);
    setAddingAll(false);
    if (r.noDeck) { promptSelectDeck(); return; }
    setJustAddedAll(true);
    setTimeout(() => setJustAddedAll(false), 1500);
  };

  // Like handleAddAll, but only single-word entries — skips multi-word phrases
  // and sentences (a "word" = a selection with no internal whitespace).
  const handleAddWordsOnly = async () => {
    if (addingWords) return;
    const results = explainHistory
      .map(p => explanationCacheRef.current.get(p))
      .filter((r): r is ExplanationResult => !!r)
      .filter(r => { const s = (r.selection || '').trim(); return !!s && !/\s/.test(s); });
    if (results.length === 0) return;
    setAddingWords(true);
    const r = await addAllToActiveDeck(results, textLanguage, explanationLanguage);
    setAddingWords(false);
    if (r.noDeck) { promptSelectDeck(); return; }
    setJustAddedWords(true);
    setTimeout(() => setJustAddedWords(false), 1500);
  };

  // Like handleAddAll, but only multi-word entries — phrases/sentences (a
  // "phrase" = a selection with internal whitespace); skips single words.
  const handleAddPhrasesOnly = async () => {
    if (addingPhrases) return;
    const results = explainHistory
      .map(p => explanationCacheRef.current.get(p))
      .filter((r): r is ExplanationResult => !!r)
      .filter(r => { const s = (r.selection || '').trim(); return !!s && /\s/.test(s); });
    if (results.length === 0) return;
    setAddingPhrases(true);
    const r = await addAllToActiveDeck(results, textLanguage, explanationLanguage);
    setAddingPhrases(false);
    if (r.noDeck) { promptSelectDeck(); return; }
    setJustAddedPhrases(true);
    setTimeout(() => setJustAddedPhrases(false), 1500);
  };

  // The deck selector (current-deck button + dropdown) — shared by the single
  // "Add to deck" control and the list-mode "Add all to deck" control.
  const renderDeckPicker = () => (
    <>
      <button
        onClick={() => setDeckPickerOpen(o => !o)}
        title={activeDeck?.name || t('SELECT_DECK', interfaceLanguage)}
        // px-2.5 py-2 on touch → ~36-40px tap target; tighter on desktop pointer.
        className="flex items-center gap-0.5 px-2.5 py-2 sm:px-1.5 sm:py-1.5 rounded-md border border-[var(--border-main)] text-xs sm:text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--text-muted)] transition-colors max-w-[140px]"
      >
        <span className="truncate">{activeDeck?.name || t('SELECT_DECK', interfaceLanguage)}</span>
        <ChevronDown className="w-3 h-3 shrink-0" />
      </button>
      {deckPickerOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setDeckPickerOpen(false)} />
          {/* Anchored to the right of the picker — when this lives in the top-right of the panel,
              the menu drops down and to the left, growing into the viewport. */}
          <div className="absolute top-full right-0 mt-1 py-1 bg-[var(--bg-panel)] border border-[var(--border-main)] rounded-lg shadow-lg z-50 min-w-[180px] max-w-[calc(100vw-2rem)]">
            {decks.length === 0 && (
              <div className="px-3 py-1.5 text-xs text-[var(--text-muted)] italic">{t('NO_DECKS', interfaceLanguage)}</div>
            )}
            {decks.map(d => (
              <button
                key={d.id}
                onClick={() => { setActiveDeck(d.id); setDeckPickerOpen(false); }}
                className={`w-full flex items-center justify-between px-3 py-2.5 sm:py-1.5 text-sm sm:text-xs hover:bg-[var(--bg-hover)] transition-colors ${d.id === activeDeckId ? 'text-[var(--text-primary)] font-medium' : 'text-[var(--text-secondary)]'}`}
              >
                <span className="truncate">{d.name}</span>
                {d.id === activeDeckId && <Check className="w-3 h-3 shrink-0 ml-2" />}
              </button>
            ))}
            <div className="my-1 border-t border-[var(--border-main)]" />
            <button
              onClick={() => { setDeckPickerOpen(false); onCreateDeck(); }}
              className="w-full flex items-center gap-2 px-3 py-2.5 sm:py-1.5 text-sm sm:text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
            >
              <Plus className="w-3 h-3" />
              {t('NEW_CARD_DECK', interfaceLanguage)}
            </button>
            {decks.length > 0 && (
              <button
                onClick={() => { setDeckPickerOpen(false); onOpenReview(); }}
                className="w-full flex items-center gap-2 px-3 py-2.5 sm:py-1.5 text-sm sm:text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
              >
                <BookOpen className="w-3 h-3" />
                {t('REVIEW_DECK', interfaceLanguage)}
              </button>
            )}
          </div>
        </>
      )}
    </>
  );

  // Single-card add — shown in the word/sentence result header.
  const addedState = justAdded || isCurrentCardInActiveDeck;
  const renderAddToDeck = () => result && (
    <div className="relative flex items-center gap-1" dir="ltr">
      <button
        onClick={handleAdd}
        disabled={adding || isCurrentCardInActiveDeck}
        title={isCurrentCardInActiveDeck ? t('IN_DECK', interfaceLanguage) : t('ADD_TO_DECK', interfaceLanguage)}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-bold transition-colors disabled:cursor-not-allowed shrink-0 ${
          addedState
            ? 'bg-emerald-500 text-white disabled:opacity-100'
            : 'bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-60'
        }`}
      >
        {adding ? <Loader2 className="w-4 h-4 animate-spin" />
          : addedState ? <Check className="w-4 h-4" />
          : <Plus className="w-4 h-4" strokeWidth={3} />}
        <span className="hidden lg:inline uppercase tracking-wider">{t(addedState ? 'ADDED_TO_DECK' : 'ADD_TO_DECK', interfaceLanguage)}</span>
      </button>
      {renderDeckPicker()}
    </div>
  );

  // Bulk add — shown in list mode, in place of the single-card add. Adds every
  // explanation in the current list to the active deck.
  const renderAddAllToDeck = () => (
    <div className="relative flex items-center gap-1" dir="ltr">
      <button
        onClick={handleAddAll}
        disabled={addingAll || explainHistory.length === 0}
        title={t('ADD_ALL_TO_DECK', interfaceLanguage)}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-bold transition-colors disabled:cursor-not-allowed shrink-0 ${
          justAddedAll
            ? 'bg-emerald-500 text-white disabled:opacity-100'
            : 'bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-60'
        }`}
      >
        {addingAll ? <Loader2 className="w-4 h-4 animate-spin" />
          : justAddedAll ? <Check className="w-4 h-4" />
          : <Layers className="w-4 h-4" strokeWidth={3} />}
      </button>
      <button
        onClick={handleAddWordsOnly}
        disabled={addingWords || explainHistory.length === 0}
        title={t('ADD_WORDS_ONLY', interfaceLanguage)}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-bold transition-colors disabled:cursor-not-allowed shrink-0 ${
          justAddedWords
            ? 'bg-emerald-500 text-white disabled:opacity-100'
            : 'bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-60'
        }`}
      >
        {addingWords ? <Loader2 className="w-4 h-4 animate-spin" />
          : justAddedWords ? <Check className="w-4 h-4" />
          : <Type className="w-4 h-4" strokeWidth={3} />}
      </button>
      <button
        onClick={handleAddPhrasesOnly}
        disabled={addingPhrases || explainHistory.length === 0}
        title={t('ADD_PHRASES_ONLY', interfaceLanguage)}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-bold transition-colors disabled:cursor-not-allowed shrink-0 ${
          justAddedPhrases
            ? 'bg-emerald-500 text-white disabled:opacity-100'
            : 'bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-60'
        }`}
      >
        {addingPhrases ? <Loader2 className="w-4 h-4 animate-spin" />
          : justAddedPhrases ? <Check className="w-4 h-4" />
          : <Quote className="w-4 h-4" strokeWidth={3} />}
      </button>
      {renderDeckPicker()}
    </div>
  );

  return (
    <section
      data-tutorial="results-panel"
      ref={resultSectionRef}
      className="w-full lg:w-[min(450px,40%)] lg:shrink-0 bg-[var(--bg-surface)] flex flex-col border-t lg:border-t-0 border-l border-[var(--border-main)] overflow-y-auto"
      dir={textDir}
    >
      {/* Explanation history navigation */}
      {(() => {
        const cachedPhrases = explainHistory;
        if (cachedPhrases.length === 0) return null;
        // Compute displayIdx: prefer explicit nav index, fall back to matching result
        let displayIdx = explainNavIdx;
        if (displayIdx < 0 || displayIdx >= cachedPhrases.length) {
          if (result) {
            const found = cachedPhrases.findIndex(p => p === result.selection);
            displayIdx = found >= 0 ? found : cachedPhrases.length - 1;
          } else {
            displayIdx = cachedPhrases.length - 1;
          }
        }
        const showArrows = cachedPhrases.length > 1;

        const navigateTo = (idx: number) => {
          const phrase = cachedPhrases[idx];
          if (!phrase) return;
          setExplainNavIdx(idx);
          const cached = explanationCacheRef.current.get(phrase);
          if (cached && !isExplanationStale(cached)) {
            setResult(cached);
            setError(null);
          } else {
            // Missing or stale (predates a rendered field like antonyms) —
            // re-fetch so the entry picks up the newer schema.
            explainPhrase(phrase);
          }
        };

        const deletePhrase = (phrase: string) => {
          explanationCacheRef.current.delete(phrase);
          const newHistory = cachedPhrases.filter(p => p !== phrase);
          setExplainHistory(newHistory);
          if (newHistory.length === 0) {
            setResult(null);
            setShowExplainList(false);
            setExplainNavIdx(-1);
          } else {
            const delIdx = cachedPhrases.indexOf(phrase);
            const nextIdx = delIdx >= newHistory.length ? newHistory.length - 1 : delIdx;
            setResult(explanationCacheRef.current.get(newHistory[nextIdx]) ?? null);
            setExplainNavIdx(nextIdx);
          }
          setError(null);
        };

        // Admin-only: drop the cached entry and refetch a fresh explanation.
        const regenerate = (phrase: string) => {
          if (!phrase) return;
          explanationCacheRef.current.delete(phrase);
          setError(null);
          explainPhrase(phrase); // now a cache miss → fresh fetch
        };

        return (
          <>
            <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border-main)] bg-[var(--bg-panel)] shrink-0" dir="ltr">
              {showArrows ? (
                <button
                  onClick={() => {
                    if (showExplainList) { setShowExplainList(false); return; }
                    const prevIdx = displayIdx <= 0 ? cachedPhrases.length - 1 : displayIdx - 1;
                    navigateTo(prevIdx);
                  }}
                  className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
              ) : <div className="w-6" />}
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-medium text-[var(--text-muted)] tabular-nums">{displayIdx + 1} / {cachedPhrases.length}</span>
                <button
                  onClick={() => setShowExplainList(v => !v)}
                  className={`p-1 transition-colors ${showExplainList ? 'text-[var(--text-primary)]' : 'text-[var(--text-faint)] hover:text-[var(--text-primary)]'}`}
                  title={t('LIST_VIEW', interfaceLanguage)}
                >
                  <List className="w-3 h-3" />
                </button>
                {isAdmin && !showExplainList && (
                  <button
                    onClick={() => regenerate(cachedPhrases[displayIdx])}
                    className="p-1 text-[var(--text-faint)] hover:text-[var(--text-primary)] transition-colors"
                    title={t('REGENERATE', interfaceLanguage)}
                    aria-label={t('REGENERATE', interfaceLanguage)}
                  >
                    <RefreshCw className="w-3 h-3" />
                  </button>
                )}
                {!showExplainList && (
                  <button
                    onClick={() => deletePhrase(cachedPhrases[displayIdx])}
                    className="p-1 text-[var(--text-faint)] hover:text-red-500 transition-colors"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
              {showArrows ? (
                <button
                  onClick={() => {
                    if (showExplainList) { setShowExplainList(false); return; }
                    const nextIdx = displayIdx >= cachedPhrases.length - 1 ? 0 : displayIdx + 1;
                    navigateTo(nextIdx);
                  }}
                  className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              ) : <div className="w-6" />}
            </div>
            {showExplainList && (
              <div className="flex-1 overflow-y-auto border-b border-[var(--border-main)]" dir="ltr">
                {/* Bulk add — sticky so it stays reachable while scrolling the list. */}
                <div className="sticky top-0 z-10 flex justify-end px-4 py-2 border-b border-[var(--border-main)] bg-[var(--bg-panel)]">
                  {renderAddAllToDeck()}
                </div>
                {cachedPhrases.map((phrase, idx) => (
                  <div
                    key={phrase}
                    className={`flex items-center justify-between px-4 py-2 cursor-pointer transition-colors ${idx === displayIdx ? 'bg-[var(--bg-hover)]' : 'hover:bg-[var(--bg-hover)]'}`}
                    onClick={() => {
                      navigateTo(idx);
                      setShowExplainList(false);
                    }}
                  >
                    <button
                      onClick={(e) => { e.stopPropagation(); speakPhrase(phrase); }}
                      className="p-1 shrink-0 text-[var(--text-faint)] hover:text-[var(--text-primary)] transition-colors"
                    >
                      <Volume2 className="w-3 h-3" />
                    </button>
                    <span className={`text-sm truncate mr-3 ${idx === displayIdx ? 'text-[var(--text-primary)] font-medium' : 'text-[var(--text-secondary)]'}`}>{phrase}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); deletePhrase(phrase); }}
                      className="p-1 shrink-0 ml-auto text-[var(--text-faint)] hover:text-red-500 transition-colors"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        );
      })()}
      <AnimatePresence mode="wait">
        {!result && !loading && !error ? (
          <motion.div
            key="empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex-1 flex flex-col items-center justify-center p-6 lg:p-12 text-center"
          >
            <div className="w-16 h-16 bg-[var(--bg-muted)]/50 rounded-full flex items-center justify-center mb-6">
              <BookOpen className="text-[var(--text-muted)] w-8 h-8" />
            </div>
            <h3 className="text-[var(--text-primary)] font-medium mb-2">{t('READY', interfaceLanguage)}</h3>
            <p className="text-[var(--text-tertiary)] text-sm max-w-xs">
              {t('RESULTS_EMPTY_HINT', interfaceLanguage)}
            </p>
          </motion.div>
        ) : loading ? (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex-1 flex flex-col items-center justify-center p-6 lg:p-12 text-center"
          >
            <Loader2 className="w-10 h-10 text-[var(--text-primary)] animate-spin mb-6" />
            <h3 className="text-[var(--text-primary)] font-medium mb-2">{t('ANALYZING', interfaceLanguage)}</h3>
            <p className="text-[var(--text-tertiary)] text-sm">{t('ANALYZING_CONTEXT', interfaceLanguage)}</p>
          </motion.div>
        ) : error ? (
          <motion.div
            key="error"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex-1 flex flex-col items-center justify-center p-6 lg:p-12 text-center"
          >
            <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mb-6">
              <Info className="text-red-400 w-8 h-8" />
            </div>
            <h3 className="text-red-900 font-medium mb-2">{t('ERROR', interfaceLanguage)}</h3>
            <p className="text-red-500 text-sm">{error}</p>
            <button
              onClick={() => explainPhrase(lastExplainedPhraseRef.current)}
              className="mt-6 text-xs font-bold uppercase tracking-widest text-[var(--text-primary)] underline"
            >
              {t('RETRY', interfaceLanguage)}
            </button>
          </motion.div>
        ) : result && (
          <motion.div
            key="result"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="p-4 lg:p-6 space-y-8 pb-20"
          >
            {/* Top row: "Back to text" (mobile only) + Add-to-deck picker.
                Placed on a single line so both anchors live at the same vertical position
                regardless of device — mobile shows both, desktop just the picker. */}
            <div className="flex items-center justify-between gap-2" dir="ltr">
              {isTouchDevice ? (
                <button
                  ref={backToTextBtnRef}
                  onClick={() => window.scrollTo({ top: savedScrollYRef.current, behavior: 'smooth' })}
                  className="flex items-center gap-1.5 text-xs text-blue-500 font-medium lg:hidden"
                >
                  <ArrowUp className="w-3.5 h-3.5" />
                  {t('BACK_TO_TEXT', interfaceLanguage)}
                </button>
              ) : <div />}
              {/* In list mode the bulk "Add all to deck" picker (atop the list)
                  is the active control — render only one picker at a time, else
                  both share deckPickerOpen and the second's full-screen backdrop
                  swallows clicks on the first's menu. */}
              {!showExplainList && renderAddToDeck()}
            </div>
            {/* -- Case A: Word -- */}
            {result.input_type === 'word' && (<>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)]">{t('WORD', interfaceLanguage)}</span>
                  {result.part_of_speech && (
                    <span className="text-[10px] font-black uppercase tracking-widest bg-[var(--bg-muted)] px-1.5 py-0.5 rounded text-[var(--text-secondary)]">
                      {result.part_of_speech}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <h2 className="text-3xl font-serif font-bold text-[var(--text-primary)]">{result.selection}</h2>
                  <button
                    onClick={() => speakPhrase(result.selection)}
                    className="text-[var(--text-faint)] hover:text-[var(--text-secondary)] transition-colors shrink-0"
                  >
                    <Volume2 className="w-5 h-5" />
                  </button>
                </div>
                {result.meanings.length > 0 && (
                  <div className="mt-4 space-y-2" dir={explDir}>
                    {result.meanings.map((m, i) => (
                      <div key={i} className="flex items-start gap-3">
                        <ChevronRight className="w-4 h-4 mt-1 text-[var(--text-faint)] shrink-0" />
                        <p className="text-lg text-[var(--text-primary)]">{m}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {(result.morphology?.lemma || result.morphology?.gender || result.morphology?.case || result.morphology?.tense) && (
                <div className="space-y-3">
                  <h4 className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-2">
                    <Info className="w-3 h-3" /> {t('MORPHOLOGY', interfaceLanguage)}
                  </h4>
                  <div className="grid grid-cols-2 gap-2">
                    {result.morphology?.lemma && (
                      <div className="bg-[var(--bg-panel)] p-3 rounded-xl border border-[var(--border-main)]">
                        <p className="text-[10px] text-[var(--text-muted)] uppercase font-bold mb-1">{t('LEMMA', interfaceLanguage)}</p>
                        <p className="font-medium">{result.morphology.lemma}</p>
                      </div>
                    )}
                    {result.morphology?.gender && (
                      <div className="bg-[var(--bg-panel)] p-3 rounded-xl border border-[var(--border-main)]">
                        <p className="text-[10px] text-[var(--text-muted)] uppercase font-bold mb-1">{t('GENDER', interfaceLanguage)}</p>
                        <p className="font-medium">
                          {result.morphology.gender === 'm' ? getGrammar(textLanguage).masculine :
                           result.morphology.gender === 'f' ? getGrammar(textLanguage).feminine : getGrammar(textLanguage).neuter}
                        </p>
                      </div>
                    )}
                    {result.morphology?.case && (
                      <div className="bg-[var(--bg-panel)] p-3 rounded-xl border border-[var(--border-main)]">
                        <p className="text-[10px] text-[var(--text-muted)] uppercase font-bold mb-1">{t('CASE', interfaceLanguage)}</p>
                        <p className="font-medium">{result.morphology.case}</p>
                      </div>
                    )}
                    {result.morphology?.tense && (
                      <div className="bg-[var(--bg-panel)] p-3 rounded-xl border border-[var(--border-main)]">
                        <p className="text-[10px] text-[var(--text-muted)] uppercase font-bold mb-1">{t('TENSE', interfaceLanguage)}</p>
                        <p className="font-medium">{result.morphology.tense}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {(result.forms?.noun?.singular?.nom || result.forms?.verb?.infinitive) && (
                <div className="space-y-3">
                  <h4 className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-2">
                    <TableIcon className="w-3 h-3" /> {t('FORMS', interfaceLanguage)}
                  </h4>
                  <div className="bg-[var(--bg-panel)] rounded-xl border border-[var(--border-main)] overflow-hidden text-xs">
                    {result.forms?.noun?.singular?.nom ? (
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-[var(--bg-surface)] border-b border-[var(--border-light)]">
                            <th className="p-2 font-bold text-[var(--text-muted)] uppercase text-[9px]">{t('DECLENSION', interfaceLanguage)}</th>
                            <th className="p-2 font-bold text-[var(--text-muted)] uppercase text-[9px]">{t('SINGULAR', interfaceLanguage)}</th>
                            <th className="p-2 font-bold text-[var(--text-muted)] uppercase text-[9px]">{t('PLURAL', interfaceLanguage)}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {['nom', 'akk', 'dat', 'gen'].map((c) => (
                            <tr key={c} className="border-b border-[var(--border-light)] last:border-0">
                              <td className="p-2 font-bold text-[var(--text-muted)] text-[9px]">{getGrammar(textLanguage).cases[c] || c}</td>
                              <td className="p-2">{(result.forms?.noun?.singular as any)?.[c] || '-'}</td>
                              <td className="p-2">{(result.forms?.noun?.plural as any)?.[c] || '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : result.forms?.verb?.infinitive ? (
                      <div className="p-4 space-y-3">
                        <div className="flex justify-between border-b border-[var(--border-light)] pb-2">
                          <span className="text-[var(--text-muted)]">{getGrammar(textLanguage).infinitive}</span>
                          <span className="font-medium">{result.forms.verb.infinitive}</span>
                        </div>
                        <div className="flex justify-between border-b border-[var(--border-light)] pb-2">
                          <span className="text-[var(--text-muted)]">{getGrammar(textLanguage).present}</span>
                          <span className="font-medium">{result.forms.verb.praesens_ich}</span>
                        </div>
                        <div className="flex justify-between border-b border-[var(--border-light)] pb-2">
                          <span className="text-[var(--text-muted)]">{getGrammar(textLanguage).past}</span>
                          <span className="font-medium">{result.forms.verb.praeteritum}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[var(--text-muted)]">{getGrammar(textLanguage).perfect}</span>
                          <span className="font-medium">{result.forms.verb.perfekt}</span>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              )}

              {result.examples?.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-2">
                    <Quote className="w-3 h-3" /> {t('EXAMPLES', interfaceLanguage)}
                  </h4>
                  <div className="space-y-4">
                    {result.examples.map((ex, i) => (
                      <ExampleCard
                        key={`${result.selection}:${i}`}
                        ex={ex}
                        peers={result.examples.filter((_, j) => j !== i).map(e => e.text)}
                        speakPhrase={speakPhrase}
                        requestVariant={requestExampleVariant}
                        interfaceLanguage={interfaceLanguage}
                        explDir={explDir}
                      />
                    ))}
                  </div>
                </div>
              )}

              {Array.isArray(result.near_synonyms) && result.near_synonyms.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-2">
                    <Sparkles className="w-3 h-3" /> {t('NEAR_SYNONYMS', interfaceLanguage)}
                  </h4>
                  <div className="space-y-2">
                    {result.near_synonyms.map((ns, i) => (
                      <div key={i} className="bg-[var(--bg-panel)] p-3 rounded-xl border border-[var(--border-main)]">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-[var(--text-primary)] flex-1 min-w-0 break-words">{ns.word}</p>
                          <button
                            onClick={() => speakPhrase(ns.word)}
                            className="text-[var(--text-faint)] hover:text-[var(--text-secondary)] transition-colors shrink-0"
                            title={t('LISTEN', interfaceLanguage)}
                            aria-label={t('LISTEN', interfaceLanguage)}
                          >
                            <Volume2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <p className="text-xs text-[var(--text-tertiary)] mt-1 break-words" dir={explDir}>{ns.difference}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {Array.isArray(result.antonyms) && result.antonyms.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-2">
                    <ArrowLeftRight className="w-3 h-3" /> {t('ANTONYMS', interfaceLanguage)}
                  </h4>
                  <div className="space-y-2">
                    {result.antonyms.map((an, i) => (
                      <div key={i} className="bg-[var(--bg-panel)] p-3 rounded-xl border border-[var(--border-main)]">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-[var(--text-primary)] flex-1 min-w-0 break-words">{an.word}</p>
                          <button
                            onClick={() => speakPhrase(an.word)}
                            className="text-[var(--text-faint)] hover:text-[var(--text-secondary)] transition-colors shrink-0"
                            title={t('LISTEN', interfaceLanguage)}
                            aria-label={t('LISTEN', interfaceLanguage)}
                          >
                            <Volume2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <p className="text-xs text-[var(--text-tertiary)] mt-1 break-words" dir={explDir}>{an.meaning}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Word structure — decomposition into roots/components (compounds,
                  derived words; most useful for long German words). */}
              {Array.isArray(result.word_structure) && result.word_structure.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-2">
                    <Puzzle className="w-3 h-3" /> {t('WORD_STRUCTURE', interfaceLanguage)}
                  </h4>
                  <div className="space-y-2">
                    {result.word_structure.map((c, i) => (
                      <div key={i} className="bg-[var(--bg-panel)] p-3 rounded-xl border border-[var(--border-main)] flex gap-3 items-start">
                        <span className="text-sm font-serif font-bold text-[var(--text-primary)] shrink-0 min-w-[90px] break-words">{c.part}</span>
                        <span className="text-sm text-[var(--text-tertiary)] flex-1 min-w-0 break-words" dir={explDir}>
                          {c.meaning}
                          {c.type ? <span className="text-[var(--text-faint)]"> · {c.type}</span> : null}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>)}

            {/* -- Case B: Sentence -- */}
            {result.input_type === 'sentence' && (<>
              <div>
                <span className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)]">{t('SENTENCE', interfaceLanguage)}</span>
                <div className="flex items-center gap-2 mt-1">
                  <p className="text-base font-serif text-[var(--text-secondary)] italic line-clamp-3">"{result.selection}"</p>
                  <button
                    onClick={() => speakPhrase(result.selection)}
                    className="text-[var(--text-faint)] hover:text-[var(--text-secondary)] transition-colors shrink-0"
                  >
                    <Volume2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {result.translation && (
                <div className="bg-[var(--bg-panel)] p-5 rounded-2xl border border-[var(--border-main)]">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-2">{t('TRANSLATION', interfaceLanguage)}</p>
                  <p className="text-xl font-serif text-[var(--text-primary)]" dir={explDir}>{result.translation}</p>
                </div>
              )}

              {result.sentence_structure && (
                <div className="space-y-2">
                  <h4 className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-2">
                    <Info className="w-3 h-3" /> {t('SENTENCE_STRUCTURE', interfaceLanguage)}
                  </h4>
                  <div className="bg-[var(--bg-hover)] p-4 rounded-xl text-sm text-[var(--text-secondary)] leading-relaxed">
                    <span dir={explDir}>{result.sentence_structure}</span>
                  </div>
                </div>
              )}

              {result.highlights?.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-2">
                    <Sparkles className="w-3 h-3" /> {t('KEY_FORMS', interfaceLanguage)}
                  </h4>
                  <div className="space-y-2">
                    {result.highlights.map((h, i) => (
                      <div key={i} className="bg-[var(--bg-panel)] p-3 rounded-xl border border-[var(--border-main)] flex gap-3 items-start">
                        <span className="text-sm font-serif font-bold text-[var(--text-primary)] shrink-0 min-w-[90px]">{h.form}</span>
                        <span className="text-sm text-[var(--text-tertiary)]" dir={explDir}>{h.explanation}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {result.examples?.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-2">
                    <Quote className="w-3 h-3" /> {t('SIMILAR_EXAMPLES', interfaceLanguage)}
                  </h4>
                  <div className="space-y-4">
                    {result.examples.map((ex, i) => (
                      <ExampleCard
                        key={`${result.selection}:${i}`}
                        ex={ex}
                        peers={result.examples.filter((_, j) => j !== i).map(e => e.text)}
                        speakPhrase={speakPhrase}
                        requestVariant={requestExampleVariant}
                        interfaceLanguage={interfaceLanguage}
                        explDir={explDir}
                      />
                    ))}
                  </div>
                </div>
              )}
            </>)}

            {/* -- Case C: Translation request -- */}
            {result.target_translations && result.target_translations.length > 0 && (<>
              <div>
                <span className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)]">{t('TRANSLATION_DE', interfaceLanguage)}</span>
                <div className="flex items-center gap-2 mt-1">
                  <p className="text-base font-serif text-[var(--text-secondary)] italic line-clamp-3">"{result.selection}"</p>
                  <button
                    onClick={() => speakPhrase(result.selection)}
                    className="text-[var(--text-faint)] hover:text-[var(--text-secondary)] transition-colors shrink-0"
                  >
                    <Volume2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {result.target_translations?.length > 0 && (
                <div className="space-y-3">
                  {result.target_translations.map((trans, i) => (
                    <div key={i} className="bg-[var(--bg-panel)] p-4 rounded-xl border border-[var(--border-main)]">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <p className="text-xl font-serif font-bold text-[var(--text-primary)]">{trans.text}</p>
                        {trans.register && (
                          <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${
                            trans.register === 'formal' ? 'bg-blue-50 text-blue-600' :
                            trans.register === 'informal' ? 'bg-orange-50 text-orange-600' :
                            'bg-[var(--bg-hover)] text-[var(--text-tertiary)]'
                          }`}>
                            {trans.register === 'formal' ? t('FORMAL', interfaceLanguage) : trans.register === 'informal' ? t('INFORMAL', interfaceLanguage) : t('NEUTRAL', interfaceLanguage)}
                          </span>
                        )}
                      </div>
                      {trans.note && <p className="text-sm text-[var(--text-tertiary)]">{trans.note}</p>}
                    </div>
                  ))}
                </div>
              )}

              {result.grammar_notes?.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-2">
                    <Info className="w-3 h-3" /> {t('GRAMMAR', interfaceLanguage)}
                  </h4>
                  <div className="bg-[var(--bg-panel)] p-4 rounded-xl border border-[var(--border-main)] space-y-2">
                    {result.grammar_notes.map((note, i) => (
                      <div key={i} className="flex gap-2 text-sm text-[var(--text-secondary)]" dir={explDir}>
                        <span className="text-[var(--text-muted)] shrink-0">•</span>
                        {note}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {result.examples?.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-2">
                    <Quote className="w-3 h-3" /> {t('EXAMPLES', interfaceLanguage)}
                  </h4>
                  <div className="space-y-4">
                    {result.examples.map((ex, i) => (
                      <ExampleCard
                        key={`${result.selection}:${i}`}
                        ex={ex}
                        peers={result.examples.filter((_, j) => j !== i).map(e => e.text)}
                        speakPhrase={speakPhrase}
                        requestVariant={requestExampleVariant}
                        interfaceLanguage={interfaceLanguage}
                        explDir={explDir}
                      />
                    ))}
                  </div>
                </div>
              )}
            </>)}

            {/* -- Common: Notes -- */}
            {result.notes?.length > 0 && (
              <div className="bg-[var(--bg-surface)] text-[var(--text-primary)] p-6 rounded-2xl space-y-3 border border-[var(--border-light)]">
                <h4 className="text-[10px] font-black uppercase tracking-widest text-[var(--text-tertiary)]">{t('NOTES', interfaceLanguage)}</h4>
                <ul className="space-y-2 text-sm leading-relaxed" dir={explDir}>
                  {result.notes.map((note, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-[var(--text-secondary)]">•</span>
                      {note}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

    </section>
  );
}
