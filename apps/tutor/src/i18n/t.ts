import { TRANSLATIONS } from './translations';

export const t = (key: string, lang?: string): string => {
  const language = lang || (typeof window !== 'undefined' && (window as any).__userPrefs?.interfaceLanguage) || 'en';
  return TRANSLATIONS[language]?.[key] ?? TRANSLATIONS.en[key] ?? key;
};
