/**
 * Pre-process the markdown source to fix intra-word emphasis patterns that
 * CommonMark refuses to parse.
 *
 * The problem case (very common in language-lesson content highlighting
 * elision and contraction):
 *
 *   **n'**aime  →  expected: <strong>n'</strong>aime
 *
 * Per the CommonMark right-flanking rule, a closing `**` preceded by
 * punctuation AND followed by a letter is NOT recognized as a closer
 * (rule (b) requires whitespace/punctuation after). The result: the
 * opening `**` stays open, swallows the rest of the line, and renders
 * as literal asterisks.
 *
 * Fix: rewrite this exact shape to inline HTML <strong>...</strong>.
 * MarkdownRenderer has rehype-raw enabled, so the HTML pass-through works.
 *
 * False-positive risk: a `**foo'**bar` pattern intended as something other
 * than bold-then-word is essentially impossible — the user already typed
 * the bold delimiters. Inside fenced code blocks the substitution would
 * leak HTML into rendered code; in practice no lesson code block contains
 * this shape, so we accept the risk.
 */
export function fixIntraWordBold(src: string): string {
  return src.replace(
    /\*\*([^*\n]+?[!?,.;:'"`«»‹›])\*\*(?=\p{L})/gu,
    '<strong>$1</strong>',
  );
}
