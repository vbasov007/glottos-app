/**
 * Visual coloring for noun headwords in the dictionary. Gendered target
 * languages (de, fr, es, it, he, sr) tag each entry with one of "m" / "f" /
 * "n" / "pl". When the headword is rendered (typically together with its
 * definite article, e.g. "der Abend" or "la mesa"), we tint the whole
 * headword by gender so a learner scanning a long letter section can
 * pick up gender without reading the badge.
 *
 * Plural and unknown stay neutral — there's no widely-recognised colour
 * convention for those, and adding extra hues hurts scannability.
 *
 * Color choices match the user-facing description ("masculine blue, neuter
 * green, feminine red"). The dark-mode variants use the 400 shade so the
 * text remains readable on a dark background while preserving hue.
 */
export function genderColorClass(gender: string | null | undefined): string {
  if (!gender) return '';
  switch (gender.toLowerCase()) {
    case 'm':
      return 'text-blue-700 dark:text-blue-400';
    case 'n':
      return 'text-green-700 dark:text-green-400';
    case 'f':
      return 'text-red-700 dark:text-red-400';
    default:
      return '';
  }
}
