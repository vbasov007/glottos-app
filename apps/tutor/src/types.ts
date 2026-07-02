// Shared types used across App.tsx and extracted components

export type AcousticPreset = 'none' | 'far' | 'phone' | 'cb_radio';
export type NoisePreset = 'none' | 'street' | 'crowd';
export type NoiseLevel = 'ambient' | 'moderate' | 'disturbing';

export const ACOUSTIC_PRESETS: readonly AcousticPreset[] = ['none', 'far', 'phone', 'cb_radio'] as const;
export const NOISE_PRESETS: readonly NoisePreset[] = ['none', 'street', 'crowd'] as const;
export const NOISE_LEVELS: readonly NoiseLevel[] = ['ambient', 'moderate', 'disturbing'] as const;

export function nextAcousticPreset(current: AcousticPreset): AcousticPreset {
  const i = ACOUSTIC_PRESETS.indexOf(current);
  return ACOUSTIC_PRESETS[(i + 1) % ACOUSTIC_PRESETS.length];
}

export function nextNoisePreset(current: NoisePreset): NoisePreset {
  const i = NOISE_PRESETS.indexOf(current);
  return NOISE_PRESETS[(i + 1) % NOISE_PRESETS.length];
}

export function nextNoiseLevel(current: NoiseLevel): NoiseLevel {
  const i = NOISE_LEVELS.indexOf(current);
  return NOISE_LEVELS[(i + 1) % NOISE_LEVELS.length];
}

export interface UserPreferences {
  interfaceLanguage: string;
  explanationLanguage: string;
  defaultTextLanguage: string;
  theme?: 'light' | 'dark';
  setupCompleted?: boolean;
  tutorialCompleted?: boolean;
  activeDeckId?: string | null;
}

export interface DeckSummary {
  id: string;
  name: string;
  position: number;
  card_count: number;
}

/** Per-(card, direction) interval-doubling scheduler row, as returned by
 *  GET /api/decks/:id/srs. A card with no row for a given direction has never
 *  entered the scheduler and is implicitly "new" — the UI infers that rather
 *  than the server materializing it. */
export interface DeckCardSrsState {
  card_id: string;
  direction: 'forward' | 'reverse';
  /** Position in the deck's shuffle (phase tie-break = rank / n). */
  rank: number;
  /** Current interval, in review steps. X0 = fresh; grows toward X_MAX = M*n. */
  x: number;
  /** Absolute virtual time of the card's next appearance. */
  next_due: number;
}

export interface DeckCard {
  id: string;
  source_text: string;
  text_language: string;
  explanation: ExplanationResult;
  /** Language the explanation/back was generated in, captured at card-create time
   *  so a later user-preference change doesn't poison the TTS voice for the back. */
  explanation_language: string | null;
  position: number;
}

export interface TtsVoiceOption {
  id: string;
  name: string;
  gender: 'male' | 'female' | 'neutral';
}

export interface Morphology {
  lemma: string | null;
  gender: 'm' | 'f' | 'n' | null;
  plural: string | null;
  case: 'NOM' | 'AKK' | 'DAT' | 'GEN' | null;
  number: 'SG' | 'PL' | null;
  tense: string | null;
  person: string | null;
  mood: string | null;
  voice: string | null;
  degree: 'POS' | 'KOMP' | 'SUP' | null;
  separable_prefix: string | null;
}

export interface NounForms {
  singular: { nom: string; akk: string; dat: string; gen: string };
  plural: { nom: string; akk: string; dat: string; gen: string };
}

export interface VerbForms {
  infinitive: string;
  praesens_ich: string;
  praeteritum: string;
  perfekt: string;
  konjunktiv_ii: string;
  imperativ_du: string;
}

export interface AdjectiveForms {
  positiv: string;
  komparativ: string;
  superlativ: string;
}

export interface TargetTranslation {
  text: string;
  register: 'formal' | 'informal' | 'neutral' | null;
  note: string | null;
}

export interface Highlight {
  form: string;
  explanation: string;
}

export interface ExplanationResult {
  input_language: string;
  input_type: 'word' | 'sentence';
  selection: string;
  meanings: string[];
  lemma_translation: string | null;
  translation: string | null;
  target_translations: TargetTranslation[];
  part_of_speech: string | null;
  morphology: Morphology;
  forms: {
    noun: NounForms;
    verb: VerbForms;
    adjective: AdjectiveForms;
  };
  sentence_structure: string | null;
  highlights: Highlight[];
  grammar_notes: string[];
  examples: Array<{ text: string; translation: string }>;
  /** Closely-related words in the target language with a short note on how
   *  each differs from the selected word. Populated for word inputs (Case A);
   *  absent/empty for sentence and reverse-lookup inputs. */
  near_synonyms?: Array<{ word: string; difference: string }>;
  /** Words in the target language with the opposite meaning, each with a short
   *  note on its sense. Populated for word inputs (Case A); absent/empty for
   *  sentence and reverse-lookup inputs. */
  antonyms?: Array<{ word: string; meaning: string }>;
  /** Decomposition of a compound/derived word into its meaningful parts in
   *  order (component words, roots, prefixes/suffixes, linking elements), each
   *  glossed. Most useful for long German compounds. Empty/absent for simple
   *  words and non-word inputs. */
  word_structure?: Array<{ part: string; meaning: string; type?: string }>;
  notes: string[];
}

export interface User {
  name: string;
  email: string | null;
  picture: string | null;
  role?: string;
  created_at?: string;
  preferences?: UserPreferences;
}
