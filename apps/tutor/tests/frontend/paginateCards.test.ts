import { describe, it, expect } from 'vitest';
import { paginateCards } from '../../src/lib/paginateCards';
import type { DeckCard } from '../../src/types';

// Build a deck card with sensible defaults so each test only specifies what matters.
function card(id: string, source: string, lemmaTranslation = '', position = 0, lang = 'de'): DeckCard {
  return {
    id,
    source_text: source,
    text_language: lang,
    explanation: {
      input_language: lang,
      input_type: 'word',
      selection: source,
      meanings: [],
      lemma_translation: lemmaTranslation || null,
      translation: null,
      target_translations: [],
      part_of_speech: 'noun',
      morphology: { lemma: source, gender: null, plural: null, case: null, number: null, tense: null, person: null, mood: null, voice: null, degree: null, separable_prefix: null },
      forms: {
        noun: { singular: { nom: '', akk: '', dat: '', gen: '' }, plural: { nom: '', akk: '', dat: '', gen: '' } },
        verb: { infinitive: '', praesens_ich: '', praeteritum: '', perfekt: '', konjunktiv_ii: '', imperativ_du: '' },
        adjective: { positiv: '', komparativ: '', superlativ: '' },
      },
      sentence_structure: null,
      highlights: [],
      grammar_notes: [],
      examples: [],
      notes: [],
    } as any,
    explanation_language: null,
    position,
  };
}

describe('paginateCards', () => {
  const cards = [
    card('1', 'Apfel', 'apple', 0),
    card('2', 'Banane', 'banana', 1),
    card('3', 'Tisch', 'table', 2),
    card('4', 'Stuhl', 'chair', 3),
    card('5', 'Hund', 'dog', 4),
  ];

  it('returns all rows on a single page when below page size', () => {
    const r = paginateCards({ cards, query: '', sort: 'oldest', page: 1, pageSize: 50 });
    expect(r.total).toBe(5);
    expect(r.totalPages).toBe(1);
    expect(r.rows).toHaveLength(5);
  });

  it('newest sorts by descending position', () => {
    const r = paginateCards({ cards, query: '', sort: 'newest', page: 1, pageSize: 50 });
    expect(r.rows.map(c => c.id)).toEqual(['5', '4', '3', '2', '1']);
  });

  it('oldest sorts by ascending position', () => {
    const r = paginateCards({ cards, query: '', sort: 'oldest', page: 1, pageSize: 50 });
    expect(r.rows.map(c => c.id)).toEqual(['1', '2', '3', '4', '5']);
  });

  it('alpha sorts by derived front', () => {
    const r = paginateCards({ cards, query: '', sort: 'alpha', page: 1, pageSize: 50 });
    // German articles get prepended for nouns — but here gender is null, so deriveCard
    // returns null (no usable back without translation) for some. We seeded lemma_translation,
    // so deriveCard returns front = source_text (no article since gender null).
    // Alpha order on raw source: Apfel, Banane, Hund, Stuhl, Tisch.
    expect(r.rows.map(c => c.source_text)).toEqual(['Apfel', 'Banane', 'Hund', 'Stuhl', 'Tisch']);
  });

  it('search filter matches source_text case-insensitively', () => {
    const r = paginateCards({ cards, query: 'tisch', sort: 'oldest', page: 1, pageSize: 50 });
    expect(r.rows.map(c => c.id)).toEqual(['3']);
  });

  it('search filter matches derived back (translation)', () => {
    const r = paginateCards({ cards, query: 'chair', sort: 'oldest', page: 1, pageSize: 50 });
    expect(r.rows.map(c => c.id)).toEqual(['4']);
  });

  it('paginates: page 2 with pageSize 2 returns the right slice', () => {
    const r = paginateCards({ cards, query: '', sort: 'oldest', page: 2, pageSize: 2 });
    expect(r.totalPages).toBe(3);
    expect(r.page).toBe(2);
    expect(r.rows.map(c => c.id)).toEqual(['3', '4']);
  });

  it('clamps page to [1, totalPages]', () => {
    const tooHigh = paginateCards({ cards, query: '', sort: 'oldest', page: 99, pageSize: 2 });
    expect(tooHigh.page).toBe(3);
    expect(tooHigh.rows.map(c => c.id)).toEqual(['5']);

    const tooLow = paginateCards({ cards, query: '', sort: 'oldest', page: -3, pageSize: 2 });
    expect(tooLow.page).toBe(1);
  });

  it('empty deck still returns totalPages=1 so the UI can render "1 / 1"', () => {
    const r = paginateCards({ cards: [], query: '', sort: 'newest', page: 1, pageSize: 50 });
    expect(r.total).toBe(0);
    expect(r.totalPages).toBe(1);
    expect(r.rows).toEqual([]);
  });

  it('does not mutate the input array', () => {
    const ids = cards.map(c => c.id);
    paginateCards({ cards, query: '', sort: 'newest', page: 1, pageSize: 50 });
    expect(cards.map(c => c.id)).toEqual(ids);
  });

  it('search with no matches yields totalPages=1 and empty rows', () => {
    const r = paginateCards({ cards, query: 'xyzzy', sort: 'oldest', page: 1, pageSize: 50 });
    expect(r.total).toBe(0);
    expect(r.totalPages).toBe(1);
    expect(r.rows).toEqual([]);
  });
});
