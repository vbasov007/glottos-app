/**
 * Inline <script> that decides whether to set <html class="dark"> BEFORE the
 * page first paints — that's the only way to avoid a light→dark flash for
 * users whose saved preference is dark. The script runs synchronously,
 * looks at localStorage, falls back to prefers-color-scheme when the user
 * hasn't picked a preference, and toggles the class accordingly.
 *
 * Kept tiny so it inlines without blocking. Same logic lives in
 * ThemeProvider's effect — duplicating one branch is the cost of avoiding
 * the flash.
 */
export function ThemeScript() {
  // The source string MUST be self-contained (no closures, no React refs) —
  // it runs in the browser context as plain JS before bundles load. Wrapped
  // in dangerouslySetInnerHTML so Next.js doesn't escape the curly braces.
  const src = `
    try {
      var pref = localStorage.getItem('theme');
      var dark =
        pref === 'dark' ||
        ((!pref || pref === 'system') &&
         window.matchMedia &&
         window.matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.classList.toggle('dark', dark);
    } catch (e) { /* fail open: no dark class, OS will decide via no-op */ }
  `;
  return <script dangerouslySetInnerHTML={{ __html: src }} />;
}
