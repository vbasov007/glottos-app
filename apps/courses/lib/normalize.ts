// Answer-checking normalization. Shared by the client Checker and the
// /api/check-answer route so they agree on what "exact match" means.

const UMLAUT_MAP: Record<string, string> = {
  ä: 'ae',
  ö: 'oe',
  ü: 'ue',
  Ä: 'Ae',
  Ö: 'Oe',
  Ü: 'Ue',
  ß: 'ss',
};

const BOUNDARY_PUNCT = /[!?,.;:"'()«»„""\-–—]+/g;

/**
 * Strip the common markdown emphasis markers used in lesson keys:
 *   **bold**, __alt-bold__, *italic*, _alt-italic_, ~~strike~~, `code`.
 * We strip the delimiter *characters*, not the wrapped text. Asterisks /
 * underscores never appear in German answer content, so blanket-removing
 * them is safe and avoids regex edge cases (mixed/nested/unbalanced markers).
 */
export function stripMarkdown(input: string): string {
  return input.replace(/[*_~`]/g, '');
}

// Visual symbols that a TTS engine reads out as a word ("→" → "rightwards
// arrow") or otherwise mispronounces. In exercise text these are separators or
// markers ("schnell → schneller", "✗ → …", "∅ article") that were never meant
// to be spoken. Covers the Unicode arrow blocks plus a handful of standalone
// marks (check/cross, empty-set, bullets, pipe). Replaced with a space so the
// words on either side stay separated.
const SPOKEN_SYMBOL_RE = new RegExp(
  '[' +
    '\\u2190-\\u21FF' + // Arrows                → ← ↔ ⇒ …
    '\\u2794-\\u27BF' + // Dingbat arrows        ➔ ➜ ➡ …
    '\\u27F0-\\u27FF' + // Supplemental Arrows-A
    '\\u2900-\\u297F' + // Supplemental Arrows-B
    '\\u2B00-\\u2BFF' + // Misc Symbols & Arrows ⬅ ⬆ …
    '\\u2205' + //        ∅ empty set (the "no article" marker)
    '\\u2022\\u2023\\u00B7\\u25AA\\u25CF\\u25B6' + // • ‣ · ▪ ● ▶
    '\\u2713\\u2714\\u2717\\u2718\\u2611\\u2612' + // ✓ ✔ ✗ ✘ ☑ ☒
    '\\u2705\\u274C\\uFE0F' + //                   ✅ ❌ + emoji variation selector
    '\\|' + //            pipe separator
    ']',
  'g',
);

/**
 * Strip symbols that don't belong in speech. Safe to run on any text headed
 * for the TTS engine, regardless of whether it's a lesson answer, a dictionary
 * headword, or a raw sentence.
 */
export function stripSpokenSymbols(input: string): string {
  return input.replace(SPOKEN_SYMBOL_RE, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Text suitable for the TTS engine. Drops italic parentheticals — teaching
 * annotations like `*(e→ie)*` are written for the eye, not the ear — strips
 * remaining markdown delimiters and unreadable symbols, and collapses
 * whitespace.
 *
 *   "Er **liest** jeden Abend die Zeitung. *(e→ie)*"
 *     → "Er liest jeden Abend die Zeitung."
 *   "schnell → schneller → am schnellsten"
 *     → "schnell schneller am schnellsten"
 */
export function speakableText(input: string): string {
  return stripSpokenSymbols(
    stripMarkdown(
      input
        // "*(e→ie)*" — italicised inline annotation. Strip the asterisks
        // along with the parens so no orphan ** survives stripMarkdown.
        .replace(/\s*\*\([^)]*\)\*\s*/g, ' ')
        // Any other parenthetical — typically a grammar marker like
        // "(A)" / "(Dat)" / "(m)" embedded in an exercise canonical to
        // call out the case or gender being drilled. Visual only; the
        // TTS engine should pronounce the surrounding sentence as if the
        // marker weren't there.
        .replace(/\s*\([^)]*\)\s*/g, ' '),
    ),
  );
}

export function normalizeAnswer(input: string): string {
  return stripMarkdown(input)
    .normalize('NFC')
    .toLowerCase()
    .replace(/[äöüÄÖÜß]/g, (c) => UMLAUT_MAP[c] ?? c)
    .replace(BOUNDARY_PUNCT, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Strict exact match, after stripping markdown emphasis from both sides. */
export function exactMatch(given: string, expected: string): boolean {
  return stripMarkdown(given).trim() === stripMarkdown(expected).trim();
}

// Match levels, ordered worst → best. classifyMatch returns the lowest cost
// transformation that brings the two strings into agreement; everything past
// 'no_match' means the answer is acceptable, with the level telling the UI
// whether to show a small "watch your case / punctuation" warning.
//
// Umlaut substitution (typing "ueber" for "über") is folded into the baseline
// — it's an input-method accommodation, not a misspelling, and shouldn't
// trigger a warning. Case and punctuation are separable concerns that DO
// trigger warnings when they're the only differences.
export type MatchLevel = 'exact' | 'case_only' | 'punct_only' | 'case_and_punct' | 'no_match';

function foldUmlauts(s: string): string {
  return s.replace(/[äöüÄÖÜß]/g, (c) => UMLAUT_MAP[c] ?? c);
}

// Strip markdown emphasis, NFC-normalize composed characters, fold umlauts
// to their ASCII substitution. The result is the "baseline" representation
// against which case-folding and punctuation-stripping are layered.
function baseline(s: string): string {
  return foldUmlauts(stripMarkdown(s).trim().normalize('NFC'));
}

function stripPunct(s: string): string {
  return s.replace(BOUNDARY_PUNCT, ' ').replace(/\s+/g, ' ').trim();
}

export function classifyMatch(given: string, expected: string): MatchLevel {
  const g = baseline(given);
  const e = baseline(expected);
  if (g === e) return 'exact';
  if (g.toLowerCase() === e.toLowerCase()) return 'case_only';
  if (stripPunct(g) === stripPunct(e)) return 'punct_only';
  if (stripPunct(g.toLowerCase()) === stripPunct(e.toLowerCase())) return 'case_and_punct';
  return 'no_match';
}

const LEVEL_RANK: Record<MatchLevel, number> = {
  exact: 0,
  case_only: 1,
  punct_only: 2,
  case_and_punct: 3,
  no_match: 4,
};

/**
 * Hybrid check across canonical + alternates. Returns the best level achieved
 * across all candidates, plus whether that best match was on an alternate
 * (rather than the canonical). matchLevel === 'no_match' means rejected.
 */
export function checkAgainst(
  given: string,
  canonical: string,
  alternates: string[] = [],
): { correct: boolean; matchedAlternate: boolean; matchLevel: MatchLevel } {
  let best: { level: MatchLevel; alt: boolean } = { level: 'no_match', alt: false };
  const candidates: { value: string; alt: boolean }[] = [
    { value: canonical, alt: false },
    ...alternates.map((a) => ({ value: a, alt: true })),
  ];
  for (const { value, alt } of candidates) {
    const level = classifyMatch(given, value);
    if (LEVEL_RANK[level] < LEVEL_RANK[best.level]) {
      best = { level, alt };
      if (level === 'exact') break;
    }
  }
  return {
    correct: best.level !== 'no_match',
    matchedAlternate: best.alt,
    matchLevel: best.level,
  };
}
