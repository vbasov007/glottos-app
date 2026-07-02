// Pure utility functions extracted from App.tsx for testability

import type { ExplanationResult } from './types';

export const LEAD_SILENCE = 7200; // 300 ms at 24 kHz

/**
 * Remove parenthetical asides "(...)" from a string to be spoken aloud, tidying
 * the leftover spacing and any space left before punctuation. Used so read-all
 * TTS skips bracketed notes. Single level of nesting (rare in practice).
 */
export function stripParentheticals(s: string): string {
  return s
    .replace(/\([^()]*\)/g, ' ')      // drop (...) groups
    .replace(/\s+([,.;:!?])/g, '$1')  // remove space left before punctuation
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * A cached explanation is "stale" when it predates a schema field we now render.
 * Word explanations gained an `antonyms` array (Case A) — entries cached before
 * that change have it `undefined` rather than an array. Treat those as a cache
 * miss so they get re-fetched and pick up antonyms. Newer entries always carry
 * an array (possibly empty), so they are never re-fetched on this basis.
 */
export function isExplanationStale(r: ExplanationResult): boolean {
  // A word explanation is stale if it predates a rendered field (antonyms or
  // word_structure) — re-fetch once to populate it. Both come back as arrays
  // (possibly []), so this can't loop forever.
  return r.input_type === 'word' && (!Array.isArray(r.antonyms) || !Array.isArray(r.word_structure));
}

export function chunksToWav(chunks: Int16Array[], sampleRate: number): Blob {
  const totalSamples = chunks.reduce((sum, c) => sum + c.length, 0);
  const dataSize = totalSamples * 2;
  const fileSize = 44 + dataSize;
  const buf = new ArrayBuffer(fileSize);
  const dv = new DataView(buf);
  // WAV header
  const wr = (o: number, s: string) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  wr(0, 'RIFF'); dv.setUint32(4, fileSize - 8, true); wr(8, 'WAVE');
  wr(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true); dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * 2, true); dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  wr(36, 'data'); dv.setUint32(40, dataSize, true);
  // Write every sample explicitly via DataView — no TypedArray tricks
  let bytePos = 44;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i++) {
      dv.setInt16(bytePos, chunk[i], true); // little-endian
      bytePos += 2;
    }
  }
  return new Blob([buf], { type: 'audio/wav' });
}

export function pcmToAudioBuffer(ctx: AudioContext, pcm: Int16Array): AudioBuffer {
  const buf = ctx.createBuffer(1, LEAD_SILENCE + pcm.length, 24000);
  const ch = buf.getChannelData(0);
  // Fill lead silence with a low-frequency, very-low-amplitude tone to keep
  // the audio hardware engaged through the silent lead. Earlier versions used
  // ±1/32768 (clipped — too quiet to wake the hardware) then ±50/32768
  // (audible). A 60 Hz sine at amplitude 5/32768 (~-76 dB) sits well below
  // the audible threshold but stays in the speech-band passband so browser
  // resampling preserves it.
  const SILENCE_AMP = 5 / 32768;
  const SILENCE_PHASE_INC = 2 * Math.PI * 60 / 24000;
  for (let i = 0; i < LEAD_SILENCE; i++) ch[i] = Math.sin(i * SILENCE_PHASE_INC) * SILENCE_AMP;
  for (let i = 0; i < pcm.length; i++) ch[LEAD_SILENCE + i] = pcm[i] / 32768;
  return buf;
}

export function decodeJwt(token: string): Record<string, unknown> {
  const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(atob(base64));
}

// Resize an image file to a JPEG data URL bounded by maxDim on the long side.
// 1024/0.8 pairs with OpenAI's detail:"low" mode (which downsamples to 512x512
// internally and uses ~85 image tokens) — fastest end-to-end. May lose tiny
// footnote-size print; for that, bump maxDim per-call.
export function resizeImageToDataUrl(
  file: File,
  maxDim = 1024,
  quality = 0.8,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Canvas 2D context unavailable'));
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };
    img.src = url;
  });
}

// Crop a JPEG/PNG data URL to a pixel rectangle and re-encode as JPEG.
// Coordinates are in the source image's natural pixel space.
export function cropDataUrlToDataUrl(
  srcDataUrl: string,
  crop: { x: number; y: number; width: number; height: number },
  quality = 0.85,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const w = Math.max(1, Math.round(crop.width));
      const h = Math.max(1, Math.round(crop.height));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Canvas 2D context unavailable'));
      ctx.drawImage(img, crop.x, crop.y, crop.width, crop.height, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = srcDataUrl;
  });
}
