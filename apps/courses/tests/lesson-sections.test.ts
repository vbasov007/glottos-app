import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { classifySection, partitionSections } from '../lib/lesson-sections';
import type { Lesson } from '../lib/content-types';

const OUT = path.resolve(__dirname, '..', 'content', '.generated');
const readLesson = (lang: string, n: number): Lesson =>
  JSON.parse(readFileSync(path.join(OUT, 'classic50', `de.${lang}`, 'lessons', `${n}.json`), 'utf8'));

describe('classifySection', () => {
  it('intro variants (3 langs)', () => {
    expect(classifySection('How to work with this lesson')).toBe('intro');
    expect(classifySection('Как работать с этим уроком')).toBe('intro');
    expect(classifySection('Jak pracować z tą lekcją')).toBe('intro');
  });

  it('vocab variants', () => {
    expect(classifySection('Part 6: Vocabulary — At the supermarket')).toBe('vocab');
    expect(classifySection('Часть 5: Словарь — Семья')).toBe('vocab');
    expect(classifySection('Część 5: Słownictwo — Mój dzień')).toBe('vocab');
  });

  it('audio variants — scales', () => {
    expect(classifySection('Part 7: Language scales')).toBe('audio');
    expect(classifySection('Часть 7: Языковые гаммы')).toBe('audio');
    expect(classifySection('Część 7: Gamy językowe')).toBe('audio');
  });

  it('audio variants — matrix', () => {
    expect(classifySection('Part 8: Language matrix')).toBe('audio');
    expect(classifySection('Часть 8: Языковая матрица')).toBe('audio');
    expect(classifySection('Część 8: Matryca językowa')).toBe('audio');
  });

  it('exercises variants', () => {
    expect(classifySection('Part 9: Exercises')).toBe('exercises');
    expect(classifySection('Часть 9: Упражнения')).toBe('exercises');
    expect(classifySection('Część 9: Ćwiczenia')).toBe('exercises');
  });

  it('cheatsheet variants', () => {
    expect(classifySection('Lesson cheat sheet')).toBe('cheatsheet');
    expect(classifySection('Памятка урока')).toBe('cheatsheet');
    expect(classifySection('Ściąga z lekcji')).toBe('cheatsheet');
  });

  it('theory is the default', () => {
    expect(classifySection('Part 1: What Akkusativ is and why you need it')).toBe('theory');
    expect(classifySection('Часть 2: Главный хак')).toBe('theory');
    expect(classifySection('Część 3: Tabela rodzajników')).toBe('theory');
  });
});

describe('partitionSections — real lessons across 3 languages', () => {
  // Lesson 9 has all categories: intro + theory parts + vocab + scales + matrix + exercises + cheatsheet
  for (const lang of ['en', 'ru', 'pl'] as const) {
    it(`lesson 9 ${lang} partitions cleanly`, () => {
      const lesson = readLesson(lang, 9);
      const { intro, theory, audio, cheatsheet } = partitionSections(lesson.sections);
      expect(intro).not.toBeNull();
      expect(theory.length).toBeGreaterThan(2); // multiple "Part N" theory sections
      expect(audio.length).toBe(2); // scales + matrix
      expect(cheatsheet).not.toBeNull();

      // Audio sections should contain exactly the scales + matrix
      const audioHeadings = audio.map((s) => s.heading.toLowerCase());
      expect(audioHeadings.some((h) => /scale|гамм|gama|gamy/.test(h))).toBe(true);
      expect(audioHeadings.some((h) => /matrix|матриц|matryca/.test(h))).toBe(true);
    });
  }

  // Lesson 1 is the simplest — Block 1, no scales/matrix
  it('lesson 1 en partitions cleanly (no scales/matrix)', () => {
    const lesson = readLesson('en', 1);
    const { intro, theory, audio } = partitionSections(lesson.sections);
    expect(intro).not.toBeNull();
    expect(theory.length).toBeGreaterThan(0);
    expect(audio.length).toBe(0); // no scales or matrix yet in Block 1 early lessons
  });
});
