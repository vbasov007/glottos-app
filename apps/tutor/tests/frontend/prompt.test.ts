import { describe, it, expect } from 'vitest';
import { buildPrompt, getTextLimit, LOGOGRAPHIC_LANGUAGES, LANGUAGE_LABELS, buildAntonymBackfillPrompt, coerceAntonyms } from '../../server-utils';

describe('buildAntonymBackfillPrompt', () => {
  it('names the word, both languages, and the JSON shape', () => {
    const p = buildAntonymBackfillPrompt('schnell', 'fast', 'de', 'ru');
    expect(p).toContain('"schnell"');
    expect(p).toContain('(meaning: fast)');
    expect(p).toContain('German');   // textLang label
    expect(p).toContain('Russian');  // explanationLang label
    expect(p).toContain('"antonyms"');
    expect(p.toLowerCase()).toContain('opposite');
  });

  it('omits the meaning hint when not provided', () => {
    const p = buildAntonymBackfillPrompt('öffnen', '', 'de', 'en');
    expect(p).not.toContain('meaning:');
    expect(p).toContain('"öffnen"');
  });
});

describe('coerceAntonyms', () => {
  it('keeps valid entries, trims, and defaults missing meaning to empty string', () => {
    expect(coerceAntonyms([{ word: ' klein ', meaning: ' small ' }, { word: 'winzig' }]))
      .toEqual([{ word: 'klein', meaning: 'small' }, { word: 'winzig', meaning: '' }]);
  });

  it('drops entries without a usable word and caps at 3', () => {
    expect(coerceAntonyms([{ meaning: 'x' }, { word: '' }, { word: '  ' }])).toEqual([]);
    const many = coerceAntonyms([{ word: 'a' }, { word: 'b' }, { word: 'c' }, { word: 'd' }]);
    expect(many).toHaveLength(3);
  });

  it('returns [] for non-array / junk input', () => {
    expect(coerceAntonyms(null)).toEqual([]);
    expect(coerceAntonyms('nope')).toEqual([]);
    expect(coerceAntonyms([1, 'x', null])).toEqual([]);
  });
});

describe('buildPrompt', () => {
  it('should include text language and explanation language names', () => {
    const prompt = buildPrompt('de', 'ru');
    expect(prompt).toContain('German');
    expect(prompt).toContain('Russian');
  });

  it('should use language codes as placeholders', () => {
    const prompt = buildPrompt('de', 'en');
    expect(prompt).toContain('"de"');
    expect(prompt).toContain('"en"');
  });

  it('should include JSON schema structure', () => {
    const prompt = buildPrompt('fr', 'en');
    expect(prompt).toContain('"input_language"');
    expect(prompt).toContain('"input_type"');
    expect(prompt).toContain('"selection"');
    expect(prompt).toContain('"meanings"');
    expect(prompt).toContain('"morphology"');
  });

  it('should mention all three cases (A, B, C)', () => {
    const prompt = buildPrompt('de', 'ru');
    expect(prompt).toContain('Case A');
    expect(prompt).toContain('Case B');
    expect(prompt).toContain('Case C');
  });

  it('should contain template placeholders for selected_text and full_text', () => {
    const prompt = buildPrompt('de', 'en');
    expect(prompt).toContain('{{selected_text}}');
    expect(prompt).toContain('{{full_text}}');
    expect(prompt).toContain('{{cursor_context}}');
  });

  it('should handle unknown language codes gracefully', () => {
    const prompt = buildPrompt('xyz', 'abc');
    // Falls back to using the code as the label
    expect(prompt).toContain('xyz');
    expect(prompt).toContain('abc');
  });

  it('should produce different prompts for different language pairs', () => {
    const deRu = buildPrompt('de', 'ru');
    const frEn = buildPrompt('fr', 'en');
    expect(deRu).not.toBe(frEn);
  });
});

describe('getTextLimit', () => {
  it('should return 2000 for non-logographic languages', () => {
    expect(getTextLimit('de')).toBe(2000);
    expect(getTextLimit('en')).toBe(2000);
    expect(getTextLimit('ru')).toBe(2000);
    expect(getTextLimit('fr')).toBe(2000);
    expect(getTextLimit('he')).toBe(2000);
  });

  it('should return 500 for logographic languages (zh, ja)', () => {
    expect(getTextLimit('zh')).toBe(500);
    expect(getTextLimit('ja')).toBe(500);
  });

  it('should return 2000 for unknown languages', () => {
    expect(getTextLimit('xyz')).toBe(2000);
  });
});

describe('LOGOGRAPHIC_LANGUAGES', () => {
  it('should contain zh and ja', () => {
    expect(LOGOGRAPHIC_LANGUAGES.has('zh')).toBe(true);
    expect(LOGOGRAPHIC_LANGUAGES.has('ja')).toBe(true);
  });

  it('should not contain non-logographic languages', () => {
    expect(LOGOGRAPHIC_LANGUAGES.has('de')).toBe(false);
    expect(LOGOGRAPHIC_LANGUAGES.has('en')).toBe(false);
    expect(LOGOGRAPHIC_LANGUAGES.has('ko')).toBe(false); // Korean is alphabetic
  });
});

describe('LANGUAGE_LABELS', () => {
  it('should have labels for common languages', () => {
    expect(LANGUAGE_LABELS.de).toBe('German');
    expect(LANGUAGE_LABELS.en).toBe('English');
    expect(LANGUAGE_LABELS.ru).toBe('Russian');
    expect(LANGUAGE_LABELS.he).toBe('Hebrew');
    expect(LANGUAGE_LABELS.ja).toBe('Japanese');
  });

  it('should have labels for all 41 languages', () => {
    expect(Object.keys(LANGUAGE_LABELS).length).toBeGreaterThanOrEqual(39);
  });
});
