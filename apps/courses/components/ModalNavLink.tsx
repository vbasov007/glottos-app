'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  /** Same href the old NavLink would have used — appears in the iframe with
   *  `?embed=1` appended so the embedded layout hides its own chrome. */
  href: string;
  label: string;
  /** Optional id for the rendered <a> so global keyboard shortcuts can
   *  resolve and click it (g c / g d / g p). */
  id?: string;
  /** Optional keyboard-shortcut hint shown as small <kbd> chips next to
   *  the label — `['g', 'v']` renders as `[g][v]`. Hidden on narrow
   *  viewports so the nav strip stays uncrowded. */
  shortcut?: string[];
  /** Visual variant for the trigger.
   *  - `topbar` (default): inline padded link, matches the desktop top-bar
   *    nav strip.
   *  - `bottom`: icon-above-caption tile sized for the mobile bottom-nav
   *    grid cell. Requires `children` for the icon. Hides keyboard-shortcut
   *    chips since bottom-nav targets are touch, not keyboard. */
  style?: 'topbar' | 'bottom';
  /** Icon element for the `bottom` variant. Passed as `children` (a React
   *  element) rather than a function reference — a Server Component parent
   *  can render the icon directly and pass the element across the
   *  Server→Client boundary; a function reference would fail RSC
   *  serialization. Ignored for `topbar`. */
  children?: ReactNode;
}

/**
 * Desktop top-bar nav entry that pops a same-origin iframe over the current
 * page instead of navigating away. Used for Courses / Dictionary / Progress
 * so a user mid-lesson can peek without losing their scroll position.
 *
 * Implementation notes:
 *   - `<iframe>` over real route extraction: zero refactor for the three
 *     target pages, full session/Zustand state is shared via localStorage
 *     since the iframe is same-origin. Trade-off is a fresh page load per
 *     open — acceptable for a peek-and-close flow.
 *   - `?embed=1` query → an inline script in the root layout (see
 *     ThemeScript-adjacent block) sets `html[data-embed="true"]`, which
 *     hides TopBar + MobileBottomNav via the existing data-tma-hide CSS
 *     rule. No flicker, no double chrome.
 *   - Portal targets `document.body` so the modal isn't trapped by the
 *     `overflow-x-clip` chain set on the layout.
 *   - Body scroll locks while open; restores on close.
 */
export function ModalNavLink({ href, label, id, shortcut, style = 'topbar', children }: Props) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const triggerRef = useRef<HTMLAnchorElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const close = useCallback(() => setOpen(false), []);

  // Lock body scroll while the modal is open. Restoring on unmount handles
  // the rare case the component itself unmounts while open (e.g. route
  // change pulled by the back button).
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Escape closes; restore focus to the trigger so keyboard users land back
  // on the same nav item they came from.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') close();
    }
    // Keystrokes inside the iframe don't bubble to the parent window, so
    // the embedded page sends a same-origin postMessage when its own Esc
    // handler fires (see KeyboardShortcuts). We close on receipt — that's
    // how Esc gets out of the iframe and closes the modal.
    function onMsg(e: MessageEvent): void {
      if (e.origin !== window.location.origin) return;
      const data = e.data as { type?: string } | null;
      if (data?.type === 'glottos:close-overlay') close();
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('message', onMsg);
    // Focus the modal shell so subsequent Tab cycles inside the panel.
    dialogRef.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('message', onMsg);
      triggerRef.current?.focus();
    };
  }, [open, close]);

  function onClick(e: React.MouseEvent): void {
    // Allow middle-click / ⌘-click / ctrl-click to follow the link normally
    // (open in real new tab) — only intercept plain left-click for the modal.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    setOpen(true);
  }

  const sep = href.includes('?') ? '&' : '?';
  const embedSrc = `${href}${sep}embed=1`;

  // Bottom-nav variant uses an icon-above-caption tile that fits the mobile
  // bottom-nav grid cell. Falls back to the topbar layout if no `children`
  // (icon) was supplied. Keyboard-shortcut chips are skipped here — touch UI.
  const trigger =
    style === 'bottom' && children ? (
      <a
        ref={triggerRef}
        id={id}
        href={href}
        onClick={onClick}
        aria-label={label}
        className="flex flex-col items-center justify-center gap-0.5 py-1.5 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900"
      >
        {children}
        <span className="text-[10px] leading-none">{label}</span>
      </a>
    ) : (
      <a
        ref={triggerRef}
        id={id}
        href={href}
        onClick={onClick}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-900"
      >
        <span>{label}</span>
        {shortcut && shortcut.length > 0 ? (
          <span
            aria-hidden
            className="hidden xl:inline-flex items-center gap-0.5 font-mono text-[10px] text-zinc-400 dark:text-zinc-400"
          >
            {shortcut.map((k, i) => (
              <kbd
                key={i}
                className="px-1 py-px rounded border border-zinc-200 dark:border-zinc-800 leading-none"
              >
                {k}
              </kbd>
            ))}
          </span>
        ) : null}
      </a>
    );

  return (
    <>
      {trigger}
      {mounted && open
        ? createPortal(
            <div
              className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
              role="dialog"
              aria-modal="true"
              aria-label={label}
            >
              {/* Dim backdrop — click closes. Sits behind the panel. */}
              <button
                type="button"
                aria-label="Close"
                onClick={close}
                className="absolute inset-0 bg-black/40 dark:bg-black/60"
              />
              {/* Panel */}
              <div
                ref={dialogRef}
                tabIndex={-1}
                className="relative w-full max-w-5xl h-[85vh] rounded-xl bg-white dark:bg-zinc-950 shadow-2xl flex flex-col overflow-hidden outline-none"
              >
                <div className="flex items-center justify-between gap-3 px-4 py-2 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <h2 className="text-sm font-semibold truncate">{label}</h2>
                    {shortcut && shortcut.length > 0 ? (
                      <span
                        aria-hidden
                        className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] text-zinc-400 dark:text-zinc-400"
                      >
                        {shortcut.map((k, i) => (
                          <kbd
                            key={i}
                            className="px-1 py-px rounded border border-zinc-200 dark:border-zinc-800 leading-none"
                          >
                            {k}
                          </kbd>
                        ))}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <kbd
                      aria-hidden
                      className="hidden sm:inline font-mono text-[10px] text-zinc-400 dark:text-zinc-400 px-1 py-px rounded border border-zinc-200 dark:border-zinc-800 leading-none"
                    >
                      Esc
                    </kbd>
                    <button
                      type="button"
                      onClick={close}
                      aria-label="Close"
                      className="w-8 h-8 inline-flex items-center justify-center rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-900 text-zinc-600 dark:text-zinc-300"
                    >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                  </div>
                </div>
                <iframe
                  src={embedSrc}
                  title={label}
                  onLoad={(e) => {
                    // Move focus into the iframe so the embedded page's
                    // own listeners (KeyboardShortcuts, DictionarySearch
                    // autofocus) take over. Wrapped defensively though
                    // same-origin embeds should never throw.
                    try {
                      (e.currentTarget.contentWindow as Window | null)?.focus();
                    } catch {
                      /* ignore */
                    }
                  }}
                  className="flex-1 w-full border-0 bg-white dark:bg-zinc-950"
                />
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
