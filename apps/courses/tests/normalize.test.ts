import { describe, it, expect } from 'vitest';
import {
  normalizeAnswer,
  exactMatch,
  checkAgainst,
  classifyMatch,
  stripMarkdown,
} from '../lib/normalize';

describe('stripMarkdown', () => {
  it('removes bold markers', () => {
    expect(stripMarkdown('**Der** Korb')).toBe('Der Korb');
    expect(stripMarkdown('__Der__ Korb')).toBe('Der Korb');
  });
  it('removes italic markers', () => {
    expect(stripMarkdown('*Hallo*')).toBe('Hallo');
    expect(stripMarkdown('_Hallo_')).toBe('Hallo');
  });
  it('removes strikethrough and code', () => {
    expect(stripMarkdown('~~old~~ new')).toBe('old new');
    expect(stripMarkdown('`code`')).toBe('code');
  });
  it('leaves plain text alone', () => {
    expect(stripMarkdown('Ich kaufe den Kuchen.')).toBe('Ich kaufe den Kuchen.');
  });
});

describe('normalizeAnswer', () => {
  it('lowercases', () => {
    expect(normalizeAnswer('Hallo!')).toBe('hallo');
  });

  it('replaces umlauts', () => {
    expect(normalizeAnswer('Schön')).toBe('schoen');
    expect(normalizeAnswer('Bär')).toBe('baer');
    expect(normalizeAnswer('über')).toBe('ueber');
    expect(normalizeAnswer('Straße')).toBe('strasse');
  });

  it('strips boundary punctuation', () => {
    expect(normalizeAnswer('Hallo, wie geht es dir?')).toBe('hallo wie geht es dir');
  });

  it('collapses whitespace', () => {
    expect(normalizeAnswer('  Ich   bin   hier  ')).toBe('ich bin hier');
  });
});

describe('exactMatch', () => {
  it('passes on identical strings', () => {
    expect(exactMatch('Hallo!', 'Hallo!')).toBe(true);
  });

  it('fails on case difference', () => {
    expect(exactMatch('hallo!', 'Hallo!')).toBe(false);
  });
});

describe('checkAgainst', () => {
  it('matches exact', () => {
    const r = checkAgainst('Hallo!', 'Hallo!');
    expect(r.correct).toBe(true);
    expect(r.matchedAlternate).toBe(false);
  });

  it('matches normalized case', () => {
    const r = checkAgainst('hallo', 'Hallo!');
    expect(r.correct).toBe(true);
  });

  it('matches umlaut substitution', () => {
    const r = checkAgainst('schoen', 'Schön');
    expect(r.correct).toBe(true);
  });

  it('matches alternate', () => {
    const r = checkAgainst('Servus', 'Hallo!', ['Servus', 'Grüß Gott']);
    expect(r.correct).toBe(true);
    expect(r.matchedAlternate).toBe(true);
  });

  it('fails on different meaning', () => {
    const r = checkAgainst('Tschüss', 'Hallo!');
    expect(r.correct).toBe(false);
  });

  // Markdown stripping — what the user requested
  it('plain user input matches markdown-bold canonical', () => {
    const r = checkAgainst('Der Korb steht neben der Kasse.', '**Der** Korb steht neben der Kasse.');
    expect(r.correct).toBe(true);
  });
  it('case + markdown together', () => {
    const r = checkAgainst('der korb', '**Der** Korb');
    expect(r.correct).toBe(true);
  });
  it('italic-wrapped user input still matches', () => {
    const r = checkAgainst('*Hallo!*', 'Hallo!');
    expect(r.correct).toBe(true);
  });
  it('umlaut + markdown', () => {
    const r = checkAgainst('Schoen', '**Schön**');
    expect(r.correct).toBe(true);
  });
});

describe('classifyMatch', () => {
  it('exact for identical strings', () => {
    expect(classifyMatch('Hallo!', 'Hallo!')).toBe('exact');
  });

  it('umlaut substitution is exact (no warning)', () => {
    // Typing "ueber" for "über" is an input-method accommodation, not an error.
    expect(classifyMatch('ueber', 'über')).toBe('exact');
    expect(classifyMatch('Schoen', 'Schön')).toBe('exact');
    expect(classifyMatch('Strasse', 'Straße')).toBe('exact');
  });

  it('case_only when only capitalization differs', () => {
    expect(classifyMatch('ich bin', 'Ich bin')).toBe('case_only');
    expect(classifyMatch('DER KORB', 'der Korb')).toBe('case_only');
  });

  it('case_only across umlaut substitution', () => {
    // "Über" canonical, user types lowercase "ueber": umlaut folded to ASCII,
    // case still differs (U vs u). Should be case_only, not exact.
    expect(classifyMatch('ueber', 'Über')).toBe('case_only');
  });

  it('punct_only when only punctuation differs', () => {
    expect(classifyMatch('Hallo Welt', 'Hallo, Welt!')).toBe('punct_only');
    expect(classifyMatch('Ich bin hier', 'Ich bin hier.')).toBe('punct_only');
  });

  it('case_and_punct when both differ', () => {
    expect(classifyMatch('hallo welt', 'Hallo, Welt!')).toBe('case_and_punct');
  });

  it('no_match when the words actually differ', () => {
    expect(classifyMatch('Tschüss', 'Hallo')).toBe('no_match');
    expect(classifyMatch('Ich bin Anna', 'Ich bin Alex')).toBe('no_match');
  });
});

describe('checkAgainst — match level surfaced', () => {
  it('exact match has matchLevel exact', () => {
    expect(checkAgainst('Hallo!', 'Hallo!').matchLevel).toBe('exact');
  });
  it('case-only match has matchLevel case_only', () => {
    expect(checkAgainst('hallo!', 'Hallo!').matchLevel).toBe('case_only');
  });
  it('picks the best match level across alternates', () => {
    // Exact match on alternate beats case-only match on canonical.
    const r = checkAgainst('Servus', 'Hallo', ['Servus', 'Grüß Gott']);
    expect(r.matchLevel).toBe('exact');
    expect(r.matchedAlternate).toBe(true);
  });
});
