import { describe, it, expect } from 'vitest';
import { parseDialogLine, pickVoiceForGender, speakerLabelTokenIndices } from '../../src/lib/dialog';
import type { TtsVoiceOption } from '../../src/types';

const tok = (text: string) => text.split(/(\s+)/).filter(Boolean);

describe('speakerLabelTokenIndices', () => {
  it('marks the "Name:" tokens (incl. colon) of each dialog line', () => {
    const text = 'Lukas: Hallo Sarah.\nSarah: Hallo Lukas.';
    const tokens = tok(text);
    const idx = speakerLabelTokenIndices(text, tokens);
    // The marked tokens are exactly the two speaker labels.
    const marked = [...idx].sort((a, b) => a - b).map(i => tokens[i]);
    expect(marked).toEqual(['Lukas:', 'Sarah:']);
  });

  it('handles two-word names (the space token is not marked)', () => {
    const text = 'Mary Jane: Hi there.';
    const tokens = tok(text); // ['Mary',' ','Jane:',' ','Hi',' ','there.']
    const marked = [...speakerLabelTokenIndices(text, tokens)].map(i => tokens[i]);
    expect(marked.sort()).toEqual(['Jane:', 'Mary']);
  });

  it('marks nothing for non-dialog text', () => {
    const text = 'Just a normal paragraph. It has sentences.';
    expect(speakerLabelTokenIndices(text, tok(text)).size).toBe(0);
  });

  it('does not mark a phrase that merely contains a colon', () => {
    const text = 'The time was 12:30 exactly.';
    expect(speakerLabelTokenIndices(text, tok(text)).size).toBe(0);
  });
});

describe('parseDialogLine', () => {
  it('parses a simple "Name: phrase" line', () => {
    expect(parseDialogLine('John: Where are we?')).toEqual({ speaker: 'John', phrase: 'Where are we?' });
  });

  it('parses a two-word speaker', () => {
    expect(parseDialogLine('Mary Jane: I have no idea.')).toEqual({ speaker: 'Mary Jane', phrase: 'I have no idea.' });
  });

  it('works for caseless / non-Latin scripts', () => {
    expect(parseDialogLine('サクラ: こんにちは')).toEqual({ speaker: 'サクラ', phrase: 'こんにちは' });
    expect(parseDialogLine('Ахмед: привет')).toEqual({ speaker: 'Ахмед', phrase: 'привет' });
  });

  it('returns null for a non-dialog line', () => {
    expect(parseDialogLine('Just a normal sentence.')).toBeNull();
    expect(parseDialogLine('')).toBeNull();
  });

  it('does not treat a time like 12:30 as a speaker', () => {
    expect(parseDialogLine('12:30 is lunchtime')).toBeNull();
  });

  it('rejects an empty phrase after the colon', () => {
    expect(parseDialogLine('John:   ')).toBeNull();
  });

  it('rejects an over-long "speaker" (likely not a name)', () => {
    expect(parseDialogLine('Thisisareallylongwordthatisnotaname: hi')).toBeNull();
  });
});

const catalog: TtsVoiceOption[] = [
  { id: 'm1', name: 'M1', gender: 'male' },
  { id: 'm2', name: 'M2', gender: 'male' },
  { id: 'f1', name: 'F1', gender: 'female' },
  { id: 'f2', name: 'F2', gender: 'female' },
];

/** Tiny seeded LCG for deterministic picks. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

describe('pickVoiceForGender', () => {
  it('picks a voice matching the requested gender', () => {
    const id = pickVoiceForGender(catalog, 'male', new Set(), seeded(1))!;
    expect(['m1', 'm2']).toContain(id);
  });

  it('prefers an unused voice for distinct speakers', () => {
    const used = new Set(['m1']);
    const id = pickVoiceForGender(catalog, 'male', used, seeded(7))!;
    expect(id).toBe('m2'); // only fresh male voice left
  });

  it('falls back to the whole catalog when no gender matches', () => {
    const femaleOnly: TtsVoiceOption[] = [{ id: 'f1', name: 'F1', gender: 'female' }];
    const id = pickVoiceForGender(femaleOnly, 'male', new Set(), seeded(3));
    expect(id).toBe('f1');
  });

  it('reuses a voice when the pool is exhausted', () => {
    const used = new Set(['f1', 'f2']);
    const id = pickVoiceForGender(catalog, 'female', used, seeded(2))!;
    expect(['f1', 'f2']).toContain(id);
  });

  it('returns null for an empty catalog', () => {
    expect(pickVoiceForGender([], 'male', new Set())).toBeNull();
  });

  it('is deterministic for a given seed', () => {
    const a = pickVoiceForGender(catalog, 'female', new Set(), seeded(42));
    const b = pickVoiceForGender(catalog, 'female', new Set(), seeded(42));
    expect(a).toBe(b);
  });
});
