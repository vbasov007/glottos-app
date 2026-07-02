'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Global keyboard shortcuts. Mounted once at the locale-layout level so a
 * single document-level listener serves every lesson / dictionary /
 * dashboard page underneath. Inert outside the browser and gated on focus
 * so it never interferes with answer typing, dictionary search, or IME
 * composition.
 *
 * Shortcut surface:
 *   Esc        — when focus is in a text input: blur it (so the next key
 *                lands in command mode). When focus is already free: no-op
 *                so existing Esc handlers (ModalNavLink, cheatsheet) keep
 *                their semantics.
 *   ?          — toggle the cheatsheet overlay
 *   /          — already handled by DictionarySearch's own listener; we
 *                deliberately don't touch it here.
 *   g <key>    — two-key navigation sequence with a 1 s arm window:
 *                  g t  → lesson Theory tab
 *                  g v  → lesson Vocab tab
 *                  g e  → lesson Exercises tab
 *                  g a  → lesson Audio tab
 *                  g c  → Courses modal
 *                  g d  → Dictionary modal
 *                  g p  → Progress modal
 *   n / p      — next / previous lesson (only fires when those links
 *                exist on the page)
 *
 * Each shortcut resolves its target by id / data-shortcut attribute and
 * calls .click() — no React refs across components, no per-page wiring.
 * If the target isn't on the current page (e.g. `g v` on the landing),
 * the keystroke quietly no-ops.
 */

function isEditableElement(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type;
    // Inputs that don't accept typed characters can still receive keystrokes
    // (Space toggles a checkbox, etc.) — let them through to the handler.
    return !['button', 'submit', 'reset', 'checkbox', 'radio', 'image', 'file', 'range', 'color'].includes(type);
  }
  return (el as HTMLElement).isContentEditable === true;
}

/** Find a click target by id, fall back to data-shortcut. */
function clickById(id: string): boolean {
  const el = document.getElementById(id);
  if (!el) return false;
  (el as HTMLElement).click();
  return true;
}

function clickByDataShortcut(value: string): boolean {
  const el = document.querySelector<HTMLElement>(`[data-shortcut="${value}"]`);
  if (!el) return false;
  el.click();
  return true;
}

// Maps the second key after `g` (by physical position, KeyboardEvent.code)
// to the click target. Tab buttons live at id="tab-<key>"; modal nav
// links at id="nav-<key>". `KeyV` and `KeyD` both open the main
// dictionary modal — most users reach for `v` (Vocabulary) first, `d`
// (Dictionary) is the literal alias.
//
// Using `e.code` (not `e.key`) so a user with a non-Latin keyboard layout
// (Russian / Hebrew / Greek / …) gets the same physical keys, not the
// typed characters that don't map to anything. Same fix removes Caps
// Lock as a footgun.
const G_TARGETS: Record<string, string> = {
  KeyT: 'tab-theory',
  KeyV: 'nav-dictionary',
  KeyE: 'tab-writing',
  KeyA: 'tab-audio',
  KeyC: 'nav-courses',
  KeyD: 'nav-dictionary',
  KeyP: 'nav-progress',
};

export function KeyboardShortcuts() {
  const [helpOpen, setHelpOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  // Mirror helpOpen into a ref so the keydown handler (registered once
  // with empty deps) always sees the current value without retriggering
  // the listener attach/detach on every toggle.
  const helpOpenRef = useRef(false);
  useEffect(() => {
    helpOpenRef.current = helpOpen;
  }, [helpOpen]);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Close the cheatsheet on Esc explicitly — we still let Esc fall through
  // in the global handler so the standard "blur input" semantics keep
  // working for everyone else, but when the cheatsheet itself owns focus,
  // Esc should dismiss it first.
  const closeHelp = useCallback(() => setHelpOpen(false), []);

  useEffect(() => {
    // `armed` holds the timeout id while we're waiting for the second key
    // of a `g <key>` sequence. Captured in the closure so the same handler
    // instance owns the state across keydown events.
    let armed: number | null = null;
    const disarm = () => {
      if (armed !== null) {
        window.clearTimeout(armed);
        armed = null;
      }
    };

    function onKey(e: KeyboardEvent): void {
      // IME composition: every keystroke during composition fires keydown
      // with isComposing=true. We must never act on those — the user is
      // mid-pinyin or mid-kana entry.
      if (e.isComposing) return;

      const editable = isEditableElement(document.activeElement);

      // Esc cascade — ordered so an open popup always wins over input-blur.
      if (e.key === 'Escape') {
        disarm();
        // 1) Cheatsheet overlay: lightest case, owned right here.
        if (helpOpenRef.current) {
          setHelpOpen(false);
          e.preventDefault();
          return;
        }
        // 2) Embed mode: this document is inside the dictionary / courses /
        //    progress iframe, and keystrokes here never bubble out. Tell
        //    the parent (same origin) to close us via postMessage; the
        //    ModalNavLink that opened us listens for the message.
        const isEmbed = document.documentElement.dataset.embed === 'true';
        if (isEmbed && window.parent !== window) {
          window.parent.postMessage(
            { type: 'glottos:close-overlay' },
            window.location.origin,
          );
          e.preventDefault();
          return;
        }
        // 3) Parent has a modal open: ModalNavLink owns its own Esc
        //    listener, so we fall through *without* preventDefault and
        //    let it close. We don't blur first — the modal is closing
        //    anyway and will restore focus to the trigger on close.
        if (document.querySelector('[role="dialog"][aria-modal="true"]')) {
          return;
        }
        // 4) Plain page, focus in an input: leave the input so the next
        //    key lands in command mode.
        if (editable) {
          (document.activeElement as HTMLElement).blur();
          e.preventDefault();
        }
        return;
      }

      // Beyond Esc, every shortcut requires focus to be free. Bail without
      // doing anything else if focus is in an editable surface.
      if (editable) {
        disarm();
        return;
      }

      // Modifier combos belong to the browser / OS — never intercept.
      if (e.ctrlKey || e.metaKey || e.altKey) {
        disarm();
        return;
      }

      // Second key of a `g <key>` sequence: try to resolve and click.
      // Keyed by KeyboardEvent.code so a Russian / Hebrew / Greek user
      // gets the same physical positions, not the typed characters.
      if (armed !== null) {
        disarm();
        const target = G_TARGETS[e.code];
        if (target && clickById(target)) e.preventDefault();
        return;
      }

      // Letter shortcuts use e.code (physical key) for layout independence.
      // `?` stays on e.key because it's a character intent — Shift+Slash
      // on Latin layouts produces `?`; the small minority on layouts
      // where it doesn't can still type into the help-search-aware UIs.
      switch (e.code) {
        case 'KeyG':
          // Arm the leader. Disarmed if no second key arrives in 1 s, if
          // focus enters an input, or if a modifier is pressed.
          armed = window.setTimeout(() => {
            armed = null;
          }, 1000);
          e.preventDefault();
          return;
        case 'KeyN':
          if (clickByDataShortcut('next-lesson')) e.preventDefault();
          return;
        case 'KeyP':
          if (clickByDataShortcut('prev-lesson')) e.preventDefault();
          return;
      }
      if (e.key === '?') {
        setHelpOpen((v) => !v);
        e.preventDefault();
      }
    }

    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      disarm();
    };
  }, []);

  if (!mounted || !helpOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
    >
      <button
        type="button"
        onClick={closeHelp}
        aria-label="Close"
        className="absolute inset-0 bg-black/40 dark:bg-black/60"
      />
      <div
        className="relative w-full max-w-md rounded-xl bg-white dark:bg-zinc-950 shadow-2xl p-5 border border-zinc-200 dark:border-zinc-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">Keyboard shortcuts</h2>
          <button
            type="button"
            onClick={closeHelp}
            aria-label="Close"
            className="w-7 h-7 inline-flex items-center justify-center rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-900 text-zinc-600 dark:text-zinc-300"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <ShortcutRow keys={['Esc']} label="Leave input (then shortcuts work)" />
          <ShortcutRow keys={['?']} label="Toggle this help" />
          <ShortcutRow keys={['/']} label="Focus dictionary search" />
          <ShortcutRow keys={['g', 't']} label="Lesson · Theory tab" />
          <ShortcutRow keys={['g', 'e']} label="Lesson · Exercises tab" />
          <ShortcutRow keys={['g', 'a']} label="Lesson · Audio tab" />
          <ShortcutRow keys={['g', 'c']} label="Courses overlay" />
          <ShortcutRow keys={['g', 'v']} label="Dictionary overlay (also g d)" />
          <ShortcutRow keys={['g', 'p']} label="Progress overlay" />
          <ShortcutRow keys={['n']} label="Next lesson" />
          <ShortcutRow keys={['p']} label="Previous lesson" />
        </dl>
        <p className="mt-4 text-xs text-zinc-500">
          Press <Kbd>Esc</Kbd> while typing to leave the input — shortcuts only fire when no input has focus.
        </p>
      </div>
    </div>,
    document.body,
  );
}

function ShortcutRow({ keys, label }: { keys: string[]; label: string }) {
  return (
    <>
      <dt className="flex items-center gap-1 justify-end">
        {keys.map((k, i) => (
          <span key={i} className="contents">
            <Kbd>{k}</Kbd>
            {i < keys.length - 1 ? <span className="text-zinc-400 mx-0.5">then</span> : null}
          </span>
        ))}
      </dt>
      <dd className="text-zinc-700 dark:text-zinc-300">{label}</dd>
    </>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="font-mono text-xs px-1.5 py-0.5 rounded border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-200">
      {children}
    </kbd>
  );
}
