'use client';

import { type MouseEvent } from 'react';
import { hasTts } from '../lib/tts-voices';
import type { TargetLang } from '../lib/content-types';

// Single AudioContext kept warm across plays. Created on first user gesture.
let sharedCtx: AudioContext | null = null;
let activeSource: AudioBufferSourceNode | null = null;

// 300 ms of 60 Hz at amplitude 10/32767 — inaudible but wakes the audio hardware
// so the first phoneme of the actual word isn't clipped on mobile/Bluetooth output.
const WAKEUP_SEC = 0.3;
const WAKEUP_HZ = 60;
const WAKEUP_AMP = 10 / 32767;

function buildWakeupBuffer(ctx: AudioContext): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const length = Math.floor(sampleRate * WAKEUP_SEC);
  const buf = ctx.createBuffer(1, length, sampleRate);
  const data = buf.getChannelData(0);
  const omega = (2 * Math.PI * WAKEUP_HZ) / sampleRate;
  for (let i = 0; i < length; i++) {
    data[i] = Math.sin(omega * i) * WAKEUP_AMP;
  }
  return buf;
}

export async function speak(text: string, lang: TargetLang): Promise<void> {
  if (!text.trim()) return;
  try {
    if (!sharedCtx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      sharedCtx = new Ctor();
    }
    const ctx = sharedCtx;

    if (activeSource) {
      try {
        activeSource.stop();
      } catch {
        /* already stopped */
      }
      activeSource = null;
    }

    // iOS Safari only unlocks the AudioContext when a buffer source is started
    // synchronously inside the user gesture. Scheduling the wakeup BEFORE any
    // await (and before/alongside ctx.resume) is what keeps mobile playback
    // working — the previous order awaited ctx.resume() first and silently
    // failed on iPhone because the gesture had already ended by the time
    // start() ran.
    const startAt = ctx.currentTime;
    const wakeup = ctx.createBufferSource();
    wakeup.buffer = buildWakeupBuffer(ctx);
    wakeup.connect(ctx.destination);
    wakeup.start(startAt);
    if (ctx.state !== 'running') void ctx.resume().catch(() => {});

    const res = await fetch(`/api/tts?text=${encodeURIComponent(text)}&lang=${lang}`);
    if (!res.ok) return;
    const bytes = await res.arrayBuffer();
    const audioBuf = await ctx.decodeAudioData(bytes);

    // iOS may auto-suspend the context once the wakeup tone finishes (300 ms)
    // and the network fetch is still in flight. A second resume() here is a
    // no-op when the context is still running.
    if (ctx.state !== 'running') {
      try {
        await ctx.resume();
      } catch {
        /* ignore — playback below will simply be silent */
      }
    }

    const speech = ctx.createBufferSource();
    speech.buffer = audioBuf;
    speech.connect(ctx.destination);
    const speechAt = Math.max(startAt + WAKEUP_SEC, ctx.currentTime);
    speech.start(speechAt);
    activeSource = speech;
    speech.onended = () => {
      if (activeSource === speech) activeSource = null;
    };
  } catch {
    /* swallow */
  }
}

interface SpeakButtonProps {
  text: string;
  lang: TargetLang;
  size?: 'sm' | 'md';
  className?: string;
}

export function SpeakButton({ text, lang, size = 'sm', className }: SpeakButtonProps) {
  // Hide entirely for targets Google TTS doesn't cover (sr, ka) — better than
  // showing a button that produces nothing.
  if (!hasTts(lang)) return null;
  const px = size === 'md' ? 18 : 16;
  function onClick(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    void speak(text, lang);
  }
  // Tap target sized for touch: visible icon is small (16/18 px) but the
  // hit area expands via inline-flex + min-w/h, so a thumb-tap lands
  // reliably even when the speaker icon shares a row with text.
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Play pronunciation: ${text}`}
      className={
        'inline-flex items-center justify-center min-w-[32px] min-h-[32px] -mx-1 text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors ' +
        (className ?? '')
      }
    >
      <svg
        width={px}
        height={px}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
        <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
      </svg>
    </button>
  );
}
