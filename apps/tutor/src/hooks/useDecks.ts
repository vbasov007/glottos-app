import { useState, useCallback, useRef } from 'react';
import type { DeckSummary, DeckCard, DeckCardSrsState, ExplanationResult, UserPreferences } from '../types';

/** A card surfaced by the interval-doubling scheduler for the practice stream.
 *  `x` is the current interval (review steps); `mastery` = x / X_MAX ∈ (0, 1]. */
export interface PracticeCard {
  cardId: string;
  x: number;
  mastery: number;
}

interface UseDecksParams {
  sessionId: string | null;
  initialDecks: DeckSummary[];
  initialActiveDeckId: string | null;
  /** Sets local user preferences (used after we persist activeDeckId). */
  setUserPrefs: (updater: (prev: UserPreferences) => UserPreferences) => void;
  /** Translated default deck name for first-add auto-create (e.g., "My Deck"). */
  defaultDeckName: string;
}

async function jsonFetch<T = any>(url: string, init: RequestInit & { sessionId: string | null }): Promise<T> {
  const { sessionId, headers, ...rest } = init;
  const res = await fetch(url, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      'x-session-id': sessionId || '',
      ...(headers || {}),
    },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const err = new Error(data.error || `Server error ${res.status}`) as Error & { status?: number; code?: string };
    err.status = res.status;
    err.code = data.error;
    throw err;
  }
  return res.json();
}

/** Result of name-mutating operations. `error` is a stable code so the UI can branch. */
export type DeckMutationResult =
  | { ok: true }
  | { ok: false; error: 'duplicate_name' | 'unknown' };

export function useDecks({
  sessionId,
  initialDecks,
  initialActiveDeckId,
  setUserPrefs,
  defaultDeckName,
}: UseDecksParams) {
  const [decks, setDecks] = useState<DeckSummary[]>(initialDecks);
  const [activeDeckId, setActiveDeckIdState] = useState<string | null>(initialActiveDeckId);
  const [cardsByDeck, setCardsByDeck] = useState<Map<string, DeckCard[]>>(new Map());
  /** Per-(card_id, direction) SRS rows for the Review modal. Lazy-loaded per deck. */
  const [srsByDeck, setSrsByDeck] = useState<Map<string, DeckCardSrsState[]>>(new Map());
  // Track in-flight card loads so loadCards is idempotent under React strict-mode double-renders.
  const loadingCardsRef = useRef<Set<string>>(new Set());
  const loadingSrsRef = useRef<Set<string>>(new Set());

  const refreshDecks = useCallback(async () => {
    if (!sessionId) return;
    try {
      const rows = await jsonFetch<DeckSummary[]>('/api/decks', { sessionId, method: 'GET' });
      setDecks(rows);
    } catch (_) { /* swallow; UI keeps last good state */ }
  }, [sessionId]);

  /** Case-insensitive duplicate check against the current deck list. */
  const isDuplicateName = useCallback((name: string, exceptId?: string): boolean => {
    const target = name.trim().toLowerCase();
    return decks.some(d => d.name.trim().toLowerCase() === target && d.id !== exceptId);
  }, [decks]);

  const createDeck = useCallback(async (name: string): Promise<{ deck: DeckSummary } | { error: 'duplicate_name' | 'unknown' }> => {
    if (!sessionId) return { error: 'unknown' };
    if (isDuplicateName(name)) return { error: 'duplicate_name' };
    try {
      const created = await jsonFetch<DeckSummary>('/api/decks', {
        sessionId, method: 'POST', body: JSON.stringify({ name }),
      });
      setDecks(prev => [...prev, created]);
      return { deck: created };
    } catch (err: any) {
      if (err?.code === 'duplicate_name' || err?.status === 409) return { error: 'duplicate_name' };
      return { error: 'unknown' };
    }
  }, [sessionId, isDuplicateName]);

  const renameDeck = useCallback(async (id: string, name: string): Promise<DeckMutationResult> => {
    if (!sessionId) return { ok: false, error: 'unknown' };
    if (isDuplicateName(name, id)) return { ok: false, error: 'duplicate_name' };
    // Optimistic update; rolled back via refresh on failure.
    setDecks(prev => prev.map(d => d.id === id ? { ...d, name } : d));
    try {
      await jsonFetch(`/api/decks/${id}`, { sessionId, method: 'PATCH', body: JSON.stringify({ name }) });
      return { ok: true };
    } catch (err: any) {
      refreshDecks();
      if (err?.code === 'duplicate_name' || err?.status === 409) return { ok: false, error: 'duplicate_name' };
      return { ok: false, error: 'unknown' };
    }
  }, [sessionId, isDuplicateName, refreshDecks]);

  const deleteDeck = useCallback(async (id: string) => {
    if (!sessionId) return;
    setDecks(prev => prev.filter(d => d.id !== id));
    setCardsByDeck(prev => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev); next.delete(id); return next;
    });
    if (activeDeckId === id) {
      setActiveDeckIdState(null);
    }
    try {
      await jsonFetch(`/api/decks/${id}`, { sessionId, method: 'DELETE' });
    } catch (_) { refreshDecks(); }
  }, [sessionId, activeDeckId, refreshDecks]);

  // The selected deck is per-workspace UI state (persisted in the workspace
  // state, restored on switch) — NOT a global user preference. So this just
  // sets local state; the workspace auto-save persists it.
  const setActiveDeck = useCallback((id: string | null) => {
    setActiveDeckIdState(id);
  }, []);

  const loadCards = useCallback(async (deckId: string): Promise<DeckCard[]> => {
    if (!sessionId) return [];
    if (loadingCardsRef.current.has(deckId)) {
      // Another call is in flight — wait briefly and return current state.
      await new Promise(r => setTimeout(r, 50));
      return cardsByDeck.get(deckId) || [];
    }
    loadingCardsRef.current.add(deckId);
    try {
      const cards = await jsonFetch<DeckCard[]>(`/api/decks/${deckId}/cards`, { sessionId, method: 'GET' });
      setCardsByDeck(prev => { const next = new Map(prev); next.set(deckId, cards); return next; });
      return cards;
    } catch (_) { return cardsByDeck.get(deckId) || []; }
    finally { loadingCardsRef.current.delete(deckId); }
  }, [sessionId, cardsByDeck]);

  /** Lazy-load the SRS state rows for one deck. Used by the Review modal so
   *  each card row can show its per-direction phase/interval at a glance. */
  const loadSrsForDeck = useCallback(async (deckId: string): Promise<DeckCardSrsState[]> => {
    if (!sessionId) return [];
    if (loadingSrsRef.current.has(deckId)) {
      await new Promise(r => setTimeout(r, 50));
      return srsByDeck.get(deckId) || [];
    }
    loadingSrsRef.current.add(deckId);
    try {
      const rows = await jsonFetch<DeckCardSrsState[]>(`/api/decks/${deckId}/srs`, { sessionId, method: 'GET' });
      setSrsByDeck(prev => { const next = new Map(prev); next.set(deckId, rows); return next; });
      return rows;
    } catch (_) { return srsByDeck.get(deckId) || []; }
    finally { loadingSrsRef.current.delete(deckId); }
  }, [sessionId, srsByDeck]);

  const addCard = useCallback(async (
    deckId: string, result: ExplanationResult, textLanguage: string, explanationLanguage: string,
  ): Promise<boolean> => {
    if (!sessionId) return false;
    try {
      const res = await jsonFetch<{ id: string }>(`/api/decks/${deckId}/cards`, {
        sessionId, method: 'POST',
        body: JSON.stringify({
          source_text: result.selection,
          text_language: textLanguage,
          explanation: result,
          explanation_language: explanationLanguage,
        }),
      });
      // Update the local card cache so the "already in deck" badge resolves
      // without waiting on /api/decks. The card_count itself is refreshed from
      // the server below — the local closure-driven optimistic bump used to
      // drift in either direction once cardsByDeck went stale.
      setCardsByDeck(prev => {
        const existing = prev.get(deckId);
        if (!existing) return prev;
        const next = new Map(prev);
        const filtered = existing.filter(c => c.source_text !== result.selection);
        next.set(deckId, [...filtered, {
          id: res.id,
          source_text: result.selection,
          text_language: textLanguage,
          explanation: result,
          explanation_language: explanationLanguage,
          position: filtered.length,
        }]);
        return next;
      });
      // Authoritative card_count comes from the server. Don't await — the
      // caller doesn't need to block on it for the UI to feel responsive.
      refreshDecks();
      return true;
    } catch (_) { return false; }
  }, [sessionId, refreshDecks]);

  /**
   * Add the current explanation to the active deck. Returns `'no-deck'` when no
   * (valid) deck is selected — the caller prompts the user to pick one — so a
   * card is never silently added to an auto-created deck.
   */
  const addCardToActiveDeck = useCallback(async (
    result: ExplanationResult, textLanguage: string, explanationLanguage: string,
  ): Promise<boolean | 'no-deck'> => {
    if (!activeDeckId || !decks.some(d => d.id === activeDeckId)) return 'no-deck';
    return addCard(activeDeckId, result, textLanguage, explanationLanguage);
  }, [activeDeckId, addCard, decks]);

  /**
   * Add many explanations to the active deck in one go. Returns `noDeck: true`
   * when no (valid) deck is selected (caller prompts to pick one). Adds are
   * sequential to preserve card order and keep `position` monotonic; duplicates
   * are harmless (server upserts on (deck_id, source_text)).
   */
  const addAllToActiveDeck = useCallback(async (
    results: ExplanationResult[], textLanguage: string, explanationLanguage: string,
  ): Promise<{ added: number; total: number; noDeck?: boolean }> => {
    if (results.length === 0) return { added: 0, total: 0 };
    if (!activeDeckId || !decks.some(d => d.id === activeDeckId)) {
      return { added: 0, total: results.length, noDeck: true };
    }
    let added = 0;
    for (const result of results) {
      if (await addCard(activeDeckId, result, textLanguage, explanationLanguage)) added++;
    }
    return { added, total: results.length };
  }, [activeDeckId, addCard, decks]);

  /**
   * Remove a card from local state only — no network call. Returns the removed
   * card so the caller (typically an undo flow) can hand it back to restoreCard.
   * Pair with commitCardDelete to flush the deletion to the server.
   */
  const removeCardLocal = useCallback((deckId: string, cardId: string): DeckCard | null => {
    let removed: DeckCard | null = null;
    setCardsByDeck(prev => {
      const cards = prev.get(deckId);
      if (!cards) return prev;
      const idx = cards.findIndex(c => c.id === cardId);
      if (idx < 0) return prev;
      removed = cards[idx];
      const next = new Map(prev);
      next.set(deckId, [...cards.slice(0, idx), ...cards.slice(idx + 1)]);
      return next;
    });
    if (removed) {
      setDecks(prev => prev.map(d => d.id === deckId ? { ...d, card_count: Math.max(0, d.card_count - 1) } : d));
    }
    return removed;
  }, []);

  /** Send the DELETE without touching local state — caller already did that. */
  const commitCardDelete = useCallback(async (deckId: string, cardId: string): Promise<void> => {
    if (!sessionId) return;
    try {
      await jsonFetch(`/api/decks/${deckId}/cards/${cardId}`, { sessionId, method: 'DELETE' });
    } catch (_) {
      // On network failure, resync so the UI doesn't lie about a card that's actually still there.
      loadCards(deckId);
      refreshDecks();
    }
  }, [sessionId, loadCards, refreshDecks]);

  /** Reinsert a previously removed card. Used by the undo path on card delete. */
  const restoreCard = useCallback((deckId: string, card: DeckCard) => {
    setCardsByDeck(prev => {
      const cards = prev.get(deckId);
      if (!cards) {
        // Cards aren't loaded yet — restoring into an unloaded list would create
        // a partial view. Skip; the next loadCards will pull the truth.
        return prev;
      }
      // Skip if it somehow already came back (e.g. a parallel refresh).
      if (cards.some(c => c.id === card.id || c.source_text === card.source_text)) return prev;
      const next = new Map(prev);
      // Reinsert in position order so the row reappears where it was.
      const inserted = [...cards, card].sort((a, b) => (a.position - b.position) || (a.id < b.id ? -1 : 1));
      next.set(deckId, inserted);
      return next;
    });
    setDecks(prev => prev.map(d => d.id === deckId ? { ...d, card_count: d.card_count + 1 } : d));
  }, []);

  /** Convenience: local remove + immediate network commit. Used by callers that don't need undo. */
  const deleteCard = useCallback(async (deckId: string, cardId: string) => {
    const removed = removeCardLocal(deckId, cardId);
    if (!removed) return;
    await commitCardDelete(deckId, cardId);
  }, [removeCardLocal, commitCardDelete]);

  /** True if a card with `source_text` is already in the deck (after loadCards). */
  const isCardInDeck = useCallback((deckId: string, sourceText: string): boolean => {
    const cards = cardsByDeck.get(deckId);
    if (!cards) return false;
    return cards.some(c => c.source_text === sourceText);
  }, [cardsByDeck]);

  /** --- SRS (spaced repetition) ----------------------------------------------- */

  /** Start (or continue) a streaming practice session: ask the scheduler for
   *  the single next card to show in this deck. `direction` selects which
   *  scheduler state set to draw from — forward (target → native) is the
   *  default; reverse (native → target) is tracked independently. Returns
   *  `{ card: null }` when the deck is empty. */
  const startPractice = useCallback(async (
    deckId: string, direction: 'forward' | 'reverse' = 'forward',
  ): Promise<{ card: PracticeCard | null; deckSize: number } | null> => {
    if (!sessionId) return null;
    try {
      return await jsonFetch<{ card: PracticeCard | null; deckSize: number }>(
        `/api/decks/${deckId}/practice/next`,
        { sessionId, method: 'POST', body: JSON.stringify({ direction }) },
      );
    } catch (_) { return null; }
  }, [sessionId]);

  /**
   * Record a binary answer for the current card and get the next card to show.
   * "known" doubles the card's interval (review frequency halves); "don't know"
   * resets it to the base interval. Direction is mandatory — forward and
   * reverse have separate scheduler state.
   */
  const gradeCard = useCallback(async (
    deckId: string, cardId: string, remembered: boolean, direction: 'forward' | 'reverse' = 'forward',
  ): Promise<{ recorded: { cardId: string; x: number }; next: PracticeCard | null } | null> => {
    if (!sessionId) return null;
    try {
      return await jsonFetch(
        `/api/decks/${deckId}/cards/${cardId}/grade`,
        { sessionId, method: 'POST', body: JSON.stringify({ remembered, direction }) },
      );
    } catch (_) { return null; }
  }, [sessionId]);

  /** Replace the deck list and active-deck pointer (e.g., from a fresh /api/state). */
  const hydrate = useCallback((nextDecks: DeckSummary[], nextActiveDeckId: string | null) => {
    setDecks(nextDecks);
    setActiveDeckIdState(nextActiveDeckId);
    setCardsByDeck(new Map()); // force re-fetch for any deck we look at next
  }, []);

  return {
    decks,
    activeDeckId,
    cardsByDeck,
    refreshDecks,
    createDeck,
    renameDeck,
    deleteDeck,
    setActiveDeck,
    loadCards,
    addCard,
    addCardToActiveDeck,
    addAllToActiveDeck,
    deleteCard,
    removeCardLocal,
    commitCardDelete,
    restoreCard,
    isCardInDeck,
    hydrate,
    startPractice,
    gradeCard,
    srsByDeck,
    loadSrsForDeck,
  };
}
