export interface LanguageConfig {
  label: string;
  ttsLang: string;
  ttsVoice: string;
  ttsAzureVoice: string;
  ttsTestPhrase: string;
  defaultTtsProvider?: 'google' | 'azure';
}

export interface GrammarLabels {
  masculine: string;
  feminine: string;
  neuter: string;
  cases: Record<string, string>;
  infinitive: string;
  present: string;
  past: string;
  perfect: string;
}
