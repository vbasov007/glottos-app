'use client';

import { openInTutor } from '../lib/open-in-tutor';

interface Props {
  label: string;
  /** Style: `nav` for the desktop top-bar link, `bottom` for the mobile
   *  bottom-nav cell (with icon + tiny caption). */
  style: 'nav' | 'bottom';
}

/**
 * Inline link/button that opens text-tutor in a new tab carrying the SSO
 * handoff (signed-in user + colour scheme + originating path). Calls
 * openInTutor("/") which lands the user at the tutor home; tutor's own
 * landing decides what to show.
 *
 * Two visual variants share a single client surface so the locale layout
 * doesn't have to import two near-identical components.
 */
export function TutorLink({ label, style }: Props) {
  function onClick(e: React.MouseEvent): void {
    e.preventDefault();
    openInTutor('/');
  }
  if (style === 'nav') {
    return (
      <a
        href="https://t.glottos.com/"
        onClick={onClick}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-900"
      >
        <span>{label}</span>
        <span aria-hidden className="text-xs">↗</span>
      </a>
    );
  }
  return (
    <a
      href="https://t.glottos.com/"
      onClick={onClick}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      className="flex flex-col items-center justify-center gap-0.5 py-1.5 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900"
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        {/* Headphones glyph — universal "audio learning" signal, matches
            the "Audio Tutor" label. Headband arc on top, two ear-cup
            rectangles below. Distinct from book / dictionary / chart /
            course icons already in the strip. */}
        <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
        <path d="M21 19a2 2 0 0 1-2 2h-1a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1h3z" />
        <path d="M3 19a2 2 0 0 0 2 2h1a1 1 0 0 0 1-1v-5a1 1 0 0 0-1-1H3z" />
      </svg>
      <span className="text-[10px] leading-none">{label}</span>
    </a>
  );
}
