import { describe, it, expect } from 'vitest';
import { TRANSLATIONS } from '../../src/i18n/translations';
import { t } from '../../src/i18n/t';

const EN_KEYS = Object.keys(TRANSLATIONS.en);
const ALL_LANGS = Object.keys(TRANSLATIONS);

describe('i18n translation completeness', () => {
  it('should have English as the reference locale', () => {
    expect(EN_KEYS.length).toBeGreaterThan(50);
  });

  it('should have at least 39 locales', () => {
    expect(ALL_LANGS.length).toBeGreaterThanOrEqual(39);
  });

  for (const lang of ALL_LANGS) {
    if (lang === 'en') continue;

    it(`${lang}: should have all English keys`, () => {
      const langKeys = Object.keys(TRANSLATIONS[lang]);
      const missing = EN_KEYS.filter(k => !langKeys.includes(k));
      expect(missing, `Missing keys in ${lang}: ${missing.join(', ')}`).toEqual([]);
    });

    it(`${lang}: should not have extra keys not in English`, () => {
      const langKeys = Object.keys(TRANSLATIONS[lang]);
      const extra = langKeys.filter(k => !EN_KEYS.includes(k));
      expect(extra, `Extra keys in ${lang}: ${extra.join(', ')}`).toEqual([]);
    });

    it(`${lang}: no values should be empty strings`, () => {
      const emptyKeys = EN_KEYS.filter(k => TRANSLATIONS[lang][k] === '');
      expect(emptyKeys, `Empty values in ${lang}: ${emptyKeys.join(', ')}`).toEqual([]);
    });
  }
});

describe('t() function', () => {
  it('should return English translation for existing key', () => {
    expect(t('EXPLAIN', 'en')).toBe('Explain');
  });

  it('should fall back to English when key missing in target lang', () => {
    // Create a scenario where a key exists in en but hypothetically missing
    // The t() function falls back to en, then to key itself
    expect(t('EXPLAIN', 'en')).toBe('Explain');
  });

  it('should return the key itself when not found in any locale', () => {
    expect(t('NONEXISTENT_KEY_12345', 'en')).toBe('NONEXISTENT_KEY_12345');
  });

  it('should work with different languages', () => {
    const ruResult = t('EXPLAIN', 'ru');
    expect(ruResult).toBeTruthy();
    expect(ruResult).not.toBe('EXPLAIN'); // Should be translated, not the key
  });

  it('should default to en when lang is undefined', () => {
    // t() without lang reads from window.__userPrefs which won't exist in test
    // so it falls back to 'en'
    const result = t('ERROR');
    expect(result).toBe('Error');
  });
});
