import React, { useState, useRef } from 'react';
import { motion } from 'motion/react';
import {
  BookOpen,
  Layers,
  Loader2,
  Sparkles,
  Volume2,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Square,
  Eye,
  EyeOff,
  Mic,
  Trash2,
  Pencil,
  Download,
  ArrowUp,
  X,
  Wand2,
  RefreshCw,
  Search,
  Crown,
  Repeat,
  RotateCcw,
  Share2,
  Copy,
  TextCursorInput,
  Menu,
  Camera,
} from 'lucide-react';

import { LANGUAGES, t } from '../i18n';
import { TIMEOUTS } from '../constants';
import type { UserPreferences, User, ExplanationResult, AcousticPreset, NoisePreset, NoiseLevel, TtsVoiceOption } from '../types';
import { nextAcousticPreset, nextNoisePreset, nextNoiseLevel } from '../types';
import type { Workspace } from '../hooks/useWorkspaces';

// Playback speeds the speed button cycles through (slower → faster).
const PLAYBACK_SPEEDS = [0.7, 0.9, 1, 1.1, 1.25];

// --- Tutorial Steps (needed for conditional rendering) ---
interface TutorialStep {
  target: string;
  titleKey: string;
  descriptionKey: string;
  position: 'top' | 'bottom' | 'left' | 'right';
  fallbackPosition: 'top' | 'bottom';
  forceShow?: boolean;
}

export interface TextToolbarProps {
  // --- Language & text state ---
  textLanguage: string;
  disabledTextLanguages: Set<string>;
  text: string;
  textDir: 'ltr' | 'rtl';

  // --- User & prefs ---
  userPrefs: UserPreferences;
  user: User | null;
  isPaidUser: boolean;
  isEmbedMode: boolean;
  isTouchDevice: boolean;

  // --- Visibility toggles ---
  textHidden: boolean;
  setTextHidden: React.Dispatch<React.SetStateAction<boolean>>;
  editMode: boolean;
  setEditMode: React.Dispatch<React.SetStateAction<boolean>>;
  showUnsaved: boolean;

  // --- Loading / explain ---
  loading: boolean;
  speaking: boolean;

  // --- Listen full text ---
  fullTextPlaying: boolean;
  fullTextPaused: boolean;
  fullTextPrefetching: boolean;
  currentSentenceIndex: number;
  sentencePause: number;
  setSentencePause: (n: number) => void;
  sentenceRepeat: number;
  setSentenceRepeat: (n: number) => void;
  playbackSpeed: number;
  setPlaybackSpeed: (n: number) => void;
  speedSwitching: boolean;
  overallProgress: number;
  sentencesRef: React.MutableRefObject<string[]>;
  sentencePauseRef: React.MutableRefObject<number>;
  sentenceRepeatRef: React.MutableRefObject<number>;
  playbackSpeedRef: React.MutableRefObject<number>;
  acousticPreset: AcousticPreset;
  setAcousticPreset: (p: AcousticPreset) => void;
  noisePreset: NoisePreset;
  setNoisePreset: (p: NoisePreset) => void;
  noiseLevel: NoiseLevel;
  setNoiseLevel: (l: NoiseLevel) => void;
  voiceCatalog: TtsVoiceOption[];
  currentVoice: string | null;
  setCurrentVoice: (v: string | null) => void;
  voiceSwitching: boolean;
  startFullTextPlayback: () => void;
  stopFullTextPlayback: () => void;
  pauseFullTextPlayback: () => void;
  resumeFullTextPlayback: () => void;
  nextSentence: () => void;
  prevSentence: () => void;
  seekToProgress: (progress: number) => void;
  downloadingAudio: boolean;
  downloadFullTextAudio: () => void;

  // --- Recording ---
  isRecording: boolean;
  hasRecording: boolean;
  playingRecording: boolean;
  startRecording: () => void;
  stopRecording: () => void;
  toggleRecordingPlayback: () => void;
  deleteRecording: () => void;

  // --- Generate text ---
  setShowGenerateText: (show: boolean) => void;

  // --- OCR from image ---
  setShowImageOcr: (show: boolean) => void;

  // --- Flashcards & export ---
  explainHistory: string[];
  exportCards: () => void;
  startFlashcards: () => void;

  // --- Decks ---
  decksCount: number;
  onCreateDeck: () => void;
  onOpenReview: () => void;

  // --- Quick explain ---
  speakPhrase: (phrase: string) => void;
  handleQuickExplain: () => void;
  quickInput: string;
  setQuickInput: (val: string) => void;

  // --- Workspace actions ---
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  setEditingTabId: (id: string | null) => void;
  setEditingTabName: (name: string) => void;
  duplicateWorkspace: (id: string) => void;
  deleteWorkspace: (id: string) => void;
  handleShare: () => void;
  retranslateAll: () => void;
  retranslating: boolean;
  retranslateProgress: string;
  setDeleteConfirm: (val: { id: string; name: string } | null) => void;

  // --- Clear workspace callback ---
  onClearWorkspace: () => void;

  // --- Cache clearing for language change ---
  onLanguageChange: (lang: string) => void;

  // --- Tutorial ---
  tutorialStep: number | null;
  TUTORIAL_STEPS: TutorialStep[];
}

export function TextToolbar({
  textLanguage,
  disabledTextLanguages,
  text,
  textDir,
  userPrefs,
  user,
  isPaidUser,
  isEmbedMode,
  isTouchDevice,
  textHidden,
  setTextHidden,
  editMode,
  setEditMode,
  showUnsaved,
  loading,
  speaking,
  fullTextPlaying,
  fullTextPaused,
  fullTextPrefetching,
  currentSentenceIndex,
  sentencePause,
  setSentencePause,
  sentenceRepeat,
  setSentenceRepeat,
  playbackSpeed,
  setPlaybackSpeed,
  speedSwitching,
  overallProgress,
  sentencesRef,
  sentencePauseRef,
  sentenceRepeatRef,
  playbackSpeedRef,
  acousticPreset,
  setAcousticPreset,
  noisePreset,
  setNoisePreset,
  noiseLevel,
  setNoiseLevel,
  voiceCatalog,
  currentVoice,
  setCurrentVoice,
  voiceSwitching,
  startFullTextPlayback,
  stopFullTextPlayback,
  pauseFullTextPlayback,
  resumeFullTextPlayback,
  nextSentence,
  prevSentence,
  seekToProgress,
  downloadingAudio,
  downloadFullTextAudio,
  isRecording,
  hasRecording,
  playingRecording,
  startRecording,
  stopRecording,
  toggleRecordingPlayback,
  deleteRecording,
  setShowGenerateText,
  setShowImageOcr,
  explainHistory,
  exportCards,
  startFlashcards,
  decksCount,
  onCreateDeck,
  onOpenReview,
  speakPhrase,
  handleQuickExplain,
  quickInput,
  setQuickInput,
  workspaces,
  activeWorkspaceId,
  setEditingTabId,
  setEditingTabName,
  duplicateWorkspace,
  deleteWorkspace,
  handleShare,
  retranslateAll,
  retranslating,
  retranslateProgress,
  setDeleteConfirm,
  onClearWorkspace,
  onLanguageChange,
  tutorialStep,
  TUTORIAL_STEPS,
}: TextToolbarProps) {
  // --- Local state ---
  const [wsMenuId, setWsMenuId] = useState<string | null>(null);
  const wsMenuTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [cardsMenuOpen, setCardsMenuOpen] = useState(false);

  // Voice cycle: next id in the verified catalog (wraps). Shown character
  // name derives from the same catalog. Both null/undefined when the
  // language has no voices configured — the button stays hidden in that case.
  const currentVoiceName = currentVoice ? (voiceCatalog.find(v => v.id === currentVoice)?.name ?? null) : null;
  const cycleVoice = () => {
    if (voiceCatalog.length === 0) return;
    const i = voiceCatalog.findIndex(v => v.id === currentVoice);
    setCurrentVoice(voiceCatalog[(i + 1) % voiceCatalog.length].id);
  };

  return (
    <div data-tutorial="toolbar" className="p-3 lg:p-4 border-b border-[var(--border-light)] flex flex-wrap items-center justify-between gap-y-2 bg-[var(--bg-surface-half)]">
      <div className="flex items-center gap-3 lg:gap-6">
        {!isEmbedMode && <div className="flex items-center gap-3">
          <select
            data-tutorial="lang-selector"
            value={textLanguage}
            onChange={(e) => onLanguageChange(e.target.value)}
            className="text-xs px-2 py-1 border border-[var(--border-main)] rounded bg-[var(--bg-panel)] text-[var(--text-secondary)]"
          >
            {Object.entries(LANGUAGES).filter(([code]) => !disabledTextLanguages.has(code)).map(([code, lang]) => (
              <option key={code} value={code}>{lang.label}</option>
            ))}
          </select>
        </div>}
        <button
          data-tutorial="hide-text-btn"
          onClick={() => setTextHidden(h => !h)}
          title={textHidden ? t('SHOW_TEXT', userPrefs.interfaceLanguage) : t('HIDE_TEXT', userPrefs.interfaceLanguage)}
          className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
        >
          {textHidden ? <EyeOff className="w-4 h-4 lg:w-3 lg:h-3" /> : <Eye className="w-4 h-4 lg:w-3 lg:h-3" />}
          <span>{textHidden ? t('SHOW_TEXT', userPrefs.interfaceLanguage) : t('HIDE_TEXT', userPrefs.interfaceLanguage)}</span>
        </button>
        {!isEmbedMode && text.trim() && (
          <button
            onClick={() => setEditMode(m => !m)}
            className="hidden lg:flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          >
            {editMode ? <BookOpen className="w-3 h-3" /> : <Pencil className="w-3 h-3" />}
            <span>{editMode ? t('READ_MODE', userPrefs.interfaceLanguage) : t('EDIT_MODE', userPrefs.interfaceLanguage)}</span>
          </button>
        )}
        {((!fullTextPlaying && text.trim().length > 0) || tutorialStep !== null) && (
          <button
            data-tutorial="listen-full-btn"
            onClick={startFullTextPlayback}
            disabled={fullTextPrefetching}
            className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-tertiary)] hover:text-[var(--text-primary)] flex items-center gap-1.5 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {fullTextPrefetching
              ? <Loader2 className="w-4 h-4 lg:w-3 lg:h-3 animate-spin" />
              : (<>
                  <span className="flex items-center gap-0.5 lg:hidden">
                    <Volume2 className="w-4 h-4" />
                    <span className="text-[8px] opacity-50">/</span>
                    <Download className="w-4 h-4" />
                  </span>
                  <Volume2 className="w-3 h-3 hidden lg:block" />
                </>)}
            <span className="hidden lg:inline leading-tight text-center">{fullTextPrefetching ? t('LOADING_AUDIO', userPrefs.interfaceLanguage) : t('LISTEN_FULL', userPrefs.interfaceLanguage)}</span>
          </button>
        )}
        {(!fullTextPlaying || tutorialStep !== null) && (
          <>
            <div className="w-px h-4 bg-[var(--bg-muted)]" />
            {isRecording && tutorialStep === null ? (
              <button
                onClick={stopRecording}
                className="flex items-center gap-1.5 text-red-500 hover:text-red-700 transition-colors"
                title={t('RECORDING', userPrefs.interfaceLanguage)}
              >
                <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
                </span>
                <span className="text-[10px] font-bold uppercase tracking-widest">{t('RECORDING', userPrefs.interfaceLanguage)}</span>
              </button>
            ) : hasRecording && tutorialStep === null ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={startRecording}
                  title={t('RECORD', userPrefs.interfaceLanguage)}
                  className="p-2 -m-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                >
                  <Mic className="w-4 h-4" />
                </button>
                <button
                  onClick={toggleRecordingPlayback}
                  title={t('PLAY_RECORDING', userPrefs.interfaceLanguage)}
                  className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                >
                  {playingRecording ? <Square className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
                </button>
                <button
                  onClick={deleteRecording}
                  title={t('DELETE_RECORDING', userPrefs.interfaceLanguage)}
                  className="text-[var(--text-muted)] hover:text-red-500 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button
                data-tutorial="record-btn"
                onClick={startRecording}
                title={t('RECORD', userPrefs.interfaceLanguage)}
                className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
              >
                <Mic className="w-4 h-4 lg:w-3 lg:h-3" />
                <span className="hidden lg:inline">{t('RECORD', userPrefs.interfaceLanguage)}</span>
              </button>
            )}
          </>
        )}
        {!isEmbedMode && (!text.trim() || tutorialStep !== null) && (
          <>
            <div className="w-px h-4 bg-[var(--bg-muted)]" />
            <button
              data-tutorial="generate-btn"
              onClick={() => setShowGenerateText(true)}
              className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
              title={t('GENERATE_TEXT', userPrefs.interfaceLanguage)}
            >
              <Wand2 className="w-4 h-4 lg:w-3 lg:h-3" />
              <span className="hidden lg:inline">{t('GENERATE_TEXT', userPrefs.interfaceLanguage)}</span>
            </button>
            <button
              onClick={() => setShowImageOcr(true)}
              className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
              title={t('OCR_FROM_IMAGE', userPrefs.interfaceLanguage)}
            >
              <Camera className="w-4 h-4 lg:w-3 lg:h-3" />
              <span className="hidden lg:inline">{t('OCR_FROM_IMAGE', userPrefs.interfaceLanguage)}</span>
            </button>
          </>
        )}
        {(((text.trim() && !fullTextPlaying && explainHistory.length > 0 && !isTouchDevice) || (tutorialStep !== null && !isTouchDevice)) || (decksCount > 0 && !isTouchDevice)) && (
          <>
            <div className="w-px h-4 bg-[var(--bg-muted)]" />
            <div className="relative group" data-tutorial="flashcards-btn" onMouseLeave={() => { if (tutorialStep === null) setCardsMenuOpen(false); }}>
              <button
                onClick={() => setCardsMenuOpen(o => !o)}
                className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
              >
                <Layers className="w-4 h-4 lg:w-3 lg:h-3" />
                <span className="hidden lg:inline">{t('FLASHCARDS', userPrefs.interfaceLanguage)}</span>
              </button>
              <div className={`absolute top-full right-0 mt-1 py-1 bg-[var(--bg-panel)] border border-[var(--border-main)] rounded-lg shadow-lg transition-all z-50 min-w-[180px] ${cardsMenuOpen || (tutorialStep !== null && TUTORIAL_STEPS[tutorialStep]?.target === 'export-btn') ? 'opacity-100 visible' : 'opacity-0 invisible lg:group-hover:opacity-100 lg:group-hover:visible'}`}>
                {explainHistory.length > 0 && (
                  <>
                    <button
                      data-tutorial="export-btn"
                      onClick={() => { exportCards(); setCardsMenuOpen(false); }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                      Export .tsv (Anki)
                    </button>
                    <button
                      onClick={() => { startFlashcards(); setCardsMenuOpen(false); }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
                    >
                      <Play className="w-3.5 h-3.5" />
                      {t('FLASHCARDS', userPrefs.interfaceLanguage)}
                    </button>
                    <div className="my-1 border-t border-[var(--border-main)]" />
                  </>
                )}
                <button
                  onClick={() => { onCreateDeck(); setCardsMenuOpen(false); }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
                >
                  <Layers className="w-3.5 h-3.5" />
                  {t('NEW_CARD_DECK', userPrefs.interfaceLanguage)}
                </button>
                <button
                  onClick={() => { onOpenReview(); setCardsMenuOpen(false); }}
                  disabled={decksCount === 0}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  {t('REVIEW_DECK', userPrefs.interfaceLanguage)}
                </button>
              </div>
            </div>
          </>
        )}
        {showUnsaved && (
          <span
            className="w-2 h-2 rounded-full bg-amber-400 shrink-0"
            title={t('UNSAVED_CHANGES', userPrefs.interfaceLanguage)}
          />
        )}
        {/* Workspace actions burger menu */}
        <div className="w-px h-4 bg-[var(--bg-muted)]" />
        <div className="relative"
          onMouseEnter={() => { if (!isTouchDevice) { if (wsMenuTimerRef.current) clearTimeout(wsMenuTimerRef.current); setWsMenuId('toolbar'); } }}
          onMouseLeave={() => { if (!isTouchDevice) { wsMenuTimerRef.current = setTimeout(() => setWsMenuId(null), TIMEOUTS.MENU_HOVER_CLOSE); } }}
        >
          <button
            onClick={() => { if (isTouchDevice) setWsMenuId(prev => prev === 'toolbar' ? null : 'toolbar'); }}
            className="flex items-center text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          >
            <Menu className="w-4 h-4 lg:w-3.5 lg:h-3.5" />
          </button>
          {wsMenuId === 'toolbar' && (
            <>
              {isTouchDevice && <div className="fixed inset-0 z-40" onClick={() => setWsMenuId(null)} />}
              <div
                className="absolute top-full right-0 mt-1 py-1 bg-[var(--bg-panel)] border border-[var(--border-main)] rounded-lg shadow-lg z-50 min-w-[170px]"
                onMouseEnter={() => { if (!isTouchDevice && wsMenuTimerRef.current) clearTimeout(wsMenuTimerRef.current); }}
                onMouseLeave={() => { if (!isTouchDevice) { wsMenuTimerRef.current = setTimeout(() => setWsMenuId(null), TIMEOUTS.MENU_HOVER_CLOSE); } }}
              >
                <button
                  onClick={() => { setWsMenuId(null); if (activeWorkspaceId) { setEditingTabId(activeWorkspaceId); const ws = workspaces.find(w => w.id === activeWorkspaceId); setEditingTabName(ws?.name || ''); } }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
                >
                  <TextCursorInput className="w-3.5 h-3.5" />
                  {t('RENAME_WORKSPACE', userPrefs.interfaceLanguage)}
                </button>
                <button
                  onClick={() => { setWsMenuId(null); if (activeWorkspaceId) duplicateWorkspace(activeWorkspaceId); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
                >
                  <Copy className="w-3.5 h-3.5" />
                  {t('DUPLICATE_WORKSPACE', userPrefs.interfaceLanguage)}
                </button>
                {text.trim() && (
                  <button
                    onClick={() => { setWsMenuId(null); handleShare(); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
                  >
                    <Share2 className="w-3.5 h-3.5" />
                    {t('SHARE_LESSON', userPrefs.interfaceLanguage)}
                  </button>
                )}
                {text.trim() && explainHistory.length > 0 && (
                  <>
                    <div className="mx-2 my-1 border-t border-[var(--border-light)]" />
                    <button
                      onClick={() => { setWsMenuId(null); exportCards(); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                      Export .tsv (Anki)
                    </button>
                    <button
                      onClick={() => { setWsMenuId(null); startFlashcards(); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
                    >
                      <Layers className="w-3.5 h-3.5" />
                      {t('FLASHCARDS', userPrefs.interfaceLanguage)}
                    </button>
                    <button
                      onClick={() => { setWsMenuId(null); retranslateAll(); }}
                      disabled={retranslating}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors disabled:opacity-50"
                    >
                      {retranslating
                        ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /><span>{t('RETRANSLATE', userPrefs.interfaceLanguage)} {retranslateProgress}</span></>
                        : <><RefreshCw className="w-3.5 h-3.5" /><span>{t('RETRANSLATE', userPrefs.interfaceLanguage)}</span></>
                      }
                      {!isPaidUser && user?.role !== 'admin' && <Crown className="w-3 h-3 ml-auto text-amber-400" />}
                    </button>
                  </>
                )}
                {decksCount > 0 && (
                  <>
                    <div className="mx-2 my-1 border-t border-[var(--border-light)]" />
                    <button
                      onClick={() => { setWsMenuId(null); onOpenReview(); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
                    >
                      <BookOpen className="w-3.5 h-3.5" />
                      {t('REVIEW_DECK', userPrefs.interfaceLanguage)}
                    </button>
                  </>
                )}
                {!isEmbedMode && text.trim() && (
                  <>
                    <div className="mx-2 my-1 border-t border-[var(--border-light)]" />
                    <button
                      onClick={() => { setWsMenuId(null); onClearWorkspace(); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      {t('CLEAR', userPrefs.interfaceLanguage)}
                    </button>
                  </>
                )}
                {workspaces.length > 1 && (
                  <button
                    onClick={() => { setWsMenuId(null); if (activeWorkspaceId) { const isEmpty = !text.trim(); if (isEmpty) deleteWorkspace(activeWorkspaceId); else setDeleteConfirm({ id: activeWorkspaceId, name: workspaces.find(w => w.id === activeWorkspaceId)?.name || '' }); } }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-red-500 hover:bg-[var(--bg-hover)] transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    {t('DELETE_CONFIRM', userPrefs.interfaceLanguage)}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {((!fullTextPlaying || tutorialStep !== null) && !isTouchDevice) && (
        <div data-tutorial="quick-input" className="flex items-center gap-1.5">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-[var(--text-faint)] pointer-events-none" />
            <input
              type="text"
              value={quickInput}
              onChange={(e) => setQuickInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleQuickExplain(); }}
              placeholder={t('EXPLAIN_WORD', userPrefs.interfaceLanguage)}
              className="w-32 lg:w-40 text-xs pl-7 pr-2 py-1.5 border border-[var(--border-main)] rounded-lg focus:outline-none focus:border-[var(--border-accent)] bg-[var(--bg-panel)] text-[var(--text-primary)] placeholder:text-[var(--text-faint)] transition-colors"
              dir={textDir}
              spellCheck={false}
            />
          </div>
          <button
            onClick={() => speakPhrase(quickInput.trim())}
            disabled={!quickInput.trim() || speaking}
            className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors disabled:opacity-40"
            title={t('LISTEN', userPrefs.interfaceLanguage)}
          >
            {speaking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Volume2 className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={handleQuickExplain}
            disabled={!quickInput.trim() || loading}
            className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors disabled:opacity-40"
            title={t('EXPLAIN', userPrefs.interfaceLanguage)}
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          </button>
        </div>
      )}

      {fullTextPlaying || (tutorialStep !== null && TUTORIAL_STEPS[tutorialStep]?.target === 'text-player') ? (
        <motion.div
          data-tutorial="text-player"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="fixed bottom-2 left-2 right-2 z-40 sm:static sm:left-auto sm:right-auto sm:bottom-auto flex flex-col gap-2 bg-[var(--bg-playbar)] text-white px-3 sm:px-4 py-2 rounded-2xl shadow-lg sm:w-full lg:w-auto lg:min-w-[340px]"
        >
          {/* Row 1 — transport (always one line). Settings inline on sm+, on row 2 below on mobile. */}
          <div className="flex items-center gap-2">
            <button
              onClick={prevSentence}
              disabled={currentSentenceIndex <= 0}
              className="hover:text-[var(--text-muted)] transition-colors disabled:opacity-30"
            >
              <SkipBack className="w-4 h-4" />
            </button>
            {fullTextPaused ? (
              <button onClick={resumeFullTextPlayback} className="hover:text-[var(--text-muted)] transition-colors">
                <Play className="w-4 h-4 fill-current" />
              </button>
            ) : (
              <button onClick={pauseFullTextPlayback} className="hover:text-[var(--text-muted)] transition-colors">
                <Pause className="w-4 h-4 fill-current" />
              </button>
            )}
            <button
              onClick={() => {
                const phrase = sentencesRef.current[currentSentenceIndex];
                if (phrase) speakPhrase(phrase);
              }}
              disabled={!fullTextPaused || speaking || currentSentenceIndex < 0}
              className="hover:text-[var(--text-muted)] transition-colors disabled:opacity-30"
              title={t('REPEAT_SENTENCE', userPrefs.interfaceLanguage)}
            >
              <RotateCcw className="w-4 h-4" />
            </button>
            <button
              onClick={nextSentence}
              disabled={currentSentenceIndex >= sentencesRef.current.length - 1}
              className="hover:text-[var(--text-muted)] transition-colors disabled:opacity-30"
            >
              <SkipForward className="w-4 h-4" />
            </button>
            {/* Playback timing — always visible (row 1 on mobile, inline on desktop). */}
            <div className="w-px h-4 bg-white/20" />
            <button
              onClick={() => { const next = sentencePause >= 8 ? 0 : sentencePause + 1; setSentencePause(next); sentencePauseRef.current = next; }}
              className="px-1.5 py-0.5 rounded text-[10px] font-mono font-medium transition-colors hover:bg-white/10"
              title={t('PAUSE_BETWEEN_SENTENCES', userPrefs.interfaceLanguage)}
            >
              <span className="opacity-50">⏱</span> {sentencePause}s
            </button>
            <button
              onClick={() => { const next = sentenceRepeat >= 5 ? 1 : sentenceRepeat + 1; setSentenceRepeat(next); sentenceRepeatRef.current = next; }}
              className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-mono font-medium transition-colors hover:bg-white/10 ${sentenceRepeat > 1 ? 'text-white' : ''}`}
              title={t('REPEAT_EACH_SENTENCE', userPrefs.interfaceLanguage)}
            >
              <Repeat className="w-3 h-3" /> ×{sentenceRepeat}
            </button>
            <button
              onClick={() => {
                const i = PLAYBACK_SPEEDS.indexOf(playbackSpeed);
                setPlaybackSpeed(PLAYBACK_SPEEDS[(i + 1) % PLAYBACK_SPEEDS.length]);
              }}
              disabled={speedSwitching}
              className={`flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium transition-colors hover:bg-white/10 disabled:hover:bg-transparent ${playbackSpeed !== 1 ? 'text-white' : ''}`}
              title={t('PLAYBACK_SPEED', userPrefs.interfaceLanguage)}
            >
              {speedSwitching ? <Loader2 className="w-3 h-3 animate-spin" /> : `${playbackSpeed}×`}
            </button>
            {/* Audio styling — inline on sm+, hidden on mobile (rendered on row 2 below). */}
            <div className="hidden sm:contents">
              <div className="w-px h-4 bg-white/20" />
              <button
                onClick={() => setAcousticPreset(nextAcousticPreset(acousticPreset))}
                className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-medium transition-colors hover:bg-white/10 ${acousticPreset !== 'none' ? 'text-white' : ''}`}
                title={t('ACOUSTIC_PRESET', userPrefs.interfaceLanguage)}
              >
                <span className="opacity-50">🎙</span> {t(`ACOUSTIC_${acousticPreset.toUpperCase()}`, userPrefs.interfaceLanguage)}
              </button>
              <button
                onClick={() => setNoisePreset(nextNoisePreset(noisePreset))}
                className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-medium transition-colors hover:bg-white/10 ${noisePreset !== 'none' ? 'text-white' : ''}`}
                title={t('BG_NOISE_PRESET', userPrefs.interfaceLanguage)}
              >
                <span className="opacity-50">🌆</span> {t(`BG_NOISE_${noisePreset.toUpperCase()}`, userPrefs.interfaceLanguage)}
              </button>
              <button
                onClick={() => setNoiseLevel(nextNoiseLevel(noiseLevel))}
                disabled={noisePreset === 'none'}
                className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-medium transition-colors hover:bg-white/10 disabled:opacity-40 disabled:hover:bg-transparent ${noisePreset !== 'none' && noiseLevel !== 'ambient' ? 'text-white' : ''}`}
                title={t('NOISE_LEVEL', userPrefs.interfaceLanguage)}
              >
                <span className="opacity-50">🔉</span> {t(`NOISE_LEVEL_${noiseLevel.toUpperCase()}`, userPrefs.interfaceLanguage)}
              </button>
              {voiceCatalog.length > 0 && (
                <button
                  onClick={cycleVoice}
                  disabled={voiceSwitching}
                  className="flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium transition-colors hover:bg-white/10 disabled:hover:bg-transparent text-white"
                  title={t('VOICE_PRESET', userPrefs.interfaceLanguage)}
                >
                  {voiceSwitching ? <Loader2 className="w-3 h-3 animate-spin" /> : <><span className="opacity-50">🗣</span> {currentVoiceName ?? '—'}</>}
                </button>
              )}
              <div className="w-px h-4 bg-white/20" />
              <button
                onClick={downloadFullTextAudio}
                disabled={downloadingAudio}
                className="flex items-center whitespace-nowrap hover:text-[var(--text-muted)] transition-colors disabled:opacity-30"
                title={t('DOWNLOAD_AUDIO', userPrefs.interfaceLanguage)}
              >
                {downloadingAudio ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><Download className="w-3.5 h-3.5" /><span className="text-[9px] ml-0.5">.WAV</span></>}
              </button>
              <div className="w-px h-4 bg-white/20" />
            </div>
            <span className="text-[10px] font-mono ml-auto text-[var(--text-tertiary)]">
              {currentSentenceIndex + 1} / {sentencesRef.current.length || 1}
            </span>
            <button onClick={stopFullTextPlayback} className="hover:text-[var(--text-muted)] transition-colors ml-1">
              <X className="w-4 h-4" />
            </button>
          </div>
          {/* Row 2 — audio styling (mobile only): acoustic, background noise, level, download. */}
          <div className="flex sm:hidden items-center gap-2 flex-wrap">
            <button
              onClick={() => setAcousticPreset(nextAcousticPreset(acousticPreset))}
              className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-medium transition-colors hover:bg-white/10 ${acousticPreset !== 'none' ? 'text-white' : ''}`}
              title={t('ACOUSTIC_PRESET', userPrefs.interfaceLanguage)}
            >
              <span className="opacity-50">🎙</span> {t(`ACOUSTIC_${acousticPreset.toUpperCase()}`, userPrefs.interfaceLanguage)}
            </button>
            <button
              onClick={() => setNoisePreset(nextNoisePreset(noisePreset))}
              className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-medium transition-colors hover:bg-white/10 ${noisePreset !== 'none' ? 'text-white' : ''}`}
              title={t('BG_NOISE_PRESET', userPrefs.interfaceLanguage)}
            >
              <span className="opacity-50">🌆</span> {t(`BG_NOISE_${noisePreset.toUpperCase()}`, userPrefs.interfaceLanguage)}
            </button>
            <button
              onClick={() => setNoiseLevel(nextNoiseLevel(noiseLevel))}
              disabled={noisePreset === 'none'}
              className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-medium transition-colors hover:bg-white/10 disabled:opacity-40 disabled:hover:bg-transparent ${noisePreset !== 'none' && noiseLevel !== 'ambient' ? 'text-white' : ''}`}
              title={t('NOISE_LEVEL', userPrefs.interfaceLanguage)}
            >
              <span className="opacity-50">🔉</span> {t(`NOISE_LEVEL_${noiseLevel.toUpperCase()}`, userPrefs.interfaceLanguage)}
            </button>
            {voiceCatalog.length > 0 && (
              <button
                onClick={cycleVoice}
                disabled={voiceSwitching}
                className="flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium transition-colors hover:bg-white/10 disabled:hover:bg-transparent text-white"
                title={t('VOICE_PRESET', userPrefs.interfaceLanguage)}
              >
                {voiceSwitching ? <Loader2 className="w-3 h-3 animate-spin" /> : <><span className="opacity-50">🗣</span> {currentVoiceName ?? '—'}</>}
              </button>
            )}
            <button
              onClick={downloadFullTextAudio}
              disabled={downloadingAudio}
              className="flex items-center whitespace-nowrap hover:text-[var(--text-muted)] transition-colors disabled:opacity-30 ml-auto"
              title={t('DOWNLOAD_AUDIO', userPrefs.interfaceLanguage)}
            >
              {downloadingAudio ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><Download className="w-3.5 h-3.5" /><span className="text-[9px] ml-0.5">.WAV</span></>}
            </button>
          </div>
          {/* Interactive progress bar */}
          <div
            className="relative h-1.5 bg-[var(--bg-hover)] rounded-full cursor-pointer group mx-0.5"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              const rect = e.currentTarget.getBoundingClientRect();
              seekToProgress((e.clientX - rect.left) / rect.width);
            }}
            onPointerMove={(e) => {
              if (e.buttons > 0) {
                const rect = e.currentTarget.getBoundingClientRect();
                seekToProgress((e.clientX - rect.left) / rect.width);
              }
            }}
          >
            <div
              className="h-full bg-[var(--bg-panel)] rounded-full pointer-events-none"
              style={{ width: `${overallProgress * 100}%` }}
            />
            <div
              className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-[var(--bg-panel)] rounded-full shadow-md pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ left: `calc(${overallProgress * 100}% - 6px)` }}
            />
          </div>
        </motion.div>
      ) : null}
    </div>
  );
}
