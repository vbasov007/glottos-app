import { describe, it, expect } from 'vitest';
import { getNounArticle } from '../../src/i18n/grammar';

describe('getNounArticle', () => {
  describe('German', () => {
    it('maps genders to definite articles (word ignored)', () => {
      expect(getNounArticle('de', 'm', 'Hund')).toBe('der');
      expect(getNounArticle('de', 'f', 'Katze')).toBe('die');
      expect(getNounArticle('de', 'n', 'Haus')).toBe('das');
      expect(getNounArticle('de', 'm')).toBe('der');
    });
  });

  describe('French', () => {
    it('uses le/la before a consonant', () => {
      expect(getNounArticle('fr', 'm', 'livre')).toBe('le');
      expect(getNounArticle('fr', 'f', 'table')).toBe('la');
    });

    it("elides to l' before a vowel", () => {
      expect(getNounArticle('fr', 'm', 'arbre')).toBe("l'");
      expect(getNounArticle('fr', 'f', 'eau')).toBe("l'");
      expect(getNounArticle('fr', 'm', 'œuf')).toBe("l'");
    });

    it("elides before a mute h", () => {
      expect(getNounArticle('fr', 'm', 'homme')).toBe("l'");
      expect(getNounArticle('fr', 'f', 'heure')).toBe("l'");
      expect(getNounArticle('fr', 'm', 'hôtel')).toBe("l'");
    });

    it('does NOT elide before an aspirated h', () => {
      expect(getNounArticle('fr', 'm', 'haricot')).toBe('le');
      expect(getNounArticle('fr', 'f', 'hache')).toBe('la');
      expect(getNounArticle('fr', 'm', 'héros')).toBe('le');
      expect(getNounArticle('fr', 'm', 'hibou')).toBe('le');
    });

    it('treats initial y as a consonant', () => {
      expect(getNounArticle('fr', 'm', 'yaourt')).toBe('le');
    });

    it('falls back to le/la when the word is unknown', () => {
      expect(getNounArticle('fr', 'm')).toBe('le');
      expect(getNounArticle('fr', 'f', '')).toBe('la');
    });

    it('has no neuter', () => {
      expect(getNounArticle('fr', 'n', 'truc')).toBeNull();
    });
  });

  describe('Spanish', () => {
    it('uses el/la and never elides', () => {
      expect(getNounArticle('es', 'm', 'libro')).toBe('el');
      expect(getNounArticle('es', 'f', 'casa')).toBe('la');
      expect(getNounArticle('es', 'f', 'isla')).toBe('la');
      expect(getNounArticle('es', 'f', 'abeja')).toBe('la'); // unstressed initial a
    });

    it('uses euphonic el for feminine nouns with a stressed initial a-/ha-', () => {
      expect(getNounArticle('es', 'f', 'agua')).toBe('el');
      expect(getNounArticle('es', 'f', 'alma')).toBe('el');
      expect(getNounArticle('es', 'f', 'hacha')).toBe('el');
      expect(getNounArticle('es', 'f', 'hambre')).toBe('el');
      expect(getNounArticle('es', 'f', 'águila')).toBe('el'); // written accent ⇒ stressed
    });

    it('has no neuter', () => {
      expect(getNounArticle('es', 'n', 'algo')).toBeNull();
    });
  });

  describe('Italian', () => {
    it('uses il/la before a plain consonant', () => {
      expect(getNounArticle('it', 'm', 'cane')).toBe('il');
      expect(getNounArticle('it', 'f', 'casa')).toBe('la');
      expect(getNounArticle('it', 'm', 'sole')).toBe('il'); // s + vowel
    });

    it("elides to l' before a vowel", () => {
      expect(getNounArticle('it', 'm', 'amico')).toBe("l'");
      expect(getNounArticle('it', 'f', 'acqua')).toBe("l'");
      expect(getNounArticle('it', 'm', 'inizio')).toBe("l'"); // i + consonant
      expect(getNounArticle('it', 'm', 'hotel')).toBe("l'"); // silent h loanword
    });

    it('uses lo before impure s, z, gn, ps, pn, x, y, i+vowel', () => {
      expect(getNounArticle('it', 'm', 'studente')).toBe('lo');
      expect(getNounArticle('it', 'm', 'sport')).toBe('lo');
      expect(getNounArticle('it', 'm', 'zio')).toBe('lo');
      expect(getNounArticle('it', 'm', 'gnomo')).toBe('lo');
      expect(getNounArticle('it', 'm', 'psicologo')).toBe('lo');
      expect(getNounArticle('it', 'm', 'pneumatico')).toBe('lo');
      expect(getNounArticle('it', 'm', 'xilofono')).toBe('lo');
      expect(getNounArticle('it', 'm', 'yogurt')).toBe('lo');
      expect(getNounArticle('it', 'm', 'iato')).toBe('lo'); // i + vowel
    });

    it('keeps la (not l\') for feminine i+vowel', () => {
      expect(getNounArticle('it', 'f', 'iena')).toBe('la');
    });

    it('has no neuter', () => {
      expect(getNounArticle('it', 'n', 'coso')).toBeNull();
    });
  });

  describe('edge cases', () => {
    it('returns null when gender is missing', () => {
      expect(getNounArticle('de', null)).toBeNull();
      expect(getNounArticle('fr', undefined, 'arbre')).toBeNull();
    });

    it('returns null for unsupported languages', () => {
      expect(getNounArticle('en', 'm', 'dog')).toBeNull();
      expect(getNounArticle('ru', 'f', 'кошка')).toBeNull();
    });

    it('handles surrounding whitespace and casing', () => {
      expect(getNounArticle('it', 'f', '  Acqua ')).toBe("l'");
      expect(getNounArticle('fr', 'm', '  Homme')).toBe("l'");
    });
  });
});
