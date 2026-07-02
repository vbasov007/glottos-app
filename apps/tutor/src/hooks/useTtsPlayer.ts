import React, { useState, useRef, useCallback, useEffect, type MutableRefObject } from 'react';
import { pcmToAudioBuffer, stripParentheticals } from '../utils';
import { TIMEOUTS } from '../constants';
import { getTextLimit } from '../i18n';
import type { AcousticPreset, NoisePreset, NoiseLevel, TtsVoiceOption } from '../types';
import { parseDialogLine, pickVoiceForGender, type Gender } from '../lib/dialog';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseTtsPlayerParams {
  text: string;
  textLanguage: string;
  sessionId: string | null;
  selection: string;
  effectiveTextLimit: number;
  logAction: (action: string, detail?: string, inputUnits?: number, outputUnits?: number) => void;
  showToast: (msg: string) => void;
  setShowLimitReached: (v: boolean) => void;
  setShowTextLimitWarning: (v: boolean) => void;
  setDailyUsage: React.Dispatch<React.SetStateAction<{ explains: number; tts: number; generates: number }>>;
  /** Ref that gates per-sentence sync checks (set to true during full-text playback) */
  skipSyncCheckRef: MutableRefObject<boolean>;
  /** Ref to current checkServerSync function */
  checkServerSyncRef: MutableRefObject<() => Promise<'ok' | 'sync' | 'keep-local'>>;
  /** Ref to current loadWorkspaceState function */
  loadWorkspaceStateRef: MutableRefObject<(sid: string, wsId: string) => Promise<void>>;
  /** Ref to current active workspace id */
  activeWorkspaceIdRef: MutableRefObject<string | null>;
  /** Ref to textarea element (used to read fresh text after sync) */
  textareaRef: MutableRefObject<HTMLTextAreaElement | null>;
  /** Acoustic preset: dry / phone / room / hall. Read at each source-creation. */
  acousticPresetRef?: MutableRefObject<AcousticPreset>;
  /** Acoustic preset as a value. Passed alongside the ref so toggling
   *  mid-playback re-triggers the current sentence with the new chain. */
  acousticPreset?: AcousticPreset;
  /** Background-noise preset: dry / street / cafe / club. Read at full-text playback start. */
  noisePresetRef?: MutableRefObject<NoisePreset>;
  /** Background-noise preset as a value. Passed alongside the ref so toggling
   *  mid-playback can swap the loop (or stop it for 'none') reactively. */
  noisePreset?: NoisePreset;
  /** Background-noise level (ambient/moderate/disturbing). Passed as a value so
   *  toggling mid-playback re-applies the gain on the live source without a
   *  full restart. */
  noiseLevel?: NoiseLevel;
  /** Selected TTS voice id (or null for server default). Read inside callbacks
   *  via the ref; passed as a value so a change triggers the swap useEffect. */
  voiceRef?: MutableRefObject<string | null>;
  voice?: string | null;
  /** The current language's voice catalog (id/name/gender), as a ref so the
   *  read-all dialog logic can assign a gender-matched voice per speaker. */
  voiceCatalogRef?: MutableRefObject<TtsVoiceOption[]>;
}

export interface UseTtsPlayerReturn {
  // --- State ---
  speaking: boolean;
  ttsFetching: boolean;
  fullTextPlaying: boolean;
  fullTextPaused: boolean;
  fullTextPrefetching: boolean;
  currentSentenceIndex: number;
  sentencePause: number;
  setSentencePause: React.Dispatch<React.SetStateAction<number>>;
  sentenceRepeat: number;
  setSentenceRepeat: React.Dispatch<React.SetStateAction<number>>;
  playbackSpeed: number;
  setPlaybackSpeed: React.Dispatch<React.SetStateAction<number>>;
  speedSwitching: boolean;
  voiceSwitching: boolean;
  history: string[];
  setHistory: React.Dispatch<React.SetStateAction<string[]>>;
  audioProgress: number;
  overallProgress: number;

  // --- Functions ---
  /** `cleanAudio` (default false): skip the acoustic-preset effect chain AND
   *  the background-noise loop for this one playback — used by flashcards,
   *  Examples popover etc. where the listening-comprehension effects make no
   *  sense and would carry over from a recent full-text session. */
  speakPhrase: (phraseToSpeak?: string, onEnded?: () => void, languageOverride?: string, cleanAudio?: boolean, voiceOverride?: string | null) => Promise<void>;
  prefetchSentences: (sentences: string[], langOverride?: string, voices?: (string | null)[]) => Promise<number>;
  startFullTextPlayback: () => Promise<void>;
  stopFullTextPlayback: () => void;
  pauseFullTextPlayback: () => void;
  resumeFullTextPlayback: () => void;
  nextSentence: () => void;
  prevSentence: () => void;
  stopAllAudio: () => void;
  startHeartbeat: () => (() => void);
  seekToProgress: (progress: number) => void;

  // --- Refs (exposed for external use) ---
  speakingRef: MutableRefObject<boolean>;
  sentencesRef: MutableRefObject<string[]>;
  sentencePauseRef: MutableRefObject<number>;
  sentenceRepeatRef: MutableRefObject<number>;
  playbackSpeedRef: MutableRefObject<number>;
  ttsCacheRef: MutableRefObject<Map<string, AudioBuffer>>;
  ttsRawCacheRef: MutableRefObject<Map<string, string>>;
  audioContextRef: MutableRefObject<AudioContext | null>;
  savedScrollYRef: MutableRefObject<number>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useTtsPlayer({
  text,
  textLanguage,
  sessionId,
  selection,
  effectiveTextLimit,
  logAction,
  showToast,
  setShowLimitReached,
  setShowTextLimitWarning,
  setDailyUsage,
  skipSyncCheckRef,
  checkServerSyncRef,
  loadWorkspaceStateRef,
  activeWorkspaceIdRef,
  textareaRef,
  acousticPresetRef,
  acousticPreset = 'none',
  noisePresetRef,
  noisePreset = 'none',
  noiseLevel = 'moderate',
  voiceRef,
  voice = null,
  voiceCatalogRef,
}: UseTtsPlayerParams): UseTtsPlayerReturn {

  // ── State ────────────────────────────────────────────────────────────────
  const [speaking, setSpeaking] = useState(false);
  const [ttsFetching, setTtsFetching] = useState(false);
  const [fullTextPlaying, setFullTextPlaying] = useState(false);
  const [fullTextPaused, setFullTextPaused] = useState(false);
  const [fullTextPrefetching, setFullTextPrefetching] = useState(false);
  const [currentSentenceIndex, setCurrentSentenceIndex] = useState(-1);
  const [sentencePause, setSentencePause] = useState(0);
  const [sentenceRepeat, setSentenceRepeat] = useState(1);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [history, setHistory] = useState<string[]>([]);
  const [audioProgress, setAudioProgress] = useState(0);

  // ── Refs ──────────────────────────────────────────────────────────────────
  const speakingRef = useRef(false);
  const fullTextPlayingRef = useRef(false);
  const fullTextPausedRef = useRef(false);
  const sentencePauseRef = useRef(0);
  const sentenceRepeatRef = useRef(1);
  // Keep the playback refs in sync with state from ANY setter — including the
  // per-workspace restore in useWorkspaces, which calls setSentencePause/
  // setSentenceRepeat directly (the toolbar buttons also set the refs eagerly).
  useEffect(() => { sentencePauseRef.current = sentencePause; }, [sentencePause]);
  useEffect(() => { sentenceRepeatRef.current = sentenceRepeat; }, [sentenceRepeat]);
  const playbackSpeedRef = useRef(1.0);
  const sentencePlayCountRef = useRef(0);
  const sentencesRef = useRef<string[]>([]);
  // Per-sentence voice override aligned by index with sentencesRef. Non-null for
  // dialog lines (the speaker's assigned voice, which overrides the panel voice);
  // null = use the panel voice. Holds the SPOKEN text in sentencesRef (name stripped).
  const sentenceVoicesRef = useRef<(string | null)[]>([]);
  // Per-text dialog caches (lowercased speaker → gender / assigned voice id).
  // Persist across replays so voices stay stable and audio is served from cache;
  // reset only when the language (and thus the voice catalog) changes.
  const speakerGenderRef = useRef<Map<string, Gender>>(new Map());
  const speakerVoiceRef = useRef<Map<string, string>>(new Map());
  const manualStopRef = useRef(false);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const savedScrollYRef = useRef<number>(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioDestNodeRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const audioBridgeRef = useRef<HTMLAudioElement | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const ttsCacheRef = useRef<Map<string, AudioBuffer>>(new Map());
  const ttsRawCacheRef = useRef<Map<string, string>>(new Map());
  const playbackStartTimeRef = useRef<number>(0);
  const playbackOffsetRef = useRef<number>(0);
  const currentBufferRef = useRef<AudioBuffer | null>(null);
  const onEndedCallbackRef = useRef<(() => void) | undefined>(undefined);
  const animationFrameRef = useRef<number | null>(null);
  const heartbeatRef = useRef<AudioBufferSourceNode | null>(null);
  const warmUpSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const playingSentenceRef = useRef<number>(-1);

  // Effect-chain + background-noise refs (helpers defined after getAudioDest)
  type EffectChain = { input: AudioNode; output: AudioNode };
  const effectChainCacheRef = useRef<Map<AcousticPreset, EffectChain | null>>(new Map());
  const irBufferCacheRef = useRef<Map<string, AudioBuffer | 'loading' | 'failed'>>(new Map());
  const noiseBufferCacheRef = useRef<Map<string, AudioBuffer | 'loading' | 'failed'>>(new Map());
  const bgNoiseSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const bgNoiseGainRef = useRef<GainNode | null>(null);

  // ── Keep refs in sync with state ─────────────────────────────────────────
  useEffect(() => { fullTextPlayingRef.current = fullTextPlaying; }, [fullTextPlaying]);
  useEffect(() => { speakingRef.current = speaking; }, [speaking]);
  useEffect(() => { fullTextPausedRef.current = fullTextPaused; }, [fullTextPaused]);
  const currentSentenceIndexRef = useRef(currentSentenceIndex);
  useEffect(() => { currentSentenceIndexRef.current = currentSentenceIndex; }, [currentSentenceIndex]);

  // ── Speed-switch swap flow ───────────────────────────────────────────────
  // When playbackSpeed changes mid-playback, the cache-miss path in the
  // sentence effect would otherwise skip all remaining sentences. Instead we
  // pause, prefetch the rest at the new speed, then resume from the next
  // sentence. Spinner UX is driven by the speedSwitching flag.
  const [speedSwitching, setSpeedSwitching] = useState(false);
  const speedSwitchTokenRef = useRef(0);
  // Debounce timer for the read-all speed change (lets rapid clicks settle), and
  // a flag marking that the current pause was triggered by a speed switch (so we
  // resume from it, vs. a manual pause which we must leave paused).
  const speedSwitchDebounceRef = useRef<number | null>(null);
  const speedPausedRef = useRef(false);

  // Voice-switch swap state, parallel to speedSwitching. The wrapped logic
  // lives in a useEffect on the `voice` prop further down (after
  // prefetchSentences and clearPendingSentenceTimer are defined).
  const [voiceSwitching, setVoiceSwitching] = useState(false);
  const voiceSwitchTokenRef = useRef(0);
  const previousVoiceRef = useRef<string | null>(voice);

  // Pending sentence-repeat / inter-pause timers. The sentence-effect's onEnded
  // schedules setTimeouts that call speakPhrase(oldPhrase) or advance the index
  // later. If a speed-switch (or any pause) clears playback state but doesn't
  // cancel these timers, a stale timeout can fire AFTER we've unpaused on the
  // new sentence — two speakPhrase calls land concurrently and we hear two
  // voices at different speeds. Track the latest timer ID so we can cancel it.
  const pendingSentenceTimerRef = useRef<number | null>(null);
  const clearPendingSentenceTimer = useCallback(() => {
    if (pendingSentenceTimerRef.current !== null) {
      clearTimeout(pendingSentenceTimerRef.current);
      pendingSentenceTimerRef.current = null;
    }
  }, []);

  // ── iOS audio bridge ─────────────────────────────────────────────────────
  // Bridge Web Audio → <audio> element so iOS keeps playback alive in background.
  // All sources connect to a master GainNode (not the destination directly) so
  // stopAllAudio can drop gain to 0 — guarantees silence on iOS Safari, where
  // .stop() / .disconnect() on a looping source can leak residual cyclic noise.
  const getAudioDest = useCallback((ctx: AudioContext): AudioNode => {
    if (audioDestNodeRef.current && audioBridgeRef.current && masterGainRef.current) {
      if (audioBridgeRef.current.paused) audioBridgeRef.current.play().catch(() => {});
      // Restore gain in case stopAllAudio attenuated it
      try { masterGainRef.current.gain.value = 1; } catch (_) {}
      return masterGainRef.current;
    }
    try {
      const dest = ctx.createMediaStreamDestination();
      const masterGain = ctx.createGain();
      masterGain.gain.value = 1;
      masterGain.connect(dest);
      const audio = new Audio();
      audio.srcObject = dest.stream;
      audio.play().catch(() => {});
      audioDestNodeRef.current = dest;
      audioBridgeRef.current = audio;
      masterGainRef.current = masterGain;
      return masterGain;
    } catch (_) {
      return ctx.destination;
    }
  }, []);

  const resetAudioBridge = useCallback(() => {
    if (audioBridgeRef.current) {
      audioBridgeRef.current.pause();
      audioBridgeRef.current.srcObject = null;
      audioBridgeRef.current = null;
    }
    audioDestNodeRef.current = null;
    masterGainRef.current = null;
  }, []);

  // ── Audio effects + background noise ─────────────────────────────────────
  // Listening-comprehension presets: phone-line distortion, simulated room
  // reverb (ConvolverNode + IR), and ambient background loops (street/café/
  // club). All effects are inserted between `source` and `masterGain`; the
  // bg-noise loop is a parallel source mixed into masterGain via its own gain.
  // Chains and loaded assets are cached on the AudioContext lifetime.
  const ACOUSTIC_ASSET: Partial<Record<AcousticPreset, string>> = {
    far: '/audio/effects/far.wav',
  };
  const NOISE_ASSET: Partial<Record<NoisePreset, string>> = {
    street: '/audio/noises/street.mp3',
    crowd: '/audio/noises/crowd.mp3',
  };
  // Mix level — applies the same dB attenuation regardless of which noise
  // preset is chosen, so the user has independent control over WHICH sound
  // and HOW LOUD. Calibrated by ear against normally-mastered ambient loops:
  //   ambient    -15 dB  notice it, easy to ignore
  //   moderate   -5  dB  clear competition with speech
  //   disturbing +3  dB  louder than speech, real strain
  const NOISE_LEVEL_DB: Record<NoiseLevel, number> = {
    ambient: -15, moderate: -5, disturbing: 3,
  };
  const noiseLevelRef = useRef<NoiseLevel>(noiseLevel);
  useEffect(() => { noiseLevelRef.current = noiseLevel; }, [noiseLevel]);
  // When the user cycles the level mid-playback, retune the live source
  // immediately instead of waiting for the next loop iteration.
  useEffect(() => {
    if (bgNoiseGainRef.current) {
      try { bgNoiseGainRef.current.gain.value = dbToLinear(NOISE_LEVEL_DB[noiseLevel]); } catch (_) {}
    }
  }, [noiseLevel]);
  const dbToLinear = (db: number) => (db === -Infinity ? 0 : Math.pow(10, db / 20));

  const loadAudioAsset = useCallback(async (
    ctx: AudioContext,
    url: string,
    cache: MutableRefObject<Map<string, AudioBuffer | 'loading' | 'failed'>>,
  ): Promise<AudioBuffer | null> => {
    const existing = cache.current.get(url);
    if (existing instanceof AudioBuffer) return existing;
    if (existing === 'loading' || existing === 'failed') return null;
    cache.current.set(url, 'loading');
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ab = await res.arrayBuffer();
      const buf = await ctx.decodeAudioData(ab);
      cache.current.set(url, buf);
      return buf;
    } catch (err) {
      console.warn(`[audio-effects] Failed to load ${url}, falling back to dry:`, err);
      cache.current.set(url, 'failed');
      return null;
    }
  }, []);

  /**
   * Returns the effect chain for the given preset, or null for 'none' (caller
   * connects source straight to masterGain). For IR-based presets, kicks off
   * an async fetch on first request; this and any subsequent call returns
   * null until the IR is decoded — at which point the next request returns
   * the chain. Net effect: first sentence under a wet preset plays dry,
   * subsequent sentences play wet.
   */
  const getEffectChain = useCallback((ctx: AudioContext, preset: AcousticPreset): EffectChain | null => {
    if (preset === 'none') return null;
    const cached = effectChainCacheRef.current.get(preset);
    if (cached !== undefined) return cached;

    if (preset === 'phone') {
      // POTS-ish ~300-3400 Hz: bandpass centre 1500 Hz with Q=0.7 (~−3 dB
      // octave on each side) plus mild tanh saturation. Subtler than CB —
      // narrows the voice without obvious distortion.
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1500;
      bp.Q.value = 0.7;
      const shaper = ctx.createWaveShaper();
      const curve = new Float32Array(512);
      for (let i = 0; i < 512; i++) {
        const x = (i / 256) - 1;
        curve[i] = Math.tanh(x * 2.5) / Math.tanh(2.5);
      }
      shaper.curve = curve;
      shaper.oversample = '4x';
      bp.connect(shaper);
      const chain: EffectChain = { input: bp, output: shaper };
      effectChainCacheRef.current.set('phone', chain);
      return chain;
    }

    if (preset === 'cb_radio') {
      // Walkie-talkie / CB feel: narrow bandpass ~300–3000 Hz centred ~1200 Hz
      // (Q=1.2 — narrower than typical phone) followed by heavy tanh saturation
      // (drive 6 vs phone's 2.5) to get that crunchy, compressed comms sound.
      // preGain pushes into the saturator; postGain compensates for the level
      // bump so it doesn't dominate the master mix.
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1200;
      bp.Q.value = 1.2;
      const preGain = ctx.createGain();
      preGain.gain.value = 4;
      const shaper = ctx.createWaveShaper();
      const curve = new Float32Array(512);
      for (let i = 0; i < 512; i++) {
        const x = (i / 256) - 1;
        curve[i] = Math.tanh(x * 6) / Math.tanh(6);
      }
      shaper.curve = curve;
      shaper.oversample = '4x';
      const postGain = ctx.createGain();
      postGain.gain.value = 0.6;
      bp.connect(preGain);
      preGain.connect(shaper);
      shaper.connect(postGain);
      const chain: EffectChain = { input: bp, output: postGain };
      effectChainCacheRef.current.set('cb_radio', chain);
      return chain;
    }

    const url = ACOUSTIC_ASSET[preset];
    if (!url) return null;
    // Kick off async load; return null this call. Whatever fired this request
    // will play dry. Once the load resolves we cache the chain so the NEXT
    // call returns the wet version.
    loadAudioAsset(ctx, url, irBufferCacheRef).then(ir => {
      if (!ir) {
        effectChainCacheRef.current.set(preset, null);
        return;
      }
      const conv = ctx.createConvolver();
      conv.buffer = ir;
      const wetGain = ctx.createGain();
      wetGain.gain.value = 1;
      conv.connect(wetGain);
      effectChainCacheRef.current.set(preset, { input: conv, output: wetGain });
    });
    return null;
  }, [loadAudioAsset]);

  /**
   * Connect a freshly-created source to either the effect chain or directly
   * to masterGain, depending on the current acoustic preset.
   */
  const connectSourceToDest = useCallback((ctx: AudioContext, source: AudioBufferSourceNode, bypassEffects = false) => {
    const preset = bypassEffects ? 'none' : (acousticPresetRef?.current ?? 'none');
    const chain = getEffectChain(ctx, preset);
    if (chain) {
      source.connect(chain.input);
      chain.output.connect(getAudioDest(ctx));
    } else {
      source.connect(getAudioDest(ctx));
    }
  }, [acousticPresetRef, getEffectChain, getAudioDest]);

  /** Start the background-noise loop for the given preset. Idempotent: stops
   *  any existing loop first. No-op for 'none'. */
  const startBackgroundNoise = useCallback(async (ctx: AudioContext) => {
    const preset = noisePresetRef?.current ?? 'none';
    if (bgNoiseSourceRef.current) {
      try { bgNoiseSourceRef.current.stop(); } catch (_) {}
      try { bgNoiseSourceRef.current.disconnect(); } catch (_) {}
      bgNoiseSourceRef.current = null;
    }
    if (bgNoiseGainRef.current) {
      try { bgNoiseGainRef.current.disconnect(); } catch (_) {}
      bgNoiseGainRef.current = null;
    }
    if (preset === 'none') return;
    const url = NOISE_ASSET[preset];
    if (!url) return;
    const buf = await loadAudioAsset(ctx, url, noiseBufferCacheRef);
    if (!buf) return;
    if (manualStopRef.current) return;
    try {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const gain = ctx.createGain();
      gain.gain.value = dbToLinear(NOISE_LEVEL_DB[noiseLevelRef.current]);
      src.connect(gain);
      gain.connect(getAudioDest(ctx));
      src.start();
      bgNoiseSourceRef.current = src;
      bgNoiseGainRef.current = gain;
    } catch (err) {
      console.warn('[audio-effects] startBackgroundNoise failed:', err);
    }
  }, [noisePresetRef, loadAudioAsset, getAudioDest]);

  const stopBackgroundNoise = useCallback(() => {
    if (bgNoiseSourceRef.current) {
      try { bgNoiseSourceRef.current.stop(); } catch (_) {}
      try { bgNoiseSourceRef.current.disconnect(); } catch (_) {}
      bgNoiseSourceRef.current = null;
    }
    if (bgNoiseGainRef.current) {
      try { bgNoiseGainRef.current.disconnect(); } catch (_) {}
      bgNoiseGainRef.current = null;
    }
  }, []);

  // Stop the bg-noise loop whenever fullTextPlaying transitions to false —
  // catches the natural end-of-text completion path that doesn't go through
  // stopFullTextPlayback, plus any other termination route.
  useEffect(() => {
    if (!fullTextPlaying) stopBackgroundNoise();
  }, [fullTextPlaying, stopBackgroundNoise]);

  // Swap the bg-noise loop when the preset changes mid-playback. startBackgroundNoise
  // is idempotent (stops the old source, starts the new one, or just stops if 'none').
  useEffect(() => {
    if (!fullTextPlaying) return;
    const ctx = audioContextRef.current;
    if (!ctx) return;
    startBackgroundNoise(ctx).catch(err => console.warn('[audio-effects] bg noise swap failed:', err));
  }, [noisePreset, fullTextPlaying, startBackgroundNoise]);

  // ── Acoustic preset restart-current-sentence ─────────────────────────────
  // The effect chain is baked into the AudioBufferSourceNode at source.start()
  // time, so changing acousticPreset mid-playback would otherwise only take
  // effect on the NEXT sentence — and would play that sentence dry if the new
  // preset's IR hadn't finished loading yet. Instead: stop the current source
  // immediately, pre-warm the IR, then re-trigger the sentence effect at the
  // SAME index so the sentence replays with the new chain attached. A
  // token guards rapid taps so only the latest preset replays.
  const previousAcousticPresetRef = useRef<AcousticPreset>(acousticPreset);
  const [effectRestartCounter, setEffectRestartCounter] = useState(0);
  const effectSwitchTokenRef = useRef(0);
  useEffect(() => {
    if (previousAcousticPresetRef.current === acousticPreset) return;
    previousAcousticPresetRef.current = acousticPreset;
    if (!fullTextPlayingRef.current || fullTextPausedRef.current) return;
    const idx = currentSentenceIndexRef.current;
    if (idx < 0 || idx >= sentencesRef.current.length) return;

    const token = ++effectSwitchTokenRef.current;

    clearPendingSentenceTimer();
    manualStopRef.current = true;
    playingSentenceRef.current = -1;
    if (currentSourceRef.current) {
      try { currentSourceRef.current.onended = null; } catch (_) {}
      try { currentSourceRef.current.stop(); } catch (_) {}
      currentSourceRef.current = null;
    }
    currentBufferRef.current = null;
    speakingRef.current = false;
    setSpeaking(false);

    (async () => {
      const ctx = audioContextRef.current;
      const url = ACOUSTIC_ASSET[acousticPreset];
      // Pre-warm the convolver chain for IR-based presets. For 'none',
      // 'phone', and 'cb_radio' the chain has no async asset.
      if (ctx && url && !effectChainCacheRef.current.has(acousticPreset)) {
        const ir = await loadAudioAsset(ctx, url, irBufferCacheRef);
        if (effectSwitchTokenRef.current !== token) return;
        if (ir) {
          const conv = ctx.createConvolver();
          conv.buffer = ir;
          const wetGain = ctx.createGain();
          wetGain.gain.value = 1;
          conv.connect(wetGain);
          effectChainCacheRef.current.set(acousticPreset, { input: conv, output: wetGain });
        } else {
          effectChainCacheRef.current.set(acousticPreset, null);
        }
      }
      if (effectSwitchTokenRef.current !== token) return;
      if (!fullTextPlayingRef.current) return;
      manualStopRef.current = false;
      // Bump the counter — sentence effect's dep list includes it, so the
      // current index gets re-played with the new chain attached.
      setEffectRestartCounter(c => c + 1);
    })();
  }, [acousticPreset, clearPendingSentenceTimer, loadAudioAsset]);

  // ── iOS: recover from AudioContext interruption after screen lock ────────
  useEffect(() => {
    const handleVisibilityResume = async () => {
      if (document.visibilityState !== 'visible') return;
      const ctx = audioContextRef.current;
      if (!ctx) return;

      if (ctx.state !== 'running') {
        try { await ctx.resume(); } catch (_) {}
      }

      if (currentSourceRef.current) {
        setTimeout(() => {
          if (currentSourceRef.current && currentBufferRef.current) {
            const elapsed = ctx.currentTime - playbackStartTimeRef.current + playbackOffsetRef.current;
            const duration = currentBufferRef.current.duration;
            if (elapsed >= duration || ctx.state !== 'running') {
              try { currentSourceRef.current.stop(); } catch (_) {}
              currentSourceRef.current = null;
              currentBufferRef.current = null;
              speakingRef.current = false;
              setSpeaking(false);
              setAudioProgress(0);
              if (warmUpSourceRef.current) { try { warmUpSourceRef.current.stop(); } catch (_) {} warmUpSourceRef.current = null; }
              if (fullTextPlayingRef.current) {
                if (heartbeatRef.current) { try { heartbeatRef.current.stop(); } catch (_) {} heartbeatRef.current = null; }
                manualStopRef.current = true;
                playingSentenceRef.current = -1;
                setFullTextPlaying(false);
                setFullTextPaused(false);
                setCurrentSentenceIndex(-1);
              }
              if (audioBridgeRef.current) { audioBridgeRef.current.pause(); }
            }
          }
        }, TIMEOUTS.IOS_AUDIO_FIX);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityResume);
    return () => document.removeEventListener('visibilitychange', handleVisibilityResume);
  }, []);

  // ── Ensure AudioContext is created & running ─────────────────────────────
  const ensureAudioContext = useCallback(async (): Promise<AudioContext> => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    let ctx = audioContextRef.current;
    if (ctx.state !== 'running') {
      try { await ctx.resume(); } catch (_) {}
    }
    if (ctx.state !== 'running') {
      try { ctx.close(); } catch (_) {}
      resetAudioBridge();
      ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = ctx;
      ttsCacheRef.current = new Map();
    }
    return ctx;
  }, [resetAudioBridge]);

  // ── speakPhrase ──────────────────────────────────────────────────────────
  const speakPhrase = useCallback(async (phraseToSpeak?: string, onEnded?: () => void, languageOverride?: string, cleanAudio = false, voiceOverride?: string | null) => {
    const phrase = phraseToSpeak || selection;
    if (!phrase || speakingRef.current) return;
    if (text.length > effectiveTextLimit) {
      setShowTextLimitWarning(true);
      return;
    }

    // Flashcards / Examples popover etc. opt in to clean playback: skip the
    // acoustic-preset effect chain AND tear down any background-noise loop
    // that may have outlived a recent full-text listening session.
    if (cleanAudio) stopBackgroundNoise();

    // Clear any sticky manualStop from a prior stopAllAudio. manualStopRef is
    // normally reset by handleEnded when an audio source ends — but if
    // stopAllAudio ran with no source playing (e.g. user paused during the
    // inter-phrase delay), no onended fires and the flag stays stuck at true.
    // Without this reset, the manualStopRef checks below would block every
    // subsequent playback. Subsequent stopAllAudio calls during the awaits
    // below will re-set the flag and trigger the bailouts as intended.
    manualStopRef.current = false;

    // Pre-action conflict check (skipped during full-text playback)
    if (!skipSyncCheckRef.current) {
      const syncResult = await checkServerSyncRef.current();
      if (syncResult === 'sync') {
        const sid = localStorage.getItem('session_id');
        if (sid && activeWorkspaceIdRef.current) await loadWorkspaceStateRef.current(sid, activeWorkspaceIdRef.current);
      }
    }

    const effectiveLang = languageOverride || textLanguage;
    const speed = playbackSpeedRef.current ?? 1.0;
    // A dialog speaker's voice (voiceOverride) wins over the panel voice.
    const effectiveVoice = voiceOverride || voiceRef?.current || null;
    const voiceKey = effectiveVoice ?? '-';
    const cacheKey = `${effectiveLang}:${voiceKey}:${speed}:${phrase}`;
    onEndedCallbackRef.current = onEnded;

    const audioContext = await ensureAudioContext();

    // If a stop was requested while awaiting (e.g. user closed flashcard modal), bail out
    // before creating a new looping warmUpSource that could be orphaned.
    if (manualStopRef.current) {
      speakingRef.current = false;
      setSpeaking(false);
      return;
    }

    // Start a LOOPING inaudible tone to keep the audio hardware active
    if (warmUpSourceRef.current) { try { warmUpSourceRef.current.stop(); } catch (_) {} }
    const warmUpSource = audioContext.createBufferSource();
    const wuBuf = audioContext.createBuffer(1, audioContext.sampleRate, audioContext.sampleRate);
    const wuCh = wuBuf.getChannelData(0);
    for (let i = 0; i < wuCh.length; i++) wuCh[i] = Math.sin(i * 2 * Math.PI * 440 / audioContext.sampleRate) * 0.0001;
    warmUpSource.buffer = wuBuf;
    warmUpSource.loop = true;
    warmUpSource.connect(getAudioDest(audioContext));
    warmUpSource.start();
    warmUpSourceRef.current = warmUpSource;

    const handleEnded = () => {
      speakingRef.current = false;
      setSpeaking(false);
      setAudioProgress(0);
      currentBufferRef.current = null;
      currentSourceRef.current = null;
      if (onEnded && !manualStopRef.current) {
        onEnded();
      }
      manualStopRef.current = false;
    };

    // If raw PCM is cached but decoded buffer is not, decode it now
    if (!ttsCacheRef.current.has(cacheKey) && ttsRawCacheRef.current.has(cacheKey)) {
      const raw = ttsRawCacheRef.current.get(cacheKey)!;
      const rawRes = await fetch(`data:application/octet-stream;base64,${raw}`);
      const rawArrayBuffer = await rawRes.arrayBuffer();
      const rawPcmData = new Int16Array(rawArrayBuffer, 0, Math.floor(rawArrayBuffer.byteLength / 2));
      const restoredBuf = pcmToAudioBuffer(audioContext, rawPcmData);
      ttsCacheRef.current.set(cacheKey, restoredBuf);
    }

    // Check cache first
    if (ttsCacheRef.current.has(cacheKey)) {
      logAction('tts_play_cached', phrase);
      const cachedBuffer = ttsCacheRef.current.get(cacheKey)!;
      warmUpSource.stop(); warmUpSourceRef.current = null;
      if (manualStopRef.current) {
        speakingRef.current = false;
        setSpeaking(false);
        return;
      }
      const source = audioContext.createBufferSource();
      currentSourceRef.current = source;
      source.buffer = cachedBuffer;
      connectSourceToDest(audioContext, source, cleanAudio);
      source.onended = handleEnded;
      currentBufferRef.current = cachedBuffer;
      playbackStartTimeRef.current = audioContext.currentTime;
      playbackOffsetRef.current = 0;
      source.start();
      speakingRef.current = true;
      setSpeaking(true);
      return;
    }

    speakingRef.current = true;
    setSpeaking(true);
    setTtsFetching(true);
    try {
      const ttsResponse = await Promise.race([
        fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(sessionId ? { 'X-Session-Id': sessionId } : {}) },
          body: JSON.stringify({ text: phrase, textLanguage: effectiveLang, speed, ...(effectiveVoice ? { voice: effectiveVoice } : {}) }),
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('TTS timeout')), TIMEOUTS.TTS_FETCH)
        ),
      ]);

      if (!ttsResponse.ok) {
        if (ttsResponse.status === 429) {
          const body = await ttsResponse.json().catch(() => ({}));
          if (body.error === 'quota_exceeded') {
            setShowLimitReached(true);
            speakingRef.current = false;
            setSpeaking(false);
            setTtsFetching(false);
            return;
          }
        }
        throw new Error(`TTS API error: ${ttsResponse.status}`);
      }

      const data = await ttsResponse.json();
      const base64Audio = data.audio;

      if (!base64Audio) {
        warmUpSource.stop(); warmUpSourceRef.current = null;
        speakingRef.current = false;
        setSpeaking(false);
        throw new Error('No audio data returned from TTS service');
      }

      const res = await fetch(`data:application/octet-stream;base64,${base64Audio}`);
      const arrayBuffer = await res.arrayBuffer();
      const pcmData = new Int16Array(arrayBuffer, 0, Math.floor(arrayBuffer.byteLength / 2));
      const audioBuffer = pcmToAudioBuffer(audioContext, pcmData);

      ttsCacheRef.current.set(cacheKey, audioBuffer);
      ttsRawCacheRef.current.set(cacheKey, base64Audio);
      if (!languageOverride) setHistory(prev => prev.includes(phrase) ? prev : [...prev, phrase]);
      setDailyUsage(prev => ({ ...prev, tts: prev.tts + 1 }));

      if (audioContext.state !== 'running') {
        await audioContext.resume();
      }

      warmUpSource.stop(); warmUpSourceRef.current = null;
      setTtsFetching(false);

      if (manualStopRef.current) {
        speakingRef.current = false;
        setSpeaking(false);
        return;
      }

      const source = audioContext.createBufferSource();
      currentSourceRef.current = source;
      source.buffer = audioBuffer;
      connectSourceToDest(audioContext, source, cleanAudio);
      source.onended = handleEnded;
      currentBufferRef.current = audioBuffer;
      playbackStartTimeRef.current = audioContext.currentTime;
      playbackOffsetRef.current = 0;
      source.start();
    } catch (err) {
      console.error('TTS Error:', err);
      warmUpSource.stop(); warmUpSourceRef.current = null;
      setTtsFetching(false);
      speakingRef.current = false;
      setSpeaking(false);
      showToast(err instanceof Error ? err.message : String(err));
      if (onEnded) onEnded();
    }
  }, [selection, textLanguage, showToast, text.length, effectiveTextLimit, sessionId, logAction, setShowLimitReached, setShowTextLimitWarning, setDailyUsage, skipSyncCheckRef, checkServerSyncRef, loadWorkspaceStateRef, activeWorkspaceIdRef, ensureAudioContext, getAudioDest, stopBackgroundNoise]);

  // ── prefetchSentences ────────────────────────────────────────────────────
  const prefetchSentences = useCallback(async (sentences: string[], langOverride?: string, voices?: (string | null)[]): Promise<number> => {
    const effectiveLang = langOverride || textLanguage;
    const speed = playbackSpeedRef.current ?? 1.0;
    const audioContext = await ensureAudioContext();
    // Per-sentence voice: a dialog override (voices[i]) wins over the panel voice.
    const voiceFor = (i: number): string | null => (voices?.[i] || voiceRef?.current || null);
    const keyFor = (i: number, s: string) => `${effectiveLang}:${voiceFor(i) ?? '-'}:${speed}:${s}`;

    // Restore AudioBuffers from raw cache for sentences that were previously fetched
    for (let i = 0; i < sentences.length; i++) {
      const ck = keyFor(i, sentences[i]);
      if (!ttsCacheRef.current.has(ck) && ttsRawCacheRef.current.has(ck)) {
        try {
          const raw = ttsRawCacheRef.current.get(ck)!;
          const res = await fetch(`data:application/octet-stream;base64,${raw}`);
          const ab = await res.arrayBuffer();
          const pcm = new Int16Array(ab, 0, Math.floor(ab.byteLength / 2));
          ttsCacheRef.current.set(ck, pcmToAudioBuffer(audioContext, pcm));
        } catch { /* ignore decode errors, will re-fetch */ }
      }
    }
    const uncachedIdx = sentences.map((_, i) => i).filter(i => !ttsCacheRef.current.has(keyFor(i, sentences[i])));
    let failCount = 0;
    await Promise.all(uncachedIdx.map(async (i) => {
      const phrase = sentences[i];
      const ck = keyFor(i, phrase);
      const voiceForThis = voiceFor(i);
      try {
        const ttsResponse = await Promise.race([
          fetch('/api/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(sessionId ? { 'X-Session-Id': sessionId } : {}) },
            body: JSON.stringify({ text: phrase, textLanguage: effectiveLang, speed, ...(voiceForThis ? { voice: voiceForThis } : {}) }),
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('TTS timeout')), TIMEOUTS.TTS_FETCH)
          ),
        ]);

        if (!ttsResponse.ok) {
          if (ttsResponse.status === 429) {
            const body = await ttsResponse.json().catch(() => ({}));
            if (body.error === 'quota_exceeded') {
              setShowLimitReached(true);
              throw new Error('quota_exceeded');
            }
          }
          throw new Error(`TTS API error: ${ttsResponse.status}`);
        }

        const data = await ttsResponse.json();
        const base64Audio = data.audio;
        if (!base64Audio) throw new Error('No audio data returned from TTS service');

        const res = await fetch(`data:application/octet-stream;base64,${base64Audio}`);
        const arrayBuffer = await res.arrayBuffer();
        const pcmData = new Int16Array(arrayBuffer, 0, Math.floor(arrayBuffer.byteLength / 2));
        const buf = pcmToAudioBuffer(audioContext, pcmData);
        ttsCacheRef.current.set(ck, buf);
        ttsRawCacheRef.current.set(ck, base64Audio);
        setDailyUsage(prev => ({ ...prev, tts: prev.tts + 1 }));
      } catch (err) {
        console.error('TTS prefetch error:', err);
        failCount++;
      }
    }));
    // Add to history in text order after all parallel fetches settle
    if (!langOverride) {
      setHistory(prev => {
        const toAdd = sentences.filter(s => !prev.includes(s));
        return [...prev, ...toAdd];
      });
    }
    return failCount;
  }, [textLanguage, sessionId, ensureAudioContext, setShowLimitReached, setDailyUsage]);

  // ── handleSetPlaybackSpeed ───────────────────────────────────────────────
  // Wraps the raw setter so a mid-playback speed change pauses, prefetches
  // the remaining sentences at the new speed, and resumes from the next
  // sentence — instead of letting the cache-miss bail skip through them.
  const handleSetPlaybackSpeed = useCallback<React.Dispatch<React.SetStateAction<number>>>((value) => {
    const newSpeed = typeof value === 'function'
      ? (value as (prev: number) => number)(playbackSpeedRef.current)
      : value;
    if (newSpeed === playbackSpeedRef.current) return;
    playbackSpeedRef.current = newSpeed;
    setPlaybackSpeed(newSpeed);

    // Only swap during active playback. If the user MANUALLY paused, just record
    // the new speed (applied when they resume) — don't auto-resume.
    if (!fullTextPlayingRef.current) return;
    if (fullTextPausedRef.current && !speedPausedRef.current) return;
    if (currentSentenceIndexRef.current + 1 >= sentencesRef.current.length) return;

    // Pause cleanly NOW so audio doesn't keep advancing (and skipping at the new
    // speed's cache miss) while the user is still picking a speed. Same teardown
    // as pauseFullTextPlayback; refs synced manually because setFullTextPaused
    // is async and the source's onended reads fullTextPausedRef synchronously.
    if (!fullTextPausedRef.current) {
      speedPausedRef.current = true;
      clearPendingSentenceTimer();
      manualStopRef.current = true;
      playingSentenceRef.current = -1;
      fullTextPausedRef.current = true;
      setFullTextPaused(true);
      if (currentSourceRef.current) { try { currentSourceRef.current.onended = null; } catch (_) {} try { currentSourceRef.current.stop(); } catch (_) {} currentSourceRef.current = null; }
      currentBufferRef.current = null;
      speakingRef.current = false;
      setSpeaking(false);
      if (audioBridgeRef.current) audioBridgeRef.current.pause();
    }

    // Debounce the expensive re-fetch + resume: rapid speed clicks reset the
    // timer, so TTS for the new speed is only requested once the user stops.
    if (speedSwitchDebounceRef.current) clearTimeout(speedSwitchDebounceRef.current);
    speedSwitchDebounceRef.current = window.setTimeout(() => {
      speedSwitchDebounceRef.current = null;
      speedPausedRef.current = false;
      if (!fullTextPlayingRef.current) return; // user stopped meanwhile
      const resumeFromIdx = currentSentenceIndexRef.current + 1;
      if (resumeFromIdx >= sentencesRef.current.length) return;

      const token = ++speedSwitchTokenRef.current;
      setSpeedSwitching(true);
      const remaining = sentencesRef.current.slice(resumeFromIdx);
      const remainingVoices = sentenceVoicesRef.current.slice(resumeFromIdx);
      (async () => {
        try { await prefetchSentences(remaining, undefined, remainingVoices); } catch (_) { /* bail will skip uncached */ }
        if (speedSwitchTokenRef.current !== token) return; // a newer switch superseded this
        if (!fullTextPlayingRef.current) return; // user stopped meanwhile
        manualStopRef.current = false;
        setSpeedSwitching(false);
        setCurrentSentenceIndex(resumeFromIdx);
        fullTextPausedRef.current = false;
        setFullTextPaused(false);
      })();
    }, TIMEOUTS.SPEED_SWITCH_DEBOUNCE);
  }, [prefetchSentences, clearPendingSentenceTimer]);

  // ── Voice swap on `voice` prop change ────────────────────────────────────
  // Mirrors the speed-switch flow: pause, prefetch remaining at the new
  // voice, resume from the next sentence. Triggers only on actual changes
  // after mount (previousVoiceRef gates the first render). voiceRef has
  // already been updated synchronously by App.tsx's setCurrentVoice, so
  // prefetchSentences picks up the new voice through it.
  useEffect(() => {
    if (previousVoiceRef.current === voice) return;
    previousVoiceRef.current = voice;
    if (!fullTextPlayingRef.current || fullTextPausedRef.current) return;
    const resumeFromIdx = currentSentenceIndexRef.current + 1;
    if (resumeFromIdx >= sentencesRef.current.length) return;

    const token = ++voiceSwitchTokenRef.current;
    setVoiceSwitching(true);

    clearPendingSentenceTimer();
    manualStopRef.current = true;
    playingSentenceRef.current = -1;
    fullTextPausedRef.current = true;
    setFullTextPaused(true);
    if (currentSourceRef.current) {
      try { currentSourceRef.current.onended = null; } catch (_) {}
      try { currentSourceRef.current.stop(); } catch (_) {}
      currentSourceRef.current = null;
    }
    currentBufferRef.current = null;
    speakingRef.current = false;
    setSpeaking(false);
    if (audioBridgeRef.current) audioBridgeRef.current.pause();

    const remaining = sentencesRef.current.slice(resumeFromIdx);
    const remainingVoices = sentenceVoicesRef.current.slice(resumeFromIdx);
    (async () => {
      try { await prefetchSentences(remaining, undefined, remainingVoices); } catch (_) { /* bail will skip uncached */ }
      if (voiceSwitchTokenRef.current !== token) return;
      if (!fullTextPlayingRef.current) return;
      manualStopRef.current = false;
      setVoiceSwitching(false);
      setCurrentSentenceIndex(resumeFromIdx);
      fullTextPausedRef.current = false;
      setFullTextPaused(false);
    })();
  }, [voice, prefetchSentences, clearPendingSentenceTimer]);

  // Reset the dialog speaker→gender/voice maps when the language changes — the
  // voice catalog and gender context differ, so assignments must be re-made.
  // (A mere replay keeps them, so voices stay stable and audio stays cached.)
  useEffect(() => {
    speakerGenderRef.current = new Map();
    speakerVoiceRef.current = new Map();
  }, [textLanguage]);

  // ── buildDialogPlaylist ──────────────────────────────────────────────────
  // Turn the text into the read-all playlist: an array of spoken sentences plus
  // a parallel array of per-sentence voice overrides. Lines of the form
  // `Speaker: phrase` are detected; the speaker name is stripped from the spoken
  // text and each speaker is assigned a gender-matched, distinct voice (inferred
  // once via /api/infer-genders, then cached). Non-dialog lines get a null voice
  // (panel voice). For non-dialog text this yields the same sentences as before.
  const buildDialogPlaylist = useCallback(async (limitedText: string): Promise<{ texts: string[]; voices: (string | null)[] }> => {
    const lines = limitedText.split(/\n+/).filter(l => l.trim().length > 0);
    const parsed = lines.map(line => ({ line, dialog: parseDialogLine(line) }));
    const catalog = voiceCatalogRef?.current ?? [];
    const speakers = Array.from(new Set(parsed.filter(p => p.dialog).map(p => p.dialog!.speaker)));

    // 1) Infer gender for speakers we don't already know (only when we have a
    //    catalog to map onto). Best-effort; failures degrade to neutral→random.
    const unknown = speakers.filter(s => !speakerGenderRef.current.has(s.toLowerCase()));
    if (unknown.length > 0 && catalog.length > 0) {
      try {
        const resp = await fetch('/api/infer-genders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(sessionId ? { 'X-Session-Id': sessionId } : {}) },
          body: JSON.stringify({ names: unknown, textLanguage }),
        });
        const data = resp.ok ? await resp.json() : { genders: {} };
        for (const name of unknown) {
          const g = data?.genders?.[name];
          speakerGenderRef.current.set(name.toLowerCase(), g === 'male' || g === 'female' ? g : 'neutral');
        }
      } catch {
        for (const name of unknown) speakerGenderRef.current.set(name.toLowerCase(), 'neutral');
      }
    }

    // 2) Assign a voice per speaker ONCE; reuse existing assignments so voices
    //    stay stable across replays (and the audio cache keeps hitting).
    if (catalog.length > 0) {
      const used = new Set<string>(speakerVoiceRef.current.values());
      for (const s of speakers) {
        const key = s.toLowerCase();
        if (speakerVoiceRef.current.has(key)) continue;
        const gender = speakerGenderRef.current.get(key) ?? 'neutral';
        const voiceId = pickVoiceForGender(catalog, gender, used);
        if (voiceId) { speakerVoiceRef.current.set(key, voiceId); used.add(voiceId); }
      }
    }

    // 3) Flatten to sentence chunks (name stripped), carrying the speaker voice.
    const texts: string[] = [];
    const voices: (string | null)[] = [];
    for (const { line, dialog } of parsed) {
      // Drop "(...)" asides before sentence-splitting so they aren't read aloud
      // (and so a period inside the brackets doesn't break the split).
      const phrase = stripParentheticals(dialog ? dialog.phrase : line);
      const voice = dialog ? speakerVoiceRef.current.get(dialog.speaker.toLowerCase()) ?? null : null;
      const sentences = phrase.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 0);
      for (const s of sentences) { texts.push(s); voices.push(voice); }
    }
    return { texts, voices };
  }, [voiceCatalogRef, sessionId, textLanguage]);

  // ── stopAllAudio ─────────────────────────────────────────────────────────
  const stopAllAudio = useCallback(() => {
    manualStopRef.current = true;
    playingSentenceRef.current = -1;
    // iOS Safari: drop master gain to 0. Even if .stop()/.disconnect() on a
    // looping source misbehaves and leaks residual audio, the gain mutes it.
    // getAudioDest restores gain to 1 on the next speakPhrase call.
    if (masterGainRef.current) {
      try { masterGainRef.current.gain.value = 0; } catch (_) {}
    }
    // Belt-and-suspenders: disconnect before stop. Disconnecting first severs
    // the graph immediately in case .stop() doesn't fully halt playback.
    if (heartbeatRef.current) {
      try { heartbeatRef.current.disconnect(); } catch (_) {}
      try { heartbeatRef.current.stop(); } catch (_) {}
      heartbeatRef.current = null;
    }
    if (currentSourceRef.current) {
      try { currentSourceRef.current.onended = null; } catch (_) {}
      try { currentSourceRef.current.disconnect(); } catch (_) {}
      try { currentSourceRef.current.stop(); } catch (_) {}
      currentSourceRef.current = null;
    }
    if (warmUpSourceRef.current) {
      try { warmUpSourceRef.current.disconnect(); } catch (_) {}
      try { warmUpSourceRef.current.stop(); } catch (_) {}
      warmUpSourceRef.current = null;
    }
    currentBufferRef.current = null;
    speakingRef.current = false;
    setSpeaking(false);
    setFullTextPlaying(false);
    setFullTextPaused(false);
    setCurrentSentenceIndex(-1);
  }, []);

  // ── startHeartbeat ───────────────────────────────────────────────────────
  const startHeartbeat = useCallback((): (() => void) => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    const ctx = audioContextRef.current;
    if (ctx.state !== 'running') { try { ctx.resume(); } catch (_) {} }
    const hb = ctx.createBufferSource();
    const hbBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const hbCh = hbBuf.getChannelData(0);
    for (let i = 0; i < hbCh.length; i++) hbCh[i] = Math.sin(i * 2 * Math.PI * 440 / ctx.sampleRate) * 0.0001;
    hb.buffer = hbBuf;
    hb.loop = true;
    hb.connect(getAudioDest(ctx));
    hb.start();
    heartbeatRef.current = hb;
    manualStopRef.current = false;
    return () => {
      if (heartbeatRef.current) { try { heartbeatRef.current.stop(); } catch (_) {} heartbeatRef.current = null; }
    };
  }, [getAudioDest]);

  // ── startFullTextPlayback ────────────────────────────────────────────────
  const startFullTextPlayback = useCallback(async () => {
    if (text.length > effectiveTextLimit) {
      setShowTextLimitWarning(true);
      return;
    }
    if (speedSwitchDebounceRef.current) { clearTimeout(speedSwitchDebounceRef.current); speedSwitchDebounceRef.current = null; }
    speedPausedRef.current = false;

    const syncResult = await checkServerSyncRef.current();
    if (syncResult === 'sync') {
      const sid = localStorage.getItem('session_id');
      if (sid && activeWorkspaceIdRef.current) await loadWorkspaceStateRef.current(sid, activeWorkspaceIdRef.current);
    }

    const currentText = textareaRef.current?.value ?? text;
    const limitedText = currentText.slice(0, getTextLimit(textLanguage));
    if (limitedText.trim().length === 0) return;
    logAction('tts_play_full');
    manualStopRef.current = false;
    skipSyncCheckRef.current = true;
    playingSentenceRef.current = -1;

    const ctx = await ensureAudioContext();

    const hb = ctx.createBufferSource();
    const hbBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const hbCh = hbBuf.getChannelData(0);
    for (let i = 0; i < hbCh.length; i++) hbCh[i] = Math.sin(i * 2 * Math.PI * 440 / ctx.sampleRate) * 0.0001;
    hb.buffer = hbBuf;
    hb.loop = true;
    hb.connect(getAudioDest(ctx));
    hb.start();
    heartbeatRef.current = hb;
    setFullTextPrefetching(true);
    try {
      // Build the dialog-aware playlist (per-speaker voices, names stripped).
      // Also runs the gender-inference call, so keep it inside the spinner.
      const { texts: sents, voices } = await buildDialogPlaylist(limitedText);
      if (sents.length === 0) {
        setFullTextPrefetching(false);
        if (heartbeatRef.current) { try { heartbeatRef.current.stop(); } catch (_) {} heartbeatRef.current = null; }
        return;
      }
      sentencesRef.current = sents;
      sentenceVoicesRef.current = voices;
      const failCount = await prefetchSentences(sents, undefined, voices);
      setFullTextPrefetching(false);
      if (manualStopRef.current) {
        if (heartbeatRef.current) { try { heartbeatRef.current.stop(); } catch (_) {} heartbeatRef.current = null; }
        return;
      }
      if (failCount === sents.length) {
        if (heartbeatRef.current) { try { heartbeatRef.current.stop(); } catch (_) {} heartbeatRef.current = null; }
        showToast('TTS: failed to load audio for full text');
        return;
      }
      if (failCount > 0) {
        showToast(`TTS: ${failCount} of ${sents.length} sentences failed to load`);
      }
      setCurrentSentenceIndex(0);
      setFullTextPlaying(true);
      setFullTextPaused(false);
      // Start the background noise loop (no-op for preset='none'). Async; if
      // the user hits Stop while the asset loads, the helper bails out.
      startBackgroundNoise(ctx).catch(err => console.warn('[audio-effects] bg noise start failed:', err));
    } catch (err) {
      setFullTextPrefetching(false);
      if (heartbeatRef.current) { try { heartbeatRef.current.stop(); } catch (_) {} heartbeatRef.current = null; }
      console.error('Full text playback error:', err);
      showToast(err instanceof Error ? err.message : String(err));
    }
  }, [text, textLanguage, prefetchSentences, buildDialogPlaylist, showToast, effectiveTextLimit, logAction, ensureAudioContext, getAudioDest, setShowTextLimitWarning, checkServerSyncRef, loadWorkspaceStateRef, activeWorkspaceIdRef, textareaRef, skipSyncCheckRef]);

  // ── stopFullTextPlayback ─────────────────────────────────────────────────
  const stopFullTextPlayback = useCallback(() => {
    clearPendingSentenceTimer();
    if (speedSwitchDebounceRef.current) { clearTimeout(speedSwitchDebounceRef.current); speedSwitchDebounceRef.current = null; }
    speedPausedRef.current = false;
    manualStopRef.current = true;
    skipSyncCheckRef.current = false;
    playingSentenceRef.current = -1;
    stopBackgroundNoise();
    if (heartbeatRef.current) { try { heartbeatRef.current.stop(); } catch (_) {} heartbeatRef.current = null; }
    if (warmUpSourceRef.current) { try { warmUpSourceRef.current.stop(); } catch (_) {} warmUpSourceRef.current = null; }
    if (currentSourceRef.current) {
      try { currentSourceRef.current.onended = null; } catch (_) {}
      try { currentSourceRef.current.stop(); } catch (_) {}
      currentSourceRef.current = null;
    }
    currentBufferRef.current = null;
    speakingRef.current = false;
    setSpeaking(false);
    setAudioProgress(0);
    setFullTextPlaying(false);
    setFullTextPaused(false);
    setCurrentSentenceIndex(-1);
    if (audioBridgeRef.current) { audioBridgeRef.current.pause(); }
  }, [skipSyncCheckRef, clearPendingSentenceTimer, stopBackgroundNoise]);

  // ── pauseFullTextPlayback ────────────────────────────────────────────────
  const pauseFullTextPlayback = useCallback(() => {
    clearPendingSentenceTimer();
    manualStopRef.current = true;
    playingSentenceRef.current = -1;
    setFullTextPaused(true);
    if (currentSourceRef.current) {
      try { currentSourceRef.current.onended = null; } catch (_) {}
      try { currentSourceRef.current.stop(); } catch (_) {}
      currentSourceRef.current = null;
    }
    currentBufferRef.current = null;
    speakingRef.current = false;
    setSpeaking(false);
    if (audioBridgeRef.current) { audioBridgeRef.current.pause(); }
  }, [clearPendingSentenceTimer]);

  // ── resumeFullTextPlayback ───────────────────────────────────────────────
  const resumeFullTextPlayback = useCallback(() => {
    manualStopRef.current = false;
    playingSentenceRef.current = -1;
    setFullTextPaused(false);
  }, []);

  // ── nextSentence / prevSentence ──────────────────────────────────────────
  const nextSentence = useCallback(() => {
    clearPendingSentenceTimer();
    manualStopRef.current = true;
    playingSentenceRef.current = -1;
    if (warmUpSourceRef.current) { try { warmUpSourceRef.current.stop(); } catch (_) {} warmUpSourceRef.current = null; }
    if (currentSourceRef.current) { try { currentSourceRef.current.onended = null; } catch (_) {} try { currentSourceRef.current.stop(); } catch (_) {} currentSourceRef.current = null; }
    currentBufferRef.current = null;
    speakingRef.current = false;
    setSpeaking(false);
    setCurrentSentenceIndex(prev => Math.min(prev + 1, sentencesRef.current.length - 1));
  }, [clearPendingSentenceTimer]);

  const prevSentence = useCallback(() => {
    clearPendingSentenceTimer();
    manualStopRef.current = true;
    playingSentenceRef.current = -1;
    if (warmUpSourceRef.current) { try { warmUpSourceRef.current.stop(); } catch (_) {} warmUpSourceRef.current = null; }
    if (currentSourceRef.current) { try { currentSourceRef.current.onended = null; } catch (_) {} try { currentSourceRef.current.stop(); } catch (_) {} currentSourceRef.current = null; }
    currentBufferRef.current = null;
    speakingRef.current = false;
    setSpeaking(false);
    setCurrentSentenceIndex(prev => Math.max(prev - 1, 0));
  }, [clearPendingSentenceTimer]);

  // ── Media Session API — lock screen controls ────────────────────────────
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    if (fullTextPlaying) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: sentencesRef.current[Math.max(0, currentSentenceIndex)]?.slice(0, 60) || 'Text playback',
        artist: 'Deutsch Tutor',
      });
      navigator.mediaSession.playbackState = fullTextPaused ? 'paused' : 'playing';
      navigator.mediaSession.setActionHandler('play', () => { if (fullTextPaused) resumeFullTextPlayback(); });
      navigator.mediaSession.setActionHandler('pause', () => { if (!fullTextPaused) pauseFullTextPlayback(); });
      navigator.mediaSession.setActionHandler('stop', () => stopFullTextPlayback());
      navigator.mediaSession.setActionHandler('nexttrack', () => nextSentence());
      navigator.mediaSession.setActionHandler('previoustrack', () => prevSentence());
    } else {
      navigator.mediaSession.playbackState = 'none';
      navigator.mediaSession.setActionHandler('play', null);
      navigator.mediaSession.setActionHandler('pause', null);
      navigator.mediaSession.setActionHandler('stop', null);
      navigator.mediaSession.setActionHandler('nexttrack', null);
      navigator.mediaSession.setActionHandler('previoustrack', null);
    }
  }, [fullTextPlaying, fullTextPaused, currentSentenceIndex, stopFullTextPlayback, resumeFullTextPlayback, pauseFullTextPlayback, nextSentence, prevSentence]);

  // ── Full-text sentence playback effect ───────────────────────────────────
  useEffect(() => {
    if (fullTextPlaying && !fullTextPaused && currentSentenceIndex >= 0 && currentSentenceIndex < sentencesRef.current.length) {
      if (playingSentenceRef.current === currentSentenceIndex) return;
      playingSentenceRef.current = currentSentenceIndex;
      sentencePlayCountRef.current = 0;
      const phrase = sentencesRef.current[currentSentenceIndex];
      // Dialog lines carry a per-speaker voice that overrides the panel voice.
      const voiceOverride = sentenceVoicesRef.current[currentSentenceIndex] ?? null;

      const speed = playbackSpeedRef.current ?? 1.0;
      const voiceKey = (voiceOverride || voiceRef?.current) ?? '-';
      const ck = `${textLanguage}:${voiceKey}:${speed}:${phrase}`;
      if (!ttsCacheRef.current.has(ck) && !ttsRawCacheRef.current.has(ck)) {
        playingSentenceRef.current = -1;
        if (fullTextPlayingRef.current && !fullTextPausedRef.current) {
          setCurrentSentenceIndex(prev => prev + 1);
        }
        return;
      }

      const ensureContextAndPlay = async () => {
        if (audioContextRef.current && audioContextRef.current.state !== 'running') {
          try { await audioContextRef.current.resume(); } catch (_) {}
        }
        const onEnded = () => {
          sentencePlayCountRef.current += 1;
          const target = sentenceRepeatRef.current;
          if (sentencePlayCountRef.current < target && fullTextPlayingRef.current && !fullTextPausedRef.current) {
            playingSentenceRef.current = -1;
            const pauseMs = sentencePauseRef.current * 1000;
            pendingSentenceTimerRef.current = window.setTimeout(() => {
              pendingSentenceTimerRef.current = null;
              if (fullTextPlayingRef.current && !fullTextPausedRef.current) {
                playingSentenceRef.current = currentSentenceIndex;
                speakPhrase(phrase, onEnded, undefined, false, voiceOverride);
              }
            }, pauseMs > 0 ? pauseMs : 300);
          } else {
            playingSentenceRef.current = -1;
            if (fullTextPlayingRef.current && !fullTextPausedRef.current) {
              const pauseMs = sentencePauseRef.current * 1000;
              if (pauseMs > 0) {
                pendingSentenceTimerRef.current = window.setTimeout(() => {
                  pendingSentenceTimerRef.current = null;
                  if (fullTextPlayingRef.current && !fullTextPausedRef.current) {
                    setCurrentSentenceIndex(prev => prev + 1);
                  }
                }, pauseMs);
              } else {
                setCurrentSentenceIndex(prev => prev + 1);
              }
            }
          }
        };
        speakPhrase(phrase, onEnded, undefined, false, voiceOverride);
      };
      ensureContextAndPlay();
    } else if (fullTextPlaying && !fullTextPaused && currentSentenceIndex >= sentencesRef.current.length) {
      playingSentenceRef.current = -1;
      skipSyncCheckRef.current = false;
      if (heartbeatRef.current) { try { heartbeatRef.current.stop(); } catch (_) {} heartbeatRef.current = null; }
      setFullTextPlaying(false);
      setCurrentSentenceIndex(-1);
    }
  }, [fullTextPlaying, fullTextPaused, currentSentenceIndex, speakPhrase, textLanguage, skipSyncCheckRef, effectRestartCounter]);

  // ── Track within-buffer playback progress ────────────────────────────────
  useEffect(() => {
    if (!speaking) {
      setAudioProgress(0);
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      return;
    }
    const update = () => {
      if (audioContextRef.current && currentBufferRef.current) {
        const elapsed = Math.max(0, audioContextRef.current.currentTime - playbackStartTimeRef.current) + playbackOffsetRef.current;
        setAudioProgress(Math.min(elapsed / currentBufferRef.current.duration, 1));
      }
      animationFrameRef.current = requestAnimationFrame(update);
    };
    animationFrameRef.current = requestAnimationFrame(update);
    return () => {
      if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [speaking]);

  // ── seekWithinCurrentBuffer ──────────────────────────────────────────────
  const seekWithinCurrentBuffer = useCallback((fraction: number) => {
    if (!audioContextRef.current || !currentBufferRef.current) return;
    const buffer = currentBufferRef.current;
    const offset = Math.max(0, Math.min(fraction * buffer.duration, buffer.duration - 0.05));
    if (currentSourceRef.current) {
      currentSourceRef.current.onended = null;
      try { currentSourceRef.current.stop(); } catch (_) {}
      currentSourceRef.current = null;
    }
    const ctx = audioContextRef.current;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    connectSourceToDest(ctx, source);
    const savedCallback = onEndedCallbackRef.current;
    source.onended = () => {
      speakingRef.current = false;
      setSpeaking(false);
      setAudioProgress(0);
      currentBufferRef.current = null;
      currentSourceRef.current = null;
      if (savedCallback && !manualStopRef.current) savedCallback();
      manualStopRef.current = false;
    };
    currentSourceRef.current = source;
    playbackStartTimeRef.current = ctx.currentTime;
    playbackOffsetRef.current = offset;
    source.start(0, offset);
    speakingRef.current = true;
    setSpeaking(true);
  }, [getAudioDest]);

  // ── seekToProgress ───────────────────────────────────────────────────────
  const seekToProgress = useCallback((progress: number) => {
    const clamped = Math.max(0, Math.min(1, progress));
    if (fullTextPlaying && sentencesRef.current.length > 0) {
      const total = sentencesRef.current.length;
      const globalPos = clamped * total;
      const targetSentence = Math.min(Math.floor(globalPos), total - 1);
      const withinFraction = globalPos - targetSentence;
      if (targetSentence === currentSentenceIndex && currentBufferRef.current) {
        setFullTextPaused(false);
        seekWithinCurrentBuffer(withinFraction);
      } else {
        manualStopRef.current = true;
        if (currentSourceRef.current) {
          currentSourceRef.current.onended = null;
          try { currentSourceRef.current.stop(); } catch (_) {}
          currentSourceRef.current = null;
        }
        speakingRef.current = false;
        setSpeaking(false);
        setFullTextPaused(false);
        setCurrentSentenceIndex(targetSentence);
      }
    } else if (currentBufferRef.current) {
      seekWithinCurrentBuffer(clamped);
    }
  }, [fullTextPlaying, currentSentenceIndex, seekWithinCurrentBuffer]);

  // ── Computed: overallProgress ────────────────────────────────────────────
  const overallProgress = fullTextPlaying && sentencesRef.current.length > 0
    ? (currentSentenceIndex + audioProgress) / sentencesRef.current.length
    : audioProgress;

  // ── Return ───────────────────────────────────────────────────────────────
  return {
    speaking,
    ttsFetching,
    fullTextPlaying,
    fullTextPaused,
    fullTextPrefetching,
    currentSentenceIndex,
    sentencePause,
    setSentencePause,
    sentenceRepeat,
    setSentenceRepeat,
    playbackSpeed,
    setPlaybackSpeed: handleSetPlaybackSpeed,
    speedSwitching,
    voiceSwitching,
    history,
    setHistory,
    audioProgress,
    overallProgress,

    speakPhrase,
    prefetchSentences,
    startFullTextPlayback,
    stopFullTextPlayback,
    pauseFullTextPlayback,
    resumeFullTextPlayback,
    nextSentence,
    prevSentence,
    stopAllAudio,
    startHeartbeat,
    seekToProgress,

    speakingRef,
    sentencesRef,
    sentencePauseRef,
    sentenceRepeatRef,
    playbackSpeedRef,
    ttsCacheRef,
    ttsRawCacheRef,
    audioContextRef,
    savedScrollYRef,
  };
}
