import { describe, it, expect } from 'vitest';
import { deriveCard } from '../../src/lib/deriveCard';

describe('deriveCard', () => {
  it('builds a word card with article and lemma_translation', () => {
    const card = deriveCard({
      input_type: 'word',
      selection: 'Tisches',
      lemma_translation: 'table',
      morphology: { lemma: 'Tisch', gender: 'm' },
    }, 'de');
    expect(card).toEqual({ front: 'der Tisch', back: 'table' });
  });

  it('falls back to meanings when lemma_translation missing', () => {
    const card = deriveCard({
      input_type: 'word',
      selection: 'Tisch',
      meanings: ['table', 'desk'],
      morphology: { lemma: 'Tisch', gender: 'm' },
    }, 'de');
    expect(card).toEqual({ front: 'der Tisch', back: 'table, desk' });
  });

  it('falls back to target_translations when meanings missing', () => {
    const card = deriveCard({
      input_type: 'word',
      selection: 'Tisch',
      target_translations: [{ text: 'стол' }, { text: 'столик' }],
      morphology: { lemma: 'Tisch', gender: 'm' },
    }, 'de');
    expect(card?.back).toBe('стол, столик');
  });

  it('handles French elision (apostrophe-trailing article)', () => {
    const card = deriveCard({
      input_type: 'word',
      selection: 'eau',
      lemma_translation: 'water',
      morphology: { lemma: 'eau', gender: 'f' },
    }, 'fr');
    // "l'" should attach with no space; "la" would attach with one.
    expect(card?.front.startsWith("l'") || card?.front.startsWith('l ')).toBe(true);
  });

  it('builds a sentence card from translation', () => {
    const card = deriveCard({
      input_type: 'sentence',
      selection: 'Der Tisch ist groß.',
      translation: 'The table is big.',
    }, 'de');
    expect(card).toEqual({ front: 'Der Tisch ist groß.', back: 'The table is big.' });
  });

  it('returns null when no back can be derived', () => {
    const card = deriveCard({
      input_type: 'word',
      selection: 'Tisch',
      morphology: { lemma: 'Tisch', gender: 'm' },
    }, 'de');
    expect(card).toBeNull();
  });

  it('uses the infinitive form for verbs (keeps German reflexive "sich")', () => {
    const card = deriveCard({
      input_type: 'word',
      selection: 'zieht sich um',
      lemma_translation: 'to change clothes',
      part_of_speech: 'verb',
      morphology: { lemma: 'umziehen' },
      forms: { verb: { infinitive: 'sich umziehen' } },
    }, 'de');
    expect(card?.front).toBe('sich umziehen');
  });

  it('uses the joined infinitive for separable verbs', () => {
    const card = deriveCard({
      input_type: 'word',
      selection: 'steht auf',
      lemma_translation: 'to get up',
      part_of_speech: 'verb',
      morphology: { lemma: 'aufstehen' },
      forms: { verb: { infinitive: 'aufstehen' } },
    }, 'de');
    expect(card?.front).toBe('aufstehen');
  });

  it('keeps sich for a reflexive + separable verb', () => {
    const card = deriveCard({
      input_type: 'word',
      selection: 'zieht sich an',
      lemma_translation: 'to get dressed',
      part_of_speech: 'verb',
      morphology: { lemma: 'anziehen' },
      forms: { verb: { infinitive: 'sich anziehen' } },
    }, 'de');
    expect(card?.front).toBe('sich anziehen');
  });

  it('falls back to the lemma for verbs without an infinitive form', () => {
    const card = deriveCard({
      input_type: 'word',
      selection: 'ging',
      lemma_translation: 'to go',
      part_of_speech: 'verb',
      morphology: { lemma: 'gehen' },
      forms: { verb: { infinitive: '' } },
    }, 'de');
    expect(card?.front).toBe('gehen');
  });

  it('does not use the infinitive for non-verbs', () => {
    const card = deriveCard({
      input_type: 'word',
      selection: 'Tisch',
      lemma_translation: 'table',
      part_of_speech: 'noun',
      morphology: { lemma: 'Tisch', gender: 'm' },
      forms: { verb: { infinitive: 'irrelevant' } },
    }, 'de');
    expect(card?.front).toBe('der Tisch');
  });

  it('works for languages without articles (no article prepended)', () => {
    const card = deriveCard({
      input_type: 'word',
      selection: 'стол',
      lemma_translation: 'table',
      morphology: { lemma: 'стол', gender: 'm' },
    }, 'ru');
    expect(card?.front).toBe('стол');
  });
});
