import { deriveCard } from './deriveCard';
import type { DeckCard } from '../types';

export type CardSort = 'newest' | 'oldest' | 'alpha';

export interface PaginateInput {
  cards: DeckCard[];
  /** Free-text query; matched (case-insensitive) against source_text and derived front/back. */
  query: string;
  sort: CardSort;
  page: number;            // 1-based
  pageSize: number;
  textLanguage?: string;   // forwarded to deriveCard for alpha sort + back-text matching
}

export interface PaginateResult {
  /** Cards on the current page after search + sort. */
  rows: DeckCard[];
  /** Total cards after search (before paging). */
  total: number;
  /** Total pages, never less than 1 so the UI can always render "page 1 / 1". */
  totalPages: number;
  /** Page actually used (clamped to [1, totalPages]). */
  page: number;
}

/** Pure search + sort + paginate. Extracted so it's testable without React. */
export function paginateCards({ cards, query, sort, page, pageSize, textLanguage = 'en' }: PaginateInput): PaginateResult {
  const q = query.trim().toLowerCase();
  let filtered = cards;
  if (q) {
    filtered = cards.filter(c => {
      if (c.source_text.toLowerCase().includes(q)) return true;
      const d = deriveCard(c.explanation, c.text_language || textLanguage, c.source_text);
      if (!d) return false;
      return d.front.toLowerCase().includes(q) || d.back.toLowerCase().includes(q);
    });
  }

  // Sort copy so we don't mutate the caller's array.
  const sorted = [...filtered];
  if (sort === 'newest') {
    // Newest first: highest position first; fall back to id desc for stability.
    sorted.sort((a, b) => (b.position - a.position) || (a.id < b.id ? 1 : -1));
  } else if (sort === 'oldest') {
    sorted.sort((a, b) => (a.position - b.position) || (a.id < b.id ? -1 : 1));
  } else {
    // Alpha by derived front, with a fallback to source_text.
    sorted.sort((a, b) => {
      const af = deriveCard(a.explanation, a.text_language || textLanguage, a.source_text)?.front || a.source_text;
      const bf = deriveCard(b.explanation, b.text_language || textLanguage, b.source_text)?.front || b.source_text;
      return af.localeCompare(bf);
    });
  }

  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const clampedPage = Math.min(Math.max(1, page), totalPages);
  const start = (clampedPage - 1) * pageSize;
  return {
    rows: sorted.slice(start, start + pageSize),
    total,
    totalPages,
    page: clampedPage,
  };
}
