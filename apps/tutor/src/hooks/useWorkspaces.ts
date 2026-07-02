import { useState, useRef, useCallback, useEffect, type MutableRefObject, type Dispatch, type SetStateAction } from 'react';

// ── Types ────────────────────────────────────────────────────────────────────

export interface Workspace { id: string; name: string; position: number; }

export interface ExplanationResultLike {
  [key: string]: unknown;
}

/** Shape of the per-workspace state cache entry */
export interface WsStateCacheEntry {
  text: string;
  history: string[];
  explainHistory: string[];
  result: ExplanationResultLike | null;
  textLanguage: string;
  explanationCache: Map<string, ExplanationResultLike>;
  originId?: string;
  // Per-workspace listening configuration. acousticPreset / noisePreset
  // are the "scene" (reset on text edits in App.tsx). voice + noiseLevel
  // are sticky preferences that survive edits but stay per-workspace so
  // each text can keep its own voice character + ambient-volume taste.
  // Loosely typed (raw strings) so the hook doesn't import the unions.
  acousticPreset?: string;
  noisePreset?: string;
  noiseLevel?: string;
  voice?: string | null;
  // Per-workspace player settings (read-all): inter-sentence pause (seconds) and
  // repeat count. New workspaces start at the defaults (0 / 1).
  sentencePause?: number;
  sentenceRepeat?: number;
  // Per-workspace selected deck (null = none / "Select deck").
  activeDeckId?: string | null;
}

export interface UseWorkspacesParams {
  sessionId: string | null;
  // Current workspace content — the hook orchestrates switching but doesn't own the content
  text: string;
  setText: (v: string) => void;
  history: string[];
  setHistory: (v: string[]) => void;
  explainHistory: string[];
  setExplainHistory: (v: string[]) => void;
  result: ExplanationResultLike | null;
  setResult: (v: ExplanationResultLike | null) => void;
  textLanguage: string;
  setTextLanguage: (v: string) => void;
  // Per-workspace scene (acoustic effect + background noise). Hook needs the
  // current values to snapshot a from-workspace into the cache before switching,
  // and the setters to restore the to-workspace on load.
  acousticPreset: string;
  setAcousticPreset: (v: string) => void;
  noisePreset: string;
  setNoisePreset: (v: string) => void;
  noiseLevel: string;
  setNoiseLevel: (v: string) => void;
  voice: string | null;
  setVoice: (v: string | null) => void;
  // Per-workspace player settings (read-all pause + repeat). Same rationale as
  // the scene fields: snapshot the from-workspace and restore the to-workspace.
  sentencePause: number;
  setSentencePause: (v: number) => void;
  sentenceRepeat: number;
  setSentenceRepeat: (v: number) => void;
  // Per-workspace selected deck (null = none). Snapshot/restore like the above.
  activeDeckId: string | null;
  setActiveDeck: (v: string | null) => void;
  // Caches
  explanationCacheRef: MutableRefObject<Map<string, ExplanationResultLike>>;
  ttsRawCacheRef: MutableRefObject<Map<string, string>>;
  ttsCacheRef: MutableRefObject<Map<string, unknown>>;
  originIdRef: MutableRefObject<string>;
  // Dirty state
  setIsDirty: (v: boolean) => void;
  isDirtyRef: MutableRefObject<boolean>;
  // Timestamps
  wsUpdatedAtRef: MutableRefObject<Map<string, string>>;
  // Save refs (owned by App but workspace ops need to clear/read them)
  saveTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  savingRef: MutableRefObject<boolean>;
  savePendingRef: MutableRefObject<boolean>;
  saveStateRef: MutableRefObject<(options?: { beacon?: boolean }) => void>;
  stateRestoredRef: MutableRefObject<boolean>;
  // Playback
  stopFullTextPlayback: () => void;
  // User prefs
  userPrefs: { defaultTextLanguage: string };
}

export interface UseWorkspacesReturn {
  // State
  workspaces: Workspace[];
  setWorkspaces: Dispatch<SetStateAction<Workspace[]>>;
  activeWorkspaceId: string | null;
  setActiveWorkspaceId: Dispatch<SetStateAction<string | null>>;
  editingTabId: string | null;
  setEditingTabId: (v: string | null) => void;
  editingTabName: string;
  setEditingTabName: (v: string) => void;
  deleteConfirm: { id: string; name: string } | null;
  setDeleteConfirm: (v: { id: string; name: string } | null) => void;
  workspaceLoading: boolean;
  // Refs exposed for external use
  workspacesRef: MutableRefObject<Workspace[]>;
  activeWorkspaceIdRef: MutableRefObject<string | null>;
  wsStateCacheRef: MutableRefObject<Map<string, WsStateCacheEntry>>;
  switchingWorkspaceRef: MutableRefObject<boolean>;
  isLoadingWorkspaceRef: MutableRefObject<boolean>;
  wsLoadAbortRef: MutableRefObject<AbortController | null>;
  // Functions
  switchWorkspace: (targetId: string, options?: { skipSave?: boolean }) => Promise<void>;
  createWorkspace: () => Promise<void>;
  deleteWorkspace: (id: string) => Promise<void>;
  duplicateWorkspace: (id: string) => Promise<void>;
  renameWorkspace: (id: string, name: string) => Promise<void>;
  loadWorkspaceState: (sid: string, wsId: string) => Promise<void>;
}

// Defensive coercion of persisted player settings to their valid ranges,
// defaulting to the player defaults (pause 0s, repeat 1) for missing/bad data —
// so a new workspace starts clean rather than inheriting another's settings.
const resolveSentencePause = (v: unknown): number =>
  (typeof v === 'number' && v >= 0 && v <= 8) ? Math.round(v) : 0;
const resolveSentenceRepeat = (v: unknown): number =>
  (typeof v === 'number' && v >= 1 && v <= 5) ? Math.round(v) : 1;

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useWorkspaces(params: UseWorkspacesParams): UseWorkspacesReturn {
  const {
    sessionId,
    text, setText,
    history, setHistory,
    explainHistory, setExplainHistory,
    result, setResult,
    textLanguage, setTextLanguage,
    acousticPreset, setAcousticPreset,
    noisePreset, setNoisePreset,
    noiseLevel, setNoiseLevel,
    voice, setVoice,
    sentencePause, setSentencePause,
    sentenceRepeat, setSentenceRepeat,
    activeDeckId, setActiveDeck,
    explanationCacheRef, ttsRawCacheRef, ttsCacheRef, originIdRef,
    setIsDirty, isDirtyRef,
    wsUpdatedAtRef,
    saveTimerRef, savingRef: _savingRef, savePendingRef: _savePendingRef, saveStateRef: _saveStateRef,
    stateRestoredRef: _stateRestoredRef,
    stopFullTextPlayback,
    userPrefs,
  } = params;

  // ── State ────────────────────────────────────────────────────────────────
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const workspacesRef = useRef<Workspace[]>([]);
  useEffect(() => { workspacesRef.current = workspaces; }, [workspaces]);

  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editingTabName, setEditingTabName] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);

  // ── Refs ──────────────────────────────────────────────────────────────────
  const activeWorkspaceIdRef = useRef<string | null>(null);
  const wsStateCacheRef = useRef<Map<string, WsStateCacheEntry>>(new Map());
  const isLoadingWorkspaceRef = useRef(false);
  const wsLoadAbortRef = useRef<AbortController | null>(null);
  const switchingWorkspaceRef = useRef(false);

  // ── loadWorkspaceState ───────────────────────────────────────────────────
  const loadWorkspaceState = useCallback(async (sid: string, wsId: string) => {
    const res = await fetch(`/api/state/${wsId}`, { headers: { 'x-session-id': sid } });
    if (!res.ok) return;
    const { state: s, updatedAt } = await res.json();
    if (updatedAt) wsUpdatedAtRef.current.set(wsId, updatedAt);
    const resolvedText = s.text ?? '';
    const resolvedHistory = s.history ?? [];
    const resolvedExplainHistory = s.explainHistory ?? (s.explanationCache ? Object.keys(s.explanationCache) : []);
    const resolvedResult = s.result ?? null;
    const resolvedTextLanguage = s.textLanguage ?? (userPrefs.defaultTextLanguage || 'de');
    const resolvedExpCache: Map<string, ExplanationResultLike> = s.explanationCache ? new Map(Object.entries(s.explanationCache)) : new Map();
    const resolvedAcoustic = (typeof s.acousticPreset === 'string' && s.acousticPreset) ? s.acousticPreset : 'none';
    const resolvedNoise = (typeof s.noisePreset === 'string' && s.noisePreset) ? s.noisePreset : 'none';
    const resolvedLevel = (typeof s.noiseLevel === 'string' && s.noiseLevel) ? s.noiseLevel : 'moderate';
    const resolvedVoice = (typeof s.voice === 'string' && s.voice) ? s.voice : null;
    const resolvedPause = resolveSentencePause(s.sentencePause);
    const resolvedRepeat = resolveSentenceRepeat(s.sentenceRepeat);
    const resolvedDeck = typeof s.activeDeckId === 'string' ? s.activeDeckId : null;
    setText(resolvedText);
    setHistory(resolvedHistory);
    setExplainHistory(resolvedExplainHistory);
    setResult(resolvedResult);
    setTextLanguage(resolvedTextLanguage);
    setAcousticPreset(resolvedAcoustic);
    setNoisePreset(resolvedNoise);
    setNoiseLevel(resolvedLevel);
    setVoice(resolvedVoice);
    setSentencePause(resolvedPause);
    setSentenceRepeat(resolvedRepeat);
    setActiveDeck(resolvedDeck);
    explanationCacheRef.current = resolvedExpCache;
    ttsRawCacheRef.current = new Map();
    ttsCacheRef.current = new Map();
    // Populate cache so future switches to this workspace are instant
    wsStateCacheRef.current.set(wsId, {
      text: resolvedText, history: resolvedHistory, explainHistory: resolvedExplainHistory,
      result: resolvedResult, textLanguage: resolvedTextLanguage,
      explanationCache: new Map(resolvedExpCache),
      acousticPreset: resolvedAcoustic,
      noisePreset: resolvedNoise,
      noiseLevel: resolvedLevel,
      voice: resolvedVoice,
      sentencePause: resolvedPause,
      sentenceRepeat: resolvedRepeat,
      activeDeckId: resolvedDeck,
    });
  }, [userPrefs.defaultTextLanguage, setText, setHistory, setExplainHistory, setResult, setTextLanguage, setAcousticPreset, setNoisePreset, setNoiseLevel, setVoice, setSentencePause, setSentenceRepeat, setActiveDeck, explanationCacheRef, ttsRawCacheRef, ttsCacheRef, wsUpdatedAtRef]);

  // ── switchWorkspace ──────────────────────────────────────────────────────
  const switchWorkspace = useCallback(async (targetId: string, options?: { skipSave?: boolean }) => {
    if (!sessionId || targetId === activeWorkspaceId) return;
    const fromId = activeWorkspaceId;

    // Abort any in-flight workspace fetch from a previous switch
    if (wsLoadAbortRef.current) { wsLoadAbortRef.current.abort(); wsLoadAbortRef.current = null; }
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
    switchingWorkspaceRef.current = true;
    stopFullTextPlayback();

    // Capture from-state NOW (closure values are fresh at click time, before any setState)
    const fromLastSavedAt = fromId ? wsUpdatedAtRef.current.get(fromId) || null : null;
    const fromStateBody = (!options?.skipSave && fromId) ? JSON.stringify({
      workspaceId: fromId,
      state: {
        text, history, result, textLanguage, explainHistory,
        explanationCache: Object.fromEntries(explanationCacheRef.current),
        originId: originIdRef.current,
        acousticPreset, noisePreset, noiseLevel, voice,
        sentencePause, sentenceRepeat, activeDeckId,
      },
      lastSavedAt: fromLastSavedAt,
    }) : null;

    // Snapshot from-workspace to cache — but only when it was fully loaded (not mid-spinner).
    if (fromId && !isLoadingWorkspaceRef.current) {
      wsStateCacheRef.current.set(fromId, {
        text, history, result, textLanguage, explainHistory,
        explanationCache: new Map(explanationCacheRef.current),
        originId: originIdRef.current,
        acousticPreset, noisePreset, noiseLevel, voice,
        sentencePause, sentenceRepeat, activeDeckId,
      });
    }

    setActiveWorkspaceId(targetId);
    activeWorkspaceIdRef.current = targetId;

    const cached = wsStateCacheRef.current.get(targetId);

    if (cached) {
      // ── CACHED PATH: instant restore, no spinner ──────────────────────────
      setText(cached.text);
      setHistory(cached.history);
      setExplainHistory(cached.explainHistory);
      setResult(cached.result);
      setTextLanguage(cached.textLanguage);
      setAcousticPreset(cached.acousticPreset || 'none');
      setNoisePreset(cached.noisePreset || 'none');
      setNoiseLevel(cached.noiseLevel || 'moderate');
      setVoice(cached.voice ?? null);
      setSentencePause(resolveSentencePause(cached.sentencePause));
      setSentenceRepeat(resolveSentenceRepeat(cached.sentenceRepeat));
      setActiveDeck(cached.activeDeckId ?? null);
      explanationCacheRef.current = new Map(cached.explanationCache);
      originIdRef.current = cached.originId || crypto.randomUUID();
      ttsRawCacheRef.current = new Map();
      ttsCacheRef.current = new Map();
      setIsDirty(false);
      isDirtyRef.current = false;
      switchingWorkspaceRef.current = false;

      // Background: persist from-state + update active-ws.
      const controller = new AbortController();
      wsLoadAbortRef.current = controller;
      ;(async () => {
        try {
          const ops: Promise<unknown>[] = [
            fetch('/api/users/active-workspace', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
              body: JSON.stringify({ workspaceId: targetId }),
              signal: controller.signal,
            }).catch(() => {}),
          ];
          if (fromStateBody) {
            ops.push(fetch('/api/state', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
              body: fromStateBody,
              signal: controller.signal,
            }).then(async (r) => {
              if (r.ok && fromId) {
                const d = await r.json();
                if (d.updatedAt) wsUpdatedAtRef.current.set(fromId, d.updatedAt);
              }
            }).catch(() => {}));
          }
          await Promise.all(ops);
        } catch (e) {
          if ((e as Error).name === 'AbortError') return;
        } finally {
          if (!controller.signal.aborted) wsLoadAbortRef.current = null;
        }
      })();

    } else {
      // ── UNCACHED PATH: first visit to this workspace, show spinner ────────
      isLoadingWorkspaceRef.current = true;
      setWorkspaceLoading(true);
      setText(''); setHistory([]); setExplainHistory([]); setResult(null); setTextLanguage(userPrefs.defaultTextLanguage || 'de');
      setAcousticPreset('none'); setNoisePreset('none'); setNoiseLevel('moderate'); setVoice(null);
      setSentencePause(0); setSentenceRepeat(1); setActiveDeck(null);
      explanationCacheRef.current = new Map(); ttsRawCacheRef.current = new Map(); ttsCacheRef.current = new Map();

      const controller = new AbortController();
      wsLoadAbortRef.current = controller;
      try {
        const [,, loadRes] = await Promise.all([
          fromStateBody
            ? fetch('/api/state', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
                body: fromStateBody,
                signal: controller.signal,
              }).then(async (r) => {
                if (r.ok && fromId) {
                  const d = await r.json();
                  if (d.updatedAt) wsUpdatedAtRef.current.set(fromId, d.updatedAt);
                }
                return r;
              }).catch(() => null)
            : Promise.resolve(null),
          fetch('/api/users/active-workspace', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
            body: JSON.stringify({ workspaceId: targetId }),
            signal: controller.signal,
          }).catch(() => null),
          fetch(`/api/state/${targetId}`, {
            headers: { 'x-session-id': sessionId },
            signal: controller.signal,
          }).catch(() => null),
        ]);

        if (!controller.signal.aborted && loadRes?.ok) {
          const { state: s, updatedAt: loadedTs } = await (loadRes as Response).json();
          if (loadedTs) wsUpdatedAtRef.current.set(targetId, loadedTs);
          const expCache: Map<string, ExplanationResultLike> = s.explanationCache ? new Map(Object.entries(s.explanationCache)) : new Map();
          const defaultLang = userPrefs.defaultTextLanguage || 'de';
          const loadedAcoustic = (typeof s.acousticPreset === 'string' && s.acousticPreset) ? s.acousticPreset : 'none';
          const loadedNoise = (typeof s.noisePreset === 'string' && s.noisePreset) ? s.noisePreset : 'none';
          const loadedLevel = (typeof s.noiseLevel === 'string' && s.noiseLevel) ? s.noiseLevel : 'moderate';
          const loadedVoice = (typeof s.voice === 'string' && s.voice) ? s.voice : null;
          const loadedPause = resolveSentencePause(s.sentencePause);
          const loadedRepeat = resolveSentenceRepeat(s.sentenceRepeat);
          const loadedDeck = typeof s.activeDeckId === 'string' ? s.activeDeckId : null;
          setText(s.text ?? ''); setHistory(s.history ?? []);
          setExplainHistory(s.explainHistory ?? (s.explanationCache ? Object.keys(s.explanationCache) : []));
          setResult(s.result ?? null); setTextLanguage(s.textLanguage ?? defaultLang);
          setAcousticPreset(loadedAcoustic);
          setNoisePreset(loadedNoise);
          setNoiseLevel(loadedLevel);
          setVoice(loadedVoice);
          setSentencePause(loadedPause);
          setSentenceRepeat(loadedRepeat);
          setActiveDeck(loadedDeck);
          explanationCacheRef.current = expCache;
          originIdRef.current = s.originId || crypto.randomUUID();
          ttsRawCacheRef.current = new Map();
          ttsCacheRef.current = new Map();
          // Populate cache so future visits are instant
          wsStateCacheRef.current.set(targetId, {
            text: s.text ?? '', history: s.history ?? [],
            explainHistory: s.explainHistory ?? (s.explanationCache ? Object.keys(s.explanationCache) : []),
            result: s.result ?? null, textLanguage: s.textLanguage ?? defaultLang,
            explanationCache: new Map(expCache),
            originId: originIdRef.current,
            acousticPreset: loadedAcoustic,
            noisePreset: loadedNoise,
            noiseLevel: loadedLevel,
            voice: loadedVoice,
            sentencePause: loadedPause,
            sentenceRepeat: loadedRepeat,
            activeDeckId: loadedDeck,
          });
          setIsDirty(false);
          isDirtyRef.current = false;
        }
      } finally {
        if (!controller.signal.aborted) {
          wsLoadAbortRef.current = null;
          isLoadingWorkspaceRef.current = false;
          setWorkspaceLoading(false);
          switchingWorkspaceRef.current = false;
        }
      }
    }
  }, [sessionId, activeWorkspaceId, text, history, result, textLanguage, explainHistory, acousticPreset, noisePreset, noiseLevel, voice, sentencePause, sentenceRepeat, activeDeckId, stopFullTextPlayback, userPrefs.defaultTextLanguage,
      setText, setHistory, setExplainHistory, setResult, setTextLanguage, setAcousticPreset, setNoisePreset, setNoiseLevel, setVoice, setSentencePause, setSentenceRepeat, setActiveDeck, setIsDirty, isDirtyRef,
      explanationCacheRef, ttsRawCacheRef, ttsCacheRef, originIdRef, wsUpdatedAtRef, saveTimerRef]);

  // ── createWorkspace ──────────────────────────────────────────────────────
  const createWorkspace = useCallback(async () => {
    if (!sessionId || !activeWorkspaceId) return;
    // Save current workspace FIRST — switchWorkspace's closure may have stale state
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
    try {
      await fetch('/api/state', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
        body: JSON.stringify({
          workspaceId: activeWorkspaceId,
          state: {
            text, history, result, textLanguage, explainHistory,
            explanationCache: Object.fromEntries(explanationCacheRef.current),
            acousticPreset, noisePreset, noiseLevel, voice,
            sentencePause, sentenceRepeat, activeDeckId,
          },
        }),
      });
    } catch { /* prior auto-saves cover this */ }
    const nextNumber = Math.max(0, ...workspacesRef.current.map(w => {
      const m = w.name.match(/^Workspace\s+(\d+)$/);
      return m ? parseInt(m[1], 10) : 0;
    })) + 1;
    const res = await fetch('/api/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
      body: JSON.stringify({ name: `Workspace ${nextNumber}` }),
    });
    const ws = await res.json();
    setWorkspaces(prev => [...prev, ws]);
    await switchWorkspace(ws.id, { skipSave: true }); // already saved above
    setTextLanguage(userPrefs.defaultTextLanguage || 'de');
  }, [sessionId, activeWorkspaceId, text, history, result, textLanguage, explainHistory, acousticPreset, noisePreset, noiseLevel, voice, sentencePause, sentenceRepeat, activeDeckId, switchWorkspace, userPrefs.defaultTextLanguage,
      explanationCacheRef, setTextLanguage, saveTimerRef]);

  // ── renameWorkspace ──────────────────────────────────────────────────────
  const renameWorkspace = useCallback(async (id: string, name: string) => {
    if (!sessionId || !name.trim()) return;
    await fetch(`/api/workspaces/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
      body: JSON.stringify({ name: name.trim() }),
    });
    setWorkspaces(prev => prev.map(w => w.id === id ? { ...w, name: name.trim() } : w));
  }, [sessionId]);

  // ── duplicateWorkspace ───────────────────────────────────────────────────
  const duplicateWorkspace = useCallback(async (id: string) => {
    if (!sessionId) return;
    // Save current workspace first
    if (id === activeWorkspaceId) {
      if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
      try {
        await fetch('/api/state', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
          body: JSON.stringify({
            workspaceId: activeWorkspaceId,
            state: { text, history, result, textLanguage, explainHistory, explanationCache: Object.fromEntries(explanationCacheRef.current), originId: originIdRef.current, acousticPreset, noisePreset, noiseLevel, voice, sentencePause, sentenceRepeat, activeDeckId },
          }),
        });
      } catch { /* auto-saves cover this */ }
    }
    // Get source workspace state
    const cached = wsStateCacheRef.current.get(id);
    let srcState: Record<string, unknown>;
    if (id === activeWorkspaceId) {
      srcState = { text, history, result, textLanguage, explainHistory, explanationCache: Object.fromEntries(explanationCacheRef.current), originId: originIdRef.current, acousticPreset, noisePreset, noiseLevel, voice, sentencePause, sentenceRepeat, activeDeckId };
    } else if (cached) {
      srcState = { text: cached.text, history: cached.history, result: cached.result, textLanguage: cached.textLanguage, explainHistory: cached.explainHistory, explanationCache: Object.fromEntries(cached.explanationCache), originId: cached.originId, acousticPreset: cached.acousticPreset, noisePreset: cached.noisePreset, noiseLevel: cached.noiseLevel, voice: cached.voice, sentencePause: cached.sentencePause, sentenceRepeat: cached.sentenceRepeat, activeDeckId: cached.activeDeckId };
    } else {
      const r = await fetch(`/api/state/${id}`, { headers: { 'x-session-id': sessionId } });
      if (!r.ok) return;
      const d = await r.json();
      srcState = d.state || {};
    }
    // Get source name
    const srcWs = workspacesRef.current.find(w => w.id === id);
    const newName = `${srcWs?.name || 'Workspace'} (copy)`;
    // Create new workspace
    const res = await fetch('/api/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
      body: JSON.stringify({ name: newName }),
    });
    const ws = await res.json();
    setWorkspaces(prev => [...prev, ws]);
    // Save duplicated state
    await fetch('/api/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
      body: JSON.stringify({ workspaceId: ws.id, state: srcState }),
    });
    // Pre-populate cache
    const srcExplanationCache = srcState.explanationCache as Record<string, ExplanationResultLike> | undefined;
    const expCache = srcExplanationCache ? new Map(Object.entries(srcExplanationCache)) : new Map<string, ExplanationResultLike>();
    wsStateCacheRef.current.set(ws.id, {
      text: (srcState.text as string) || '', history: (srcState.history as string[]) || [],
      explainHistory: (srcState.explainHistory as string[]) || (srcExplanationCache ? Object.keys(srcExplanationCache) : []),
      result: (srcState.result as ExplanationResultLike | null) || null, textLanguage: (srcState.textLanguage as string) || 'de',
      explanationCache: expCache,
      originId: srcState.originId as string | undefined,
      acousticPreset: (srcState.acousticPreset as string) || 'none',
      noisePreset: (srcState.noisePreset as string) || 'none',
      noiseLevel: (srcState.noiseLevel as string) || 'moderate',
      voice: (srcState.voice as string | null) ?? null,
      sentencePause: resolveSentencePause(srcState.sentencePause),
      sentenceRepeat: resolveSentenceRepeat(srcState.sentenceRepeat),
      activeDeckId: typeof srcState.activeDeckId === 'string' ? srcState.activeDeckId : null,
    });
    await switchWorkspace(ws.id, { skipSave: true });
  }, [sessionId, activeWorkspaceId, text, history, result, textLanguage, explainHistory, acousticPreset, noisePreset, noiseLevel, voice, sentencePause, sentenceRepeat, activeDeckId, switchWorkspace,
      explanationCacheRef, originIdRef, saveTimerRef]);

  // ── deleteWorkspace ──────────────────────────────────────────────────────
  const deleteWorkspace = useCallback(async (id: string) => {
    if (!sessionId || workspaces.length <= 1) return;
    // If deleting the active workspace, suppress auto-save and clear pending timers
    if (id === activeWorkspaceId) {
      if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
      switchingWorkspaceRef.current = true;
    }
    const res = await fetch(`/api/workspaces/${id}`, { method: 'DELETE', headers: { 'x-session-id': sessionId } });
    if (!res.ok) { switchingWorkspaceRef.current = false; return; }
    const data = await res.json();
    wsStateCacheRef.current.delete(id); // evict deleted workspace from cache
    setWorkspaces(prev => prev.filter(w => w.id !== id));
    if (id === activeWorkspaceId) {
      stopFullTextPlayback();
      // Clear in-memory state before switching to prevent old data leaking
      setText(''); setHistory([]); setExplainHistory([]); setResult(null); setTextLanguage('de');
      setAcousticPreset('none'); setNoisePreset('none'); setNoiseLevel('moderate'); setVoice(null);
      setSentencePause(0); setSentenceRepeat(1); setActiveDeck(null);
      explanationCacheRef.current = new Map(); ttsRawCacheRef.current = new Map();
      ttsCacheRef.current = new Map();
      setActiveWorkspaceId(data.newActiveWorkspaceId);
      activeWorkspaceIdRef.current = data.newActiveWorkspaceId;
      await loadWorkspaceState(sessionId, data.newActiveWorkspaceId);
      setIsDirty(false);
      isDirtyRef.current = false;
      switchingWorkspaceRef.current = false;
    }
  }, [sessionId, workspaces.length, activeWorkspaceId, loadWorkspaceState, stopFullTextPlayback,
      setText, setHistory, setExplainHistory, setResult, setTextLanguage, setAcousticPreset, setNoisePreset, setNoiseLevel, setVoice, setSentencePause, setSentenceRepeat, setActiveDeck, setIsDirty, isDirtyRef,
      explanationCacheRef, ttsRawCacheRef, ttsCacheRef, saveTimerRef]);

  return {
    // State
    workspaces, setWorkspaces,
    activeWorkspaceId, setActiveWorkspaceId,
    editingTabId, setEditingTabId,
    editingTabName, setEditingTabName,
    deleteConfirm, setDeleteConfirm,
    workspaceLoading,
    // Refs
    workspacesRef,
    activeWorkspaceIdRef,
    wsStateCacheRef,
    switchingWorkspaceRef,
    isLoadingWorkspaceRef,
    wsLoadAbortRef,
    // Functions
    switchWorkspace,
    createWorkspace,
    deleteWorkspace,
    duplicateWorkspace,
    renameWorkspace,
    loadWorkspaceState,
  };
}
