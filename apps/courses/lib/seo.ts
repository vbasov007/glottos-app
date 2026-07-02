import type { Metadata } from 'next';
import { TARGET_BY_CODE, type NativeLang, type TargetLang } from './content-types';
import { absoluteUrl } from './site-url';

/**
 * Build canonical + hreflang alternates for any page that exists in every
 * native variant of a target. `subpath` is the route under
 * /<target>/<native>/ — empty string for the course home, "/lesson/4" for a
 * lesson, "/dictionary" for the dictionary, etc.
 *
 * x-default points at English when available (broadest crawler default),
 * otherwise the first listed native — keeps Google happy.
 */
export function buildLanguageAlternates(
  target: TargetLang,
  native: NativeLang,
  subpath = '',
): NonNullable<Metadata['alternates']> {
  const meta = TARGET_BY_CODE[target];
  const languages: Record<string, string> = {};
  for (const n of meta.natives) {
    languages[n] = absoluteUrl(`/${target}/${n}${subpath}`);
  }
  languages['x-default'] = languages['en'] ?? languages[meta.natives[0]!]!;
  return {
    canonical: absoluteUrl(`/${target}/${native}${subpath}`),
    languages,
  };
}

/** Strip leading/trailing markdown bold markers from authored subtitle lines. */
export function stripBoldMarkers(s: string): string {
  return s.replace(/^\*\*/, '').replace(/\*\*$/, '').trim();
}
