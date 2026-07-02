import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const OUT = path.resolve(__dirname, '..', 'content', '.generated');

function readJson(p: string): any {
  return JSON.parse(readFileSync(path.join(OUT, p), 'utf8'));
}

describe('content build smoke tests', () => {
  it('manifest has the classic50 German native pairs', () => {
    // NOTE: the source content has grown well beyond the original 3 pairs (the
    // manifest now lists every target/native course, plus losreden50), and the
    // generated tree is nested by course slug. This checks the three classic50
    // German pairs this suite exercises rather than an exact total count.
    const m = readJson('manifest.json');
    const c50 = m.courses.filter(
      (c: any) => c.course === 'classic50' && ['de.en', 'de.pl', 'de.ru'].includes(c.courseKey),
    );
    expect(c50.map((c: any) => c.courseKey).sort()).toEqual(['de.en', 'de.pl', 'de.ru']);
    for (const c of c50) {
      expect(c.lessonCount).toBe(50);
      expect(c.testCount).toBe(50);
      expect(c.textCount).toBe(150);
      expect(c.blockCount).toBe(6);
    }
  });

  it('lesson 1 en has correct title and 5 exercises', () => {
    const l = readJson('classic50/de.en/lessons/1.json');
    expect(l.n).toBe(1);
    expect(l.title).toMatch(/^Lesson 1: /);
    expect(l.vocabSubtitle).toMatch(/^Vocabulary: /);
    expect(l.exercises.length).toBe(5);
    expect(l.exercises[0].n).toBe(1);
    expect(l.sections.length).toBeGreaterThan(3);
  });

  it('lesson 9 en (Akkusativ) has gender column in vocab', () => {
    const l = readJson('classic50/de.en/lessons/9.json');
    expect(l.vocab.length).toBeGreaterThan(15);
    const withGender = l.vocab.filter((v: any) => v.gender);
    expect(withGender.length).toBeGreaterThan(15);
    expect(['m', 'f', 'n', 'Pl']).toContain(l.vocab[0].gender);
  });

  it('test 1 en has 30 prompts and 30 answers', () => {
    const t = readJson('classic50/de.en/tests/1.json');
    expect(t.prompts.length).toBe(30);
    expect(t.answers.length).toBe(30);
    expect(t.answers[0].canonical).toBe('Hallo!');
    expect(t.answers[0].alternates).toEqual([]);
  });

  it('test 45 en alternate-answer parsing strips italics', () => {
    const t = readJson('classic50/de.en/tests/45.json');
    expect(t.answers.length).toBe(30);
    const ans10 = t.answers[9];
    expect(ans10.canonical).not.toMatch(/^\*/);
    expect(ans10.canonical).not.toMatch(/\*$/);
    expect(ans10.alternates.length).toBeGreaterThan(0);
    for (const alt of ans10.alternates) {
      expect(alt).not.toMatch(/^\*/);
      expect(alt).not.toMatch(/\*$/);
    }
  });

  it('text 1a en has 30 sentences and a vocab table', () => {
    const t = readJson('classic50/de.en/texts/1-a.json');
    expect(t.sentences.length).toBe(30);
    expect(t.sentences[0]).toBe('Hallo!');
    expect(t.vocab.length).toBeGreaterThan(5);
  });

  it('dictionary en has ~2333 entries with proper lemmas', () => {
    const d = readJson('classic50/de.en/dictionary.json');
    expect(d.totalEntries).toBeGreaterThan(2000);
    const arzt = d.entries.find((e: any) => e.german === 'der Arzt');
    expect(arzt).toBeDefined();
    expect(arzt.lemma).toBe('arzt');
    expect(arzt.gender).toBe('m');
    expect(arzt.letter).toBe('A');
  });

  it('curriculum en has 6 blocks with rank labels for blocks 1-5', () => {
    const c = readJson('classic50/de.en/curriculum.json');
    expect(c.blocks.length).toBe(6);
    expect(c.blocks[0].rankLabel).toMatch(/Knappe/);
    expect(c.blocks[4].rankLabel).toMatch(/König/);
    expect(c.blocks[5].rankLabel).toBe(null);
  });

  it('all 3 languages have consistent structure', () => {
    for (const native of ['ru', 'en', 'pl']) {
      const idx = readJson(`classic50/de.${native}/index.json`);
      expect(idx.lessons.length).toBe(50);
      expect(idx.tests.length).toBe(50);
      expect(idx.texts.length).toBe(150);
    }
  });
});
