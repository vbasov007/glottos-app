// Classifies lesson sections by their H2 heading text. The QA pass verified all
// 50 lessons × 3 native languages use the canonical heading names, so a small
// set of locale-aware regex patterns is sufficient.

import type { LessonSection } from './content-types';

export type SectionCategory =
  | 'intro' // "How to work with this lesson" (top of Theory tab)
  | 'theory' // "Part N: <concept>" (Theory tab body)
  | 'cheatsheet' // "Lesson cheat sheet" / "Памятка" / "Ściąga" (end of Theory)
  | 'vocab' // "Vocabulary" / "Словарь" / "Słownictwo" — DROPPED (side panel uses lesson.vocab[])
  | 'audio' // Scales + matrices — Audio tab
  | 'exercises'; // "Exercises" section — DROPPED (Writing tab uses lesson.exercises[])

const PATTERNS: { [K in Exclude<SectionCategory, 'theory'>]: RegExp } = {
  intro: /how to work|как работать|jak pracować|wie du.*arbeitest|so arbeitest du/i,
  cheatsheet: /cheat sheet|памятка|ściąga|spickzettel/i,
  vocab: /vocabulary|словарь|словарный запас|słownictwo|słownik|wortschatz|лексика/i,
  audio:
    /language scales?|language matrix|\bscales?\b|\bmatrix\b|гамм|матриц|\bgam(a|y)\b|matryca|gamy|sprachmatrix|sprachtonleitern?|sprach-matrix|sprach-tonleitern?/i,
  exercises: /exercises|упражнения|ćwiczenia|übungen/i,
};

export function classifySection(heading: string): SectionCategory {
  for (const [cat, re] of Object.entries(PATTERNS)) {
    if (re.test(heading)) return cat as SectionCategory;
  }
  return 'theory';
}

export interface PartitionedSections {
  intro: LessonSection | null;
  theory: LessonSection[];
  audio: LessonSection[];
  cheatsheet: LessonSection | null;
}

/** Split lesson sections into the four buckets shown on the three tabs. */
export function partitionSections(sections: LessonSection[]): PartitionedSections {
  let intro: LessonSection | null = null;
  let cheatsheet: LessonSection | null = null;
  const theory: LessonSection[] = [];
  const audio: LessonSection[] = [];
  for (const s of sections) {
    const cat = classifySection(s.heading);
    switch (cat) {
      case 'intro':
        if (!intro) intro = s;
        else theory.push(s); // safety: a 2nd "how to work" goes to theory
        break;
      case 'theory':
        theory.push(s);
        break;
      case 'audio':
        audio.push(s);
        break;
      case 'cheatsheet':
        cheatsheet = s;
        break;
      case 'vocab':
      case 'exercises':
        // Dropped — rendered from structured data in side panel / Writing tab.
        break;
    }
  }
  return { intro, theory, audio, cheatsheet };
}
