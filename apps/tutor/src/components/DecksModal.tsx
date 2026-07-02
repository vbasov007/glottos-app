import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Pencil, Trash2, Plus, Check, X, Loader2, Search, Play,
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
} from 'lucide-react';
import { Modal } from './Modal';
import { t } from '../i18n';
import type { DeckSummary, DeckCard, DeckCardSrsState } from '../types';
import { deriveCard } from '../lib/deriveCard';
import { paginateCards, type CardSort } from '../lib/paginateCards';
import { CARDS_PER_PAGE, TIMEOUTS } from '../constants';

interface DecksModalProps {
  show: boolean;
  onClose: () => void;
  interfaceLanguage: string;
  textLanguage: string;
  decks: DeckSummary[];
  cardsByDeck: Map<string, DeckCard[]>;
  loadCards: (deckId: string) => Promise<DeckCard[]>;
  /** Per-deck SRS state rows. Empty for a deck until loadSrsForDeck is called. */
  srsByDeck: Map<string, DeckCardSrsState[]>;
  loadSrsForDeck: (deckId: string) => Promise<DeckCardSrsState[]>;
  renameDeck: (id: string, name: string) => Promise<{ ok: true } | { ok: false; error: 'duplicate_name' | 'unknown' }>;
  deleteDeck: (id: string) => Promise<void>;
  createDeck: (name: string) => Promise<{ deck: DeckSummary } | { error: 'duplicate_name' | 'unknown' }>;
  /** Pure local removal — returns the removed card so undo can restore it. */
  removeCardLocal: (deckId: string, cardId: string) => DeckCard | null;
  /** Network DELETE, no local state changes. Called when the undo window expires. */
  commitCardDelete: (deckId: string, cardId: string) => Promise<void>;
  /** Reinsert a previously removed card on undo. */
  restoreCard: (deckId: string, card: DeckCard) => void;
  showToast: (msg: string, opts?: { actionLabel?: string; onAction?: () => void; durationMs?: number }) => void;
  /** When provided, a "Practice" button appears in the deck action bar. */
  onPractice?: (deckId: string) => void;
}

// Debounce a value: returns the input but only updates after `delay` ms of stability.
function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

/** Base interval of a fresh card in the interval-doubling scheduler (X0). A
 *  card still sitting at the base is effectively "learning". */
const SRS_BASE_INTERVAL = 4;

/** A tiny pill summarizing the interval-doubling scheduler state for one
 *  direction. `x` is the current interval (review steps); larger = better
 *  spaced (more mastered). A card with no row has never been practiced. */
function SrsPill({ state, arrow, title }: {
  state: DeckCardSrsState | undefined;
  arrow: '→' | '←';
  title: string;
}) {
  let body: string;
  let cls: string;
  if (!state) {
    body = 'new';
    cls = 'text-[var(--text-muted)] border-[var(--border-main)]';
  } else if (state.x <= SRS_BASE_INTERVAL) {
    body = 'learn';
    cls = 'text-blue-700 border-blue-300 bg-blue-50';
  } else {
    // Interval in review steps; grows as the card is recalled (×8, ×16, …).
    body = `×${state.x}`;
    cls = 'text-emerald-700 border-emerald-300 bg-emerald-50';
  }
  const fullTitle = state
    ? `${title} · interval ${state.x} · next @ ${state.next_due}`
    : `${title} · new`;
  return (
    <span
      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border text-[10px] font-mono tabular-nums whitespace-nowrap ${cls}`}
      title={fullTitle}
    >
      <span className="text-[var(--text-faint)] font-bold">{arrow}</span>
      {body}
    </span>
  );
}

export function DecksModal({
  show,
  onClose,
  interfaceLanguage,
  textLanguage,
  decks,
  cardsByDeck,
  loadCards,
  srsByDeck,
  loadSrsForDeck,
  renameDeck,
  deleteDeck,
  createDeck,
  removeCardLocal,
  commitCardDelete,
  restoreCard,
  showToast,
  onPractice,
}: DecksModalProps) {
  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(null);
  const [deckQuery, setDeckQuery] = useState('');
  const debouncedDeckQuery = useDebounced(deckQuery, 200);

  // Card pane state.
  const [cardQuery, setCardQuery] = useState('');
  const debouncedCardQuery = useDebounced(cardQuery, 250);
  const [sort, setSort] = useState<CardSort>('newest');
  const [page, setPage] = useState(1);
  const [loadingCards, setLoadingCards] = useState(false);

  // Deck create / rename / delete sub-modals.
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [submittingCreate, setSubmittingCreate] = useState(false);

  const [showRename, setShowRename] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const [submittingRename, setSubmittingRename] = useState(false);

  const [showDelete, setShowDelete] = useState(false);
  const [deleteTyped, setDeleteTyped] = useState('');

  // Pending card deletes: id -> timer + card snapshot. We only flush to the
  // server when the timer fires or the modal unmounts. Undo cancels the timer.
  const pendingDeletesRef = useRef<Map<string, { timer: ReturnType<typeof setTimeout>; deckId: string; card: DeckCard }>>(new Map());

  // Auto-select first deck when opened.
  useEffect(() => {
    if (!show) return;
    if (selectedDeckId && decks.some(d => d.id === selectedDeckId)) return;
    setSelectedDeckId(decks[0]?.id || null);
  }, [show, decks, selectedDeckId]);

  // Reset paging + search when switching decks.
  useEffect(() => {
    setPage(1);
    setCardQuery('');
  }, [selectedDeckId]);

  // Reset page on filter/sort change.
  useEffect(() => { setPage(1); }, [debouncedCardQuery, sort]);

  // Always refetch cards + SRS state on modal open or when the user switches
  // to a different deck. The local cardsByDeck cache can be incomplete (e.g.
  // adds that happened before the deck was first loaded are missing from it)
  // and a stale slice would silently truncate pagination. A ref guards against
  // re-fetching on every cardsByDeck/srsByDeck change while the modal is open.
  const lastLoadedRef = useRef<{ show: boolean; deckId: string | null }>({ show: false, deckId: null });
  useEffect(() => {
    if (!show) { lastLoadedRef.current = { show: false, deckId: null }; return; }
    if (!selectedDeckId) return;
    const last = lastLoadedRef.current;
    if (last.show && last.deckId === selectedDeckId) return; // already refreshed this open
    lastLoadedRef.current = { show: true, deckId: selectedDeckId };
    setLoadingCards(true);
    loadCards(selectedDeckId).finally(() => setLoadingCards(false));
    loadSrsForDeck(selectedDeckId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, selectedDeckId]);

  // On unmount (or modal close) flush any pending deletes so we don't leave dangling network ops.
  useEffect(() => {
    if (show) return;
    const pending = pendingDeletesRef.current;
    pending.forEach(({ timer, deckId, card }) => {
      clearTimeout(timer);
      commitCardDelete(deckId, card.id);
    });
    pending.clear();
  }, [show, commitCardDelete]);

  useEffect(() => () => {
    // Component truly unmounting: flush remaining pending deletes.
    const pending = pendingDeletesRef.current;
    pending.forEach(({ timer, deckId, card }) => {
      clearTimeout(timer);
      commitCardDelete(deckId, card.id);
    });
    pending.clear();
  }, [commitCardDelete]);

  const filteredDecks = useMemo(() => {
    const q = debouncedDeckQuery.trim().toLowerCase();
    if (!q) return decks;
    return decks.filter(d => d.name.toLowerCase().includes(q));
  }, [decks, debouncedDeckQuery]);

  const selectedDeck = decks.find(d => d.id === selectedDeckId) || null;
  const allCards = (selectedDeckId && cardsByDeck.get(selectedDeckId)) || [];
  // Index SRS rows so each card lookup is O(1) in the render loop.
  const srsIndex = useMemo(() => {
    const rows = (selectedDeckId && srsByDeck.get(selectedDeckId)) || [];
    const m = new Map<string, { forward?: DeckCardSrsState; reverse?: DeckCardSrsState }>();
    for (const r of rows) {
      const entry = m.get(r.card_id) || {};
      entry[r.direction] = r;
      m.set(r.card_id, entry);
    }
    return m;
  }, [selectedDeckId, srsByDeck]);
  const pageResult = useMemo(
    () => paginateCards({
      cards: allCards,
      query: debouncedCardQuery,
      sort,
      page,
      pageSize: CARDS_PER_PAGE,
      textLanguage,
    }),
    [allCards, debouncedCardQuery, sort, page, textLanguage]
  );

  // --- Actions ---

  const openCreate = () => { setCreateName(''); setCreateError(null); setShowCreate(true); };
  const submitCreate = async () => {
    const name = createName.trim();
    if (!name) { setCreateError(t('DECK_NAME', interfaceLanguage)); return; }
    setSubmittingCreate(true);
    const r = await createDeck(name);
    setSubmittingCreate(false);
    if ('deck' in r) {
      setSelectedDeckId(r.deck.id);
      setShowCreate(false);
      setCreateName('');
      setCreateError(null);
      return;
    }
    setCreateError(r.error === 'duplicate_name' ? t('DECK_NAME_EXISTS', interfaceLanguage) : 'Error');
  };

  const openRename = () => {
    if (!selectedDeck) return;
    setRenameValue(selectedDeck.name);
    setRenameError(null);
    setShowRename(true);
  };
  const submitRename = async () => {
    if (!selectedDeck) return;
    const name = renameValue.trim();
    if (!name) { setRenameError(t('DECK_NAME', interfaceLanguage)); return; }
    if (name === selectedDeck.name.trim()) { setShowRename(false); return; }
    setSubmittingRename(true);
    const r = await renameDeck(selectedDeck.id, name);
    setSubmittingRename(false);
    if (r.ok === false) {
      setRenameError(r.error === 'duplicate_name' ? t('DECK_NAME_EXISTS', interfaceLanguage) : 'Error');
      return;
    }
    setShowRename(false);
  };

  const openDelete = () => { setDeleteTyped(''); setShowDelete(true); };
  const submitDelete = async () => {
    if (!selectedDeck) return;
    if (deleteTyped.trim() !== selectedDeck.name.trim()) return;
    const idToDelete = selectedDeck.id;
    await deleteDeck(idToDelete);
    setShowDelete(false);
    setDeleteTyped('');
    if (selectedDeckId === idToDelete) {
      setSelectedDeckId(decks.find(d => d.id !== idToDelete)?.id || null);
    }
  };

  const handleCardDelete = (card: DeckCard) => {
    if (!selectedDeckId) return;
    const deckId = selectedDeckId;
    const removed = removeCardLocal(deckId, card.id);
    if (!removed) return;

    // Schedule the network commit with a window for Undo.
    const timer = setTimeout(() => {
      pendingDeletesRef.current.delete(card.id);
      commitCardDelete(deckId, card.id);
    }, TIMEOUTS.CARD_DELETE_UNDO);
    pendingDeletesRef.current.set(card.id, { timer, deckId, card: removed });

    showToast(t('CARD_REMOVED_UNDO', interfaceLanguage), {
      actionLabel: t('UNDO', interfaceLanguage),
      durationMs: TIMEOUTS.CARD_DELETE_UNDO,
      onAction: () => {
        const entry = pendingDeletesRef.current.get(card.id);
        if (!entry) return;
        clearTimeout(entry.timer);
        pendingDeletesRef.current.delete(card.id);
        restoreCard(entry.deckId, entry.card);
      },
    });
  };

  // --- Derived for display ---
  const derivedRows = useMemo(
    () => pageResult.rows.map(c => ({ card: c, derived: deriveCard(c.explanation, c.text_language || textLanguage, c.source_text) })),
    [pageResult.rows, textLanguage]
  );

  return (
    <Modal show={show} onClose={onClose} title={t('REVIEW_DECK', interfaceLanguage)} maxWidth="max-w-5xl">
      <div className="flex flex-col lg:flex-row gap-4 lg:h-[70vh] lg:min-h-[480px]">
        {/* ===== Left pane: decks ===== */}
        <div className="lg:w-64 lg:shrink-0 border border-[var(--border-main)] rounded-lg overflow-hidden flex flex-col">
          {/* Search */}
          <div className="px-2 py-2 border-b border-[var(--border-main)] bg-[var(--bg-surface-half)]">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)] pointer-events-none" />
              <input
                value={deckQuery}
                onChange={e => setDeckQuery(e.target.value)}
                placeholder={t('SEARCH_DECKS', interfaceLanguage)}
                className="w-full pl-7 pr-2 py-1.5 text-xs border border-[var(--border-main)] rounded bg-[var(--bg-panel)] text-[var(--text-primary)]"
              />
            </div>
          </div>

          {/* Scrollable deck list */}
          <div className="flex-1 overflow-y-auto">
            {filteredDecks.length === 0 && (
              <div className="px-3 py-6 text-xs italic text-[var(--text-muted)] text-center">
                {decks.length === 0 ? t('NO_DECKS', interfaceLanguage) : t('EMPTY_SEARCH_RESULTS', interfaceLanguage)}
              </div>
            )}
            {filteredDecks.map(d => {
              const isActive = d.id === selectedDeckId;
              return (
                <button
                  key={d.id}
                  onClick={() => setSelectedDeckId(d.id)}
                  className={`w-full text-left px-3 py-2 border-b border-[var(--border-main)] last:border-b-0 transition-colors ${
                    isActive ? 'bg-[var(--bg-hover)]' : 'hover:bg-[var(--bg-hover)]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className={`text-sm truncate ${isActive ? 'font-semibold text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>{d.name}</div>
                      <div className="text-[10px] text-[var(--text-muted)]">{t('CARDS_COUNT', interfaceLanguage).replace('{n}', String(d.card_count))}</div>
                    </div>
                    {isActive && <div className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Action bar */}
          <div className="border-t border-[var(--border-main)] bg-[var(--bg-surface-half)] p-2 flex items-center gap-2">
            <button
              onClick={openCreate}
              className="flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium rounded-md border border-[var(--border-main)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-panel)] transition-colors shrink-0"
              title={t('NEW_CARD_DECK', interfaceLanguage)}
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
            {onPractice && (
              <button
                onClick={() => { if (selectedDeck) onPractice(selectedDeck.id); }}
                disabled={!selectedDeck}
                className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-bold uppercase tracking-wider rounded-md bg-emerald-500 hover:bg-emerald-600 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                title={t('PRACTICE', interfaceLanguage)}
              >
                <Play className="w-3.5 h-3.5" />
                {t('PRACTICE', interfaceLanguage)}
              </button>
            )}
            <button
              onClick={openRename}
              disabled={!selectedDeck}
              className="flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium rounded-md border border-[var(--border-main)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-panel)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title={t('RENAME', interfaceLanguage)}
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={openDelete}
              disabled={!selectedDeck}
              className="flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium rounded-md border border-red-200 text-red-500 hover:bg-red-50 hover:border-red-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title={t('DELETE_DECK', interfaceLanguage)}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* ===== Right pane: cards ===== */}
        <div className="flex-1 border border-[var(--border-main)] rounded-lg overflow-hidden flex flex-col min-h-[400px] lg:min-h-0">
          {/* Header: deck name + count */}
          <div className="px-3 py-2 border-b border-[var(--border-main)] bg-[var(--bg-surface-half)] flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-[var(--text-primary)] truncate">{selectedDeck?.name || '—'}</div>
              <div className="text-[10px] text-[var(--text-muted)]">
                {selectedDeck ? t('CARDS_COUNT', interfaceLanguage).replace('{n}', String(selectedDeck.card_count)) : ''}
              </div>
            </div>
          </div>

          {/* Search + sort */}
          <div className="px-3 py-2 border-b border-[var(--border-main)] flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[160px]">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)] pointer-events-none" />
              <input
                value={cardQuery}
                onChange={e => setCardQuery(e.target.value)}
                placeholder={t('SEARCH_CARDS', interfaceLanguage)}
                disabled={!selectedDeck}
                className="w-full pl-7 pr-2 py-1.5 text-xs border border-[var(--border-main)] rounded bg-[var(--bg-panel)] text-[var(--text-primary)] disabled:opacity-50"
              />
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {(['newest', 'oldest', 'alpha'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => setSort(s)}
                  className={`px-2 py-1 text-[10px] font-bold uppercase tracking-wider rounded-md border transition-colors ${
                    sort === s
                      ? 'bg-[var(--text-primary)] text-[var(--bg-panel)] border-[var(--text-primary)]'
                      : 'text-[var(--text-secondary)] border-[var(--border-main)] hover:bg-[var(--bg-hover)]'
                  }`}
                >
                  {t(s === 'newest' ? 'SORT_NEWEST' : s === 'oldest' ? 'SORT_OLDEST' : 'SORT_ALPHA', interfaceLanguage)}
                </button>
              ))}
            </div>
          </div>

          {/* Card list */}
          <div className="flex-1 overflow-y-auto">
            {loadingCards && (
              <div className="px-3 py-6 flex items-center justify-center text-[var(--text-muted)]">
                <Loader2 className="w-4 h-4 animate-spin" />
              </div>
            )}
            {!loadingCards && selectedDeck && pageResult.total === 0 && (
              <div className="px-3 py-6 text-xs italic text-[var(--text-muted)] text-center">
                {debouncedCardQuery ? t('EMPTY_SEARCH_RESULTS', interfaceLanguage) : t('DECK_EMPTY', interfaceLanguage)}
              </div>
            )}
            {!loadingCards && derivedRows.map(({ card, derived }) => {
              const srs = srsIndex.get(card.id) || {};
              return (
                <div
                  key={card.id}
                  className="px-3 py-2 border-b border-[var(--border-main)] last:border-b-0 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 hover:bg-[var(--bg-hover)]"
                >
                  {/* Front/back */}
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-[var(--text-primary)] truncate">{derived?.front || card.source_text}</div>
                    {derived?.back && <div className="text-xs text-[var(--text-tertiary)] truncate">{derived.back}</div>}
                  </div>

                  {/* SRS rating, per direction. Forward = target→native; reverse = native→target. */}
                  <div className="flex items-center gap-1 shrink-0">
                    <SrsPill state={srs.forward} arrow="→" title="Forward" />
                    <SrsPill state={srs.reverse} arrow="←" title="Reverse" />
                  </div>

                  {/* Delete */}
                  <button
                    onClick={() => handleCardDelete(card)}
                    className="p-1.5 text-[var(--text-muted)] hover:text-red-500 transition-colors shrink-0 self-end sm:self-auto"
                    title={t('DELETE_DECK', interfaceLanguage)}
                    aria-label={t('DELETE_DECK', interfaceLanguage)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>

          {/* Pagination footer */}
          {selectedDeck && pageResult.total > 0 && (
            <div className="border-t border-[var(--border-main)] bg-[var(--bg-surface-half)] px-3 py-2 flex items-center justify-between text-xs text-[var(--text-secondary)]">
              <div className="text-[10px] text-[var(--text-muted)]">
                {pageResult.total} {t('CARDS_COUNT', interfaceLanguage).replace('{n}', '').trim()}
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(1)}
                  disabled={pageResult.page <= 1}
                  className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-30 disabled:cursor-not-allowed"
                ><ChevronsLeft className="w-4 h-4" /></button>
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={pageResult.page <= 1}
                  className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-30 disabled:cursor-not-allowed"
                ><ChevronLeft className="w-4 h-4" /></button>
                <span className="px-2 tabular-nums">{pageResult.page} / {pageResult.totalPages}</span>
                <button
                  onClick={() => setPage(p => Math.min(pageResult.totalPages, p + 1))}
                  disabled={pageResult.page >= pageResult.totalPages}
                  className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-30 disabled:cursor-not-allowed"
                ><ChevronRight className="w-4 h-4" /></button>
                <button
                  onClick={() => setPage(pageResult.totalPages)}
                  disabled={pageResult.page >= pageResult.totalPages}
                  className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-30 disabled:cursor-not-allowed"
                ><ChevronsRight className="w-4 h-4" /></button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ===== Create sub-modal ===== */}
      <Modal show={showCreate} onClose={() => setShowCreate(false)} title={t('NEW_CARD_DECK', interfaceLanguage)} maxWidth="max-w-sm">
        <div className="space-y-3">
          <input
            autoFocus
            value={createName}
            onChange={e => { setCreateName(e.target.value); if (createError) setCreateError(null); }}
            onKeyDown={e => { if (e.key === 'Enter') submitCreate(); else if (e.key === 'Escape') setShowCreate(false); }}
            placeholder={t('DECK_NAME', interfaceLanguage)}
            className={`w-full px-3 py-2 text-sm border rounded bg-[var(--bg-panel)] text-[var(--text-primary)] ${createError ? 'border-red-500' : 'border-[var(--border-main)]'}`}
          />
          {createError && <div className="text-xs text-red-500">{createError}</div>}
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowCreate(false)} className="px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
              {t('CANCEL', interfaceLanguage)}
            </button>
            <button
              onClick={submitCreate}
              disabled={submittingCreate || !createName.trim()}
              className="px-3 py-1.5 text-xs font-bold uppercase tracking-wider bg-emerald-500 hover:bg-emerald-600 text-white rounded-md disabled:opacity-50 flex items-center gap-1"
            >
              {submittingCreate ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              {t('NEW_CARD_DECK', interfaceLanguage)}
            </button>
          </div>
        </div>
      </Modal>

      {/* ===== Rename sub-modal ===== */}
      <Modal show={showRename} onClose={() => setShowRename(false)} title={t('RENAME_DECK', interfaceLanguage)} maxWidth="max-w-sm">
        <div className="space-y-3">
          <input
            autoFocus
            value={renameValue}
            onChange={e => { setRenameValue(e.target.value); if (renameError) setRenameError(null); }}
            onKeyDown={e => { if (e.key === 'Enter') submitRename(); else if (e.key === 'Escape') setShowRename(false); }}
            placeholder={t('DECK_NAME', interfaceLanguage)}
            className={`w-full px-3 py-2 text-sm border rounded bg-[var(--bg-panel)] text-[var(--text-primary)] ${renameError ? 'border-red-500' : 'border-[var(--border-main)]'}`}
          />
          {renameError && <div className="text-xs text-red-500">{renameError}</div>}
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowRename(false)} className="px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
              {t('CANCEL', interfaceLanguage)}
            </button>
            <button
              onClick={submitRename}
              disabled={submittingRename || !renameValue.trim()}
              className="px-3 py-1.5 text-xs font-bold uppercase tracking-wider bg-blue-500 hover:bg-blue-600 text-white rounded-md disabled:opacity-50 flex items-center gap-1"
            >
              {submittingRename ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              {t('RENAME', interfaceLanguage)}
            </button>
          </div>
        </div>
      </Modal>

      {/* ===== Delete confirm sub-modal ===== */}
      <Modal show={showDelete} onClose={() => setShowDelete(false)} title={t('DELETE_DECK', interfaceLanguage)} maxWidth="max-w-sm">
        {selectedDeck && (
          <div className="space-y-3">
            <p className="text-sm text-[var(--text-secondary)]">
              {t('DELETE_DECK_WITH_COUNT', interfaceLanguage)
                .replace('{name}', selectedDeck.name)
                .replace('{n}', String(selectedDeck.card_count))}
            </p>
            <div className="text-[10px] text-red-500">
              {t('DELETE_TYPE_CONFIRM', interfaceLanguage).replace('{name}', selectedDeck.name)}
            </div>
            <input
              autoFocus
              value={deleteTyped}
              onChange={e => setDeleteTyped(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Escape') setShowDelete(false);
                else if (e.key === 'Enter' && deleteTyped.trim() === selectedDeck.name.trim()) submitDelete();
              }}
              placeholder={selectedDeck.name}
              className="w-full px-3 py-2 text-sm border border-red-300 rounded bg-[var(--bg-panel)] text-[var(--text-primary)]"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowDelete(false)} className="px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                {t('CANCEL', interfaceLanguage)}
              </button>
              <button
                onClick={submitDelete}
                disabled={deleteTyped.trim() !== selectedDeck.name.trim()}
                className="px-3 py-1.5 text-xs font-bold uppercase tracking-wider bg-red-500 hover:bg-red-600 text-white rounded-md disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {t('DELETE', interfaceLanguage)}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </Modal>
  );
}
