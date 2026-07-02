/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useCallback, useEffect, useMemo, type CSSProperties, type SyntheticEvent, type MouseEvent as ReactMouseEvent } from 'react';
import Admin from './Admin';
import Monitoring from './Monitoring';
import Landing from './Landing';
import { GoogleLogin } from '@react-oauth/google';
import { motion, AnimatePresence } from "motion/react";
import {
  BookOpen,
  Loader2,
  Languages,
  Info,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Plus,
  Volume2,
  History,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Settings,
  Eye,
  EyeOff,
  Mic,
  Trash2,
  Pencil,
  Download,
  X,
  Shuffle,
  RotateCcw,
  Quote,
  BookPlus,
  Wand2,
  RefreshCw,
  Search,
  CircleHelp,
  Globe,
  Repeat,
  Copy,
  Menu,
  Camera,
  Image as ImageIcon,
} from "lucide-react";

import { Modal } from './components/Modal';
import { Header } from './components/Header';
import { openInCourses } from './lib/openInCourses';
import { ExplanationPanel } from './components/ExplanationPanel';
import { TextToolbar } from './components/TextToolbar';
import { DecksModal } from './components/DecksModal';
import { chunksToWav, pcmToAudioBuffer, decodeJwt, LEAD_SILENCE, resizeImageToDataUrl, cropDataUrlToDataUrl, isExplanationStale } from './utils';
import ReactCrop, { type PercentCrop } from 'react-image-crop';
import { TIMEOUTS } from './constants';
import { useApiClient } from './hooks/useApiClient';
import { useFlashcards } from './hooks/useFlashcards';
import { useDecks } from './hooks/useDecks';
import { deriveCard } from './lib/deriveCard';
import { speakerLabelTokenIndices } from './lib/dialog';
import {
  initDeck as srsInitDeck, selectNext as srsSelectNext, record as srsRecord,
  DEFAULT_CONFIG as SRS_DEFAULT, type DeckSched,
} from './lib/intervalScheduler';

// In-memory "current session" practice runs the same interval-doubling
// scheduler as saved decks (M=1 → X_MAX = deck size), so a missed card
// resurfaces ~4 cards later instead of immediately — matching the deck path.
const SESSION_SRS_CONFIG = { ...SRS_DEFAULT, M: 1 };
import { useWorkspaces, type Workspace } from './hooks/useWorkspaces';
import { useTtsPlayer } from './hooks/useTtsPlayer';

const MAX_RECORDING_SECONDS = 20;

function detectInAppBrowser(): string | null {
  const ua = navigator.userAgent || '';
  if (/LinkedInApp/i.test(ua)) return 'LinkedIn';
  if (/FBAN|FBAV/i.test(ua)) return 'Facebook';
  if (/Instagram/i.test(ua)) return 'Instagram';
  if (/Twitter/i.test(ua)) return 'Twitter';
  if (/Snapchat/i.test(ua)) return 'Snapchat';
  if (/TikTok|BytedanceWebview/i.test(ua)) return 'TikTok';
  if (/Telegram/i.test(ua)) return 'Telegram';
  if (/WhatsApp/i.test(ua)) return 'WhatsApp';
  return null;
}

// True only when running as a proper Telegram Mini App (signed initData present).
// Returns false for shared links opened inside Telegram's regular in-app browser.
function isTelegramMiniApp(): boolean {
  return typeof window !== 'undefined' && !!window.Telegram?.WebApp?.initData;
}

import { LANGUAGES, LOGOGRAPHIC_LANGUAGES, getTextLimit, TRANSLATIONS, t } from './i18n';
import { getGrammar } from './i18n/grammar';
import type { UserPreferences, User, ExplanationResult, AcousticPreset, NoisePreset, NoiseLevel, TtsVoiceOption, DeckSummary } from './types';
import { nextAcousticPreset, nextNoisePreset, nextNoiseLevel, ACOUSTIC_PRESETS, NOISE_PRESETS } from './types';

// --- Tutorial Steps ---
interface TutorialStep {
  target: string;
  titleKey: string;
  descriptionKey: string;
  position: 'top' | 'bottom' | 'left' | 'right';
  fallbackPosition: 'top' | 'bottom';
  forceShow?: boolean; // element is rendered only when this step is active — never skip it
}

const TUTORIAL_STEPS: TutorialStep[] = [
  { target: 'textarea', titleKey: 'TUT_TEXTAREA_TITLE', descriptionKey: 'TUT_TEXTAREA_DESC', position: 'right', fallbackPosition: 'bottom' },
  { target: 'lang-selector', titleKey: 'TUT_LANG_TITLE', descriptionKey: 'TUT_LANG_DESC', position: 'bottom', fallbackPosition: 'bottom' },
  { target: 'hide-text-btn', titleKey: 'TUT_HIDE_TITLE', descriptionKey: 'TUT_HIDE_DESC', position: 'bottom', fallbackPosition: 'bottom' },
  { target: 'listen-full-btn', titleKey: 'TUT_LISTEN_TITLE', descriptionKey: 'TUT_LISTEN_DESC', position: 'bottom', fallbackPosition: 'bottom' },
  { target: 'text-player', titleKey: 'TUT_PLAYER_TITLE', descriptionKey: 'TUT_PLAYER_DESC', position: 'bottom', fallbackPosition: 'bottom', forceShow: true },
  { target: 'record-btn', titleKey: 'TUT_RECORD_TITLE', descriptionKey: 'TUT_RECORD_DESC', position: 'bottom', fallbackPosition: 'bottom' },
  { target: 'generate-btn', titleKey: 'TUT_GENERATE_TITLE', descriptionKey: 'TUT_GENERATE_DESC', position: 'bottom', fallbackPosition: 'bottom' },
  { target: 'flashcards-btn', titleKey: 'TUT_FLASHCARDS_TITLE', descriptionKey: 'TUT_FLASHCARDS_DESC', position: 'bottom', fallbackPosition: 'bottom' },
  { target: 'export-btn', titleKey: 'TUT_EXPORT_TITLE', descriptionKey: 'TUT_EXPORT_DESC', position: 'bottom', fallbackPosition: 'bottom' },
  { target: 'quick-input', titleKey: 'TUT_QUICK_INPUT_TITLE', descriptionKey: 'TUT_QUICK_INPUT_DESC', position: 'bottom', fallbackPosition: 'bottom' },
  { target: 'results-panel', titleKey: 'TUT_RESULTS_TITLE', descriptionKey: 'TUT_RESULTS_DESC', position: 'left', fallbackPosition: 'top' },
  { target: 'history', titleKey: 'TUT_HISTORY_TITLE', descriptionKey: 'TUT_HISTORY_DESC', position: 'left', fallbackPosition: 'bottom' },
  { target: 'workspace-tabs', titleKey: 'TUT_WORKSPACES_TITLE', descriptionKey: 'TUT_WORKSPACES_DESC', position: 'bottom', fallbackPosition: 'bottom' },
  { target: 'feedback-btn', titleKey: 'TUT_FEEDBACK_TITLE', descriptionKey: 'TUT_FEEDBACK_DESC', position: 'bottom', fallbackPosition: 'bottom' },
  { target: 'help-btn', titleKey: 'TUT_HELP_TITLE', descriptionKey: 'TUT_HELP_DESC', position: 'bottom', fallbackPosition: 'bottom' },
  { target: 'settings-btn', titleKey: 'TUT_SETTINGS_TITLE', descriptionKey: 'TUT_SETTINGS_DESC', position: 'bottom', fallbackPosition: 'bottom' },
];

function TutorialOverlay({ step, totalSteps, stepDef, lang, onNext, onSkip }: {
  step: number;
  totalSteps: number;
  stepDef: TutorialStep;
  lang: string;
  onNext: () => void;
  onSkip: () => void;
}) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const isLast = step === totalSteps - 1;

  const recalc = useCallback(() => {
    const el = document.querySelector(`[data-tutorial="${stepDef.target}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Wait for scroll to finish before measuring position
      setTimeout(() => {
        setRect(el.getBoundingClientRect());
      }, 400);
    } else {
      setRect(null);
    }
  }, [stepDef.target]);

  useEffect(() => {
    // For forceShow steps the target element may render one tick after tutorialStep changes — retry once
    const t = setTimeout(recalc, 80);
    recalc();
    window.addEventListener('resize', recalc);
    return () => { clearTimeout(t); window.removeEventListener('resize', recalc); };
  }, [recalc]);

  const pad = 6;

  // Tooltip always centered on screen
  const tooltipStyle: CSSProperties = { position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', maxWidth: 340 };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-[60] pointer-events-none"
    >
      {/* Spotlight overlay */}
      {rect && (
        <div
          className="absolute rounded-lg border-[3px] border-red-500 pointer-events-none"
          style={{
            top: rect.top - pad,
            left: rect.left - pad,
            width: rect.width + pad * 2,
            height: rect.height + pad * 2,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)',
          }}
        />
      )}
      {/* Dark overlay when no target */}
      {!rect && <div className="absolute inset-0 bg-[var(--bg-overlay)]" />}

      {/* Tooltip */}
      <div
        style={tooltipStyle}
        className="bg-[var(--bg-panel)] rounded-xl shadow-2xl p-4 z-[61] pointer-events-auto"
      >
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1">{t(stepDef.titleKey, lang)}</h3>
        <p className="text-xs text-[var(--text-tertiary)] mb-3">{t(stepDef.descriptionKey, lang)}</p>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-[var(--text-muted)]">{step + 1} / {totalSteps}</span>
          <div className="flex gap-2">
            <button
              onClick={onSkip}
              className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors px-2 py-1"
            >
              {t('TUT_SKIP', lang)}
            </button>
            <button
              onClick={onNext}
              className="text-xs font-medium bg-[var(--bg-accent)] text-[var(--text-on-accent)] px-3 py-1 rounded-lg hover:bg-[var(--bg-accent-hover)] transition-colors"
            >
              {isLast ? t('TUT_DONE', lang) : t('TUT_NEXT', lang)}
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function AppRouter() {
  const path = window.location.pathname;
  if (path === '/admin') return <Admin />;
  if (path === '/monitoring') return <Monitoring />;
  if (path.startsWith('/s/')) {
    const code = path.slice(3);
    // Forward the cross-app SSO params too. In prod the Express /s/:code route
    // 302s with these preserved, but when the SPA is served directly (dev, or
    // any client-side hit) this handler runs instead — dropping sso/from here
    // silently kills the account handoff from courses.
    const params = new URLSearchParams(window.location.search);
    const sso = params.get('sso');
    const from = params.get('from');
    let dest = `/app?import=${encodeURIComponent(code)}`;
    if (sso) dest += `&sso=${encodeURIComponent(sso)}`;
    if (from) dest += `&from=${encodeURIComponent(from)}`;
    window.location.replace(dest);
    return null;
  }
  if (path === '/app' || path === '/embed') return <App />;
  // Telegram Mini App: skip the marketing landing and go straight to /app.
  if (isTelegramMiniApp()) {
    window.location.replace('/app');
    return null;
  }
  return <Landing />;
}

export default AppRouter;

function App() {
  const isEmbedMode = window.location.pathname === '/embed' || new URLSearchParams(window.location.search).has('embed');

  // Load user preferences from localStorage
  const [userPrefs, setUserPrefs] = useState<UserPreferences>(() => {
    const stored = localStorage.getItem('userPrefs');
    const browserLang = (navigator.language || 'en').split('-')[0].toLowerCase();
    const detectedLang = LANGUAGES[browserLang] ? browserLang : 'en';
    let parsed: UserPreferences = { interfaceLanguage: detectedLang, explanationLanguage: detectedLang, defaultTextLanguage: 'de' };
    if (stored) {
      try { parsed = JSON.parse(stored); } catch (_) { localStorage.removeItem('userPrefs'); }
    }
    // Cross-app theme handoff from glottos-courses: ?theme=light|dark on the
    // arrival URL overrides the saved tutor pref for this session. The user
    // just toggled it on courses, so that's their fresh intent. Read it here
    // in the state initializer (sync, before first render) so the document
    // class lands on the right value with no flash. Persistence + URL scrub
    // happens later in the SSO bootstrap effect.
    try {
      const urlTheme = new URLSearchParams(window.location.search).get('theme');
      if (urlTheme === 'light' || urlTheme === 'dark') {
        parsed = { ...parsed, theme: urlTheme };
      }
    } catch { /* ignore */ }
    return { defaultTextLanguage: 'de', ...parsed };
  });

  // Apply theme class to <html> element
  useEffect(() => {
    const theme = userPrefs.theme || 'dark';
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [userPrefs.theme]);

  const [text, setText] = useState('');
  const [textareaFocused, setTextareaFocused] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(
    () => localStorage.getItem('session_id')
  );
  // Listening-comprehension presets — synced into userPrefs so they persist
  // across reloads. Refs mirror state for use inside playback callbacks.
  // Clamp persisted prefs to the current preset list — old values like
  // 'phone'/'cafe'/'club' (removed when the preset set was refreshed) would
  // otherwise leave the button stuck on a dead label and a no-op effect.
  // Initial values default to 'none' (clean). The active workspace's saved
  // scene gets applied later via setAcousticPreset/setNoisePreset once the
  // workspace state load completes — userPrefs no longer carries these,
  // they're stored per-workspace in the workspace's JSONB state.
  const [acousticPreset, setAcousticPresetState] = useState<AcousticPreset>('none');
  const [noisePreset, setNoisePresetState] = useState<NoisePreset>('none');
  // noiseLevel is per-workspace: starts at 'moderate' default, workspace
  // load overwrites; setter just updates state (saveState debounce persists).
  const [noiseLevel, setNoiseLevelState] = useState<NoiseLevel>('moderate');
  // Per-language voice catalog (fetched from the server) and the user's
  // selected voice for the current text language. The catalog is empty until
  // /api/tts/voices?lang=<X> returns — at which point the voice button
  // becomes visible. Selection is persisted per-language in userPrefs.ttsVoices.
  const [voiceCatalog, setVoiceCatalog] = useState<TtsVoiceOption[]>([]);
  const [currentVoice, setCurrentVoiceState] = useState<string | null>(null);
  const acousticPresetRef = useRef<AcousticPreset>(acousticPreset);
  const noisePresetRef = useRef<NoisePreset>(noisePreset);
  const voiceRef = useRef<string | null>(null);
  // Mirror the catalog into a ref so the read-all dialog logic can read the
  // current language's voices (with gender) inside callbacks without re-renders.
  const voiceCatalogRef = useRef<TtsVoiceOption[]>([]);
  useEffect(() => { voiceCatalogRef.current = voiceCatalog; }, [voiceCatalog]);
  const setAcousticPreset = useCallback((p: AcousticPreset) => {
    acousticPresetRef.current = p;
    setAcousticPresetState(p);
    // Persistence happens via saveState's debounced workspace write — the
    // dep list there includes acousticPreset, so a change schedules a save.
  }, []);
  const setNoisePreset = useCallback((p: NoisePreset) => {
    noisePresetRef.current = p;
    setNoisePresetState(p);
  }, []);
  const setNoiseLevel = useCallback((l: NoiseLevel) => {
    setNoiseLevelState(l);
  }, []);
  // Wrapper applied at user-edit setText call sites (textarea typing, OCR
  // import, generate-text, clear-workspace). Resets the listening scene to
  // 'Clean / Quiet' on any actual content change — workspace-load setText
  // calls don't go through this so a freshly-restored workspace keeps its
  // saved scene. Per the requirement: any edit of the text → clean defaults,
  // then the workspace remembers whatever the user picks afterwards.
  const setTextAndResetScene = useCallback((next: string) => {
    setText(next);
    if (acousticPresetRef.current !== 'none') {
      acousticPresetRef.current = 'none';
      setAcousticPresetState('none');
    }
    if (noisePresetRef.current !== 'none') {
      noisePresetRef.current = 'none';
      setNoisePresetState('none');
    }
  }, []);

  // Set the voice for the current workspace. Just updates state + ref;
  // the workspace's debounced saveState picks it up via its dep list.
  const setCurrentVoice = useCallback((voiceId: string | null) => {
    voiceRef.current = voiceId;
    setCurrentVoiceState(voiceId);
  }, []);

  const [textLanguage, setTextLanguage] = useState('de');
  const [selection, setSelection] = useState('');
  const [quickInput, setQuickInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ExplanationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  interface ToastState {
    msg: string;
    actionLabel?: string;
    /** Invoked when the user taps the action button. Toast dismisses afterwards. */
    onAction?: () => void;
  }
  const [toast, setToast] = useState<ToastState | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [showUnsaved, setShowUnsaved] = useState(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Show a toast. Two call shapes for backwards compatibility:
   *   showToast('message')
   *   showToast('message', { actionLabel: 'Undo', onAction: () => …, durationMs: 5000 })
   */
  const showToast = useCallback((msg: string, opts?: { actionLabel?: string; onAction?: () => void; durationMs?: number }) => {
    setToast({ msg, actionLabel: opts?.actionLabel, onAction: opts?.onAction });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), opts?.durationMs ?? TIMEOUTS.TOAST);
  }, []);
  const [explainHistory, setExplainHistory] = useState<string[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const [feedbackType, setFeedbackType] = useState<'bug' | 'feature' | 'other'>('feature');
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [showGenerateText, setShowGenerateText] = useState(false);
  const [generateLevel, setGenerateLevel] = useState('B1');
  const [generateSentences, setGenerateSentences] = useState('10');
  const [generateTopic, setGenerateTopic] = useState('');
  const [generateInstructions, setGenerateInstructions] = useState('');
  // When on, generate a dialogue: each line is "Name: utterance" (works with
  // the read-all per-speaker dialog voices).
  const [generateDialog, setGenerateDialog] = useState(false);
  const [generateLoading, setGenerateLoading] = useState(false);
  const [showImageOcr, setShowImageOcr] = useState(false);
  const [ocrPreviewUrl, setOcrPreviewUrl] = useState<string | null>(null);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [ocrCrop, setOcrCrop] = useState<PercentCrop | null>(null);
  const [ocrNaturalSize, setOcrNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const ocrCameraInputRef = useRef<HTMLInputElement>(null);
  const ocrLibraryInputRef = useRef<HTMLInputElement>(null);
  // Hover-tooltip state for explained words/phrases (desktop only)
  const [hoverTip, setHoverTip] = useState<{ text: string; rect: { top: number; bottom: number; left: number; width: number } } | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverActiveKeyRef = useRef<string | null>(null);
  const [subscriptionStatus, setSubscriptionStatus] = useState('free');
  const [subscriptionPeriodEnd, setSubscriptionPeriodEnd] = useState<string | null>(null);
  const [cancelAtPeriodEnd, setCancelAtPeriodEnd] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [showLimitReached, setShowLimitReached] = useState(false);
  const { postJson } = useApiClient(sessionId, () => setShowLimitReached(true));
  const [showTextLimitWarning, setShowTextLimitWarning] = useState(false);
  const [showSelectionLimitWarning, setShowSelectionLimitWarning] = useState(false);
  const [stripePrices, setStripePrices] = useState<Array<{ id: string; amount: number; currency: string; interval: string; intervalCount: number; productName: string }>>([]);
  const [dailyUsage, setDailyUsage] = useState<{ explains: number; tts: number; generates: number }>({ explains: 0, tts: 0, generates: 0 });
  const [dailyLimits, setDailyLimits] = useState<{ explains: number; tts: number; generates: number } | null>(null);
  const [freeMaxGenerateSentences, setFreeMaxGenerateSentences] = useState(30);
  const [freeMaxTextLength, setFreeMaxTextLength] = useState(0); // 0 = unlimited
  const [appSettings, setAppSettings] = useState<Record<string, string>>({ llm_model: 'gemini-2.5-flash-lite', thinking_budget: '-1' });
  const [showLanguageSetup, setShowLanguageSetup] = useState(false);
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(null);
  const [tutorialStep, setTutorialStep] = useState<number | null>(null);
  const [selectionHintDismissed, setSelectionHintDismissed] = useState(false);
  useEffect(() => {
    if (selectionHintDismissed) return;
    const dismiss = () => setSelectionHintDismissed(true);
    window.addEventListener('scroll', dismiss, { once: true, capture: true });
    window.addEventListener('touchmove', dismiss, { once: true });
    return () => { window.removeEventListener('scroll', dismiss, true); window.removeEventListener('touchmove', dismiss); };
  }, [selectionHintDismissed]);
  const [explainNavIdx, setExplainNavIdx] = useState(-1);
  const [textHidden, setTextHidden] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [hasRecording, setHasRecording] = useState(false);
  const [playingRecording, setPlayingRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingBlobUrlRef = useRef<string | null>(null);
  const recordingAudioRef = useRef<HTMLAudioElement | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const resultSectionRef = useRef<HTMLElement>(null);
  const pendingScrollToResultRef = useRef(false);
  const backToTextBtnRef = useRef<HTMLButtonElement>(null);
  const explanationCacheRef = useRef<Map<string, ExplanationResult>>(new Map());
  const isDirtyRef = useRef(false);                         // readable from async callbacks
  const wsUpdatedAtRef = useRef<Map<string, string>>(new Map()); // workspaceId → ISO timestamp
  const originIdRef = useRef<string>(crypto.randomUUID()); // origin lineage tracking for duplicate import detection
  const pendingImportDataRef = useRef<any>(null);
  const [showDuplicateImportModal, setShowDuplicateImportModal] = useState(false);
  const [showSyncModal, setShowSyncModal] = useState(false);
  const syncResolveRef = useRef<((choice: 'sync' | 'keep-local') => void) | null>(null);
  const serverTimestampForSyncRef = useRef<string | null>(null);
  const skipSyncCheckRef = useRef(false);                  // true during full-text playback (avoid per-sentence checks)
  const checkServerSyncRef = useRef<() => Promise<'ok' | 'sync' | 'keep-local'>>(() => Promise.resolve('ok'));
  const loadWorkspaceStateRef = useRef<(sid: string, wsId: string) => Promise<void>>(async () => {});
  const activeWorkspaceIdLocalRef = useRef<string | null>(null); // local mirror of activeWorkspaceIdRef for use before useWorkspaces
  const saveStateRef = useRef<(options?: { beacon?: boolean }) => void>(() => {}); // always-current saveState for event listeners
  const savingRef = useRef(false); // true while a save fetch is in-flight
  const savePendingRef = useRef(false); // true if state changed during an in-flight save
  const [floatingToolbarPos, setFloatingToolbarPos] = useState<{x: number, y: number} | null>(null);
  const floatingToolbarRef = useRef<HTMLDivElement>(null);

  const isPaidUser = subscriptionStatus === 'active' || subscriptionStatus === 'trialing' || subscriptionStatus === 'past_due';
  const isAnonymous = user?.role === 'anonymous';
  const disabledTextLanguages = useMemo(() => {
    const raw = appSettings.disabled_text_languages || '';
    return new Set(raw.split(',').map(s => s.trim()).filter(Boolean));
  }, [appSettings.disabled_text_languages]);
  const inTrial = (() => {
    const trialDays = parseInt(appSettings.free_trial_days || '0', 10);
    if (trialDays <= 0 || !user?.created_at || isPaidUser) return false;
    return Date.now() < new Date(user.created_at).getTime() + trialDays * 86400_000;
  })();
  const anonLimitsOn = appSettings.anon_limits_enabled !== 'false' && !inTrial;
  const freeLimitsOn = appSettings.free_limits_enabled !== 'false' && !inTrial;
  const effectiveTextLimit = isAnonymous && anonLimitsOn && parseInt(appSettings.anon_max_text_length || '0', 10) > 0
    ? Math.min(parseInt(appSettings.anon_max_text_length, 10), getTextLimit(textLanguage))
    : !isPaidUser && !isAnonymous && freeLimitsOn && freeMaxTextLength > 0
      ? Math.min(freeMaxTextLength, getTextLimit(textLanguage))
      : getTextLimit(textLanguage);

  // Close user menu on outside click
  useEffect(() => {
    if (!showUserMenu) return;
    const handler = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) setShowUserMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showUserMenu]);

  // --- Activity logging ---
  const logAction = useCallback((action: string, detail?: string, inputUnits?: number, outputUnits?: number) => {
    if (!sessionId) return;
    const device = window.matchMedia('(pointer: coarse)').matches ? 'mobile' : 'desktop';
    fetch('/api/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Session-Id': sessionId },
      body: JSON.stringify({ action, detail, inputUnits, outputUnits, device }),
    }).catch(() => {});
  }, [sessionId]);

  // --- Export flashcards ---
  const exportCards = useCallback(() => {
    const cache = explanationCacheRef.current;
    if (cache.size === 0) return;

    const rows: string[] = [];
    cache.forEach((r, phrase) => {
      const isWord = r.input_type === 'word';
      const front = isWord ? (r.morphology?.lemma || r.selection || phrase) : (r.selection || phrase);
      let back = '';
      if (isWord) {
        if (r.lemma_translation) back = r.lemma_translation;
        else if (r.meanings?.length) back = r.meanings.join(', ');
        else if (r.target_translations?.length) back = r.target_translations.map(tt => tt.text).join(', ');
      } else {
        if (r.meanings?.length) back = r.meanings.join(', ');
        else if (r.translation) back = r.translation;
        else if (r.target_translations?.length) back = r.target_translations.map(tt => tt.text).join(', ');
      }
      if (back) rows.push(`${front}\t${back}`);
    });

    const csv = rows.join('\n');
    const blob = new Blob([csv], { type: 'text/tab-separated-values;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `polyglottos-cards-${textLanguage}.tsv`;
    a.click();
    URL.revokeObjectURL(url);
    logAction('export_cards', `${cache.size} cards`);
  }, [textLanguage, logAction]);

  // Fetch the verified voice catalog whenever the text language changes.
  // Empty list means the language isn't in the catalog (or verification
  // hasn't completed yet) — the voice button stays hidden. The workspace's
  // saved voice was already applied during workspace load; here we just
  // validate it against the new catalog and fall back to catalog[0] if it
  // doesn't fit (e.g. user changed the language inside an existing
  // workspace whose saved voice belonged to the previous language).
  useEffect(() => {
    let cancelled = false;
    const headers: HeadersInit = { 'Content-Type': 'application/json' };
    if (sessionId) (headers as any)['x-session-id'] = sessionId;
    fetch(`/api/tts/voices?lang=${encodeURIComponent(textLanguage)}`, { headers })
      .then(r => r.ok ? r.json() : { voices: [] })
      .then(({ voices }: { voices: TtsVoiceOption[] }) => {
        if (cancelled) return;
        setVoiceCatalog(voices);
        const current = voiceRef.current;
        if (current && voices.some(v => v.id === current)) return; // already valid
        const fallback = voices[0]?.id ?? null;
        voiceRef.current = fallback;
        setCurrentVoiceState(fallback);
      })
      .catch(() => { if (!cancelled) { setVoiceCatalog([]); voiceRef.current = null; setCurrentVoiceState(null); } });
    return () => { cancelled = true; };
  }, [textLanguage, sessionId]);

  const completeTutorial = useCallback(() => {
    setTutorialStep(null);
    const newPrefs = { ...userPrefs, tutorialCompleted: true };
    setUserPrefs(newPrefs);
    localStorage.setItem('userPrefs', JSON.stringify(newPrefs));
    if (sessionId) {
      fetch('/api/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
        body: JSON.stringify(newPrefs),
      }).catch(err => console.error('Failed to save preferences:', err));
    }
  }, [userPrefs, sessionId]);

  // --- Mobile tap-to-select read mode ---
  const isTouchDevice = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
  // Viewport-narrow check for the workspace tab limit (3 on mobile, 5 on
  // desktop). Reactive so a window resize crossing the sm breakpoint
  // (640 px) updates the tab bar without a reload.
  const [isNarrowViewport, setIsNarrowViewport] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 640px)');
    const handler = (e: MediaQueryListEvent) => setIsNarrowViewport(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  const textDir = textLanguage === 'he' || textLanguage === 'ar' ? 'rtl' as const : 'ltr' as const;
  const explDir = userPrefs.explanationLanguage === 'he' || userPrefs.explanationLanguage === 'ar' ? 'rtl' as const : 'ltr' as const;
  const [editMode, setEditMode] = useState(false);
  const [tapWordRange, setTapWordRange] = useState<[number, number] | null>(null);
  const wordViewRef = useRef<HTMLDivElement>(null);
  const actionTakenRef = useRef(false); // set after Listen/Explain so next tap resets selection

  // Languages where each character is selectable (no word-separating spaces)
  const isPerCharLang = textLanguage === 'zh' || textLanguage === 'ja' || textLanguage === 'th';

  const textTokens = useMemo(() => {
    if (!text) return [];
    if (isPerCharLang) {
      // Split into individual characters, keeping whitespace/newlines as separate tokens
      return [...text].reduce<string[]>((acc, ch: string) => {
        if (/\s/.test(ch)) {
          // Merge consecutive whitespace into one token
          if (acc.length && /^\s+$/.test(acc[acc.length - 1])) {
            acc[acc.length - 1] += ch;
          } else {
            acc.push(ch);
          }
        } else {
          acc.push(ch);
        }
        return acc;
      }, []);
    }
    return text.split(/(\s+)/).filter(Boolean);
  }, [text, isPerCharLang]);

  // Token indices that make up a dialog speaker label ("Name:") at a line start.
  // These render gray and are excluded from tap/selection for explain/listen.
  const personaTokenIndices = useMemo(
    () => speakerLabelTokenIndices(text, textTokens),
    [text, textTokens],
  );

  // Map token indices to styles based on previously explained words/phrases.
  // Also produce the data the hover tooltip needs:
  //   tokenExplanationKey: tokenIndex -> explainHistory key (word wins over phrase
  //     when both cover the same token; latest word wins if multiple).
  //   tokenTooltipText:    explainHistory key -> the cached translation to show.
  const { explainedTokenStyles, tokenExplanationKey, tokenTooltipText } = useMemo(() => {
    const styles = new Map<number, 'bold' | 'underline' | 'both'>();
    const tokenKey = new Map<number, string>();
    const tipText = new Map<string, string>();
    if (!textTokens.length || !explainHistory.length) {
      return { explainedTokenStyles: styles, tokenExplanationKey: tokenKey, tokenTooltipText: tipText };
    }

    const normalize = (s: string) => s.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

    // Build list of non-whitespace token indices for phrase matching
    const nonWsIndices: number[] = [];
    const normalizedTokens: string[] = [];
    for (let i = 0; i < textTokens.length; i++) {
      if (!/^\s+$/.test(textTokens[i])) {
        nonWsIndices.push(i);
        normalizedTokens.push(normalize(textTokens[i]));
      }
    }

    const pickTooltipText = (cached: ExplanationResult): string => {
      if (cached.input_type === 'word') {
        return (cached.meanings?.[0]?.trim() || cached.lemma_translation || '').trim();
      }
      return (cached.translation || '').trim();
    };

    // Word matches always win over phrase matches when assigning the tooltip key.
    const claimKey = (idx: number, phrase: string, isWord: boolean) => {
      const existing = tokenKey.get(idx);
      if (isWord || !existing) tokenKey.set(idx, phrase);
    };

    for (const phrase of explainHistory) {
      const cached = explanationCacheRef.current.get(phrase);
      if (!cached) continue;
      const sel = cached.selection;

      const isWord = cached.input_type === 'word';
      // For per-char languages, split selection into individual characters for matching
      const selWords = isPerCharLang
        ? [...String(sel)].filter((ch: string) => !/\s/.test(ch)).map(normalize)
        : sel.split(/\s+/).filter(Boolean).map(normalize);
      if (!selWords.length) continue;

      const tipForPhrase = pickTooltipText(cached);
      if (tipForPhrase) tipText.set(phrase, tipForPhrase);

      if (selWords.length === 1) {
        // Single-token match
        for (let j = 0; j < nonWsIndices.length; j++) {
          if (normalizedTokens[j] === selWords[0]) {
            const idx = nonWsIndices[j];
            const existing = styles.get(idx);
            if (isWord) {
              styles.set(idx, existing === 'underline' ? 'both' : existing === 'both' ? 'both' : 'bold');
            } else {
              styles.set(idx, existing === 'bold' ? 'both' : existing === 'both' ? 'both' : 'underline');
            }
            if (tipForPhrase) claimKey(idx, phrase, isWord);
          }
        }
      } else {
        // Multi-token: sliding window match (works for both multi-word "words" like "Das Zimmer" and sentences)
        for (let j = 0; j <= nonWsIndices.length - selWords.length; j++) {
          let match = true;
          for (let k = 0; k < selWords.length; k++) {
            if (normalizedTokens[j + k] !== selWords[k]) { match = false; break; }
          }
          if (match) {
            const firstIdx = nonWsIndices[j];
            const lastIdx = nonWsIndices[j + selWords.length - 1];
            // Style all tokens INCLUDING whitespace spans between first and last word
            for (let idx = firstIdx; idx <= lastIdx; idx++) {
              const existing = styles.get(idx);
              if (isWord) {
                styles.set(idx, existing === 'underline' ? 'both' : existing === 'both' ? 'both' : 'bold');
              } else {
                styles.set(idx, existing === 'bold' ? 'both' : existing === 'both' ? 'both' : 'underline');
              }
              if (tipForPhrase) claimKey(idx, phrase, isWord);
            }
          }
        }
      }
    }
    return { explainedTokenStyles: styles, tokenExplanationKey: tokenKey, tokenTooltipText: tipText };
  }, [textTokens, explainHistory, isPerCharLang]);

  // Token indices matching the currently active explanation
  const activeExplanationTokens = useMemo(() => {
    const indices = new Set<number>();
    if (!result?.selection || !textTokens.length) return indices;
    const normalize = (s: string) => s.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    const nonWsIndices: number[] = [];
    const normalizedTokens: string[] = [];
    for (let i = 0; i < textTokens.length; i++) {
      if (!/^\s+$/.test(textTokens[i])) {
        nonWsIndices.push(i);
        normalizedTokens.push(normalize(textTokens[i]));
      }
    }
    const selWords = result.selection.split(/\s+/).filter(Boolean).map(normalize);
    if (!selWords.length) return indices;
    for (let j = 0; j <= nonWsIndices.length - selWords.length; j++) {
      let match = true;
      for (let k = 0; k < selWords.length; k++) {
        if (normalizedTokens[j + k] !== selWords[k]) { match = false; break; }
      }
      if (match) {
        for (let k = 0; k < selWords.length; k++) indices.add(nonWsIndices[j + k]);
      }
    }
    return indices;
  }, [result?.selection, textTokens]);

  // Clear tap selection when text changes
  useEffect(() => {
    setTapWordRange(null);
  }, [text]);

  const handleWordTap = useCallback((wordIndex: number) => {
    if (actionTakenRef.current) {
      // After Listen/Explain: reset selection, start fresh on this word
      actionTakenRef.current = false;
      setTapWordRange([wordIndex, wordIndex]);
      const word = textTokens[wordIndex].replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
      setSelection(word || textTokens[wordIndex]);
    } else if (tapWordRange && tapWordRange[0] !== wordIndex) {
      // Second tap: select range from first to this word
      const [start] = tapWordRange;
      const range: [number, number] = start < wordIndex ? [start, wordIndex] : [wordIndex, start];
      setTapWordRange(range);
      // Drop any dialog speaker labels the range happens to span (cross-line).
      const selected = textTokens.slice(range[0], range[1] + 1)
        .filter((_, j) => !personaTokenIndices.has(range[0] + j))
        .join('').trim();
      setSelection(selected);
    } else if (tapWordRange && tapWordRange[0] === wordIndex && tapWordRange[1] === wordIndex) {
      // Tap same word again: deselect
      setTapWordRange(null);
      setSelection('');
    } else {
      // First tap: select single word
      setTapWordRange([wordIndex, wordIndex]);
      const word = textTokens[wordIndex].replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
      setSelection(word || textTokens[wordIndex]);
    }
  }, [tapWordRange, textTokens, personaTokenIndices]);

  const handleSelection = (e?: { clientX: number; clientY: number }) => {
    if (textareaRef.current) {
      const start = textareaRef.current.selectionStart;
      const end = textareaRef.current.selectionEnd;
      const selected = text.substring(start, end).trim();
      if (selected) {
        setSelection(selected);
        if (e) {
          setFloatingToolbarPos({ x: e.clientX, y: e.clientY });
        } else {
          setFloatingToolbarPos(null);
        }
      } else {
        setFloatingToolbarPos(null);
      }
    }
  };

  // Click-away dismissal for floating toolbar (textarea selection + read mode tap selection)
  useEffect(() => {
    if (!floatingToolbarPos && tapWordRange === null) return;
    const handler = (e: MouseEvent) => {
      const clickedInsideToolbar = floatingToolbarRef.current && floatingToolbarRef.current.contains(e.target as Node);
      if (clickedInsideToolbar) return;
      if (floatingToolbarPos) setFloatingToolbarPos(null);
      // Clear tap selection if clicking outside wordView — desktop only
      // (on mobile the bottom action bar handles its own dismiss)
      if (!isTouchDevice && tapWordRange !== null && wordViewRef.current && !wordViewRef.current.contains(e.target as Node)) {
        setTapWordRange(null);
        setSelection('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [floatingToolbarPos, tapWordRange, isTouchDevice]);

  // Escape key: clear tap selection first, then exit edit mode on desktop
  useEffect(() => {
    if (isTouchDevice) return;
    if (!tapWordRange && !editMode) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (tapWordRange !== null) {
          setTapWordRange(null);
          setSelection('');
        } else if (editMode && text) {
          setEditMode(false);
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [editMode, text, isTouchDevice, tapWordRange]);

  // ── TTS Player hook ──────────────────────────────────────────────────────
  const {
    speaking, ttsFetching,
    fullTextPlaying, fullTextPaused, fullTextPrefetching,
    currentSentenceIndex, sentencePause, setSentencePause,
    sentenceRepeat, setSentenceRepeat,
    playbackSpeed, setPlaybackSpeed, speedSwitching, voiceSwitching,
    history, setHistory,
    audioProgress, overallProgress,
    speakPhrase, prefetchSentences,
    startFullTextPlayback, stopFullTextPlayback,
    pauseFullTextPlayback, resumeFullTextPlayback,
    nextSentence, prevSentence,
    stopAllAudio, startHeartbeat,
    seekToProgress,
    speakingRef, sentencesRef, sentencePauseRef, sentenceRepeatRef, playbackSpeedRef,
    ttsCacheRef, ttsRawCacheRef, audioContextRef, savedScrollYRef,
  } = useTtsPlayer({
    text, textLanguage, sessionId, selection, effectiveTextLimit,
    logAction, showToast,
    setShowLimitReached, setShowTextLimitWarning, setDailyUsage,
    skipSyncCheckRef, checkServerSyncRef, loadWorkspaceStateRef, activeWorkspaceIdRef: activeWorkspaceIdLocalRef,
    textareaRef,
    acousticPresetRef,
    acousticPreset,
    noisePresetRef,
    noisePreset,
    noiseLevel,
    voiceRef,
    voice: currentVoice,
    voiceCatalogRef,
  });

  const {
    showFlashcards, setShowFlashcards,
    flashcards, flashcardIndex,
    flashcardFlipped, setFlashcardFlipped,
    flashcardReversed, setFlashcardReversed,
    flashcardFrontHidden, setFlashcardFrontHidden,
    flashcardAutoplay, flashcardPrefetching, flashcardDelay, flashcardDelayRef,
    startFlashcards, startFlashcardsFromCards, shuffleFlashcards, deleteFlashcard,
    nextFlashcard, prevFlashcard,
    startFlashcardAutoplay, stopFlashcardAutoplay, cycleDelay,
  } = useFlashcards({
    explanationCacheRef,
    speakPhrase,
    prefetchSentences,
    textLanguage,
    explanationLanguage: userPrefs.explanationLanguage,
    stopAllAudio,
    startHeartbeat,
    speakingRef,
  });

  // --- Flashcard decks (user-level, cross-workspace) ---
  // Initial values stay empty; App pushes hydration via `hydrate()` once /api/state arrives.
  const {
    decks,
    activeDeckId,
    cardsByDeck,
    createDeck,
    renameDeck,
    deleteDeck,
    setActiveDeck,
    loadCards,
    addCardToActiveDeck,
    addAllToActiveDeck,
    addCard,
    removeCardLocal,
    commitCardDelete,
    restoreCard,
    isCardInDeck,
    hydrate: hydrateDecks,
    startPractice,
    gradeCard,
    srsByDeck,
    loadSrsForDeck,
  } = useDecks({
    sessionId,
    initialDecks: [],
    initialActiveDeckId: null,
    setUserPrefs,
    defaultDeckName: t('MY_DECK', userPrefs.interfaceLanguage),
  });

  const [showDecksModal, setShowDecksModal] = useState(false);
  const [flashcardSource, setFlashcardSource] = useState<'session' | string>('session');

  // --- SRS Practice mode state ---
  // Browse = the existing flip-through; Practice = SRS scheduler-driven session.
  // Only meaningful when `flashcardSource` is a saved deck (i.e. not 'session').
  type FlashcardMode = 'browse' | 'practice';
  const [flashcardMode, setFlashcardMode] = useState<FlashcardMode>('browse');
  // Practice is time-boxed: the user picks a duration and works the FULL deck
  // (streamed by the scheduler) until the clock runs out, then sees a summary.
  type PracticeMinutes = 1 | 3 | 5 | 10 | 30;
  const [practiceMinutes, setPracticeMinutes] = useState<PracticeMinutes>(10);
  // The realised show sequence this sitting. For the in-memory "session" source
  // cards cycle through a reshuffled order; for a saved deck the interval-
  // doubling scheduler streams the next card after each grade.
  const [practiceCardIds, setPracticeCardIds] = useState<string[]>([]);
  // Timer: practiceDeadline is the wall-clock ms at which the sitting ends;
  // practiceTimeUp flips true when it passes → the summary screen shows.
  const [practiceDeadline, setPracticeDeadline] = useState<number>(0);
  const [practiceTimeUp, setPracticeTimeUp] = useState<boolean>(false);
  // Total cards available this sitting (deck size / session card count) — the
  // denominator for the "% of deck challenged" stat.
  const [practiceDeckSize, setPracticeDeckSize] = useState<number>(0);
  // Interval-doubling scheduler state for the in-memory "session" source (held
  // in a ref since it's ephemeral — never persisted). Decks keep theirs server-side.
  const practiceSessionSchedRef = useRef<DeckSched | null>(null);
  // Result of each card's FIRST show this sitting (true = remembered). Its keys
  // are the "challenged" set; its true-count is the "remembered first try" stat.
  const practiceFirstResultRef = useRef<Map<string, boolean>>(new Map());
  // Snapshot of the session batch's card ids (in-memory source only) so the
  // "Repeat" button can replay the exact same set. Decks have no fixed batch.
  const practiceBatchOriginalRef = useRef<string[]>([]);
  const [practiceIndex, setPracticeIndex] = useState(0);
  const [practiceStats, setPracticeStats] = useState<{ remembered: number; forgot: number }>({ remembered: 0, forgot: 0 });
  const [practiceLoading, setPracticeLoading] = useState(false);
  const [practiceGrading, setPracticeGrading] = useState(false);
  // Examples-popover state, shared by Browse and Practice. Holds the {text,
  // translation} pairs to render; null = hidden. textLang/explanationLang lets
  // the speak buttons inside the modal use the right voice per side.
  const [examplesPopup, setExamplesPopup] = useState<null | {
    /** Full explanation so the popup can also surface meanings + forms,
     *  not just the example sentences. Optional fields read defensively. */
    explanation: ExplanationResult;
    textLang: string;
    explanationLang: string;
    title: string;
  }>(null);
  // Which example indices have been revealed. The "guess" side starts blurred
  // — target text in reversed mode, translation otherwise — and the user
  // either taps the blurred line or the eye button to reveal.
  const [revealedExamples, setRevealedExamples] = useState<Set<number>>(new Set());
  // Meanings + Forms sections in the popover start collapsed so the popover
  // opens compact; the user expands what they want by tapping the header.
  const [meaningsExpanded, setMeaningsExpanded] = useState(false);
  const [formsExpanded, setFormsExpanded] = useState(false);
  // Whether the headline word at the top of the popover is revealed. Starts
  // false so the user has to guess the word from the examples first.
  const [titleRevealed, setTitleRevealed] = useState(false);
  // "More like this" variants per example index, scoped to the popover. Each
  // entry is the chain of variants generated so far for that source example;
  // the chain renders indented below the original.
  type PopupExampleVariant = { text: string; translation: string; loading?: boolean; error?: string };
  const [popupExampleVariants, setPopupExampleVariants] = useState<Map<number, PopupExampleVariant[]>>(new Map());
  // Reset reveal + expand + variant state every time a fresh popover opens.
  useEffect(() => {
    if (!examplesPopup) return;
    setRevealedExamples(new Set());
    setMeaningsExpanded(false);
    setFormsExpanded(false);
    setTitleRevealed(false);
    setPopupExampleVariants(new Map());
  }, [examplesPopup]);
  const toggleRevealedExample = useCallback((i: number) => {
    setRevealedExamples(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  }, []);

  // "More like this" handler for the Examples popover. Mirrors the per-row
  // logic ExplanationPanel uses but kept inline here since the popover has
  // its own compact visual style + already-existing reveal/blur state.
  const handlePopupMoreLikeThis = useCallback(async (rowIndex: number, source: { text: string; translation: string }) => {
    if (!examplesPopup) return;
    setPopupExampleVariants(prev => {
      const next = new Map<number, PopupExampleVariant[]>(prev);
      const chain = next.get(rowIndex) || [];
      next.set(rowIndex, [...chain, { text: '', translation: '', loading: true }]);
      return next;
    });
    try {
      const popup = examplesPopup;
      const expl = popup.explanation;
      const existingChain = popupExampleVariants.get(rowIndex) || [];
      const peers = (expl.examples || [])
        .filter((_, j) => j !== rowIndex)
        .map(e => e.text);
      const otherTexts = Array.from(new Set([
        expl.examples?.[rowIndex]?.text,
        ...peers,
        ...existingChain.map(v => v.text).filter(Boolean),
      ])).filter((t): t is string => Boolean(t) && t !== source.text);

      const body: Record<string, any> = {
        selection: expl.selection,
        inputType: expl.input_type,
        textLanguage: popup.textLang,
        explanationLanguage: popup.explanationLang,
        currentExample: source,
        otherExamples: otherTexts.map(text => ({ text })),
      };
      if (Array.isArray(expl.target_translations) && expl.target_translations.length > 0) {
        body.targetTranslations = expl.target_translations;
      } else if (expl.input_type === 'sentence') {
        body.translation = expl.translation;
      } else {
        body.meanings = expl.meanings;
      }

      const { result: variant } = await postJson<{ result: { text: string; translation: string } }>(
        '/api/explain/example-variant', body,
      );
      setPopupExampleVariants(prev => {
        const next = new Map<number, PopupExampleVariant[]>(prev);
        const chain = [...(next.get(rowIndex) || [])];
        const slot = chain.findIndex(v => v.loading);
        if (slot >= 0) chain[slot] = { text: variant.text, translation: variant.translation };
        next.set(rowIndex, chain);
        return next;
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setPopupExampleVariants(prev => {
        const next = new Map<number, PopupExampleVariant[]>(prev);
        const chain = [...(next.get(rowIndex) || [])];
        const slot = chain.findIndex(v => v.loading);
        if (slot >= 0) chain[slot] = { text: '', translation: '', error: msg };
        next.set(rowIndex, chain);
        return next;
      });
    }
  }, [examplesPopup, popupExampleVariants, postJson]);
  // Quick-add-from-flashcards state. The button opens this modal, the user
  // types a word, the same /api/explain endpoint that the explanation panel
  // uses returns an ExplanationResult, and Add to deck commits it via
  // useDecks.addCard against the deck the user is currently practicing (or
  // the active deck when in session-mode Browse).
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddText, setQuickAddText] = useState('');
  const [quickAddLoading, setQuickAddLoading] = useState(false);
  const [quickAddResult, setQuickAddResult] = useState<ExplanationResult | null>(null);
  const [quickAddError, setQuickAddError] = useState<string | null>(null);
  const [quickAddCommitting, setQuickAddCommitting] = useState(false);

  const openDeckReview = useCallback(() => setShowDecksModal(true), []);
  const createNewDeckPrompt = useCallback(async () => {
    // Loop so the user can correct a duplicate name without re-opening the menu.
    let suggested = t('MY_DECK', userPrefs.interfaceLanguage);
    while (true) {
      const name = window.prompt(t('DECK_NAME', userPrefs.interfaceLanguage), suggested);
      if (name === null) return;
      const trimmed = name.trim();
      if (!trimmed) return;
      const r = await createDeck(trimmed);
      if ('deck' in r) {
        await setActiveDeck(r.deck.id);
        return;
      }
      if (r.error === 'duplicate_name') {
        showToast(t('DECK_NAME_EXISTS', userPrefs.interfaceLanguage));
        suggested = trimmed;
        continue;
      }
      return;
    }
  }, [createDeck, setActiveDeck, userPrefs.interfaceLanguage, showToast]);

  const isCurrentCardInActiveDeck = !!(result && activeDeckId && isCardInDeck(activeDeckId, result.selection));

  // Listening practice: when "hide target" is active and a new Practice card
  // appears, auto-speak the target text so the user gets the only signal they
  // can use. Triggers on every practiceIndex change (incl. Forgot re-insertion
  // resurfacing the same card later) — the user is being quizzed each time.
  useEffect(() => {
    if (flashcardMode !== 'practice') return;
    if (!flashcardFrontHidden) return;
    if (practiceLoading || practiceGrading) return;
    const cardId = practiceCardIds[practiceIndex];
    if (cardId == null) return;
    // Resolve the target text + its language from either a saved deck card or an
    // in-memory session card (whose ids are indices into the flashcards array).
    let frontText: string | undefined;
    let frontLang: string | undefined;
    if (flashcardSource === 'session') {
      const item = flashcards[Number(cardId)];
      if (!item) return;
      frontText = item.front;
      frontLang = item.frontLang || textLanguage;
    } else {
      const deckCards = cardsByDeck.get(flashcardSource) || [];
      const card = deckCards.find(c => c.id === cardId);
      if (!card) return;
      const derived = deriveCard(card.explanation, card.text_language, card.source_text);
      if (!derived) return;
      frontText = derived.front;
      frontLang = card.text_language;
    }
    if (!frontText) return;
    // Tiny debounce so the speak doesn't race the React render that paints the
    // new card and the user actually sees what's about to be played.
    const handle = setTimeout(() => {
      speakPhrase(frontText!, undefined, frontLang, true);
    }, 120);
    return () => clearTimeout(handle);
  // speakPhrase / userPrefs intentionally omitted — we only want this to fire
  // when the SHOWN CARD changes, not every render that touches TTS state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [practiceIndex, practiceCardIds, flashcardMode, flashcardFrontHidden, practiceLoading, practiceGrading, flashcardSource]);

  // Lazy-load active deck cards once, so the "already in deck" badge resolves.
  useEffect(() => {
    if (activeDeckId && !cardsByDeck.has(activeDeckId)) {
      loadCards(activeDeckId);
    }
  }, [activeDeckId, cardsByDeck, loadCards]);

  // When the flashcards modal source switches to a deck, fetch its cards and
  // seed the flashcards in-memory list. Switching back to "session" restarts
  // from the current explanation cache.
  const handleFlashcardSourceChange = useCallback(async (source: 'session' | string) => {
    setFlashcardSource(source);
    // Switching source resets practice; user has to opt back into it explicitly.
    setFlashcardMode('browse');
    setPracticeCardIds([]);
    setPracticeIndex(0);
    setPracticeStats({ remembered: 0, forgot: 0 });
    setPracticeTimeUp(false);
    practiceFirstResultRef.current = new Map();
    practiceSessionSchedRef.current = null;
    if (source === 'session') {
      startFlashcards();
      return;
    }
    const items = await loadCards(source);
    const derived = items
      .map(c => {
        const d = deriveCard(c.explanation, c.text_language, c.source_text);
        // Card languages are frozen at create time. Fall back to the user's
        // current preference only for legacy cards (created before the
        // explanation_language column landed) — those rows return null.
        if (!d) return null;
        return {
          ...d,
          frontLang: c.text_language,
          backLang: c.explanation_language || userPrefs.explanationLanguage,
          // Pass through example sentences AND the full explanation so the
          // Browse Examples popover can render meanings + forms next to the
          // examples without re-fetching.
          examples: Array.isArray(c.explanation?.examples) ? c.explanation.examples : undefined,
          explanation: c.explanation,
        };
      })
      .filter((c): c is { front: string; back: string; frontLang?: string; backLang?: string; examples?: Array<{ text: string; translation: string }>; explanation?: ExplanationResult } => !!c);
    startFlashcardsFromCards(derived);
  }, [loadCards, startFlashcards, startFlashcardsFromCards, userPrefs.explanationLanguage]);

  /** Start (or continue) a time-boxed practice sitting. `deckIdOverride`,
   *  `directionOverride` and `minutesOverride` exist for callers that fire
   *  *immediately* after toggling state — the state setters haven't propagated
   *  yet at that point, so the closure-captured values are stale. Stats and the
   *  timer reset every call; the scheduler stream itself is not reset, so
   *  "Continue" just runs another interval over the ongoing full-deck stream. */
  const beginPractice = useCallback(async (
    deckIdOverride?: string,
    directionOverride?: 'forward' | 'reverse',
    minutesOverride?: PracticeMinutes,
  ) => {
    const deckId = deckIdOverride ?? flashcardSource;
    const direction = directionOverride ?? (flashcardReversed ? 'reverse' : 'forward');
    const minutes = minutesOverride ?? practiceMinutes;

    // Reset the per-sitting stats and arm the countdown.
    setPracticeStats({ remembered: 0, forgot: 0 });
    setPracticeIndex(0);
    setFlashcardFlipped(false);
    setPracticeTimeUp(false);
    setPracticeDeadline(Date.now() + minutes * 60_000);
    practiceFirstResultRef.current = new Map();

    // --- Current session: run the interval-doubling scheduler in-memory over
    // the unsaved flashcards (card ids are indices into the flashcards array,
    // stringified to share the deck-path plumbing). No persistence — the
    // scheduler lives in a ref for this sitting and streams cards the same way
    // the deck path does, so a missed card resurfaces ~4 cards later.
    if (deckId === 'session') {
      setPracticeLoading(true);
      const total = flashcards.length;
      setPracticeDeckSize(total);
      const allIds = Array.from({ length: total }, (_, i) => String(i));
      const seed = Math.floor(Math.random() * 0x7fffffff);
      const sel = srsSelectNext(srsInitDeck(allIds, seed, SESSION_SRS_CONFIG));
      practiceSessionSchedRef.current = sel.deck;
      practiceBatchOriginalRef.current = [...allIds]; // enables the "Repeat" button
      setPracticeCardIds(sel.cardId != null ? [sel.cardId] : []);
      setPracticeLoading(false);
      return;
    }
    // --- Saved deck: stream from the interval-doubling scheduler. Ask the
    // server for the single next card; subsequent cards arrive one at a time as
    // each grade is recorded (the scheduler recomputes the next position on
    // every review — no materialised batch). The sitting runs the full deck
    // until the timer elapses.
    setPracticeLoading(true);
    practiceBatchOriginalRef.current = []; // streaming: no fixed "Repeat" batch
    const r = await startPractice(deckId, direction);
    setPracticeLoading(false);
    setPracticeDeckSize(r?.deckSize ?? (cardsByDeck.get(deckId)?.length ?? 0));
    const first = r?.card?.cardId ?? null;
    setPracticeCardIds(first != null ? [first] : []);
  }, [flashcardSource, flashcardReversed, practiceMinutes, startPractice, setFlashcardFlipped, cardsByDeck, flashcards]);

  /** Restart the in-memory session over the same cards with a fresh shuffle,
   *  timer and stats. Only the session source populates this snapshot (a
   *  streaming deck has no fixed batch), so "Repeat" is shown for session only. */
  const repeatPractice = useCallback(() => {
    const ids = practiceBatchOriginalRef.current;
    if (ids.length === 0) return;
    setPracticeStats({ remembered: 0, forgot: 0 });
    setPracticeIndex(0);
    setFlashcardFlipped(false);
    setPracticeTimeUp(false);
    setPracticeDeadline(Date.now() + practiceMinutes * 60_000);
    practiceFirstResultRef.current = new Map();
    // Fresh scheduler over the same set so the order differs from last round.
    const seed = Math.floor(Math.random() * 0x7fffffff);
    const sel = srsSelectNext(srsInitDeck(ids, seed, SESSION_SRS_CONFIG));
    practiceSessionSchedRef.current = sel.deck;
    setPracticeCardIds(sel.cardId != null ? [sel.cardId] : []);
  }, [setFlashcardFlipped, practiceMinutes]);

  /** Switch the modal to Practice mode and kick off a sitting. */
  const enterPracticeMode = useCallback(async (deckIdOverride?: string) => {
    const deckId = deckIdOverride ?? flashcardSource;
    setFlashcardMode('practice');
    await beginPractice(deckId);
  }, [flashcardSource, beginPractice]);

  /** Flip the practice direction (forward ⇄ reverse). Restarts the sitting so
   *  the stream is scheduled against the right SRS state set. */
  const togglePracticeDirection = useCallback(async () => {
    const next = !flashcardReversed;
    setFlashcardReversed(next);
    setFlashcardFlipped(false);
    await beginPractice(undefined, next ? 'reverse' : 'forward');
  }, [flashcardSource, flashcardReversed, setFlashcardReversed, setFlashcardFlipped, beginPractice]);

  // Countdown: flip to the summary screen when the practice timer runs out.
  useEffect(() => {
    if (flashcardMode !== 'practice') return;
    if (practiceTimeUp || practiceLoading || !practiceDeadline) return;
    const remaining = practiceDeadline - Date.now();
    if (remaining <= 0) { setPracticeTimeUp(true); return; }
    const h = setTimeout(() => setPracticeTimeUp(true), remaining);
    return () => clearTimeout(h);
  }, [flashcardMode, practiceDeadline, practiceTimeUp, practiceLoading]);

  /** Grade the current practice card and advance. Every click counts toward the
   *  clicked-cards counter; the first result per card feeds the "first show"
   *  stat. The sitting ends on the timer, not a card count.
   *
   *  Both sources run the interval-doubling scheduler: a missed card's interval
   *  resets to the base so it resurfaces ~4 cards later (never immediately), and
   *  the next card is never the one just answered. The session source runs the
   *  scheduler in-memory; the deck source runs it on the server. */
  const handleGrade = useCallback(async (remembered: boolean) => {
    const cardId = practiceCardIds[practiceIndex];

    // Count the click and remember this card's first-show result (once).
    const recordStat = (id: string) => {
      setPracticeStats(s => remembered ? { ...s, remembered: s.remembered + 1 } : { ...s, forgot: s.forgot + 1 });
      if (!practiceFirstResultRef.current.has(id)) practiceFirstResultRef.current.set(id, remembered);
    };

    // --- Current session: drive the in-memory scheduler (no /grade call).
    if (flashcardSource === 'session') {
      if (cardId == null) return;
      recordStat(cardId);
      const sched = practiceSessionSchedRef.current;
      if (sched) {
        // Record, then pick the next card excluding the one just answered.
        const sel = srsSelectNext(srsRecord(sched, cardId, remembered), cardId);
        practiceSessionSchedRef.current = sel.deck;
        if (sel.cardId != null) setPracticeCardIds(prev => [...prev, sel.cardId!]);
      }
      setPracticeIndex(i => i + 1);
      setFlashcardFlipped(false);
      return;
    }

    if (!cardId || practiceGrading) return;

    setPracticeGrading(true);
    const direction = flashcardReversed ? 'reverse' : 'forward';
    const r = await gradeCard(flashcardSource, cardId, remembered, direction);
    setPracticeGrading(false);
    if (!r) {
      // Network error: stay on the card; let the user try again.
      showToast('Grade failed — retry');
      return;
    }
    recordStat(cardId);
    // Append the scheduler's next streamed card; the timer ends the sitting.
    const nextId = r.next?.cardId ?? null;
    if (nextId != null) setPracticeCardIds(prev => [...prev, nextId]);

    setPracticeIndex(i => i + 1);
    setFlashcardFlipped(false);
  }, [flashcardSource, flashcardReversed, practiceCardIds, practiceIndex, practiceGrading, gradeCard, setFlashcardFlipped, showToast]);

  /** Open the quick-add modal. Resets any previous attempt so the input is empty. */
  const openQuickAdd = useCallback(() => {
    setQuickAddOpen(true);
    setQuickAddText('');
    setQuickAddResult(null);
    setQuickAddError(null);
    setQuickAddCommitting(false);
  }, []);

  /** Fire the same /api/explain the explanation panel uses but keep the
   *  result LOCAL to the quick-add modal — don't pollute the workspace's
   *  explanationCache, explainHistory, or main result panel state. */
  const runQuickAddExplain = useCallback(async () => {
    const phrase = quickAddText.trim();
    if (!phrase) return;
    if (phrase.length > 150) {
      setQuickAddError('Too long');
      return;
    }
    setQuickAddLoading(true);
    setQuickAddError(null);
    setQuickAddResult(null);
    try {
      const { result: data } = await postJson<{ result: ExplanationResult }>('/api/explain', {
        phrase,
        text: '',
        textLanguage,
        explanationLanguage: userPrefs.explanationLanguage,
      });
      if (!data) throw new Error('Empty response');
      setQuickAddResult(data);
      setDailyUsage(prev => ({ ...prev, explains: prev.explains + 1 }));
    } catch (err) {
      if (err instanceof Error && err.message === 'quota_exceeded') return;
      setQuickAddError(err instanceof Error ? err.message : String(err));
    } finally {
      setQuickAddLoading(false);
    }
  }, [quickAddText, textLanguage, userPrefs.explanationLanguage, postJson, setDailyUsage]);

  /** Commit the quick-add explanation to the target deck. Picks the deck the
   *  user is currently practicing/browsing when that's a saved deck; otherwise
   *  routes to the active-deck flow which auto-creates "My Deck" on first add. */
  const commitQuickAdd = useCallback(async () => {
    if (!quickAddResult || quickAddCommitting) return;
    setQuickAddCommitting(true);
    const targetDeckId = flashcardSource !== 'session' ? flashcardSource : null;
    const ok = targetDeckId
      ? await addCard(targetDeckId, quickAddResult, textLanguage, userPrefs.explanationLanguage)
      : await addCardToActiveDeck(quickAddResult, textLanguage, userPrefs.explanationLanguage);
    setQuickAddCommitting(false);
    if (ok === 'no-deck') { setQuickAddError(t('SELECT_DECK', userPrefs.interfaceLanguage)); return; }
    if (!ok) { setQuickAddError('Failed to add — try again'); return; }
    setQuickAddOpen(false);
    showToast(t('ADDED_TO_DECK', userPrefs.interfaceLanguage));
  }, [quickAddResult, quickAddCommitting, flashcardSource, addCard, addCardToActiveDeck, textLanguage, userPrefs.explanationLanguage, userPrefs.interfaceLanguage, showToast]);

  const [downloadingAudio, setDownloadingAudio] = useState(false);

  const checkWavQuota = useCallback(async (type: 'text' | 'flashcards'): Promise<boolean> => {
    const sid = sessionId || localStorage.getItem('session_id');
    if (!sid) return true; // no auth = dev mode, allow
    try {
      const res = await fetch('/api/wav-download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Session-Id': sid },
        body: JSON.stringify({ type }),
      });
      if (res.status === 429) {
        setShowLimitReached(true);
        return false;
      }
      return res.ok;
    } catch {
      return true; // network error = allow (don't block offline)
    }
  }, [sessionId]);

  const downloadFullTextAudio = useCallback(async () => {
    if (!text.trim() || text.length > effectiveTextLimit) return;
    setDownloadingAudio(true);
    try {
      // Check weekly WAV quota before assembling
      const allowed = await checkWavQuota('text');
      if (!allowed) { setDownloadingAudio(false); return; }
      const limitedText = text.slice(0, getTextLimit(textLanguage));
      const sents = limitedText.split(/(?<=[.!?])\s+|\n+/).filter(s => s.trim().length > 0);
      if (sents.length === 0) return;
      logAction('download_full_audio');
      // Prefetch all sentences
      const failCount = await prefetchSentences(sents);
      if (failCount === sents.length) { showToast('TTS: failed to load audio'); return; }
      if (failCount > 0) showToast(`TTS: ${failCount} of ${sents.length} sentences failed`);
      // Build flat list of explicit chunks — each chunk is an Int16Array.
      // Silence is explicit zero-filled arrays, not "skip position" arithmetic.
      const pauseSeconds = sentencePauseRef.current;
      const repeatGapLen = pauseSeconds > 0 ? pauseSeconds * 24000 : 7200;
      const sentenceGapLen = pauseSeconds > 0 ? pauseSeconds * 24000 : 0;
      const repeat = sentenceRepeatRef.current;
      const speed = playbackSpeedRef.current ?? 1.0;
      // Create silence with near-inaudible noise (~-90dB) instead of pure zeros
      // to prevent WAV players from triggering silence-skip or auto-gain reset
      const makeSilence = (len: number): Int16Array => {
        const arr = new Int16Array(len);
        for (let i = 0; i < len; i++) arr[i] = (i & 1) ? 1 : -1; // alternating ±1 LSB
        return arr;
      };
      const chunks: Int16Array[] = [makeSilence(24000)]; // 1s lead-in for player startup
      let hasPcm = false;
      for (let si = 0; si < sents.length; si++) {
        const ck = `${textLanguage}:${speed}:${sents[si]}`;
        const raw = ttsRawCacheRef.current.get(ck);
        if (!raw) continue;
        const rawRes = await fetch(`data:application/octet-stream;base64,${raw}`);
        const rawBuf = await rawRes.arrayBuffer();
        const pcm = new Int16Array(new Int16Array(rawBuf)); // standalone copy
        hasPcm = true;
        for (let r = 0; r < repeat; r++) {
          chunks.push(makeSilence(LEAD_SILENCE));
          chunks.push(new Int16Array(pcm));                 // fresh copy each time
          if (r < repeat - 1 && repeatGapLen > 0) {
            chunks.push(makeSilence(repeatGapLen));
          }
        }
        if (si < sents.length - 1 && sentenceGapLen > 0) {
          chunks.push(makeSilence(sentenceGapLen));
        }
      }
      if (!hasPcm) { showToast('No audio data available'); return; }
      const blob = chunksToWav(chunks, 24000);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `polyglottos-${textLanguage}.wav`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    } finally {
      setDownloadingAudio(false);
    }
  }, [text, textLanguage, prefetchSentences, showToast, effectiveTextLimit, logAction, checkWavQuota]);

  const [downloadingFlashcards, setDownloadingFlashcards] = useState(false);

  const downloadFlashcardAudio = useCallback(async () => {
    if (flashcards.length === 0) return;
    setDownloadingFlashcards(true);
    try {
      // Check weekly WAV quota before assembling
      const allowed = await checkWavQuota('flashcards');
      if (!allowed) { setDownloadingFlashcards(false); return; }
      const reversed = flashcardReversed;
      // Per-card language resolution — saved decks tag each card with its own
      // front/back language so a mixed-language deck (or one whose language
      // differs from the current workspace) still gets the right voice.
      const cardFront = (c: typeof flashcards[number]) => reversed ? c.back : c.front;
      const cardBack = (c: typeof flashcards[number]) => reversed ? c.front : c.back;
      const cardFrontL = (c: typeof flashcards[number]) => (reversed
        ? (c.backLang || userPrefs.explanationLanguage)
        : (c.frontLang || textLanguage));
      const cardBackL = (c: typeof flashcards[number]) => (reversed
        ? (c.frontLang || textLanguage)
        : (c.backLang || userPrefs.explanationLanguage));
      const fronts = flashcards.map(cardFront);
      const backs = flashcards.map(cardBack);
      logAction('download_flashcard_audio');
      // Group by language for batched prefetch.
      const groupByLang = (
        pick: (c: typeof flashcards[number]) => string,
        lang: (c: typeof flashcards[number]) => string,
      ): Map<string, string[]> => {
        const groups = new Map<string, string[]>();
        for (const c of flashcards) {
          const k = lang(c);
          const arr = groups.get(k);
          if (arr) arr.push(pick(c)); else groups.set(k, [pick(c)]);
        }
        return groups;
      };
      const prefetchPromises: Promise<unknown>[] = [];
      groupByLang(cardFront, cardFrontL).forEach((s, l) => prefetchPromises.push(prefetchSentences(s, l)));
      groupByLang(cardBack, cardBackL).forEach((s, l) => prefetchPromises.push(prefetchSentences(s, l)));
      await Promise.all(prefetchPromises);
      const delaySeconds = flashcardDelayRef.current;
      const betweenCardSeconds = 2;
      const makeSilence = (len: number): Int16Array => {
        const arr = new Int16Array(len);
        for (let i = 0; i < len; i++) arr[i] = (i & 1) ? 1 : -1;
        return arr;
      };
      const chunks: Int16Array[] = [makeSilence(24000)]; // 1s lead-in
      let hasPcm = false;
      const speed = playbackSpeedRef.current ?? 1.0;
      for (let i = 0; i < flashcards.length; i++) {
        const frontKey = `${cardFrontL(flashcards[i])}:${speed}:${fronts[i]}`;
        const backKey = `${cardBackL(flashcards[i])}:${speed}:${backs[i]}`;
        const frontRaw = ttsRawCacheRef.current.get(frontKey);
        const backRaw = ttsRawCacheRef.current.get(backKey);
        // Front audio
        if (frontRaw) {
          const fb = await fetch(`data:application/octet-stream;base64,${frontRaw}`);
          const fBuf = await fb.arrayBuffer();
          chunks.push(makeSilence(LEAD_SILENCE));
          chunks.push(new Int16Array(new Int16Array(fBuf)));
          hasPcm = true;
        }
        // Wait between front and back (flashcardDelay)
        chunks.push(makeSilence(delaySeconds * 24000));
        // Back audio
        if (backRaw) {
          const bb = await fetch(`data:application/octet-stream;base64,${backRaw}`);
          const bBuf = await bb.arrayBuffer();
          chunks.push(makeSilence(LEAD_SILENCE));
          chunks.push(new Int16Array(new Int16Array(bBuf)));
          hasPcm = true;
        }
        // Wait between cards
        if (i < flashcards.length - 1) {
          chunks.push(makeSilence(betweenCardSeconds * 24000));
        }
      }
      if (!hasPcm) { showToast('No audio data available'); return; }
      const blob = chunksToWav(chunks, 24000);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `polyglottos-flashcards.wav`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    } finally {
      setDownloadingFlashcards(false);
    }
  }, [flashcards, flashcardReversed, textLanguage, userPrefs.explanationLanguage, prefetchSentences, showToast, logAction, checkWavQuota]);

  const lastExplainedPhraseRef = useRef('');

  const explainPhrase = useCallback(async (phrase: string) => {
    if (!phrase) return;
    if (text.length > effectiveTextLimit) {
      setShowTextLimitWarning(true);
      return;
    }
    if (phrase.length > 150) {
      setShowSelectionLimitWarning(true);
      return;
    }

    // Pre-action conflict check
    const syncResult = await checkServerSyncRef.current();
    if (syncResult === 'sync') {
      const sid = localStorage.getItem('session_id');
      if (sid && activeWorkspaceIdRef.current) await loadWorkspaceStateRef.current(sid, activeWorkspaceIdRef.current);
    }

    lastExplainedPhraseRef.current = phrase;

    const cachedExplanation = explanationCacheRef.current.get(phrase);
    if (cachedExplanation && !isExplanationStale(cachedExplanation)) {
      setResult(cachedExplanation);
      setExplainNavIdx(explainHistory.indexOf(phrase));
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { result: data } = await postJson<{ result: ExplanationResult }>('/api/explain', {
        phrase,
        text,
        textLanguage,
        explanationLanguage: userPrefs.explanationLanguage,
      });
      if (!data) {
        throw new Error('Empty response from explanation service');
      }
      // Defensive: a word with no antonyms must still carry an empty array, or
      // isExplanationStale() flags it on every click and we re-fetch forever.
      // The server normalizes this now; this guards against older servers too.
      const explanation = data as ExplanationResult;
      if (explanation.input_type === 'word' && !Array.isArray(explanation.antonyms)) {
        explanation.antonyms = [];
      }
      explanationCacheRef.current.set(phrase, explanation);
      setExplainHistory(prev => {
        const newHistory = prev.includes(phrase) ? prev : [...prev, phrase];
        setExplainNavIdx(newHistory.indexOf(phrase));
        return newHistory;
      });
      setResult(explanation);
      setDailyUsage(prev => ({ ...prev, explains: prev.explains + 1 }));
    } catch (err) {
      if (err instanceof Error && err.message === 'quota_exceeded') return;
      console.error('Explain error:', err);
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [text, textLanguage, userPrefs.explanationLanguage, sessionId, effectiveTextLimit, postJson]);

  // "More like this" — fetch one fresh example variant that uses the same
  // meaning as `currentExample` but in a genuinely different situation. The
  // current ExplanationResult provides the per-case context (meanings vs
  // translation vs target_translations) so the backend can reuse the same
  // prompting rules as /api/explain.
  const requestExampleVariant = useCallback(async (
    currentExample: { text: string; translation: string },
    otherExamples: string[],
  ): Promise<{ text: string; translation: string }> => {
    if (!result) throw new Error('no explanation in scope');
    const body: Record<string, any> = {
      selection: result.selection,
      inputType: result.input_type,
      textLanguage,
      explanationLanguage: userPrefs.explanationLanguage,
      currentExample,
      otherExamples: otherExamples.map(text => ({ text })),
    };
    if (Array.isArray(result.target_translations) && result.target_translations.length > 0) {
      body.targetTranslations = result.target_translations;
    } else if (result.input_type === 'sentence') {
      body.translation = result.translation;
    } else {
      body.meanings = result.meanings;
    }
    const { result: variant } = await postJson<{ result: { text: string; translation: string } }>(
      '/api/explain/example-variant', body,
    );
    return variant;
  }, [result, textLanguage, userPrefs.explanationLanguage, postJson]);

  const explainSelection = useCallback(() => {
    if (isTouchDevice) {
      savedScrollYRef.current = window.scrollY;
    }
    explainPhrase(selection);
    setSelectionHintDismissed(true);
    if (isTouchDevice) {
      setSelection('');
      setTapWordRange(null);
      pendingScrollToResultRef.current = true;
      setTimeout(() => {
        resultSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    } else if (editMode) {
      setEditMode(false);
      setFloatingToolbarPos(null);
    }
  }, [explainPhrase, selection, isTouchDevice, editMode]);

  const [retranslating, setRetranslating] = useState(false);
  const [retranslateProgress, setRetranslateProgress] = useState('');

  const retranslateAll = useCallback(async () => {
    if (!isPaidUser && user?.role !== 'admin') { setShowUpgrade(true); return; }
    // Use explainHistory (React state) as source of truth — explanationCacheRef may be stale after workspace switch
    const phrases = [...explainHistory];
    if (phrases.length === 0) return;
    setRetranslating(true);
    const sid = sessionId || '';
    let done = 0;
    for (const phrase of phrases) {
      setRetranslateProgress(`${++done}/${phrases.length}`);
      try {
        const res = await fetch('/api/explain', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Session-Id': sid },
          body: JSON.stringify({ phrase, text, textLanguage, explanationLanguage: userPrefs.explanationLanguage }),
        });
        if (res.ok) {
          const { result: data } = await res.json();
          if (data) explanationCacheRef.current.set(phrase, data as ExplanationResult);
        }
      } catch { /* continue with next */ }
    }
    // Update currently displayed result with retranslated version
    setResult(prev => {
      if (!prev) return prev;
      // Find by selection text match (cache key or selection field)
      for (const [key, val] of explanationCacheRef.current) {
        if (key === prev.selection || val.selection === prev.selection) return val;
      }
      return prev;
    });
    setRetranslating(false);
    setRetranslateProgress('');
    showToast(t('RETRANSLATE_DONE', userPrefs.interfaceLanguage));
  }, [isPaidUser, sessionId, text, textLanguage, explainHistory, userPrefs.explanationLanguage, userPrefs.interfaceLanguage, showToast]);

  const handleGenerateText = useCallback(async () => {
    setGenerateLoading(true);
    try {
      const { text: generated } = await postJson<{ text: string }>('/api/generate-text', {
        textLanguage,
        level: generateLevel,
        sentences: Math.min(30, Math.max(5, parseInt(generateSentences) || 10)),
        topic: generateTopic,
        instructions: generateInstructions,
        dialog: generateDialog,
      });
      // Dialog: keep the model's one-turn-per-line layout (so "Name: ..." lines
      // stay intact for the read-all dialog voices). Otherwise: one sentence per line.
      const formatted = generateDialog
        ? (generated as string).trim().replace(/\n{2,}/g, '\n')
        : (generated as string).replace(/([.!?।。！？])\s+/g, '$1\n');
      setTextAndResetScene(formatted);
      setShowGenerateText(false);
      setDailyUsage(prev => ({ ...prev, generates: prev.generates + 1 }));
    } catch (err) {
      if (err instanceof Error && err.message === 'quota_exceeded') return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerateLoading(false);
    }
  }, [sessionId, textLanguage, generateLevel, generateSentences, generateTopic, generateInstructions, generateDialog, postJson]);

  const handleOcrFilePick = useCallback(async (file: File | null) => {
    if (!file) return;
    setOcrError(null);
    setOcrCrop(null);
    setOcrNaturalSize(null);
    try {
      const dataUrl = await resizeImageToDataUrl(file);
      setOcrPreviewUrl(dataUrl);
    } catch (err) {
      setOcrError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const handleOcrImageLoad = useCallback((e: SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setOcrNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
    setOcrCrop({ unit: '%', x: 0, y: 0, width: 100, height: 100 });
  }, []);

  const handleOcrExtract = useCallback(async () => {
    if (!ocrPreviewUrl) return;
    setOcrLoading(true);
    setOcrError(null);
    try {
      // If user shrank the crop rectangle, send only that region. The 99.5%
      // threshold avoids cropping for users who never touched it.
      let imageToSend = ocrPreviewUrl;
      if (
        ocrCrop && ocrNaturalSize &&
        (ocrCrop.width < 99.5 || ocrCrop.height < 99.5 || ocrCrop.x > 0.5 || ocrCrop.y > 0.5)
      ) {
        imageToSend = await cropDataUrlToDataUrl(ocrPreviewUrl, {
          x: (ocrCrop.x / 100) * ocrNaturalSize.w,
          y: (ocrCrop.y / 100) * ocrNaturalSize.h,
          width: (ocrCrop.width / 100) * ocrNaturalSize.w,
          height: (ocrCrop.height / 100) * ocrNaturalSize.h,
        });
      }
      const { text: extracted } = await postJson<{ text: string }>('/api/ocr-extract', {
        image: imageToSend,
        language: textLanguage,
      });
      const trimmed = (extracted as string).trim();
      if (!trimmed) {
        setOcrError(t('OCR_NO_TEXT_FOUND', userPrefs.interfaceLanguage));
        return;
      }
      // Mirror handleGenerateText: one sentence per line, in case the model
      // returned a paragraph despite the prompt asking otherwise.
      const formatted = trimmed.replace(/([.!?।。！？])\s+/g, '$1\n');
      setTextAndResetScene(formatted);
      setShowImageOcr(false);
      setOcrPreviewUrl(null);
      setOcrCrop(null);
      setOcrNaturalSize(null);
      setDailyUsage(prev => ({ ...prev, generates: prev.generates + 1 }));
    } catch (err) {
      if (err instanceof Error && err.message === 'quota_exceeded') return;
      const status = (err as Error & { status?: number }).status;
      const detail = err instanceof Error ? err.message : String(err);
      // 422 → image unreadable; the server forwards the model's own short
      // explanation as the message. Show it without the generic prefix.
      if (status === 422) {
        setOcrError(detail);
        return;
      }
      const prefix = t('OCR_ERROR', userPrefs.interfaceLanguage);
      setOcrError(status ? `${prefix} (HTTP ${status}): ${detail}` : `${prefix}: ${detail}`);
    } finally {
      setOcrLoading(false);
    }
  }, [ocrPreviewUrl, ocrCrop, ocrNaturalSize, textLanguage, postJson, userPrefs.interfaceLanguage]);

  // Hover-tooltip handlers (desktop only). Event delegation off the read-mode
  // container: rest the cursor on a previously-explained token for ~1 s to see
  // its translation. Moving within tokens of the SAME phrase doesn't restart
  // the timer.
  const clearHoverTimer = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }, []);

  const handleTextHoverMove = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    if (isTouchDevice) return;
    const target = e.target as HTMLElement;
    const idxStr = target?.dataset?.tokenIndex;
    const idx = idxStr ? Number(idxStr) : NaN;
    const key = Number.isFinite(idx) ? tokenExplanationKey.get(idx) : undefined;
    const text = key ? tokenTooltipText.get(key) : undefined;

    if (!key || !text) {
      if (hoverActiveKeyRef.current !== null) {
        clearHoverTimer();
        hoverActiveKeyRef.current = null;
        setHoverTip(null);
      }
      return;
    }
    if (hoverActiveKeyRef.current === key) return; // same phrase, keep timer/tooltip
    clearHoverTimer();
    hoverActiveKeyRef.current = key;
    setHoverTip(null);
    const r = target.getBoundingClientRect();
    const rect = { top: r.top, bottom: r.bottom, left: r.left, width: r.width };
    hoverTimerRef.current = setTimeout(() => {
      setHoverTip({ text, rect });
    }, TIMEOUTS.HOVER_TOOLTIP_DELAY);
  }, [isTouchDevice, tokenExplanationKey, tokenTooltipText, clearHoverTimer]);

  const handleTextHoverLeave = useCallback(() => {
    clearHoverTimer();
    hoverActiveKeyRef.current = null;
    setHoverTip(null);
  }, [clearHoverTimer]);

  // Tokens may be reindexed when text changes — drop any pending/visible tooltip.
  useEffect(() => {
    clearHoverTimer();
    hoverActiveKeyRef.current = null;
    setHoverTip(null);
  }, [text, clearHoverTimer]);

  // Scroll to "Back to text" button when result appears on mobile
  useEffect(() => {
    if (pendingScrollToResultRef.current && result && !loading) {
      pendingScrollToResultRef.current = false;
      requestAnimationFrame(() => {
        backToTextBtnRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  }, [result, loading]);

  const handleQuickExplain = useCallback(() => {
    const phrase = quickInput.trim();
    if (!phrase) return;
    explainPhrase(phrase);
    setSelectionHintDismissed(true);
  }, [quickInput, explainPhrase]);

  // --- Voice Recorder ---
  const startRecording = useCallback(async () => {
    logAction('recording_start');
    try {
      // Reuse cached stream if still active, otherwise acquire a new one
      let stream = micStreamRef.current;
      if (!stream || stream.getTracks().some(t => t.readyState === 'ended')) {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        micStreamRef.current = stream;
      }
      // Pick a MIME type the browser actually supports (iOS Safari lacks webm)
      const mimeType = ['audio/webm', 'audio/mp4', 'audio/ogg', ''].find(
        t => t === '' || MediaRecorder.isTypeSupported(t)
      )!;
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = () => {
        if (recordingBlobUrlRef.current) URL.revokeObjectURL(recordingBlobUrlRef.current);
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        recordingBlobUrlRef.current = URL.createObjectURL(blob);
        setHasRecording(true);
        setIsRecording(false);
      };
      recorder.onstart = () => {
        setIsRecording(true);
      };
      mediaRecorderRef.current = recorder;
      setHasRecording(false);
      setPlayingRecording(false);
      recorder.start();
      recordingTimerRef.current = setTimeout(() => {
        if (mediaRecorderRef.current?.state === 'recording') {
          mediaRecorderRef.current.stop();
        }
      }, MAX_RECORDING_SECONDS * 1000);
    } catch (err) {
      console.error('Microphone error:', err);
      showToast(err instanceof Error ? err.message : 'Microphone access denied');
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (recordingTimerRef.current) { clearTimeout(recordingTimerRef.current); recordingTimerRef.current = null; }
    if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop();
  }, []);

  const toggleRecordingPlayback = useCallback(() => {
    if (playingRecording && recordingAudioRef.current) {
      recordingAudioRef.current.pause();
      recordingAudioRef.current.currentTime = 0;
      setPlayingRecording(false);
      return;
    }
    if (recordingBlobUrlRef.current) {
      const audio = new Audio(recordingBlobUrlRef.current);
      audio.onended = () => setPlayingRecording(false);
      recordingAudioRef.current = audio;
      audio.play().then(() => {
        setPlayingRecording(true);
      }).catch((err) => {
        setPlayingRecording(false);
        showToast(err instanceof Error ? err.message : 'Recording playback failed');
      });
    }
  }, [playingRecording]);

  const deleteRecording = useCallback(() => {
    if (recordingAudioRef.current) { recordingAudioRef.current.pause(); recordingAudioRef.current = null; }
    if (recordingBlobUrlRef.current) { URL.revokeObjectURL(recordingBlobUrlRef.current); recordingBlobUrlRef.current = null; }
    if (micStreamRef.current) { micStreamRef.current.getTracks().forEach(t => t.stop()); micStreamRef.current = null; }
    setHasRecording(false);
    setPlayingRecording(false);
  }, []);

  // --- Persistence ---
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRestoredRef = useRef(false);

  // ── Workspace hook ──────────────────────────────────────────────────────
  const {
    workspaces, setWorkspaces,
    activeWorkspaceId, setActiveWorkspaceId,
    editingTabId, setEditingTabId,
    editingTabName, setEditingTabName,
    deleteConfirm, setDeleteConfirm,
    workspaceLoading,
    workspacesRef, activeWorkspaceIdRef,
    wsStateCacheRef, switchingWorkspaceRef,
    isLoadingWorkspaceRef, wsLoadAbortRef,
    switchWorkspace, createWorkspace, deleteWorkspace, duplicateWorkspace, renameWorkspace,
    loadWorkspaceState,
  } = useWorkspaces({
    sessionId,
    text, setText,
    history, setHistory,
    explainHistory, setExplainHistory,
    result, setResult,
    textLanguage, setTextLanguage,
    acousticPreset, setAcousticPreset,
    noisePreset, setNoisePreset,
    noiseLevel, setNoiseLevel,
    voice: currentVoice, setVoice: setCurrentVoice,
    sentencePause, setSentencePause,
    sentenceRepeat, setSentenceRepeat,
    activeDeckId, setActiveDeck,
    explanationCacheRef, ttsRawCacheRef, ttsCacheRef, originIdRef,
    setIsDirty, isDirtyRef,
    wsUpdatedAtRef,
    saveTimerRef, savingRef, savePendingRef, saveStateRef, stateRestoredRef,
    stopFullTextPlayback,
    userPrefs: { defaultTextLanguage: userPrefs.defaultTextLanguage },
  });

  // Keep local ref mirror in sync with useWorkspaces' ref
  activeWorkspaceIdLocalRef.current = activeWorkspaceIdRef.current;

  // ── Workspace MRU order (drives the tab bar) ────────────────────────────
  // Tab bar shows the 5 most-recently-used workspaces; any beyond that live
  // in an overflow dropdown. Persisted to localStorage so the order survives
  // reload. On boot, unknown workspaces (those not in the stored list) are
  // appended by position; the active workspace is always pulled to the front
  // so it's guaranteed to be visible as a tab.
  const [wsOverflowOpen, setWsOverflowOpen] = useState(false);
  const [wsOverflowPos, setWsOverflowPos] = useState<{ top: number; left: number } | null>(null);
  const [mruOrder, setMruOrder] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem('wsMru');
      if (stored) return JSON.parse(stored);
    } catch { /* corrupt entry — start fresh */ }
    return [];
  });
  useEffect(() => {
    if (workspaces.length === 0) return;
    setMruOrder(prev => {
      const validIds = new Set(workspaces.map(w => w.id));
      let next = prev.filter(id => validIds.has(id));
      const present = new Set(next);
      const missing = [...workspaces].sort((a, b) => a.position - b.position)
        .filter(w => !present.has(w.id))
        .map(w => w.id);
      next = [...next, ...missing];
      if (activeWorkspaceId && next[0] !== activeWorkspaceId) {
        next = [activeWorkspaceId, ...next.filter(id => id !== activeWorkspaceId)];
      }
      // Only write back when something actually changed; avoids an infinite
      // setState→useEffect→setState loop on identical arrays.
      const same = next.length === prev.length && next.every((id, i) => id === prev[i]);
      if (!same) localStorage.setItem('wsMru', JSON.stringify(next));
      return same ? prev : next;
    });
  }, [workspaces, activeWorkspaceId]);

  const saveState = useCallback((options?: { beacon?: boolean }) => {
    if (!sessionId || !activeWorkspaceId || !stateRestoredRef.current) return;
    if (switchingWorkspaceRef.current) return; // suppress saves during workspace transition
    const statePayload = {
      text,
      history,
      result,
      textLanguage,
      explainHistory,
      explanationCache: Object.fromEntries(explanationCacheRef.current),
      originId: originIdRef.current,
      // Per-workspace listening configuration. acousticPreset + noisePreset
      // ("scene") reset to 'none' on every user edit; voice + noiseLevel are
      // sticky preferences that survive edits but are remembered separately
      // per workspace so different texts can keep different voice characters
      // and ambient-volume tastes.
      acousticPreset,
      noisePreset,
      noiseLevel,
      voice: currentVoice,
      // Per-workspace player settings (read-all pause + repeat).
      sentencePause,
      sentenceRepeat,
      // Per-workspace selected deck (null = none yet; "Select deck").
      activeDeckId,
    };
    const lastSavedAt = wsUpdatedAtRef.current.get(activeWorkspaceId) || null;
    if (options?.beacon) {
      // Beacon/unload saves: use force=true to skip conflict detection (last chance to save)
      const body = JSON.stringify({ workspaceId: activeWorkspaceId, state: statePayload, lastSavedAt, force: true });
      const blob = new Blob([body], { type: 'application/json' });
      const sent = navigator.sendBeacon?.(
        `/api/state?sid=${encodeURIComponent(sessionId)}`,
        blob,
      );
      if (!sent) {
        fetch('/api/state', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
          body,
          keepalive: true,
        }).catch(() => {});
      }
    } else {
      // Queue-based save: if a save is in-flight, mark pending so it re-saves after completion
      if (savingRef.current) {
        savePendingRef.current = true;
        return;
      }
      savingRef.current = true;
      savePendingRef.current = false;
      const body = JSON.stringify({ workspaceId: activeWorkspaceId, state: statePayload, lastSavedAt });
      fetch('/api/state', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
        body,
      }).then(async (res) => {
        if (res.status === 409) {
          const conflictData = await res.json().catch(() => ({}));
          if (conflictData.updatedAt) {
            wsUpdatedAtRef.current.set(activeWorkspaceId, conflictData.updatedAt);
          }
          // Conflict means server has newer timestamp — re-save with updated baseline
          savePendingRef.current = true;
        } else if (res.ok) {
          const data = await res.json();
          if (data.updatedAt) wsUpdatedAtRef.current.set(activeWorkspaceId, data.updatedAt);
          setIsDirty(false);
        }
      }).catch(() => setIsDirty(false))
        .finally(() => {
          savingRef.current = false;
          // If state changed while save was in-flight, save again with latest data
          if (savePendingRef.current) {
            savePendingRef.current = false;
            saveStateRef.current();
          }
        });
    }
  }, [sessionId, activeWorkspaceId, text, history, explainHistory, result, textLanguage, acousticPreset, noisePreset, noiseLevel, currentVoice, sentencePause, sentenceRepeat, activeDeckId, showToast, userPrefs.interfaceLanguage]);

  // Keep ref in sync so event listeners always call the latest saveState
  saveStateRef.current = saveState;

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(saveState, TIMEOUTS.AUTO_SAVE_DEBOUNCE);
  }, [saveState]);

  const checkServerSync = useCallback(async (): Promise<'ok' | 'sync' | 'keep-local'> => {
    if (skipSyncCheckRef.current) return 'ok';
    const wsId = activeWorkspaceIdRef.current;
    if (!sessionId || !wsId) return 'ok';
    try {
      const res = await fetch(`/api/state/${wsId}/timestamp`, { headers: { 'x-session-id': sessionId } });
      if (!res.ok) return 'ok'; // network error → don't block user
      const { updatedAt: serverTs } = await res.json();
      if (!serverTs) return 'ok';
      const localTs = wsUpdatedAtRef.current.get(wsId);
      if (!localTs || serverTs <= localTs) return 'ok'; // same or older
      // Server timestamp is newer — check if content actually changed
      try {
        const stateRes = await fetch(`/api/state/${wsId}`, { headers: { 'x-session-id': sessionId } });
        if (stateRes.ok) {
          const { state: serverState, updatedAt: fullTs } = await stateRes.json();
          const serverExplainHistory: string[] = serverState?.explainHistory ?? (serverState?.explanationCache ? Object.keys(serverState.explanationCache) : []);
          const sameText = (serverState?.text ?? '') === text;
          const sameExplainCount = serverExplainHistory.length === explainHistory.length;
          const sameExplainPhrases = sameExplainCount && serverExplainHistory.every((p: string, i: number) => p === explainHistory[i]);
          if (sameText && sameExplainPhrases) {
            // Same content — silently accept newer timestamp, no modal
            wsUpdatedAtRef.current.set(wsId, fullTs || serverTs);
            return 'ok';
          }
        }
      } catch { /* fetch failed — fall through to show modal */ }
      // Content differs (or fetch failed) — ask user
      serverTimestampForSyncRef.current = serverTs;
      setShowSyncModal(true);
      return new Promise<'sync' | 'keep-local'>((resolve) => {
        syncResolveRef.current = resolve;
      });
    } catch {
      return 'ok'; // network failure → proceed normally
    }
  }, [sessionId, text, explainHistory]);

  // Keep refs in sync so early-defined callbacks (speakPhrase, startFullTextPlayback) can call these
  checkServerSyncRef.current = checkServerSync;
  loadWorkspaceStateRef.current = loadWorkspaceState;

  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareCopied, setShareCopied] = useState(false);

  const handleShare = useCallback(async () => {
    if (!sessionId || !activeWorkspaceId || !text.trim()) return;
    try {
      // Admin users can tag shared links with a source identifier for tracking
      let shareSource: string | undefined;
      if (user?.role === 'admin') {
        const input = window.prompt('Optional: enter a source tag for tracking (e.g. "telegram", "reddit"):');
        if (input === null) return; // cancelled
        shareSource = input.trim() || undefined;
      }
      const res = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
        body: JSON.stringify({ workspaceId: activeWorkspaceId, shareSource }),
      });
      if (!res.ok) { showToast('Failed to share'); return; }
      const { code } = await res.json();
      setShareUrl(`${window.location.origin}/s/${code}`);
      setShareCopied(false);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    }
  }, [sessionId, activeWorkspaceId, text, showToast, user?.role]);

  const copyShareUrl = useCallback(() => {
    if (!shareUrl) return;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(shareUrl).then(() => setShareCopied(true)).catch(() => {});
    }
    // execCommand fallback for iOS Safari
    const ta = document.createElement('textarea');
    ta.value = shareUrl;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try { document.execCommand('copy'); setShareCopied(true); } catch { /* ignore */ }
    document.body.removeChild(ta);
  }, [shareUrl]);

  // Auto-save (debounced) when text changes
  useEffect(() => {
    if (sessionId && stateRestoredRef.current) { setIsDirty(true); scheduleSave(); }
  }, [text]);

  // Persist the per-workspace deck selection when it changes (suppressed during
  // a workspace switch by saveState's switchingWorkspaceRef guard).
  useEffect(() => {
    if (sessionId && stateRestoredRef.current) { setIsDirty(true); scheduleSave(); }
  }, [activeDeckId]);

  // Immediate save when explanation or TTS history changes — prevents data loss on reload
  const readyToSaveRef = useRef(false);
  useEffect(() => {
    if (!sessionId || !readyToSaveRef.current) return;
    setIsDirty(true);
    saveStateRef.current();
  }, [result, explainHistory, history]);

  // Keep isDirtyRef in sync so async workspace callbacks can read it without stale closures
  useEffect(() => { isDirtyRef.current = isDirty; }, [isDirty]);

  // Only show the unsaved indicator after 1.5s of pending dirty state — avoids flashing on fast saves
  useEffect(() => {
    if (!isDirty) { setShowUnsaved(false); return; }
    const t = setTimeout(() => setShowUnsaved(true), TIMEOUTS.UNSAVED_WARNING);
    return () => clearTimeout(t);
  }, [isDirty]);

  // Save on page unload / background — use sendBeacon to survive iOS page kill
  useEffect(() => {
    // Use saveStateRef.current so beacon always calls the LATEST saveState
    // (avoids stale closure when user types and switches tabs before effect re-runs)
    const beaconSave = () => {
      if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
      saveStateRef.current({ beacon: true });
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        beaconSave();
      }
    };
    window.addEventListener('beforeunload', beaconSave);
    window.addEventListener('pagehide', beaconSave);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('beforeunload', beaconSave);
      window.removeEventListener('pagehide', beaconSave);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // Persist ?import= param in sessionStorage so it survives login redirect.
  // Strip ONLY the import param — the SSO bootstrap effect below still needs
  // to read ?sso= / ?from= from the URL, so wiping the whole query string here
  // (this effect runs first) would silently drop the cross-app handoff.
  useEffect(() => {
    const url = new URL(window.location.href);
    const importCode = url.searchParams.get('import');
    if (importCode) {
      sessionStorage.setItem('pendingImport', importCode);
      url.searchParams.delete('import');
      window.history.replaceState({}, '', url.pathname + (url.search || '') + url.hash);
    }
  }, []);

  // Session restore on mount.
  // If running inside a Telegram Mini App and no session yet, first exchange
  // the signed initData for a session via /api/auth/telegram. Then fall through
  // to the regular session-from-localStorage path. On any TMA-side failure we
  // degrade silently to the regular landing/Google flow.
  useEffect(() => {
    const tryTelegramAuth = async (): Promise<string | null> => {
      const tg = typeof window !== 'undefined' ? window.Telegram?.WebApp : undefined;
      if (!tg || !tg.initData) return null;
      try {
        tg.ready();
        tg.expand();
        const res = await fetch('/api/auth/telegram', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ initData: tg.initData }),
        });
        if (!res.ok) return null;
        const data = await res.json();
        if (!data?.sessionId) return null;
        localStorage.setItem('session_id', data.sessionId);
        setSessionId(data.sessionId);
        return data.sessionId as string;
      } catch {
        return null;
      }
    };
    (async () => {
      // Recover from a lost localStorage write during the Google OAuth
      // redirect: /api/auth/google/redirect appends #sid=<NEW_SID> to the
      // navigation URL as a backup. iOS Safari with cross-site tracking
      // prevention sometimes loses the localStorage write made between
      // setItem and the subsequent navigation; the fragment survives.
      // Adopt it before reading localStorage, then scrub from the URL so it
      // doesn't linger in browser history or accidental bookmarks.
      const hashMatch = window.location.hash.match(/[#&]sid=([A-Za-z0-9_-]+)/);
      if (hashMatch) {
        localStorage.setItem('session_id', hashMatch[1]);
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      }

      // Cross-app SSO arrival from glottos-courses: ?sso=<token> in the URL.
      // POST it to /api/auth/sso, on success adopt the new session (overwrite
      // any existing one — courses identity wins for "two windows of one
      // app" semantics) and scrub the param from the URL so it doesn't end up
      // in history. On failure (expired, bad signature) just strip it and
      // fall through to the existing localStorage / Telegram path.
      const ssoUrl = new URL(window.location.href);
      const ssoToken = ssoUrl.searchParams.get('sso');
      // Stash the originating courses lesson path (if any) so the "Courses"
      // back-link can return the user to that exact lesson instead of the
      // courses home page. Persisted so it survives the import navigation and
      // any later reloads within this tutor session.
      const fromPath = ssoUrl.searchParams.get('from');
      if (fromPath && fromPath.startsWith('/') && !fromPath.startsWith('//')) {
        try { localStorage.setItem('courses_return_path', fromPath); } catch { /* ignore */ }
      }
      if (ssoToken) {
        try {
          const existingSid = localStorage.getItem('session_id');
          const res = await fetch('/api/auth/sso', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(existingSid ? { 'X-Session-Id': existingSid } : {}) },
            body: JSON.stringify({ token: ssoToken }),
          });
          if (res.ok) {
            const data = await res.json();
            if (data.sessionId) {
              localStorage.setItem('session_id', data.sessionId);
              if (data.user) setUser(data.user);
            }
          }
        } catch { /* fall through to existing flow */ }
      }
      // Cross-app theme handoff: courses appends ?theme=light|dark on every
      // tutor link. The userPrefs state initializer already adopted it (so
      // the document class is correct from first paint with no flash); here
      // we persist back into localStorage so the choice survives a reload,
      // and scrub the param from the URL alongside sso/from.
      const themeParamRaw = ssoUrl.searchParams.get('theme');
      const urlTheme: 'light' | 'dark' | null =
        themeParamRaw === 'light' || themeParamRaw === 'dark' ? themeParamRaw : null;
      if (urlTheme) {
        try {
          const stored = localStorage.getItem('userPrefs');
          const parsed = stored ? JSON.parse(stored) : {};
          parsed.theme = urlTheme;
          localStorage.setItem('userPrefs', JSON.stringify(parsed));
        } catch { /* ignore */ }
      }
      if (ssoToken || fromPath || themeParamRaw) {
        ssoUrl.searchParams.delete('sso');
        ssoUrl.searchParams.delete('from');
        ssoUrl.searchParams.delete('theme');
        window.history.replaceState(null, '', ssoUrl.pathname + (ssoUrl.search || '') + ssoUrl.hash);
      }

      let sid = localStorage.getItem('session_id');
      if (!sid) sid = await tryTelegramAuth();
      if (!sid) { stateRestoredRef.current = true; readyToSaveRef.current = true; setAuthChecked(true); return; }
      void fetch('/api/state', { headers: { 'x-session-id': sid } })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data?.user) { localStorage.removeItem('session_id'); setAuthChecked(true); return; }
        setUser(data.user);
        setSessionId(sid);
        setWorkspaces(data.workspaces ?? []);
        setActiveWorkspaceId(data.activeWorkspaceId ?? null);
        activeWorkspaceIdRef.current = data.activeWorkspaceId ?? null;
        if (data.appSettings) {
          setAppSettings(data.appSettings);
        }
        // Load subscription status from user object
        if (data.user.subscription_status) {
          setSubscriptionStatus(data.user.subscription_status);
        }
        if (data.user.subscription_period_end) {
          setSubscriptionPeriodEnd(data.user.subscription_period_end);
        }
        if (data.user.cancel_at_period_end) {
          setCancelAtPeriodEnd(data.user.cancel_at_period_end);
        }
        if (Array.isArray(data.decks)) {
          // The selected deck is per-workspace now (restored from the workspace
          // state below), not a global preference — so start unselected here.
          hydrateDecks(data.decks, null);
        }
        if (data.preferences) {
          // If the URL handed off a fresh theme from courses, it wins over
          // whatever the server has stored — the user just toggled it on
          // courses, so that's the most recent intent. Also push it back to
          // the server so future visits restore the same theme.
          const serverPrefs = urlTheme
            ? { ...data.preferences, theme: urlTheme }
            : data.preferences;
          if (!serverPrefs.setupCompleted) {
            // New user: keep browser-detected language instead of overriding with backend defaults
            const browserLang = (navigator.language || 'en').split('-')[0].toLowerCase();
            const detectedLang = LANGUAGES[browserLang] ? browserLang : 'en';
            const merged = { ...serverPrefs, interfaceLanguage: detectedLang, explanationLanguage: detectedLang };
            setUserPrefs(merged);
            localStorage.setItem('userPrefs', JSON.stringify(merged));
            setShowLanguageSetup(true);
          } else {
            setUserPrefs(serverPrefs);
            localStorage.setItem('userPrefs', JSON.stringify(serverPrefs));
          }
          // Persist the handed-off theme to the server only when it differs
          // from what's already there, to avoid a no-op write on every page
          // load that already had the right theme.
          if (urlTheme && data.preferences.theme !== urlTheme && sid) {
            fetch('/api/preferences', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json', 'x-session-id': sid },
              body: JSON.stringify({ ...serverPrefs, theme: urlTheme }),
            }).catch(() => { /* best-effort; localStorage is the fallback */ });
          }
        } else {
          setShowLanguageSetup(true);
        }
        if (data.updatedAt && data.activeWorkspaceId) {
          wsUpdatedAtRef.current.set(data.activeWorkspaceId, data.updatedAt);
        }
        const s = data.state;
        if (s.text) setText(s.text);
        if (s.history) setHistory(s.history);
        if (s.explainHistory) setExplainHistory(s.explainHistory);
        else if (s.explanationCache) setExplainHistory(Object.keys(s.explanationCache));
        if (s.result) setResult(s.result);
        if (s.textLanguage) setTextLanguage(s.textLanguage);
        if (s.explanationCache) {
          explanationCacheRef.current = new Map(Object.entries(s.explanationCache));
        }
        // Per-workspace scene: missing fields = clean (new workspaces start
        // in the default listening configuration). Sanitize the same way as
        // the state initializers to defend against stale preset ids.
        setAcousticPreset(s.acousticPreset && ACOUSTIC_PRESETS.includes(s.acousticPreset) ? s.acousticPreset : 'none');
        setNoisePreset(s.noisePreset && NOISE_PRESETS.includes(s.noisePreset) ? s.noisePreset : 'none');
        setNoiseLevelState(typeof s.noiseLevel === 'string' ? (s.noiseLevel as NoiseLevel) : 'moderate');
        setSentencePause(typeof s.sentencePause === 'number' && s.sentencePause >= 0 && s.sentencePause <= 8 ? Math.round(s.sentencePause) : 0);
        setSentenceRepeat(typeof s.sentenceRepeat === 'number' && s.sentenceRepeat >= 1 && s.sentenceRepeat <= 5 ? Math.round(s.sentenceRepeat) : 1);
        // Per-workspace selected deck — only if it still exists in the deck list.
        setActiveDeck(typeof s.activeDeckId === 'string' && data.decks?.some((d: DeckSummary) => d.id === s.activeDeckId) ? s.activeDeckId : null);
        // Voice is validated against the language catalog by the
        // language-change useEffect, so it's safe to set the raw saved id
        // here — the useEffect will substitute catalog[0] if it's stale.
        if (typeof s.voice === 'string' && s.voice) {
          voiceRef.current = s.voice;
          setCurrentVoiceState(s.voice);
        } else {
          voiceRef.current = null;
          setCurrentVoiceState(null);
        }
        originIdRef.current = s.originId || crypto.randomUUID();
        // Seed the active workspace into cache immediately
        if (data.activeWorkspaceId) {
          wsStateCacheRef.current.set(data.activeWorkspaceId, {
            text: s.text ?? '', history: s.history ?? [],
            explainHistory: s.explainHistory ?? (s.explanationCache ? Object.keys(s.explanationCache) : []),
            result: s.result ?? null, textLanguage: s.textLanguage ?? (data.preferences?.defaultTextLanguage || 'de'),
            explanationCache: new Map(explanationCacheRef.current),
            originId: originIdRef.current,
            acousticPreset: (s.acousticPreset && ACOUSTIC_PRESETS.includes(s.acousticPreset)) ? s.acousticPreset : 'none',
            noisePreset: (s.noisePreset && NOISE_PRESETS.includes(s.noisePreset)) ? s.noisePreset : 'none',
            noiseLevel: typeof s.noiseLevel === 'string' ? s.noiseLevel : 'moderate',
            voice: typeof s.voice === 'string' ? s.voice : null,
            sentencePause: typeof s.sentencePause === 'number' ? s.sentencePause : 0,
            sentenceRepeat: typeof s.sentenceRepeat === 'number' ? s.sentenceRepeat : 1,
          });
        }
        // Prefetch other workspaces in the background so first switch is also instant.
        // Uses a 2s delay to not compete with initial render and first user interactions.
        const otherWorkspaces = (data.workspaces ?? []).filter((w: Workspace) => w.id !== data.activeWorkspaceId);
        if (otherWorkspaces.length > 0) {
          setTimeout(() => {
            otherWorkspaces.forEach((ws: Workspace) => {
              fetch(`/api/state/${ws.id}`, { headers: { 'x-session-id': sid } })
                .then(r => r.ok ? r.json() : null)
                .then(d => {
                  if (!d?.state) return;
                  if (d.updatedAt) wsUpdatedAtRef.current.set(ws.id, d.updatedAt);
                  const ps = d.state;
                  wsStateCacheRef.current.set(ws.id, {
                    text: ps.text ?? '', history: ps.history ?? [],
                    explainHistory: ps.explainHistory ?? (ps.explanationCache ? Object.keys(ps.explanationCache) : []),
                    result: ps.result ?? null, textLanguage: ps.textLanguage ?? (data.preferences?.defaultTextLanguage || 'de'),
                    explanationCache: ps.explanationCache ? new Map(Object.entries(ps.explanationCache)) : new Map(),
                    originId: ps.originId,
                  });
                })
                .catch(() => {}); // network failure is harmless — switch will fall back to spinner
            });
          }, TIMEOUTS.STATE_PREFETCH_DELAY);
        }
        // Mark restore complete so auto-save doesn't overwrite with empty state
        stateRestoredRef.current = true;
        // Wait for restore effects to run, then enable immediate saves and clear dirty flag
        setTimeout(() => { readyToSaveRef.current = true; setIsDirty(false); }, 0);
        setAuthChecked(true);
      })
      .catch(() => { localStorage.removeItem('session_id'); stateRestoredRef.current = true; readyToSaveRef.current = true; setAuthChecked(true); });
    })();
  }, []);

  // Handle checkout success redirect and fetch subscription data
  useEffect(() => {
    if (!sessionId) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('checkout') === 'success') {
      // Clean URL
      window.history.replaceState({}, '', window.location.pathname);
      showToast(t('CHECKOUT_SUCCESS', userPrefs.interfaceLanguage) || 'Subscription activated!');
      // Poll subscription status (webhook may not have arrived yet)
      let attempts = 0;
      const poll = () => {
        fetch('/api/subscription', { headers: { 'X-Session-Id': sessionId } })
          .then(r => r.ok ? r.json() : null)
          .then(data => {
            if (!data) return;
            setSubscriptionStatus(data.status);
            setSubscriptionPeriodEnd(data.periodEnd);
            setCancelAtPeriodEnd(data.cancelAtPeriodEnd);
            setDailyUsage(data.usage);
            setDailyLimits(data.limits);
            if (data.freeMaxGenerateSentences) setFreeMaxGenerateSentences(data.freeMaxGenerateSentences);
            if (data.freeMaxTextLength) setFreeMaxTextLength(data.freeMaxTextLength);
            if (data.status === 'free' && attempts < 5) {
              attempts++;
              setTimeout(poll, TIMEOUTS.SUBSCRIPTION_POLL);
            }
          });
      };
      poll();
    } else {
      // Regular subscription status fetch
      fetch('/api/subscription', { headers: { 'X-Session-Id': sessionId } })
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (!data) return;
          setSubscriptionStatus(data.status);
          setSubscriptionPeriodEnd(data.periodEnd);
          setCancelAtPeriodEnd(data.cancelAtPeriodEnd);
          setDailyUsage(data.usage);
          setDailyLimits(data.limits);
          if (data.freeMaxGenerateSentences) setFreeMaxGenerateSentences(data.freeMaxGenerateSentences);
          if (data.freeMaxTextLength) setFreeMaxTextLength(data.freeMaxTextLength);
        });
    }
  }, [sessionId]);

  // Convert anonymous user to Google user via GoogleLogin
  const handleAnonGoogleSignin = useCallback(async (response: { credential?: string }) => {
    if (!response.credential) return;
    try {
      const res = await fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Session-Id': sessionId || '' },
        body: JSON.stringify({ credential: response.credential, source_code: localStorage.getItem('promo_source') || undefined }),
      });
      if (!res.ok) return;
      const data = await res.json();
      localStorage.setItem('session_id', data.sessionId);
      setSessionId(data.sessionId);
      setUser(data.user);
      if (data.user.subscription_status) setSubscriptionStatus(data.user.subscription_status);
      setShowLimitReached(false);
    } catch { /* ignore */ }
  }, [sessionId]);

  // Inside a Telegram Mini App, Google's <GoogleLogin> iframe is blocked by
  // the WebView. We instead open Google's full-page OAuth in the user's real
  // browser via Telegram.WebApp.openLink and finish linking server-side.
  const openGoogleLinkExternal = useCallback(() => {
    if (!sessionId) return;
    const tg = window.Telegram?.WebApp;
    const url = `${window.location.origin}/api/auth/google/link-start?sid=${encodeURIComponent(sessionId)}`;
    if (tg) tg.openLink(url);
    else window.open(url, '_blank');
  }, [sessionId]);

  // After the user returns from the external browser, refresh user state when
  // the Settings modal is open so the section flips to "Google: <email>".
  useEffect(() => {
    if (!showSettings || !sessionId) return;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      fetch('/api/state', { headers: { 'x-session-id': sessionId } })
        .then(r => r.ok ? r.json() : null)
        .then(data => { if (data?.user) setUser(prev => prev ? { ...prev, ...data.user } : data.user); })
        .catch(() => {});
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [showSettings, sessionId]);

  // Attach a Google identity to the currently signed-in user (e.g. a Telegram
  // or anonymous user wanting to also sign in via Google later).
  const handleLinkGoogle = useCallback(async (response: { credential?: string }) => {
    if (!response.credential) return;
    try {
      const { user: updated } = await postJson<{ user: User }>('/api/auth/link-google', { credential: response.credential });
      setUser(prev => prev ? { ...prev, ...updated } : updated);
      showToast(t('LINK_GOOGLE_SUCCESS', userPrefs.interfaceLanguage));
    } catch (err) {
      const status = (err as Error & { status?: number }).status;
      if (status === 409) {
        showToast(t('LINK_GOOGLE_CONFLICT', userPrefs.interfaceLanguage));
      } else {
        const detail = err instanceof Error ? err.message : String(err);
        showToast(detail);
      }
    }
  }, [postJson, userPrefs.interfaceLanguage, showToast]);

  // Perform shared lesson import — creates workspace, saves state, switches to it
  const performSharedImport = useCallback(async (data: any) => {
    const sid = sessionId;
    if (!sid || !data?.state) return;
    const wsName = data.workspaceName || `Workspace ${Math.max(0, ...workspacesRef.current.map(w => {
      const m = w.name.match(/^Workspace\s+(\d+)$/);
      return m ? parseInt(m[1], 10) : 0;
    })) + 1}`;
    const wsRes = await fetch('/api/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-session-id': sid },
      body: JSON.stringify({ name: wsName }),
    });
    const ws = await wsRes.json();
    setWorkspaces(prev => [...prev, ws]);
    const sharedState = data.state;
    if (data.textLanguage) sharedState.textLanguage = data.textLanguage;
    await fetch('/api/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-session-id': sid },
      body: JSON.stringify({ workspaceId: ws.id, state: sharedState }),
    });
    const expCache = sharedState.explanationCache
      ? new Map(Object.entries(sharedState.explanationCache))
      : new Map();
    wsStateCacheRef.current.set(ws.id, {
      text: sharedState.text || '',
      history: sharedState.history || [],
      explainHistory: sharedState.explainHistory || (sharedState.explanationCache ? Object.keys(sharedState.explanationCache) : []),
      result: sharedState.result || null,
      textLanguage: sharedState.textLanguage || 'de',
      explanationCache: expCache,
      originId: sharedState.originId,
    });
    if (data.shareSource) {
      fetch('/api/tag-source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-session-id': sid },
        body: JSON.stringify({ source_code: data.shareSource }),
      }).catch(() => {});
    }
    await switchWorkspace(ws.id, { skipSave: true });
    showToast(t('SHARED_LESSON_IMPORTED', userPrefs.interfaceLanguage));
  }, [sessionId, switchWorkspace, showToast, userPrefs.interfaceLanguage]);

  // Import shared lesson from sessionStorage (saved on mount before auth)
  // Depends on authChecked (not sessionId) because sessionId may already be set
  // from localStorage on first render, before stateRestoredRef becomes true.
  useEffect(() => {
    if (!authChecked || (!sessionId && !isEmbedMode) || !stateRestoredRef.current) return;
    const importCode = sessionStorage.getItem('pendingImport');
    if (!importCode) return;
    sessionStorage.removeItem('pendingImport');

    // Helper: load shared state into local UI state (embed mode or after polling completes)
    const applySharedState = (data: any) => {
      const s = data.state;
      if (s.text) setText(s.text);
      if (s.history) setHistory(s.history);
      if (s.explainHistory) setExplainHistory(s.explainHistory);
      else if (s.explanationCache) setExplainHistory(Object.keys(s.explanationCache));
      if (s.result) setResult(s.result);
      if (s.textLanguage || data.textLanguage) setTextLanguage(s.textLanguage || data.textLanguage);
      if (s.explanationCache) {
        explanationCacheRef.current = new Map(Object.entries(s.explanationCache));
      }
      setAcousticPreset(s.acousticPreset && ACOUSTIC_PRESETS.includes(s.acousticPreset) ? s.acousticPreset : 'none');
      setNoisePreset(s.noisePreset && NOISE_PRESETS.includes(s.noisePreset) ? s.noisePreset : 'none');
      setNoiseLevelState(typeof s.noiseLevel === 'string' ? (s.noiseLevel as NoiseLevel) : 'moderate');
      setSentencePause(typeof s.sentencePause === 'number' && s.sentencePause >= 0 && s.sentencePause <= 8 ? Math.round(s.sentencePause) : 0);
      setSentenceRepeat(typeof s.sentenceRepeat === 'number' && s.sentenceRepeat >= 1 && s.sentenceRepeat <= 5 ? Math.round(s.sentenceRepeat) : 1);
      setActiveDeck(null); // a shared lesson carries no deck selection
      if (typeof s.voice === 'string' && s.voice) {
        voiceRef.current = s.voice;
        setCurrentVoiceState(s.voice);
      } else {
        voiceRef.current = null;
        setCurrentVoiceState(null);
      }
      setImportProgress(null);
    };

    // Helper: poll until processing is done
    const pollUntilReady = (code: string) => {
      const poll = () => {
        fetch(`/api/shared/${encodeURIComponent(code)}`)
          .then(r => r.ok ? r.json() : null)
          .then(data => {
            if (!data?.state) return;
            // Always apply latest state (partial results are useful)
            applySharedState(data);
            if (data.status === 'processing') {
              setImportProgress(data.progress || { done: 0, total: 1 });
              setTimeout(poll, TIMEOUTS.POLLING_INTERVAL);
            } else {
              setImportProgress(null);
            }
          })
          .catch(() => {});
      };
      poll();
    };

    fetch(`/api/shared/${encodeURIComponent(importCode)}`)
      .then(r => r.ok ? r.json() : null)
      .then(async (data) => {
        if (!data?.state) return;

        // Handle still-processing shared lessons (poll for completion)
        if (data.status === 'processing') {
          applySharedState(data);
          setImportProgress(data.progress || { done: 0, total: 1 });
          setTimeout(() => pollUntilReady(importCode), TIMEOUTS.POLLING_INTERVAL);
          return;
        }

        // Embed mode: load shared state directly into local state without creating a workspace
        if (isEmbedMode) {
          applySharedState(data);
          return;
        }
        // Check for duplicate origin ID
        const sharedOriginId = data.state.originId;
        if (sharedOriginId) {
          for (const [, cached] of wsStateCacheRef.current) {
            if (cached.originId === sharedOriginId) {
              pendingImportDataRef.current = data;
              setShowDuplicateImportModal(true);
              return;
            }
          }
        }
        await performSharedImport(data);
      })
      .catch(() => {});
  }, [authChecked]);

  // Reset daily usage counters at midnight
  useEffect(() => {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    const msUntilMidnight = midnight.getTime() - now.getTime();
    const timer = setTimeout(() => {
      setDailyUsage({ explains: 0, tts: 0, generates: 0 });
    }, msUntilMidnight);
    return () => clearTimeout(timer);
  }, [dailyUsage]);

  // Fetch Stripe prices when upgrade modal opens
  const [pricesError, setPricesError] = useState(false);
  useEffect(() => {
    if (!showUpgrade || !sessionId || stripePrices.length > 0) return;
    setPricesError(false);
    fetch('/api/stripe/prices', { headers: { 'X-Session-Id': sessionId } })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.prices?.length) setStripePrices(data.prices);
        else setPricesError(true);
      })
      .catch(() => setPricesError(true));
  }, [showUpgrade, sessionId]);

  if (!authChecked) {
    return null;
  }

  if (!user && !isEmbedMode && !isTelegramMiniApp()) {
    window.location.href = '/';
    return null;
  }

  if (showLanguageSetup && !isEmbedMode) {
    const setupLang = userPrefs.interfaceLanguage || 'en';
    return (
      <div className="min-h-screen bg-[var(--bg-page)] flex items-center justify-center font-sans">
        <div className="bg-[var(--bg-panel)] rounded-2xl border border-[var(--border-main)] shadow-sm p-6 lg:p-10 flex flex-col items-center gap-8 w-full max-w-sm">
          <div className="w-14 h-14 bg-[var(--bg-accent)] rounded-xl flex items-center justify-center">
            <Languages className="text-white w-7 h-7" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">
            {t('SETUP_TITLE', setupLang)}
          </h1>
          <div className="w-full space-y-5">
            <div>
              <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                {t('SETUP_YOUR_LANG', setupLang)}
              </label>
              <select
                value={userPrefs.interfaceLanguage}
                onChange={(e) => {
                  const newLang = e.target.value;
                  setUserPrefs(p => {
                    const updated = { ...p, interfaceLanguage: newLang, explanationLanguage: newLang };
                    // Reset learn language if it conflicts
                    if (updated.defaultTextLanguage === newLang) {
                      const firstOther = Object.keys(LANGUAGES).find(c => c !== newLang);
                      updated.defaultTextLanguage = firstOther || 'de';
                    }
                    return updated;
                  });
                }}
                className="w-full px-3 py-2 border border-[var(--border-main)] rounded-lg bg-[var(--bg-panel)] text-[var(--text-secondary)] focus:outline-none focus:border-[var(--border-main)]"
              >
                {Object.entries(LANGUAGES).map(([code, lang]) => (
                  <option key={code} value={code}>{lang.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                {t('SETUP_LEARN_LANG', userPrefs.interfaceLanguage)}
              </label>
              <select
                value={userPrefs.defaultTextLanguage || 'de'}
                onChange={(e) => setUserPrefs(p => ({ ...p, defaultTextLanguage: e.target.value }))}
                className="w-full px-3 py-2 border border-[var(--border-main)] rounded-lg bg-[var(--bg-panel)] text-[var(--text-secondary)] focus:outline-none focus:border-[var(--border-main)]"
              >
                {Object.entries(LANGUAGES)
                  .filter(([code]) => !disabledTextLanguages.has(code))
                  .map(([code, lang]) => (
                    <option key={code} value={code}>{lang.label}</option>
                  ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                {t('THEME', setupLang)}
              </label>
              <div className="flex gap-2">
                {(['light', 'dark'] as const).map(themeOpt => (
                  <button
                    key={themeOpt}
                    onClick={() => setUserPrefs(p => ({ ...p, theme: themeOpt }))}
                    className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors border ${
                      (userPrefs.theme || 'dark') === themeOpt
                        ? 'bg-[var(--bg-accent)] text-[var(--text-on-accent)] border-transparent'
                        : 'bg-[var(--bg-surface)] text-[var(--text-secondary)] border-[var(--border-main)] hover:bg-[var(--bg-hover)]'
                    }`}
                  >
                    {themeOpt === 'light' ? t('THEME_LIGHT', setupLang) : t('THEME_DARK', setupLang)}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <button
            onClick={() => {
              const newPrefs = { ...userPrefs, setupCompleted: true };
              setUserPrefs(newPrefs);
              localStorage.setItem('userPrefs', JSON.stringify(newPrefs));
              setTextLanguage(newPrefs.defaultTextLanguage || 'de');
              setShowLanguageSetup(false);
              if (sessionId) {
                fetch('/api/preferences', {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
                  body: JSON.stringify(newPrefs),
                }).catch(err => console.error('Failed to save preferences:', err));
              }
              // Tutorial can be started manually from the toolbar
            }}
            className="w-full px-4 py-3 bg-[var(--bg-accent)] text-[var(--text-on-accent)] rounded-xl font-semibold hover:bg-[var(--bg-accent-hover)] transition-colors text-base"
          >
            {t('SETUP_START', userPrefs.interfaceLanguage)}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg-page)] flex flex-col font-sans text-[var(--text-primary)]">
      {/* Header */}
      {!isEmbedMode && <Header
        interfaceLanguage={userPrefs.interfaceLanguage}
        user={user}
        subscriptionStatus={subscriptionStatus}
        isTouchDevice={isTouchDevice}
        showUserMenu={showUserMenu}
        setShowUserMenu={setShowUserMenu}
        setTutorialStep={setTutorialStep}
        setShowFeedback={setShowFeedback}
        setFeedbackSent={setFeedbackSent}
        setFeedbackText={setFeedbackText}
        setShowSettings={setShowSettings}
        onLogout={() => {
          setShowUserMenu(false);
          if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
          saveState();
          localStorage.removeItem('session_id');
          setSessionId(null); setUser(null);
          setWorkspaces([]); setActiveWorkspaceId(null);
          setText(''); setHistory([]); setExplainHistory([]); setResult(null);
          explanationCacheRef.current = new Map();
          ttsRawCacheRef.current = new Map();
          ttsCacheRef.current = new Map();
        }}
        onOpenCourses={() => openInCourses({ sessionId, isAnonymous })}
        userMenuRef={userMenuRef}
      />}

      {!isEmbedMode && user && workspaces.length > 0 && (() => {
        // Render the tab bar from the MRU list so the most-recently-touched
        // workspaces stay visible. With ≤6 workspaces, show all as tabs; with
        // more, show the first 5 + an overflow dropdown for the rest.
        const ordered = mruOrder
          .map(id => workspaces.find(w => w.id === id))
          .filter((w): w is Workspace => !!w);
        // Mobile keeps the tab bar tight: 3 tabs max, any 4th+ workspace
        // goes into the dropdown. Desktop keeps the original 5-tab limit
        // and only collapses when there's more than one to hide.
        const TAB_LIMIT = isNarrowViewport ? 3 : 5;
        const showOverflow = isNarrowViewport
          ? ordered.length > TAB_LIMIT
          : ordered.length > 6;
        const shownTabs = showOverflow ? ordered.slice(0, TAB_LIMIT) : ordered;
        const overflowTabs = showOverflow ? ordered.slice(TAB_LIMIT) : [];
        const renderTab = (ws: Workspace) => (
          <div key={ws.id}
            className={`group relative flex items-center gap-1 px-3 py-2.5 text-xs font-medium cursor-pointer border-b-2 shrink-0 transition-colors
              ${ws.id === activeWorkspaceId ? 'border-[var(--border-accent)] text-[var(--text-primary)]' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
            onClick={() => switchWorkspace(ws.id)}
          >
            {editingTabId === ws.id ? (
              <input autoFocus value={editingTabName}
                onChange={e => setEditingTabName(e.target.value)}
                onBlur={() => { renameWorkspace(ws.id, editingTabName); setEditingTabId(null); }}
                onKeyDown={e => {
                  if (e.key === 'Enter') { renameWorkspace(ws.id, editingTabName); setEditingTabId(null); }
                  if (e.key === 'Escape') setEditingTabId(null);
                }}
                className="w-24 text-xs outline-none bg-transparent font-medium text-[var(--text-primary)]"
                onClick={e => e.stopPropagation()}
              />
            ) : (
              <span className="max-w-[120px] truncate">{ws.name}</span>
            )}
            {workspaces.length > 1 && (
              <button
                onClick={e => { e.stopPropagation(); const cached = wsStateCacheRef.current.get(ws.id); const isEmpty = ws.id === activeWorkspaceId ? !text.trim() : cached ? !cached.text.trim() : false; if (isEmpty) deleteWorkspace(ws.id); else setDeleteConfirm({ id: ws.id, name: ws.name }); }}
                className={`${isTouchDevice ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} w-4 h-4 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-red-500 transition-all ml-0.5`}
              >×</button>
            )}
          </div>
        );
        return (
          <>
          <nav data-tutorial="workspace-tabs" className="border-b border-[var(--border-main)] bg-[var(--bg-panel)] px-2 flex items-end overflow-x-auto shrink-0">
            {shownTabs.map(renderTab)}
            {showOverflow && (
              <button
                onClick={e => {
                  // Position the dropdown via fixed coords from the trigger's
                  // bounding rect. The nav has overflow-x-auto, which clips
                  // its children on both axes per the CSS spec — an absolute
                  // panel inside the nav would be hidden behind the scroll
                  // ruler. Fixed positioning escapes the overflow container.
                  const r = e.currentTarget.getBoundingClientRect();
                  setWsOverflowPos({ top: r.bottom + 2, left: r.left });
                  setWsOverflowOpen(o => !o);
                }}
                className={`flex items-center gap-1 px-3 py-2.5 text-xs font-medium border-b-2 border-transparent shrink-0 transition-colors ${wsOverflowOpen ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
                title={t('MORE_WORKSPACES', userPrefs.interfaceLanguage)}
              >
                <ChevronDown className="w-3.5 h-3.5" />
                <span className="font-mono opacity-70">{overflowTabs.length}</span>
              </button>
            )}
            {(!isAnonymous || appSettings.anon_limits_enabled === 'false' || workspaces.length < parseInt(appSettings.anon_max_workspaces || '1', 10)) && (
              <button onClick={createWorkspace}
                className="px-3 py-2.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] text-xs transition-colors shrink-0 flex items-center gap-1"
                title={t('NEW_WORKSPACE', userPrefs.interfaceLanguage)}>
                <span className="text-sm">+</span>
                <span className="hidden sm:inline">{t('NEW_WORKSPACE', userPrefs.interfaceLanguage)}</span>
              </button>
            )}
          </nav>
          {wsOverflowOpen && wsOverflowPos && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setWsOverflowOpen(false)} />
              <div
                className="fixed max-h-[60vh] overflow-y-auto bg-[var(--bg-panel)] border border-[var(--border-main)] rounded-md shadow-lg z-40 py-1 sm:min-w-[200px]"
                style={{
                  top: `${wsOverflowPos.top}px`,
                  // On mobile, span almost the full viewport width (8px gutter
                  // each side). On sm+, anchor to the trigger button via the
                  // captured left coord and let min-w-[200px] handle width.
                  left: isNarrowViewport ? '8px' : `${wsOverflowPos.left}px`,
                  right: isNarrowViewport ? '8px' : undefined,
                }}
              >
                {/* Active workspace pinned at the top as a "you are here"
                    anchor. Disabled (no-op click) since it's already active;
                    styled to stand out from the overflow list below. */}
                {(() => {
                  const active = workspaces.find(w => w.id === activeWorkspaceId);
                  if (!active) return null;
                  return (
                    <>
                      <div className="flex items-stretch bg-[var(--bg-hover)] group/active">
                        <span className="flex-1 min-w-0 px-4 sm:px-3 py-3 sm:py-1.5 text-sm sm:text-xs font-medium text-[var(--text-primary)] truncate" title={active.name}>
                          {active.name}
                        </span>
                        {workspaces.length > 1 && (
                          <button
                            onClick={e => {
                              e.stopPropagation();
                              const isEmpty = !text.trim();
                              if (isEmpty) deleteWorkspace(active.id);
                              else setDeleteConfirm({ id: active.id, name: active.name });
                              // Leave the dropdown open so additional workspaces
                              // can be deleted in succession without re-opening it.
                            }}
                            className="px-3 sm:px-2 flex items-center justify-center text-[var(--text-muted)] hover:text-red-500 transition-colors"
                            title={t('DELETE', userPrefs.interfaceLanguage)}
                          >
                            <Trash2 className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
                          </button>
                        )}
                      </div>
                      <div className="my-1 mx-2 border-t border-[var(--border-main)]" />
                    </>
                  );
                })()}
                {overflowTabs.map(ws => (
                  <div key={ws.id} className="flex items-stretch hover:bg-[var(--bg-hover)] group/row">
                    <button
                      onClick={() => { switchWorkspace(ws.id); setWsOverflowOpen(false); }}
                      className="flex-1 min-w-0 text-left px-4 sm:px-3 py-3 sm:py-1.5 text-sm sm:text-xs text-[var(--text-primary)] truncate"
                      title={ws.name}
                    >
                      {ws.name}
                    </button>
                    {workspaces.length > 1 && (
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          const cached = wsStateCacheRef.current.get(ws.id);
                          const isEmpty = cached ? !cached.text.trim() : false;
                          if (isEmpty) deleteWorkspace(ws.id);
                          else setDeleteConfirm({ id: ws.id, name: ws.name });
                          // Leave the dropdown open for successive deletes.
                        }}
                        className="px-3 sm:px-2 flex items-center justify-center text-[var(--text-muted)] hover:text-red-500 transition-colors"
                        title={t('DELETE', userPrefs.interfaceLanguage)}
                      >
                        <Trash2 className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
          </>
        );
      })()}

      {/* Anonymous trial banner */}
      {!isEmbedMode && isAnonymous && (() => {
        const inApp = detectInAppBrowser();
        return inApp ? (
          <div className="bg-[var(--bg-anon-banner)] border-b border-[var(--border-anon-banner)] px-4 py-2 flex items-center justify-center text-sm">
            <span className="text-[var(--text-anon-banner)] text-center leading-relaxed">
              {t('INAPP_BROWSER_WARNING', userPrefs.interfaceLanguage).replace('{browser}', inApp)}
            </span>
          </div>
        ) : (
          <div className="bg-[var(--bg-anon-banner)] border-b border-[var(--border-anon-banner)] px-4 py-2 flex items-center justify-center gap-3 text-sm">
            <span className="text-[var(--text-anon-banner)]">{t('ANON_BANNER', userPrefs.interfaceLanguage)}</span>
            <GoogleLogin
              onSuccess={handleAnonGoogleSignin}
              onError={() => {}}
              size="small"
              type="standard"
            />
          </div>
        );
      })()}

      {(loading || ttsFetching || fullTextPrefetching || retranslating) && (
        <div className="fixed top-2 left-1/2 -translate-x-1/2 z-50 bg-[var(--bg-playbar)] text-white px-4 py-2 flex items-center justify-center gap-2 text-sm rounded-full shadow-lg">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>
            {retranslating
              ? `${t('RETRANSLATE', userPrefs.interfaceLanguage)} ${retranslateProgress}`
              : loading
                ? t('WAIT_EXPLAINING', userPrefs.interfaceLanguage)
                : fullTextPrefetching
                  ? t('WAIT_LOADING_AUDIO', userPrefs.interfaceLanguage)
                  : t('WAIT_TTS', userPrefs.interfaceLanguage)}
          </span>
        </div>
      )}

      {importProgress && (
        <div className="fixed top-2 left-1/2 -translate-x-1/2 z-50 bg-[var(--bg-playbar)] text-white px-4 py-2 flex items-center justify-center gap-2 text-sm rounded-full shadow-lg">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>
            {Math.round((importProgress.done / Math.max(importProgress.total, 1)) * 100)}% ({importProgress.done}/{importProgress.total})
          </span>
        </div>
      )}

      <main className="flex-1 flex flex-col lg:flex-row overflow-hidden relative">
        {workspaceLoading && (
          <div className="absolute inset-0 bg-[var(--bg-overlay-light)] flex items-center justify-center z-20 backdrop-blur-[2px]">
            <Loader2 className="w-8 h-8 animate-spin text-[var(--text-muted)]" />
          </div>
        )}
        {/* Left Side: Editor + History */}
        <section className="flex-1 flex flex-col border-right border-[var(--border-main)] bg-[var(--bg-panel)] min-h-[50vh] lg:min-h-0">
          <TextToolbar
            textLanguage={textLanguage}
            disabledTextLanguages={disabledTextLanguages}
            text={text}
            textDir={textDir}
            userPrefs={userPrefs}
            user={user}
            isPaidUser={isPaidUser}
            isEmbedMode={isEmbedMode}
            isTouchDevice={isTouchDevice}
            textHidden={textHidden}
            setTextHidden={setTextHidden}
            editMode={editMode}
            setEditMode={setEditMode}
            showUnsaved={showUnsaved}
            loading={loading}
            speaking={speaking}
            fullTextPlaying={fullTextPlaying}
            fullTextPaused={fullTextPaused}
            fullTextPrefetching={fullTextPrefetching}
            currentSentenceIndex={currentSentenceIndex}
            sentencePause={sentencePause}
            setSentencePause={setSentencePause}
            sentenceRepeat={sentenceRepeat}
            setSentenceRepeat={setSentenceRepeat}
            playbackSpeed={playbackSpeed}
            setPlaybackSpeed={setPlaybackSpeed}
            speedSwitching={speedSwitching}
            overallProgress={overallProgress}
            sentencesRef={sentencesRef}
            sentencePauseRef={sentencePauseRef}
            sentenceRepeatRef={sentenceRepeatRef}
            playbackSpeedRef={playbackSpeedRef}
            acousticPreset={acousticPreset}
            setAcousticPreset={setAcousticPreset}
            noisePreset={noisePreset}
            setNoisePreset={setNoisePreset}
            noiseLevel={noiseLevel}
            setNoiseLevel={setNoiseLevel}
            voiceCatalog={voiceCatalog}
            currentVoice={currentVoice}
            setCurrentVoice={setCurrentVoice}
            voiceSwitching={voiceSwitching}
            startFullTextPlayback={startFullTextPlayback}
            stopFullTextPlayback={stopFullTextPlayback}
            pauseFullTextPlayback={pauseFullTextPlayback}
            resumeFullTextPlayback={resumeFullTextPlayback}
            nextSentence={nextSentence}
            prevSentence={prevSentence}
            seekToProgress={seekToProgress}
            downloadingAudio={downloadingAudio}
            downloadFullTextAudio={downloadFullTextAudio}
            isRecording={isRecording}
            hasRecording={hasRecording}
            playingRecording={playingRecording}
            startRecording={startRecording}
            stopRecording={stopRecording}
            toggleRecordingPlayback={toggleRecordingPlayback}
            deleteRecording={deleteRecording}
            setShowGenerateText={setShowGenerateText}
            setShowImageOcr={setShowImageOcr}
            explainHistory={explainHistory}
            exportCards={exportCards}
            startFlashcards={() => {
              // Menu entry should always land on a clean "Current session"
              // Browse view — wipes any leftover Practice mode / reversed flip
              // from a previous saved-deck session before kicking off the run.
              setFlashcardReversed(false);
              setFlashcardFlipped(false);
              handleFlashcardSourceChange('session');
            }}
            decksCount={decks.length}
            onCreateDeck={createNewDeckPrompt}
            onOpenReview={openDeckReview}
            speakPhrase={speakPhrase}
            handleQuickExplain={handleQuickExplain}
            quickInput={quickInput}
            setQuickInput={setQuickInput}
            workspaces={workspaces}
            activeWorkspaceId={activeWorkspaceId}
            setEditingTabId={setEditingTabId}
            setEditingTabName={setEditingTabName}
            duplicateWorkspace={duplicateWorkspace}
            deleteWorkspace={deleteWorkspace}
            handleShare={handleShare}
            retranslateAll={retranslateAll}
            retranslating={retranslating}
            retranslateProgress={retranslateProgress}
            setDeleteConfirm={setDeleteConfirm}
            onClearWorkspace={() => {
              if (window.confirm(`${t('CLEAR', userPrefs.interfaceLanguage)}? ${t('DELETE_CONFIRM_MSG', userPrefs.interfaceLanguage)}`)) {
                setTextAndResetScene(''); setHistory([]); setExplainHistory([]); setResult(null); setSelection(''); setQuickInput(''); setSelectionHintDismissed(false);
                ttsCacheRef.current = new Map(); ttsRawCacheRef.current = new Map(); explanationCacheRef.current = new Map(); originIdRef.current = crypto.randomUUID();
              }
            }}
            onLanguageChange={(lang) => { setTextLanguage(lang); explanationCacheRef.current = new Map(); ttsCacheRef.current = new Map(); ttsRawCacheRef.current = new Map(); }}
            tutorialStep={tutorialStep}
            TUTORIAL_STEPS={TUTORIAL_STEPS}
          />
          {/* Main area: textarea + history sidebar side by side */}
          <div className="flex-1 flex flex-col lg:flex-row min-h-0">
            {/* Textarea column */}
            <div data-tutorial="textarea" className="flex-1 flex flex-col min-h-0">
              {(isEmbedMode || !editMode) && text ? (
                /* Read mode: tappable word spans */
                <div className="relative flex-1 flex flex-col min-h-0">
                  <div
                    ref={wordViewRef}
                    onClick={(e) => {
                      // Click on empty space (not on a word span) clears selection
                      if (e.target === e.currentTarget && tapWordRange !== null) {
                        setTapWordRange(null);
                        setSelection('');
                      }
                    }}
                    onMouseMove={handleTextHoverMove}
                    onMouseLeave={handleTextHoverLeave}
                    className={`flex-1 p-4 lg:p-8 text-xl leading-relaxed font-serif text-[var(--text-primary)] overflow-y-auto whitespace-pre-wrap lg:select-none transition-all${textHidden ? ' blur-lg pointer-events-none' : ''}${fullTextPlaying ? ' pb-32 sm:pb-4 lg:pb-8' : ''}`}
                    lang={textLanguage}
                    dir={textDir}
                  >
                    {textTokens.map((token, i) => {
                      const isWhitespace = /^\s+$/.test(token);
                      if (isWhitespace) {
                        const wsStyle = explainedTokenStyles.get(i);
                        const wsUnderline = wsStyle === 'underline' || wsStyle === 'both' ? ' underline decoration-[var(--text-tertiary)] underline-offset-4' : '';
                        return <span key={i} className={wsUnderline || undefined}>{token}</span>;
                      }
                      // Dialog speaker label ("Name:") — gray, and not selectable
                      // for explain/listen (no tap handler, no native selection).
                      if (personaTokenIndices.has(i)) {
                        return (
                          <span key={i} className="text-[var(--text-muted)] select-none">{token}</span>
                        );
                      }
                      const isSelected = tapWordRange !== null && i >= tapWordRange[0] && i <= tapWordRange[1];
                      const isActiveExplanation = !isSelected && activeExplanationTokens.has(i);
                      const tokenStyle = explainedTokenStyles.get(i);
                      const styleClasses = tokenStyle === 'bold' || tokenStyle === 'both' ? 'font-semibold' : '';
                      const underlineClasses = tokenStyle === 'underline' || tokenStyle === 'both' ? ' underline decoration-[var(--text-tertiary)] underline-offset-4' : '';
                      return (
                        <span
                          key={i}
                          data-token-index={i}
                          onClick={() => handleWordTap(i)}
                          className={`cursor-pointer rounded px-0.5 -mx-0.5 transition-colors ${
                            isSelected ? 'bg-yellow-300 text-gray-900' : isActiveExplanation ? 'bg-purple-400/25' : 'active:bg-[var(--bg-hover)]'
                          } ${styleClasses}${underlineClasses}`}
                        >
                          {token}
                        </span>
                      );
                    })}
                  </div>
                  {/* Hover tooltip for explained word/phrase translations (desktop only) */}
                  {hoverTip && !isTouchDevice && (
                    <div
                      style={{
                        position: 'fixed',
                        top: hoverTip.rect.top < 60 ? hoverTip.rect.bottom + 8 : hoverTip.rect.top - 8,
                        left: hoverTip.rect.left + hoverTip.rect.width / 2,
                        transform: hoverTip.rect.top < 60 ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
                      }}
                      className="z-40 px-2.5 py-1.5 rounded-md bg-[var(--bg-accent)] text-[var(--text-on-accent)] text-xs shadow-lg max-w-xs pointer-events-none break-words"
                      data-testid="hover-tooltip"
                    >
                      {hoverTip.text}
                    </div>
                  )}
                  {/* Selection hint (mobile read mode) */}
                  {!result && !selectionHintDismissed && tapWordRange === null && !textHidden && (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="absolute bottom-14 left-1/2 -translate-x-1/2 z-10 bg-[var(--bg-accent)] text-[var(--text-on-accent)] px-4 py-2 rounded-full shadow-lg text-xs font-medium flex items-center gap-2"
                      onClick={() => setSelectionHintDismissed(true)}
                    >
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                      {t('SELECTION_HINT', userPrefs.interfaceLanguage)}
                    </motion.div>
                  )}
                  {/* Desktop floating toolbar for tap selection in read mode */}
                  <AnimatePresence>
                    {!isTouchDevice && selection && tapWordRange !== null && (
                      <motion.div
                        ref={floatingToolbarRef}
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        transition={{ duration: 0.12 }}
                        className="fixed z-[45] bg-[var(--bg-panel)] border border-[var(--border-main)] rounded-full shadow-lg px-1 py-1 flex items-center gap-1"
                        style={(() => {
                          const toolbarW = 220, toolbarH = 36, gap = 10;
                          const lastIdx = tapWordRange[1];
                          const el = wordViewRef.current?.querySelector(`[data-token-index="${lastIdx}"]`) as HTMLElement | null;
                          if (!el) return { left: 0, top: 0, visibility: 'hidden' as const };
                          const rect = el.getBoundingClientRect();
                          let x = rect.left + rect.width / 2 - toolbarW / 2;
                          let y = rect.top - toolbarH - gap;
                          if (y < 8) y = rect.bottom + gap;
                          if (x < 8) x = 8;
                          if (x + toolbarW > window.innerWidth - 8) x = window.innerWidth - toolbarW - 8;
                          return { left: x, top: y };
                        })()}
                        onMouseDown={(e) => e.preventDefault()}
                      >
                        <button
                          onClick={() => { actionTakenRef.current = true; speakPhrase(); }}
                          disabled={speaking}
                          className="bg-[var(--bg-hover)] text-[var(--text-primary)] px-3 py-1 rounded-full text-xs font-medium flex items-center gap-1.5 hover:bg-[var(--bg-muted)] transition-all disabled:opacity-50"
                        >
                          {speaking ? <Loader2 className="w-3 h-3 animate-spin" /> : <Volume2 className="w-3 h-3" />}
                          {t('LISTEN', userPrefs.interfaceLanguage)}
                        </button>
                        <button
                          onClick={() => { actionTakenRef.current = true; explainSelection(); }}
                          disabled={loading}
                          className="bg-[var(--bg-accent)] text-[var(--text-on-accent)] px-3 py-1 rounded-full text-xs font-medium flex items-center gap-1.5 hover:bg-[var(--bg-accent-hover)] transition-all disabled:opacity-50"
                        >
                          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                          {t('EXPLAIN', userPrefs.interfaceLanguage)}
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                  {/* Edit button when no selection active (read mode) — mobile only, desktop uses toolbar toggle */}
                  {!isEmbedMode && (tapWordRange === null || !selection) && !textHidden && (
                    <button
                      onClick={() => setEditMode(true)}
                      className="lg:hidden absolute bottom-3 right-3 z-10 bg-[var(--bg-panel)] shadow-md border border-[var(--border-main)] rounded-full p-2.5 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
                      aria-label="Edit text"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ) : isEmbedMode ? (
                /* Embed mode with no text: empty placeholder */
                <div className="flex-1 flex items-center justify-center text-[var(--text-muted)] text-sm">
                  {t('PASTE_TEXT', userPrefs.interfaceLanguage).replace('{lang}', LANGUAGES[textLanguage]?.label || '')}
                </div>
              ) : (
                /* Desktop or mobile edit mode: standard textarea */
                <div className="relative flex-1 flex">
                  <textarea
                    ref={textareaRef}
                    value={text}
                    onChange={(e) => {
                      setTextAndResetScene(e.target.value);
                      setSelection('');
                      setFloatingToolbarPos(null);
                      if (!editMode) setEditMode(true);
                    }}
                    onMouseUp={(e) => handleSelection(e)}
                    onKeyUp={() => handleSelection()}
                    onFocus={() => setTextareaFocused(true)}
                    onBlur={(e) => { setTextareaFocused(false); if (isTouchDevice && text) setEditMode(false); }}
                    autoFocus={editMode}
                    placeholder={textareaFocused ? t('PASTE_TEXT', userPrefs.interfaceLanguage).replace('{lang}', LANGUAGES[textLanguage]?.label || '') : ''}
                    className={`flex-1 p-4 lg:p-8 text-xl leading-relaxed resize-none focus:outline-none font-serif text-[var(--text-primary)] placeholder:text-[var(--text-faint)] transition-all${textHidden ? ' blur-lg select-none' : ''}`}
                    lang={textLanguage}
                    dir={textDir}
                    spellCheck={false}
                    tabIndex={textHidden ? -1 : undefined}
                  />
                  <AnimatePresence>
                    {text && !result && !selectionHintDismissed && !selection && (
                      <motion.div
                        key="selection-hint"
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 8 }}
                        className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 bg-[var(--bg-accent)] text-[var(--text-on-accent)] px-4 py-2 rounded-full shadow-lg text-xs font-medium flex items-center gap-2 cursor-pointer"
                        onClick={() => setSelectionHintDismissed(true)}
                      >
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                        {t('SELECTION_HINT', userPrefs.interfaceLanguage)}
                      </motion.div>
                    )}
                  </AnimatePresence>
                  <AnimatePresence>
                    {!isTouchDevice && selection && floatingToolbarPos && (
                      <motion.div
                        ref={floatingToolbarRef}
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        transition={{ duration: 0.12 }}
                        className="fixed z-[45] bg-[var(--bg-panel)] border border-[var(--border-main)] rounded-full shadow-lg px-1 py-1 flex items-center gap-1"
                        style={(() => {
                          const toolbarW = 220, toolbarH = 36, gap = 10;
                          let x = floatingToolbarPos.x - toolbarW / 2;
                          let y = floatingToolbarPos.y - toolbarH - gap;
                          if (y < 8) y = floatingToolbarPos.y + gap;
                          if (x < 8) x = 8;
                          if (x + toolbarW > window.innerWidth - 8) x = window.innerWidth - toolbarW - 8;
                          return { left: x, top: y };
                        })()}
                        onMouseDown={(e) => e.preventDefault()}
                      >
                        <button
                          onClick={() => { actionTakenRef.current = true; speakPhrase(); }}
                          disabled={speaking}
                          className="bg-[var(--bg-hover)] text-[var(--text-primary)] px-3 py-1 rounded-full text-xs font-medium flex items-center gap-1.5 hover:bg-[var(--bg-muted)] transition-all disabled:opacity-50"
                        >
                          {speaking ? <Loader2 className="w-3 h-3 animate-spin" /> : <Volume2 className="w-3 h-3" />}
                          {t('LISTEN', userPrefs.interfaceLanguage)}
                        </button>
                        <button
                          onClick={() => { actionTakenRef.current = true; explainSelection(); }}
                          disabled={loading}
                          className="bg-[var(--bg-accent)] text-[var(--text-on-accent)] px-3 py-1 rounded-full text-xs font-medium flex items-center gap-1.5 hover:bg-[var(--bg-accent-hover)] transition-all disabled:opacity-50"
                        >
                          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                          {t('EXPLAIN', userPrefs.interfaceLanguage)}
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                  {!text && !textareaFocused && (
                    <div
                      className="absolute inset-0 flex items-center justify-center p-3 sm:p-6 lg:p-12 pointer-events-auto"
                      dir={['he', 'ar'].includes(userPrefs.interfaceLanguage) ? 'rtl' : 'ltr'}
                    >
                      <div className="flex flex-col items-stretch gap-3 sm:gap-4 w-full max-w-2xl">
                        <button
                          onClick={() => textareaRef.current?.focus()}
                          className="w-full flex flex-col items-center gap-1.5 sm:gap-2 p-3 sm:p-5 rounded-xl border-2 border-dashed border-[var(--border-main)] hover:border-[var(--border-accent)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] transition-all group"
                        >
                          <BookOpen className="w-5 h-5 sm:w-6 sm:h-6 text-[var(--text-muted)] group-hover:text-[var(--text-primary)] transition-colors" />
                          <span className="text-xs sm:text-sm font-medium text-[var(--text-primary)]">{t('EMPTY_STATE_PASTE', userPrefs.interfaceLanguage)}</span>
                          <span className="hidden sm:block text-xs text-[var(--text-muted)] text-center leading-snug">{t('EMPTY_STATE_PASTE_DESC', userPrefs.interfaceLanguage)}</span>
                        </button>
                        <div className="flex items-center justify-center">
                          <span className="text-xs text-[var(--text-faint)] uppercase tracking-wider">{t('EMPTY_STATE_OR', userPrefs.interfaceLanguage)}</span>
                        </div>
                        <div className="flex flex-row items-stretch gap-3 sm:gap-4 w-full">
                          <button
                            onClick={() => setShowGenerateText(true)}
                            className="flex-1 flex flex-col items-center gap-1.5 sm:gap-2 p-3 sm:p-5 rounded-xl border-2 border-dashed border-[var(--border-main)] hover:border-[var(--border-accent)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] transition-all group"
                          >
                            <Wand2 className="w-5 h-5 sm:w-6 sm:h-6 text-[var(--text-muted)] group-hover:text-[var(--text-primary)] transition-colors" />
                            <span className="text-xs sm:text-sm font-medium text-[var(--text-primary)]">{t('EMPTY_STATE_GENERATE', userPrefs.interfaceLanguage)}</span>
                            <span className="hidden sm:block text-xs text-[var(--text-muted)] text-center leading-snug">{t('EMPTY_STATE_GENERATE_DESC', userPrefs.interfaceLanguage)}</span>
                          </button>
                          <div className="flex items-center justify-center">
                            <span className="text-xs text-[var(--text-faint)] uppercase tracking-wider">{t('EMPTY_STATE_OR', userPrefs.interfaceLanguage)}</span>
                          </div>
                          <button
                            onClick={() => setShowImageOcr(true)}
                            className="flex-1 flex flex-col items-center gap-1.5 sm:gap-2 p-3 sm:p-5 rounded-xl border-2 border-dashed border-[var(--border-main)] hover:border-[var(--border-accent)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] transition-all group"
                          >
                            <Camera className="w-5 h-5 sm:w-6 sm:h-6 text-[var(--text-muted)] group-hover:text-[var(--text-primary)] transition-colors" />
                            <span className="text-xs sm:text-sm font-medium text-[var(--text-primary)]">{t('EMPTY_STATE_OCR', userPrefs.interfaceLanguage)}</span>
                            <span className="hidden sm:block text-xs text-[var(--text-muted)] text-center leading-snug">{t('EMPTY_STATE_OCR_DESC', userPrefs.interfaceLanguage)}</span>
                          </button>
                        </div>
                        <div className="self-center flex flex-row items-center gap-4">
                          <button
                            onClick={() => setTimeout(() => setTutorialStep(0), 100)}
                            className="flex flex-row items-center gap-2 px-4 py-2 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                          >
                            <Info className="w-4 h-4" />
                            <span className="text-xs font-medium">{t('EMPTY_STATE_TOUR', userPrefs.interfaceLanguage)}</span>
                          </button>
                          <a
                            href="/guide"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex flex-row items-center gap-2 px-4 py-2 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                          >
                            <CircleHelp className="w-4 h-4" />
                            <span className="text-xs font-medium">{t('HELP', userPrefs.interfaceLanguage)}</span>
                          </a>
                          <a
                            href="/#lp-content"
                            className="flex flex-row items-center gap-2 px-4 py-2 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                          >
                            <Globe className="w-4 h-4" />
                            <span className="text-xs font-medium">{t('ABOUT', userPrefs.interfaceLanguage)}</span>
                          </a>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {text.length > 0 && (
                <div className="px-4 py-1 border-t border-[var(--border-light)] bg-[var(--bg-surface-half)] text-right">
                  <span className={`text-[10px] tabular-nums ${text.length > effectiveTextLimit ? 'text-red-500' : text.length > effectiveTextLimit * 0.9 ? 'text-amber-500' : 'text-[var(--text-faint)]'}`}>
                    {text.length} / {effectiveTextLimit}
                  </span>
                </div>
              )}
              {isTouchDevice && (
                <div className="px-4 py-2 border-t border-[var(--border-light)] flex gap-2 items-center bg-[var(--bg-surface-half)]">
                  <div className="flex-1 relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-faint)] pointer-events-none" />
                    <input
                      type="text"
                      value={quickInput}
                      onChange={(e) => setQuickInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleQuickExplain(); }}
                      placeholder={t('EXPLAIN_WORD', userPrefs.interfaceLanguage)}
                      className="w-full text-sm pl-8 pr-3 py-1.5 border border-[var(--border-main)] rounded-lg focus:outline-none focus:border-[var(--border-accent)] bg-[var(--bg-panel)] text-[var(--text-primary)] placeholder:text-[var(--text-faint)] transition-colors"
                      dir={textDir}
                      spellCheck={false}
                    />
                  </div>
                  <button
                    onClick={() => speakPhrase(quickInput.trim())}
                    disabled={!quickInput.trim() || speaking}
                    className="shrink-0 bg-[var(--bg-hover)] text-[var(--text-primary)] p-2.5 rounded-lg flex items-center gap-1.5 hover:bg-[var(--bg-muted)] transition-colors disabled:opacity-40"
                    title={t('LISTEN', userPrefs.interfaceLanguage)}
                  >
                    {speaking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Volume2 className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={handleQuickExplain}
                    disabled={!quickInput.trim() || loading}
                    className="shrink-0 bg-[var(--bg-playbar)] text-white p-2.5 rounded-lg flex items-center gap-1.5 hover:bg-[var(--bg-hover)] transition-colors disabled:opacity-40"
                    title={t('EXPLAIN', userPrefs.interfaceLanguage)}
                  >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  </button>
                </div>
              )}
            </div>

            {/* History sidebar — parallel to textarea */}
            {history.length > 0 && (
              <div data-tutorial="history" className="w-full lg:w-52 border-t lg:border-t-0 lg:border-l border-[var(--border-main)] bg-[var(--bg-surface)] flex flex-col overflow-hidden shrink-0">
                <div className="hidden lg:flex px-4 pt-3 pb-2 items-center gap-2 flex-none border-b border-[var(--border-light)]">
                  <History className="w-3 h-3 text-[var(--text-muted)]" />
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">{t('TTS_HISTORY', userPrefs.interfaceLanguage)}</span>
                </div>
                <div className="px-3 py-2 lg:py-3 flex flex-row lg:flex-col gap-1.5 overflow-x-auto lg:overflow-x-hidden lg:overflow-y-auto flex-1">
                  {history.map((phrase, i) => (
                    <button
                      key={i}
                      onClick={() => speakPhrase(phrase)}
                      disabled={speaking}
                      dir={textDir}
                      className="shrink-0 px-3 py-2 bg-[var(--bg-panel)] border border-[var(--border-main)] rounded-lg text-xs text-[var(--text-secondary)] hover:border-[var(--border-accent)] hover:text-[var(--text-primary)] transition-all flex items-center gap-2 group shadow-sm text-left whitespace-nowrap lg:whitespace-normal"
                    >
                      <Volume2 className="w-3 h-3 text-[var(--text-faint)] group-hover:text-[var(--text-primary)] shrink-0" />
                      <span className="truncate">{phrase}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Right Side: Results */}
        <ExplanationPanel
          result={result}
          loading={loading}
          error={error}
          isAdmin={user?.role === 'admin'}
          explainHistory={explainHistory}
          setExplainHistory={setExplainHistory}
          explainNavIdx={explainNavIdx}
          setExplainNavIdx={setExplainNavIdx}
          explanationCacheRef={explanationCacheRef}
          setResult={setResult}
          setError={setError}
          speakPhrase={speakPhrase}
          speaking={speaking}
          explainPhrase={explainPhrase}
          lastExplainedPhraseRef={lastExplainedPhraseRef}
          interfaceLanguage={userPrefs.interfaceLanguage}
          explanationLanguage={userPrefs.explanationLanguage}
          textLanguage={textLanguage}
          textDir={textDir}
          explDir={explDir}
          resultSectionRef={resultSectionRef}
          isTouchDevice={isTouchDevice}
          backToTextBtnRef={backToTextBtnRef}
          savedScrollYRef={savedScrollYRef}
          decks={decks}
          activeDeckId={activeDeckId}
          setActiveDeck={setActiveDeck}
          addCardToActiveDeck={addCardToActiveDeck}
          addAllToActiveDeck={addAllToActiveDeck}
          isCurrentCardInActiveDeck={isCurrentCardInActiveDeck}
          onCreateDeck={createNewDeckPrompt}
          onOpenReview={openDeckReview}
          showToast={showToast}
          requestExampleVariant={requestExampleVariant}
        />
      </main>

      {/* Mobile floating action bar */}
      {isTouchDevice && selection && !fullTextPlaying && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-[var(--bg-overlay-blur)] backdrop-blur border-t border-[var(--border-main)] px-4 py-3 flex items-center justify-center gap-3 shadow-[0_-4px_12px_rgba(0,0,0,0.08)] lg:hidden">
          <button
            onClick={() => {
              speakPhrase();
              setSelection(''); setTapWordRange(null);
            }}
            disabled={speaking}
            className="bg-[var(--bg-hover)] text-[var(--text-primary)] px-5 py-2.5 rounded-full text-sm font-medium flex items-center gap-2 hover:bg-[var(--bg-muted)] transition-all disabled:opacity-50"
          >
            {speaking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Volume2 className="w-4 h-4" />}
            {t('LISTEN', userPrefs.interfaceLanguage)}
          </button>
          <button
            onClick={explainSelection}
            disabled={loading}
            className="bg-[var(--bg-accent)] text-[var(--text-on-accent)] px-5 py-2.5 rounded-full text-sm font-medium flex items-center gap-2 hover:bg-[var(--bg-accent-hover)] transition-all disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {t('EXPLAIN', userPrefs.interfaceLanguage)} "{selection.length > 12 ? selection.substring(0, 12) + '…' : selection}"
          </button>
          {tapWordRange !== null && (
            <button
              onClick={() => setEditMode(true)}
              className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] p-2 rounded-full transition-colors"
              aria-label="Edit text"
            >
              <Pencil className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={() => { setTapWordRange(null); setSelection(''); }}
            className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] p-2 rounded-full transition-colors"
          >
            ✕
          </button>
        </div>
      )}

      {/* Mobile fixed TTS player bar */}
      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-[var(--bg-overlay)] flex items-center justify-center z-50 p-4">
          <div className="bg-[var(--bg-panel)] rounded-2xl shadow-lg max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-[var(--text-primary)]">{t('SETTINGS', userPrefs.interfaceLanguage)}</h2>
              <button
                onClick={() => setShowSettings(false)}
                className="p-2 -m-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] text-xl leading-none"
              >
                ×
              </button>
            </div>

            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
                  {t('INTERFACE_LANG', userPrefs.interfaceLanguage)}
                </label>
                <p className="text-xs text-[var(--text-muted)] mb-2">{t('INTERFACE_LANG_HINT', userPrefs.interfaceLanguage)}</p>
                <select
                  value={userPrefs.interfaceLanguage}
                  onChange={(e) => {
                    const newPrefs = { ...userPrefs, interfaceLanguage: e.target.value };
                    setUserPrefs(newPrefs);
                    localStorage.setItem('userPrefs', JSON.stringify(newPrefs));
                    if (sessionId) {
                      fetch('/api/preferences', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
                        body: JSON.stringify(newPrefs),
                      }).catch(err => console.error('Failed to save preferences:', err));
                    }
                  }}
                  className="w-full px-3 py-2 border border-[var(--border-main)] rounded-lg bg-[var(--bg-panel)] text-[var(--text-secondary)] focus:outline-none focus:border-[var(--border-main)]"
                >
                  {Object.entries(LANGUAGES).map(([code, lang]) => (
                    <option key={code} value={code}>{lang.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
                  {t('DEFAULT_TEXT_LANG', userPrefs.interfaceLanguage)}
                </label>
                <p className="text-xs text-[var(--text-muted)] mb-2">{t('TEXT_LANG_HINT', userPrefs.interfaceLanguage)}</p>
                <select
                  value={userPrefs.defaultTextLanguage || 'de'}
                  onChange={(e) => {
                    const newPrefs = { ...userPrefs, defaultTextLanguage: e.target.value };
                    setUserPrefs(newPrefs);
                    localStorage.setItem('userPrefs', JSON.stringify(newPrefs));
                    if (sessionId) {
                      fetch('/api/preferences', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
                        body: JSON.stringify(newPrefs),
                      }).catch(err => console.error('Failed to save preferences:', err));
                    }
                  }}
                  className="w-full px-3 py-2 border border-[var(--border-main)] rounded-lg bg-[var(--bg-panel)] text-[var(--text-secondary)] focus:outline-none focus:border-[var(--border-main)]"
                >
                  {Object.entries(LANGUAGES).filter(([code]) => !disabledTextLanguages.has(code)).map(([code, lang]) => (
                    <option key={code} value={code}>{lang.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
                  {t('EXPLANATION_LANG', userPrefs.interfaceLanguage)}
                </label>
                <p className="text-xs text-[var(--text-muted)] mb-2">{t('EXPLANATION_LANG_HINT', userPrefs.interfaceLanguage)}</p>
                <select
                  value={userPrefs.explanationLanguage}
                  onChange={(e) => {
                    const newPrefs = { ...userPrefs, explanationLanguage: e.target.value };
                    setUserPrefs(newPrefs);
                    localStorage.setItem('userPrefs', JSON.stringify(newPrefs));
                    // Clear explanation cache since answers will be in a different language now
                    explanationCacheRef.current = new Map();
                    if (sessionId) {
                      fetch('/api/preferences', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
                        body: JSON.stringify(newPrefs),
                      }).catch(err => console.error('Failed to save preferences:', err));
                    }
                  }}
                  className="w-full px-3 py-2 border border-[var(--border-main)] rounded-lg bg-[var(--bg-panel)] text-[var(--text-secondary)] focus:outline-none focus:border-[var(--border-main)]"
                >
                  {Object.entries(LANGUAGES).map(([code, lang]) => (
                    <option key={code} value={code}>{lang.label}</option>
                  ))}
                </select>
              </div>

              {/* Theme toggle */}
              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                  {t('THEME', userPrefs.interfaceLanguage)}
                </label>
                <div className="flex gap-2">
                  {(['light', 'dark'] as const).map(themeOpt => (
                    <button
                      key={themeOpt}
                      onClick={() => {
                        const newPrefs = { ...userPrefs, theme: themeOpt };
                        setUserPrefs(newPrefs);
                        localStorage.setItem('userPrefs', JSON.stringify(newPrefs));
                        if (sessionId) {
                          fetch('/api/preferences', {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
                            body: JSON.stringify(newPrefs),
                          }).catch(err => console.error('Failed to save preferences:', err));
                        }
                      }}
                      className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors border ${
                        (userPrefs.theme || 'dark') === themeOpt
                          ? 'bg-[var(--bg-accent)] text-[var(--text-on-accent)] border-transparent'
                          : 'bg-[var(--bg-surface)] text-[var(--text-secondary)] border-[var(--border-main)] hover:bg-[var(--bg-hover)]'
                      }`}
                    >
                      {themeOpt === 'light' ? (t('THEME_LIGHT', userPrefs.interfaceLanguage)) : (t('THEME_DARK', userPrefs.interfaceLanguage))}
                    </button>
                  ))}
                </div>
              </div>

              {/* Linked accounts */}
              {user && !isAnonymous && (
                <div className="pt-4 border-t border-[var(--border-light)]">
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
                    {t('ACCOUNT_LINKS_TITLE', userPrefs.interfaceLanguage)}
                  </label>
                  {user.email ? (
                    <p className="text-xs text-[var(--text-muted)]">
                      {t('LINK_GOOGLE_LINKED', userPrefs.interfaceLanguage).replace('{email}', user.email)}
                    </p>
                  ) : (
                    <>
                      <p className="text-xs text-[var(--text-muted)] mb-3">
                        {t('LINK_GOOGLE_DESC', userPrefs.interfaceLanguage)}
                      </p>
                      {isTelegramMiniApp() ? (
                        <button
                          onClick={openGoogleLinkExternal}
                          className="w-full bg-[var(--bg-accent)] text-[var(--text-on-accent)] py-2.5 rounded-xl text-sm font-medium hover:bg-[var(--bg-accent-hover)] transition-colors"
                        >
                          {t('SIGN_IN_WITH_GOOGLE', userPrefs.interfaceLanguage)}
                        </button>
                      ) : (
                        <div className="flex justify-center">
                          <GoogleLogin onSuccess={handleLinkGoogle} onError={() => showToast('Google sign-in failed')} />
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* Billing section */}
              <div className="pt-4 border-t border-[var(--border-light)]">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm font-medium text-[var(--text-secondary)]">
                      {subscriptionStatus === 'active' || subscriptionStatus === 'trialing'
                        ? t('PRO_PLAN', userPrefs.interfaceLanguage)
                        : t('FREE_PLAN', userPrefs.interfaceLanguage)}
                    </span>
                    {subscriptionPeriodEnd && (subscriptionStatus === 'active' || subscriptionStatus === 'trialing') && (
                      <p className="text-xs text-[var(--text-tertiary)] mt-0.5">
                        {cancelAtPeriodEnd
                          ? (t('SUBSCRIPTION_CANCELS', userPrefs.interfaceLanguage) || '').replace('{date}', new Date(subscriptionPeriodEnd).toLocaleDateString())
                          : (t('SUBSCRIPTION_ACTIVE_UNTIL', userPrefs.interfaceLanguage) || '').replace('{date}', new Date(subscriptionPeriodEnd).toLocaleDateString())}
                      </p>
                    )}
                    {(() => {
                      // Only show trial badge when limits are enabled (trial is meaningful)
                      const limitsConfigOn = isAnonymous ? appSettings.anon_limits_enabled !== 'false' : appSettings.free_limits_enabled !== 'false';
                      if (!limitsConfigOn) return null;
                      const trialDays = parseInt(appSettings.free_trial_days || '0', 10);
                      if (trialDays <= 0 || !user?.created_at || isPaidUser) return null;
                      const daysLeft = Math.max(0, Math.ceil((new Date(user.created_at).getTime() + trialDays * 86400_000 - Date.now()) / 86400_000));
                      if (daysLeft <= 0) return null;
                      return (
                        <p className="text-xs text-emerald-500 mt-0.5">
                          {(t('TRIAL_DAYS_LEFT', userPrefs.interfaceLanguage) || '').replace('{days}', String(daysLeft))}
                        </p>
                      );
                    })()}
                  </div>
                  {subscriptionStatus === 'active' || subscriptionStatus === 'trialing' ? (
                    <button
                      onClick={() => {
                        fetch('/api/stripe/portal', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json', 'X-Session-Id': sessionId || '' },
                        })
                          .then(r => r.json())
                          .then(data => {
                            if (data.url) window.location.href = data.url;
                            else if (data.error) showToast(data.error);
                          })
                          .catch(err => showToast(err.message));
                      }}
                      className="px-3 py-1.5 text-sm border border-[var(--border-main)] rounded-lg hover:bg-[var(--bg-surface)] transition-colors"
                    >
                      {t('MANAGE_BILLING', userPrefs.interfaceLanguage)}
                    </button>
                  ) : !isAnonymous ? (
                    <button
                      onClick={() => { setShowSettings(false); setShowUpgrade(true); }}
                      className="px-3 py-1.5 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
                    >
                      {t('UPGRADE_BUTTON', userPrefs.interfaceLanguage)}
                    </button>
                  ) : null}
                </div>
              </div>

              <button
                onClick={() => setShowSettings(false)}
                className="w-full px-4 py-2 bg-[var(--bg-accent)] text-[var(--text-on-accent)] rounded-lg font-medium hover:bg-[var(--bg-accent-hover)] transition-colors"
              >
                {t('CLOSE', userPrefs.interfaceLanguage)}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Text Limit Warning Modal */}
      <Modal show={showTextLimitWarning} onClose={() => setShowTextLimitWarning(false)} centerContent>
        <div className="w-14 h-14 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <span className="text-2xl">&#9888;</span>
        </div>
        <p className="text-[var(--text-secondary)] mb-6 text-sm leading-relaxed">
          {(t('TEXT_LIMIT_WARNING', userPrefs.interfaceLanguage) || '').replace('{limit}', String(effectiveTextLimit))}
        </p>
        <button
          onClick={() => setShowTextLimitWarning(false)}
          className="w-full px-4 py-2.5 bg-[var(--bg-accent)] text-[var(--text-on-accent)] font-medium rounded-xl hover:bg-[var(--bg-accent-hover)] transition-colors text-sm"
        >
          {t('CLOSE', userPrefs.interfaceLanguage)}
        </button>
      </Modal>

      {/* Selection Limit Warning Modal */}
      <Modal show={showSelectionLimitWarning} onClose={() => setShowSelectionLimitWarning(false)} centerContent>
        <div className="w-14 h-14 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <span className="text-2xl">&#9888;</span>
        </div>
        <p className="text-[var(--text-secondary)] mb-6 text-sm leading-relaxed">
          {(t('SELECTION_LIMIT_WARNING', userPrefs.interfaceLanguage) || '').replace('{limit}', '150')}
        </p>
        <button
          onClick={() => setShowSelectionLimitWarning(false)}
          className="w-full px-4 py-2.5 bg-[var(--bg-accent)] text-[var(--text-on-accent)] font-medium rounded-xl hover:bg-[var(--bg-accent-hover)] transition-colors text-sm"
        >
          {t('CLOSE', userPrefs.interfaceLanguage)}
        </button>
      </Modal>

      {/* Sync Conflict Modal */}
      <Modal show={showSyncModal} onClose={() => {
        setShowSyncModal(false);
        if (syncResolveRef.current) { syncResolveRef.current('keep-local'); syncResolveRef.current = null; }
      }} centerContent>
        <div className="w-14 h-14 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <RefreshCw className="w-6 h-6 text-blue-500" />
        </div>
        <p className="text-[var(--text-primary)] font-medium mb-1">
          {t('SYNC_CONFLICT_TITLE', userPrefs.interfaceLanguage)}
        </p>
        <p className="text-[var(--text-tertiary)] mb-6 text-sm">
          {t('SYNC_CONFLICT_BODY', userPrefs.interfaceLanguage)}
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => {
              setShowSyncModal(false);
              // Update baseline so next save doesn't 409, then immediately save local state
              const wsId = activeWorkspaceIdRef.current;
              if (wsId && serverTimestampForSyncRef.current) {
                wsUpdatedAtRef.current.set(wsId, serverTimestampForSyncRef.current);
              }
              saveStateRef.current();
              if (syncResolveRef.current) { syncResolveRef.current('keep-local'); syncResolveRef.current = null; }
            }}
            className="flex-1 px-4 py-2.5 bg-[var(--bg-hover)] text-[var(--text-secondary)] font-medium rounded-xl hover:bg-[var(--bg-muted)] transition-colors text-sm"
          >
            {t('SYNC_KEEP_LOCAL', userPrefs.interfaceLanguage)}
          </button>
          <button
            onClick={() => {
              setShowSyncModal(false);
              if (syncResolveRef.current) { syncResolveRef.current('sync'); syncResolveRef.current = null; }
            }}
            className="flex-1 px-4 py-2.5 bg-[var(--bg-accent)] text-[var(--text-on-accent)] font-medium rounded-xl hover:bg-[var(--bg-accent-hover)] transition-colors text-sm"
          >
            {t('SYNC_LOAD_SERVER', userPrefs.interfaceLanguage)}
          </button>
        </div>
      </Modal>

      {/* Duplicate Import Modal */}
      <Modal show={showDuplicateImportModal} onClose={() => { setShowDuplicateImportModal(false); pendingImportDataRef.current = null; }} centerContent>
        <div className="w-14 h-14 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <Copy className="w-6 h-6 text-amber-500" />
        </div>
        <p className="text-[var(--text-primary)] font-medium mb-1">
          {t('DUPLICATE_IMPORT_TITLE', userPrefs.interfaceLanguage)}
        </p>
        <p className="text-[var(--text-tertiary)] mb-6 text-sm">
          {t('DUPLICATE_IMPORT_BODY', userPrefs.interfaceLanguage)}
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => { setShowDuplicateImportModal(false); pendingImportDataRef.current = null; }}
            className="flex-1 px-4 py-2.5 bg-[var(--bg-hover)] text-[var(--text-secondary)] font-medium rounded-xl hover:bg-[var(--bg-muted)] transition-colors text-sm"
          >
            {t('DUPLICATE_IMPORT_CANCEL', userPrefs.interfaceLanguage)}
          </button>
          <button
            onClick={() => {
              setShowDuplicateImportModal(false);
              const data = pendingImportDataRef.current;
              pendingImportDataRef.current = null;
              if (data) performSharedImport(data);
            }}
            className="flex-1 px-4 py-2.5 bg-[var(--bg-accent)] text-[var(--text-on-accent)] font-medium rounded-xl hover:bg-[var(--bg-accent-hover)] transition-colors text-sm"
          >
            {t('DUPLICATE_IMPORT_CONFIRM', userPrefs.interfaceLanguage)}
          </button>
        </div>
      </Modal>

      {/* Delete Workspace Confirm Modal */}
      <Modal show={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} centerContent>
        <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <Trash2 className="w-6 h-6 text-red-500" />
        </div>
        <p className="text-[var(--text-primary)] font-medium mb-1">
          {t('DELETE_CONFIRM', userPrefs.interfaceLanguage)} «{deleteConfirm?.name}»?
        </p>
        <p className="text-[var(--text-tertiary)] mb-6 text-sm">
          {t('DELETE_CONFIRM_MSG', userPrefs.interfaceLanguage)}
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => setDeleteConfirm(null)}
            className="flex-1 px-4 py-2.5 bg-[var(--bg-hover)] text-[var(--text-secondary)] font-medium rounded-xl hover:bg-[var(--bg-muted)] transition-colors text-sm"
          >
            {t('CLOSE', userPrefs.interfaceLanguage)}
          </button>
          <button
            onClick={() => { if (deleteConfirm) deleteWorkspace(deleteConfirm.id); setDeleteConfirm(null); }}
            className="flex-1 px-4 py-2.5 bg-red-500 text-white font-medium rounded-xl hover:bg-red-600 transition-colors text-sm"
          >
            {t('DELETE_CONFIRM', userPrefs.interfaceLanguage)}
          </button>
        </div>
      </Modal>

      {/* Limit Reached Modal */}
      <Modal show={showLimitReached} onClose={() => setShowLimitReached(false)} centerContent>
        <div className="w-14 h-14 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <span className="text-2xl">&#9888;</span>
        </div>
        {isAnonymous ? (() => {
          const inApp = detectInAppBrowser();
          return (
            <>
              <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-3">{t('ANON_LIMIT_TITLE', userPrefs.interfaceLanguage)}</h2>
              {inApp ? (
                <p className="text-[var(--text-secondary)] mb-6 text-sm leading-relaxed">
                  {t('INAPP_BROWSER_WARNING', userPrefs.interfaceLanguage).replace('{browser}', inApp)}
                </p>
              ) : (
                <>
                  <p className="text-[var(--text-secondary)] mb-6 text-sm leading-relaxed">{t('ANON_LIMIT_DESC', userPrefs.interfaceLanguage)}</p>
                  <div className="flex justify-center mb-3">
                    <GoogleLogin
                      onSuccess={handleAnonGoogleSignin}
                      onError={() => {}}
                    />
                  </div>
                </>
              )}
            </>
          );
        })() : (
          <>
            <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-3">{t('LIMIT_REACHED_TITLE', userPrefs.interfaceLanguage)}</h2>
            <p className="text-[var(--text-secondary)] mb-6 text-sm leading-relaxed">{t('LIMIT_REACHED_DESC', userPrefs.interfaceLanguage)}</p>
            <button
              onClick={() => { setShowLimitReached(false); setShowUpgrade(true); }}
              className="w-full px-4 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl transition-colors mb-3"
            >
              {t('LIMIT_REACHED_UPGRADE', userPrefs.interfaceLanguage)}
            </button>
          </>
        )}
        <button
          onClick={() => setShowLimitReached(false)}
          className="w-full px-4 py-2 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors text-sm"
        >
          {t('CLOSE', userPrefs.interfaceLanguage)}
        </button>
      </Modal>

      {/* Upgrade Modal */}
      <Modal show={showUpgrade} onClose={() => setShowUpgrade(false)} title={t('UPGRADE_TITLE', userPrefs.interfaceLanguage)}>
            <p className="text-[var(--text-secondary)] mb-6">{t('UPGRADE_SUBTITLE', userPrefs.interfaceLanguage)}</p>
            {stripePrices.length > 0 ? (
              <div className="space-y-3 mb-6">
                {stripePrices.map(price => (
                  <button
                    key={price.id}
                    onClick={() => {
                      fetch('/api/stripe/checkout', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'X-Session-Id': sessionId || '' },
                        body: JSON.stringify({ priceId: price.id }),
                      })
                        .then(r => r.json())
                        .then(data => {
                          if (data.url) window.location.href = data.url;
                          else if (data.error) showToast(data.error);
                        })
                        .catch(err => showToast(err.message));
                    }}
                    className="w-full px-4 py-3 border-2 border-emerald-600 rounded-xl hover:bg-emerald-50 transition-colors text-left"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-[var(--text-primary)]">{price.productName || t('PRO_PLAN', userPrefs.interfaceLanguage)}</span>
                      <span className="text-emerald-700 font-bold">
                        {(price.amount! / 100).toFixed(2)} {price.currency.toUpperCase()}
                        <span className="text-xs font-normal text-[var(--text-tertiary)]">
                          /{price.intervalCount > 1 ? `${price.intervalCount} ` : ''}{price.interval}
                        </span>
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-center py-4 text-[var(--text-muted)] mb-6">
                {pricesError ? 'Billing is not configured yet.' : 'Loading prices...'}
              </div>
            )}
            <button
              onClick={() => setShowUpgrade(false)}
              className="w-full px-4 py-2 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors text-sm"
            >
              {t('CLOSE', userPrefs.interfaceLanguage)}
            </button>
      </Modal>

      {/* Flashcards modal — Browse (legacy flip-through) + Practice (SRS-driven). */}
      {showFlashcards && (flashcards.length > 0 || flashcardMode === 'practice') && (() => {
        const isDeckSource = flashcardSource !== 'session';
        // Build the active practice card from the loaded deck cards. The deck has
        // already been loaded by handleFlashcardSourceChange, so cardsByDeck is hot.
        const deckCards = isDeckSource ? (cardsByDeck.get(flashcardSource) || []) : [];
        const practiceCurrentCardId = flashcardMode === 'practice' && practiceIndex < practiceCardIds.length
          ? practiceCardIds[practiceIndex] : null;
        // Unify deck cards (server SRS) and session cards (in-memory, ids are
        // indices into `flashcards`) into one view so the Practice UI never has
        // to branch on the source per element.
        let practiceView: { front: string; back: string; frontLang?: string; backLang?: string; explanation?: ExplanationResult } | null = null;
        if (practiceCurrentCardId != null) {
          if (isDeckSource) {
            const pc = deckCards.find(c => c.id === practiceCurrentCardId);
            const d = pc ? deriveCard(pc.explanation, pc.text_language, pc.source_text) : null;
            if (pc && d) practiceView = {
              front: d.front,
              back: d.back,
              frontLang: pc.text_language,
              backLang: pc.explanation_language || userPrefs.explanationLanguage,
              explanation: pc.explanation,
            };
          } else {
            const item = flashcards[Number(practiceCurrentCardId)];
            if (item) practiceView = {
              front: item.front,
              back: item.back,
              frontLang: item.frontLang || textLanguage,
              backLang: item.backLang || userPrefs.explanationLanguage,
              explanation: item.explanation,
            };
          }
        }
        // The sitting ends when the timer runs out (or there are no cards).
        const practiceNoCards = isDeckSource ? practiceDeckSize === 0 : flashcards.length === 0;
        const practiceFinished = flashcardMode === 'practice'
          && !practiceLoading
          && (practiceTimeUp || practiceNoCards);
        const totalGraded = practiceStats.remembered + practiceStats.forgot;
        // End-of-interval stats: how much of the deck was challenged, the recall
        // rate, and how many cards were nailed on their first show this sitting.
        const challengedCount = practiceFirstResultRef.current.size;
        const firstShowRemembered = Array.from(practiceFirstResultRef.current.values()).filter(Boolean).length;
        const deckTotal = practiceDeckSize || (isDeckSource ? deckCards.length : flashcards.length) || 0;
        const pct = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 100) : 0);
        const challengedPct = pct(challengedCount, deckTotal);
        const rememberedPct = pct(practiceStats.remembered, totalGraded);
        return (
        <div className="fixed inset-0 bg-[var(--bg-overlay)] flex items-center justify-center z-50 p-4">
          <div className="bg-[var(--bg-panel)] rounded-2xl shadow-lg max-w-md w-full p-6">
            {(decks.length > 0 || flashcards.length > 0 || flashcardMode === 'practice') && (
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                {decks.length > 0 && (
                  <>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">{t('SOURCE_LABEL', userPrefs.interfaceLanguage)}</span>
                    <select
                      value={flashcardSource}
                      onChange={e => handleFlashcardSourceChange(e.target.value)}
                      disabled={flashcardAutoplay || practiceGrading}
                      // iOS Safari zooms when a control's font-size is <16px. Use base size on
                      // small screens to suppress the zoom, shrink back to xs on desktop.
                      className="text-base sm:text-xs px-2 py-1 border border-[var(--border-main)] rounded bg-[var(--bg-panel)] text-[var(--text-secondary)] disabled:opacity-50"
                    >
                      <option value="session">{t('CURRENT_SESSION', userPrefs.interfaceLanguage)}</option>
                      {decks.map(d => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                    </select>
                  </>
                )}
                {/* Mode tabs — Browse / Practice, available for the current
                    session as well as saved decks. */}
                <div className="flex items-center rounded-md border border-[var(--border-main)] overflow-hidden">
                  {/* Tabs bumped to a ~36px tap target on touch (px-3 py-2) and
                      shrunken back on desktop where pointer precision is fine. */}
                  <button
                    onClick={() => setFlashcardMode('browse')}
                    disabled={flashcardAutoplay || practiceGrading}
                    className={`px-3 py-2 sm:px-2 sm:py-1 text-[11px] sm:text-[10px] font-bold uppercase tracking-wider transition-colors ${flashcardMode === 'browse' ? 'bg-[var(--text-primary)] text-[var(--bg-panel)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}`}
                  >
                    {t('BROWSE', userPrefs.interfaceLanguage)}
                  </button>
                  <button
                    onClick={() => { if (flashcardMode !== 'practice') enterPracticeMode(); }}
                    disabled={flashcardAutoplay || practiceGrading}
                    className={`px-3 py-2 sm:px-2 sm:py-1 text-[11px] sm:text-[10px] font-bold uppercase tracking-wider transition-colors ${flashcardMode === 'practice' ? 'bg-emerald-600 text-white' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}`}
                  >
                    {t('PRACTICE', userPrefs.interfaceLanguage)}
                  </button>
                </div>
              </div>
            )}

            {/* Header: progress + close. In Practice the clicked-cards counter and
                the practice-duration selector live here. */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                {flashcardMode === 'practice' ? (
                  <>
                    {/* Counter of cards clicked (graded) this sitting. */}
                    <span className="text-sm font-medium text-[var(--text-tertiary)] tabular-nums">
                      {totalGraded}
                    </span>
                    <select
                      value={String(practiceMinutes)}
                      onChange={e => {
                        const newMinutes = Number(e.target.value) as PracticeMinutes;
                        setPracticeMinutes(newMinutes);
                        // Changing the duration restarts the interval at the new
                        // length. The scheduler stream isn't reset, so no progress
                        // is lost; on the summary screen the next round picks it up.
                        if (!practiceFinished && practiceCardIds.length > 0) {
                          beginPractice(undefined, undefined, newMinutes);
                        }
                      }}
                      // Only lock the dropdown during the brief /grade network call
                      // so a concurrent restart can't race the in-flight request.
                      disabled={practiceGrading}
                      // 16px on mobile to suppress the iOS Safari zoom-on-focus reflow.
                      className="text-base sm:text-xs px-2 py-1 border border-[var(--border-main)] rounded bg-[var(--bg-panel)] text-[var(--text-secondary)] disabled:opacity-50"
                    >
                      {[1, 3, 5, 10, 30].map(n => (
                        <option key={n} value={n}>{`${n} ${t('MIN_SHORT', userPrefs.interfaceLanguage)}`}</option>
                      ))}
                    </select>
                  </>
                ) : (
                  <>
                    <span className="text-sm font-medium text-[var(--text-tertiary)]">{flashcardIndex + 1} / {flashcards.length}</span>
                    <button
                      onClick={downloadFlashcardAudio}
                      disabled={downloadingFlashcards}
                      className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-40"
                      title={t('DOWNLOAD_AUDIO', userPrefs.interfaceLanguage)}
                    >
                      {downloadingFlashcards ? <Loader2 className="w-4 h-4 animate-spin" /> : <span className="flex items-center whitespace-nowrap"><Download className="w-4 h-4" /><span className="text-[9px] ml-0.5">.WAV</span></span>}
                    </button>
                  </>
                )}
              </div>
              <button
                onClick={() => { stopFlashcardAutoplay(); setShowFlashcards(false); }}
                className="p-2 -m-2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Card area — three states for Practice (loading / finished / showing card), one for Browse. */}
            {flashcardMode === 'practice' ? (
              practiceLoading ? (
                <div className="min-h-[200px] flex items-center justify-center rounded-xl border border-[var(--border-main)] bg-[var(--bg-surface)]">
                  <Loader2 className="w-6 h-6 animate-spin text-[var(--text-muted)]" />
                </div>
              ) : practiceFinished ? (
                /* End-of-interval summary: deck coverage + recall + first-try. */
                <div className="min-h-[200px] flex flex-col items-center justify-center rounded-xl border border-[var(--border-main)] bg-[var(--bg-surface)] px-6 py-8 text-center">
                  <p className="text-2xl font-semibold text-[var(--text-primary)] mb-4">{t('PRACTICE_DONE', userPrefs.interfaceLanguage)}</p>
                  {totalGraded === 0 ? (
                    <p className="text-sm text-[var(--text-tertiary)]">{t('NO_CARDS_DUE', userPrefs.interfaceLanguage)}</p>
                  ) : (
                    <>
                      <div className="flex items-center gap-5 mb-3">
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">{t('SUMMARY_CHALLENGED', userPrefs.interfaceLanguage)}</div>
                          <div className="text-3xl font-bold text-blue-600 tabular-nums">{challengedPct}%</div>
                          <div className="text-[10px] text-[var(--text-muted)] tabular-nums">{challengedCount} / {deckTotal}</div>
                        </div>
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">{t('SUMMARY_REMEMBERED', userPrefs.interfaceLanguage)}</div>
                          <div className="text-3xl font-bold text-emerald-600 tabular-nums">{rememberedPct}%</div>
                          <div className="text-[10px] text-[var(--text-muted)] tabular-nums">{practiceStats.remembered} / {totalGraded}</div>
                        </div>
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">{t('SUMMARY_FIRST_TRY', userPrefs.interfaceLanguage)}</div>
                          <div className="text-3xl font-bold text-[var(--text-primary)] tabular-nums">{firstShowRemembered}</div>
                          <div className="text-[10px] text-[var(--text-muted)] tabular-nums">/ {challengedCount}</div>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              ) : practiceView ? (
                /* showBack = reversed XOR flipped — when reversed=true the visible
                   side starts as the back (native), so a flip reveals the front. */
                (() => {
                  const showBack = flashcardFlipped !== flashcardReversed;
                  // Blur the target-language side when the user has the hide
                  // toggle on. The target is always the front; reversed mode
                  // just changes which face it shows on.
                  const blurTarget = flashcardFrontHidden && !showBack;
                  return (
                    <div
                      // Tap toggles the visible side — Practice doesn't auto-advance
                      // on tap (only the grade buttons do), so flipping back is fine.
                      onClick={() => setFlashcardFlipped(f => !f)}
                      className="min-h-[200px] flex flex-col items-center justify-center cursor-pointer select-none rounded-xl border border-[var(--border-main)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] transition-colors px-6 py-8"
                    >
                      <p className={`text-2xl font-semibold text-[var(--text-primary)] text-center ${blurTarget ? 'blur-md' : ''}`}>
                        {showBack ? practiceView.back : practiceView.front}
                      </p>
                      <p className="text-xs text-[var(--text-muted)] mt-4">{flashcardFlipped ? '' : (isTouchDevice ? '(tap to flip)' : '(click to flip)')}</p>
                    </div>
                  );
                })()
              ) : (
                /* card_id from server doesn't match any loaded card — shouldn't happen, but guard. */
                <div className="min-h-[200px] flex items-center justify-center rounded-xl border border-[var(--border-main)] bg-[var(--bg-surface)] text-[var(--text-muted)] text-sm">
                  …
                </div>
              )
            ) : (
              <div
                onClick={() => { if (flashcardFlipped) nextFlashcard(); else setFlashcardFlipped(true); }}
                className="min-h-[200px] flex flex-col items-center justify-center cursor-pointer select-none rounded-xl border border-[var(--border-main)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] transition-colors px-6 py-8"
              >
                {(flashcardFlipped !== flashcardReversed)
                  ? <p className="text-2xl font-semibold text-[var(--text-primary)] text-center">{flashcards[flashcardIndex].back}</p>
                  : flashcardFrontHidden
                    ? <p className="text-2xl font-semibold text-[var(--text-primary)] text-center select-none blur-md">{flashcards[flashcardIndex].front}</p>
                    : <p className="text-2xl font-semibold text-[var(--text-primary)] text-center">{flashcards[flashcardIndex].front}</p>
                }
                <p className="text-xs text-[var(--text-muted)] mt-4">{flashcardFlipped ? '' : (isTouchDevice ? '(tap to flip)' : '(click to flip)')}</p>
              </div>
            )}

            {/* Speak row. In Practice the visible side is spoken with its own
                language (deck cards may belong to a different language than the
                current workspace), so we resolve the voice per side. */}
            {flashcardMode === 'practice' ? (
              practiceView && !practiceFinished && (
                <div className="flex justify-center items-center gap-2 mt-3">
                  {/* p-3 sm:p-2 → ~44px tap target on touch, compact on desktop. */}
                  <button
                    onClick={() => {
                      const showBack = flashcardFlipped !== flashcardReversed;
                      if (showBack) {
                        speakPhrase(practiceView.back, undefined, practiceView.backLang, true);
                      } else {
                        speakPhrase(practiceView.front, undefined, practiceView.frontLang, true);
                      }
                    }}
                    className="p-3 sm:p-2 rounded-lg text-[var(--text-faint)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
                    title={t('LISTEN', userPrefs.interfaceLanguage)}
                    aria-label={t('LISTEN', userPrefs.interfaceLanguage)}
                  >
                    <Volume2 className="w-5 h-5" />
                  </button>
                  <button
                    onClick={togglePracticeDirection}
                    disabled={practiceGrading || practiceLoading}
                    className={`p-3 sm:p-2 rounded-lg transition-colors ${flashcardReversed ? 'text-blue-600 bg-blue-50' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'} disabled:opacity-50 disabled:cursor-not-allowed`}
                    title={t('REVERSE_SIDES', userPrefs.interfaceLanguage)}
                    aria-label={t('REVERSE_SIDES', userPrefs.interfaceLanguage)}
                  >
                    <RotateCcw className="w-5 h-5" />
                  </button>
                  {/* Hide target text — listening practice. Toggling on also kicks
                      off an auto-speak each time a new card appears (see effect). */}
                  <button
                    onClick={() => setFlashcardFrontHidden(h => !h)}
                    className={`p-3 sm:p-2 rounded-lg transition-colors ${flashcardFrontHidden ? 'text-blue-600 bg-blue-50' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}`}
                    title={flashcardFrontHidden ? t('SHOW_TEXT', userPrefs.interfaceLanguage) : t('HIDE_TEXT', userPrefs.interfaceLanguage)}
                    aria-label={flashcardFrontHidden ? t('SHOW_TEXT', userPrefs.interfaceLanguage) : t('HIDE_TEXT', userPrefs.interfaceLanguage)}
                  >
                    {flashcardFrontHidden ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                  {/* Examples — only when the card payload actually carries any. */}
                  {practiceView.explanation && (
                    <button
                      onClick={() => setExamplesPopup({
                        explanation: practiceView.explanation!,
                        textLang: practiceView.frontLang || textLanguage,
                        explanationLang: practiceView.backLang || userPrefs.explanationLanguage,
                        title: practiceView.front,
                      })}
                      className="p-3 sm:p-2 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
                      title={t('EXAMPLES', userPrefs.interfaceLanguage)}
                      aria-label={t('EXAMPLES', userPrefs.interfaceLanguage)}
                    >
                      <Quote className="w-5 h-5" />
                    </button>
                  )}
                  {/* Quick add a new word into the deck without leaving Practice. */}
                  <button
                    onClick={openQuickAdd}
                    className="p-3 sm:p-2 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
                    title={t('ADD_TO_DECK', userPrefs.interfaceLanguage)}
                    aria-label={t('ADD_TO_DECK', userPrefs.interfaceLanguage)}
                  >
                    <BookPlus className="w-5 h-5" />
                  </button>
                </div>
              )
            ) : (
              <div className="flex justify-center gap-1 mt-2">
                <button
                  onClick={() => {
                    const card = flashcards[flashcardIndex];
                    // Honor the card's own front language if it carries one (saved
                    // decks tag each card with its source language; session cards leave
                    // it undefined and fall back to the workspace's textLanguage).
                    speakPhrase(card.front, undefined, card.frontLang, true);
                  }}
                  className="p-2 text-[var(--text-faint)] hover:text-[var(--text-secondary)] transition-colors"
                  title={t('LISTEN', userPrefs.interfaceLanguage)}
                >
                  <Volume2 className="w-5 h-5" />
                </button>
                <button
                  onClick={() => setFlashcardFrontHidden(h => !h)}
                  className="p-2 text-[var(--text-faint)] hover:text-[var(--text-secondary)] transition-colors"
                  title={flashcardFrontHidden ? t('SHOW_TEXT', userPrefs.interfaceLanguage) : t('HIDE_TEXT', userPrefs.interfaceLanguage)}
                >
                  {flashcardFrontHidden ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
                {/* Examples — deck-sourced cards carry the explanation on
                    FlashcardItem; session cards travel without their original
                    explanation payload so the button stays hidden there. */}
                {(() => {
                  const card = flashcards[flashcardIndex];
                  if (!card?.explanation) return null;
                  return (
                    <button
                      onClick={() => setExamplesPopup({
                        explanation: card.explanation!,
                        textLang: card.frontLang || textLanguage,
                        explanationLang: card.backLang || userPrefs.explanationLanguage,
                        title: card.front,
                      })}
                      // Bump to a 44px tap target on touch; compact on desktop pointer.
                      className="p-3 sm:p-2 text-[var(--text-faint)] hover:text-[var(--text-secondary)] transition-colors"
                      title={t('EXAMPLES', userPrefs.interfaceLanguage)}
                      aria-label={t('EXAMPLES', userPrefs.interfaceLanguage)}
                    >
                      <Quote className="w-5 h-5" />
                    </button>
                  );
                })()}
                {/* Quick add a new word into the deck without leaving Browse. */}
                <button
                  onClick={openQuickAdd}
                  className="p-3 sm:p-2 text-[var(--text-faint)] hover:text-[var(--text-secondary)] transition-colors"
                  title={t('ADD_TO_DECK', userPrefs.interfaceLanguage)}
                  aria-label={t('ADD_TO_DECK', userPrefs.interfaceLanguage)}
                >
                  <BookPlus className="w-5 h-5" />
                </button>
              </div>
            )}

            {/* Control row — Browse keeps the legacy bar; Practice shows grade buttons or summary actions. */}
            {flashcardMode === 'practice' ? (
              practiceFinished ? (
                <div className="flex justify-center gap-3 mt-6 flex-wrap">
                  {/* Continue runs another interval over the same full deck —
                      the scheduler stream carries on where it left off. */}
                  <button
                    // Wrap so React's synthetic event isn't passed as deckIdOverride —
                    // that would break beginPractice's deck-id check on the next call.
                    onClick={() => beginPractice()}
                    disabled={practiceLoading}
                    className="px-4 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-sm font-bold uppercase tracking-wider disabled:opacity-50 flex items-center gap-2"
                  >
                    {practiceLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                    {t('PRACTICE_MORE', userPrefs.interfaceLanguage)}
                  </button>
                  {/* Repeat replays the exact same in-memory set (session source
                      only — a streaming deck has no fixed batch). */}
                  {!isDeckSource && practiceBatchOriginalRef.current.length > 0 && (
                    <button
                      onClick={repeatPractice}
                      disabled={practiceLoading}
                      className="px-4 py-2 rounded-lg border border-[var(--border-main)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] text-sm font-bold uppercase tracking-wider disabled:opacity-50 flex items-center gap-2"
                    >
                      <RotateCcw className="w-4 h-4" />
                      {t('REPEAT', userPrefs.interfaceLanguage)}
                    </button>
                  )}
                  <button
                    onClick={() => setShowFlashcards(false)}
                    className="px-4 py-2 rounded-lg border border-[var(--border-main)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] text-sm font-bold uppercase tracking-wider"
                  >
                    {t('CLOSE', userPrefs.interfaceLanguage)}
                  </button>
                </div>
              ) : (
                <div className="flex justify-center gap-3 mt-6">
                  <button
                    onClick={() => handleGrade(false)}
                    disabled={practiceGrading || !practiceView}
                    className="flex-1 max-w-[160px] px-4 py-3 rounded-lg bg-red-500 hover:bg-red-600 text-white text-sm font-bold uppercase tracking-wider disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    {t('FORGOT', userPrefs.interfaceLanguage)}
                  </button>
                  <button
                    onClick={() => handleGrade(true)}
                    disabled={practiceGrading || !practiceView}
                    className="flex-1 max-w-[160px] px-4 py-3 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-bold uppercase tracking-wider disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    {t('REMEMBERED', userPrefs.interfaceLanguage)}
                  </button>
                </div>
              )
            ) : (
              <div className="flex justify-center gap-3 mt-4">
                <button onClick={flashcardAutoplay ? stopFlashcardAutoplay : startFlashcardAutoplay} className={`p-2 rounded-lg transition-colors ${flashcardAutoplay ? 'text-blue-600 bg-blue-50' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}`} title={t('AUTOPLAY', userPrefs.interfaceLanguage)}>
                  {flashcardPrefetching ? <Loader2 className="w-5 h-5 animate-spin" /> : flashcardAutoplay ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
                </button>
                <button
                  onClick={cycleDelay}
                  className="px-2 py-1 rounded-lg text-xs font-mono font-medium transition-colors text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                  title={t('PAUSE_BETWEEN_SIDES', userPrefs.interfaceLanguage)}
                >
                  <span className="text-[var(--text-faint)]">Wait:</span> {flashcardDelay}s
                </button>
                <button onClick={deleteFlashcard} disabled={flashcardAutoplay} className={`p-2 rounded-lg transition-colors ${flashcardAutoplay ? 'text-[var(--text-faint)] cursor-not-allowed' : 'text-[var(--text-muted)] hover:text-red-500 hover:bg-red-50'}`} title={t('DELETE_CARD', userPrefs.interfaceLanguage)}>
                  <Trash2 className="w-5 h-5" />
                </button>
                <button onClick={shuffleFlashcards} disabled={flashcardAutoplay} className={`p-2 rounded-lg transition-colors ${flashcardAutoplay ? 'text-[var(--text-faint)] cursor-not-allowed' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}`} title={t('SHUFFLE_CARDS', userPrefs.interfaceLanguage)}>
                  <Shuffle className="w-5 h-5" />
                </button>
                <button onClick={() => { setFlashcardReversed(r => !r); setFlashcardFlipped(false); }} disabled={flashcardAutoplay} className={`p-2 rounded-lg transition-colors ${flashcardAutoplay ? 'text-[var(--text-faint)] cursor-not-allowed' : flashcardReversed ? 'text-blue-600 bg-blue-50' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}`} title={t('REVERSE_SIDES', userPrefs.interfaceLanguage)}>
                  <RotateCcw className="w-5 h-5" />
                </button>
                <button onClick={prevFlashcard} disabled={flashcardAutoplay} className={`p-2 rounded-lg transition-colors ${flashcardAutoplay ? 'text-[var(--text-faint)] cursor-not-allowed' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}`} title={t('PREV_CARD', userPrefs.interfaceLanguage)}>
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <button onClick={nextFlashcard} disabled={flashcardAutoplay} className={`p-2 rounded-lg transition-colors ${flashcardAutoplay ? 'text-[var(--text-faint)] cursor-not-allowed' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}`} title={t('NEXT_CARD', userPrefs.interfaceLanguage)}>
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            )}
          </div>
        </div>
        );
      })()}

      <DecksModal
        show={showDecksModal}
        onClose={() => setShowDecksModal(false)}
        interfaceLanguage={userPrefs.interfaceLanguage}
        textLanguage={textLanguage}
        decks={decks}
        cardsByDeck={cardsByDeck}
        loadCards={loadCards}
        srsByDeck={srsByDeck}
        loadSrsForDeck={loadSrsForDeck}
        renameDeck={renameDeck}
        deleteDeck={deleteDeck}
        createDeck={createDeck}
        removeCardLocal={removeCardLocal}
        commitCardDelete={commitCardDelete}
        restoreCard={restoreCard}
        showToast={showToast}
        onPractice={async (deckId) => {
          // Open the Flashcards modal preset to Practice mode for this deck.
          setShowDecksModal(false);
          await handleFlashcardSourceChange(deckId);
          setShowFlashcards(true);
          // Pass deckId explicitly: flashcardSource state hasn't propagated yet.
          await enterPracticeMode(deckId);
        }}
      />

      {/* Examples popover — shared by Browse and Practice. Renders the card's
          example sentences with per-line speak buttons, each using its own
          language so the back's voice matches the back's text. */}
      <Modal
        show={!!examplesPopup}
        onClose={() => setExamplesPopup(null)}
        // Title is just "Examples" — the front of the card goes in the body so it
        // can wrap/truncate on narrow phones without pushing the close button off.
        title={t('EXAMPLES', userPrefs.interfaceLanguage)}
        maxWidth="max-w-md"
      >
        {examplesPopup && (() => {
          const expl = examplesPopup.explanation;
          const meanings = Array.isArray(expl.meanings) ? expl.meanings.filter(m => m && m.trim()) : [];
          const morph = expl.morphology;
          const nounForms = expl.forms?.noun;
          const verbForms = expl.forms?.verb;
          const adjForms = expl.forms?.adjective;
          const examples = Array.isArray(expl.examples) ? expl.examples : [];
          const grammar = getGrammar(examplesPopup.textLang);
          const hasNounTable = !!nounForms?.singular?.nom;
          const hasVerbForms = !!verbForms?.infinitive;
          const hasAdjForms = !!(adjForms?.positiv || adjForms?.komparativ || adjForms?.superlativ);
          const sectionHeader = (label: string) => (
            <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">{label}</div>
          );
          /** Clickable collapsible header for the Meanings / Forms sections. */
          const collapsibleHeader = (label: string, expanded: boolean, onToggle: () => void, count?: number) => (
            <button
              onClick={onToggle}
              className="w-full flex items-center justify-between gap-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
              aria-expanded={expanded}
            >
              <span className="flex items-center gap-1.5">
                {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                {label}
                {count !== undefined && count > 0 && (
                  <span className="text-[var(--text-faint)] normal-case tracking-normal">({count})</span>
                )}
              </span>
            </button>
          );
          return (
          <div className="space-y-3">
            <div>
              {/* Blur the headline so the user gets to guess the word from the
                  examples below first; tap the word or the eye icon to reveal.
                  Part-of-speech tag stays visible as a mild hint. */}
              <div className="flex items-start gap-2">
                <div
                  onClick={() => setTitleRevealed(v => !v)}
                  className={`flex-1 min-w-0 text-sm font-semibold text-[var(--text-primary)] truncate cursor-pointer ${titleRevealed ? '' : 'blur-md select-none hover:blur-[5px] transition-[filter]'}`}
                  title={titleRevealed ? t('HIDE_TEXT', userPrefs.interfaceLanguage) : t('SHOW_TEXT', userPrefs.interfaceLanguage)}
                >
                  {examplesPopup.title}
                </div>
                <button
                  onClick={() => setTitleRevealed(v => !v)}
                  className="p-2 sm:p-1.5 -m-1 rounded text-[var(--text-faint)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors shrink-0"
                  title={titleRevealed ? t('HIDE_TEXT', userPrefs.interfaceLanguage) : t('SHOW_TEXT', userPrefs.interfaceLanguage)}
                  aria-label={titleRevealed ? t('HIDE_TEXT', userPrefs.interfaceLanguage) : t('SHOW_TEXT', userPrefs.interfaceLanguage)}
                >
                  {titleRevealed ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {expl.part_of_speech && (
                <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mt-0.5">{expl.part_of_speech}</div>
              )}
            </div>

            {meanings.length > 0 && (
              <div className="border-t border-[var(--border-light)] pt-2">
                {collapsibleHeader(t('MEANINGS', userPrefs.interfaceLanguage), meaningsExpanded, () => setMeaningsExpanded(v => !v), meanings.length)}
                {meaningsExpanded && (
                  <ul className="space-y-1 mt-1">
                    {meanings.map((m, i) => (
                      <li key={i} className="text-sm text-[var(--text-primary)] flex items-start gap-2">
                        <span className="text-[var(--text-faint)] shrink-0">·</span>
                        <span className="min-w-0 break-words">{m}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {(hasNounTable || hasVerbForms || hasAdjForms) && (
              <div className="border-t border-[var(--border-light)] pt-2">
                {collapsibleHeader(t('FORMS', userPrefs.interfaceLanguage), formsExpanded, () => setFormsExpanded(v => !v))}
                {formsExpanded && (
                <div className="rounded-lg border border-[var(--border-main)] bg-[var(--bg-surface)] px-3 py-2 text-xs mt-1">
                  {hasNounTable ? (
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-[var(--border-light)]">
                          <th className="py-1 text-[9px] font-bold uppercase tracking-wider text-[var(--text-muted)]">{t('DECLENSION', userPrefs.interfaceLanguage) || 'Case'}</th>
                          <th className="py-1 text-[9px] font-bold uppercase tracking-wider text-[var(--text-muted)]">{t('SINGULAR', userPrefs.interfaceLanguage)}</th>
                          <th className="py-1 text-[9px] font-bold uppercase tracking-wider text-[var(--text-muted)]">{t('PLURAL', userPrefs.interfaceLanguage)}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(['nom', 'akk', 'dat', 'gen'] as const).map(c => (
                          <tr key={c} className="border-b border-[var(--border-light)] last:border-0">
                            <td className="py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">{grammar.cases?.[c] || c}</td>
                            <td className="py-1 text-[var(--text-primary)]">{(nounForms?.singular as any)?.[c] || '—'}</td>
                            <td className="py-1 text-[var(--text-primary)]">{(nounForms?.plural as any)?.[c] || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : hasVerbForms ? (
                    <div className="space-y-1.5">
                      {([
                        [grammar.infinitive, verbForms?.infinitive],
                        [grammar.present, verbForms?.praesens_ich],
                        [grammar.past, verbForms?.praeteritum],
                        [grammar.perfect, verbForms?.perfekt],
                      ] as Array<[string, string | undefined]>).filter(([, v]) => v).map(([label, value], i) => (
                        <div key={i} className="flex items-baseline justify-between gap-3 border-b border-[var(--border-light)] last:border-0 pb-1 last:pb-0">
                          <span className="text-[var(--text-muted)] text-[10px] uppercase tracking-wider shrink-0">{label}</span>
                          <span className="text-[var(--text-primary)] text-right break-words">{value}</span>
                        </div>
                      ))}
                    </div>
                  ) : hasAdjForms ? (
                    <div className="space-y-1.5">
                      {([
                        ['Positive', adjForms?.positiv],
                        ['Comparative', adjForms?.komparativ],
                        ['Superlative', adjForms?.superlativ],
                      ] as Array<[string, string | undefined]>).filter(([, v]) => v).map(([label, value], i) => (
                        <div key={i} className="flex items-baseline justify-between gap-3 border-b border-[var(--border-light)] last:border-0 pb-1 last:pb-0">
                          <span className="text-[var(--text-muted)] text-[10px] uppercase tracking-wider shrink-0">{label}</span>
                          <span className="text-[var(--text-primary)] text-right break-words">{value}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
                )}
              </div>
            )}

            {examples.length > 0 && (
              <div className="border-t border-[var(--border-light)] pt-2">
                {sectionHeader(t('EXAMPLES', userPrefs.interfaceLanguage))}
              </div>
            )}
            {examples.map((ex, i) => {
              // In reversed mode the user is being tested on the target text,
              // so the target gets blurred and the translation is the prompt.
              // Otherwise the target is the prompt and the translation hides.
              const revealed = revealedExamples.has(i);
              const blurTarget = flashcardReversed && !revealed;
              const blurTranslation = !flashcardReversed && !revealed && !!ex.translation;
              const blurClass = (active: boolean) => active
                ? 'blur-[6px] select-none cursor-pointer hover:blur-[5px] transition-[filter]'
                : '';
              return (
                <div key={i} className="rounded-lg border border-[var(--border-main)] bg-[var(--bg-surface)] px-3 py-2">
                  <div className="flex items-start gap-2">
                    <p
                      onClick={blurTarget ? () => toggleRevealedExample(i) : undefined}
                      className={`flex-1 min-w-0 text-sm font-medium text-[var(--text-primary)] break-words ${blurClass(blurTarget)}`}
                    >
                      {ex.text}
                    </p>
                    <button
                      onClick={() => speakPhrase(ex.text, undefined, examplesPopup.textLang, true)}
                      className="p-2 sm:p-1.5 -m-1 rounded text-[var(--text-faint)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors shrink-0"
                      title={t('LISTEN', userPrefs.interfaceLanguage)}
                      aria-label={t('LISTEN', userPrefs.interfaceLanguage)}
                    >
                      <Volume2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handlePopupMoreLikeThis(i, { text: ex.text, translation: ex.translation || '' })}
                      className="p-2 sm:p-1.5 -m-1 rounded text-[var(--text-faint)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors shrink-0"
                      title={t('MORE_LIKE_THIS', userPrefs.interfaceLanguage)}
                      aria-label={t('MORE_LIKE_THIS', userPrefs.interfaceLanguage)}
                    >
                      <Wand2 className="w-4 h-4" />
                    </button>
                    {/* Reveal/hide for the guessed side. Only matters when the card
                        has a translation — without one, nothing is being hidden. */}
                    {ex.translation && (
                      <button
                        onClick={() => toggleRevealedExample(i)}
                        className="p-2 sm:p-1.5 -m-1 rounded text-[var(--text-faint)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors shrink-0"
                        title={revealed ? t('HIDE_TEXT', userPrefs.interfaceLanguage) : t('SHOW_TEXT', userPrefs.interfaceLanguage)}
                        aria-label={revealed ? t('HIDE_TEXT', userPrefs.interfaceLanguage) : t('SHOW_TEXT', userPrefs.interfaceLanguage)}
                      >
                        {revealed ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    )}
                  </div>
                  {ex.translation && (
                    <p
                      onClick={blurTranslation ? () => toggleRevealedExample(i) : undefined}
                      className={`text-xs text-[var(--text-tertiary)] italic break-words mt-1 ${blurClass(blurTranslation)}`}
                    >
                      — {ex.translation}
                    </p>
                  )}
                  {(popupExampleVariants.get(i) || []).map((v, vi) => (
                    <div key={vi} className="mt-2 ml-2 pl-3 border-l-2 border-[var(--border-main)]">
                      {v.loading ? (
                        <div className="flex items-center gap-2 py-1 text-xs text-[var(--text-tertiary)]">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        </div>
                      ) : v.error ? (
                        <p className="text-xs text-red-500 py-1">{v.error}</p>
                      ) : (
                        <>
                          <div className="flex items-start gap-2">
                            <p className="flex-1 min-w-0 text-sm text-[var(--text-primary)] break-words">{v.text}</p>
                            <button
                              onClick={() => speakPhrase(v.text, undefined, examplesPopup.textLang, true)}
                              className="p-2 sm:p-1.5 -m-1 rounded text-[var(--text-faint)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors shrink-0"
                              title={t('LISTEN', userPrefs.interfaceLanguage)}
                              aria-label={t('LISTEN', userPrefs.interfaceLanguage)}
                            >
                              <Volume2 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handlePopupMoreLikeThis(i, { text: v.text, translation: v.translation })}
                              className="p-2 sm:p-1.5 -m-1 rounded text-[var(--text-faint)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors shrink-0"
                              title={t('MORE_LIKE_THIS', userPrefs.interfaceLanguage)}
                              aria-label={t('MORE_LIKE_THIS', userPrefs.interfaceLanguage)}
                            >
                              <Wand2 className="w-4 h-4" />
                            </button>
                          </div>
                          {v.translation && (
                            <p className="text-xs text-[var(--text-tertiary)] italic break-words mt-1">— {v.translation}</p>
                          )}
                        </>
                      )}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
          );
        })()}
      </Modal>

      {/* Quick-add a new word into the active deck without leaving Browse/Practice.
          Calls the same /api/explain endpoint the explanation panel uses but
          keeps the result LOCAL — workspace explainHistory / explanationCache /
          result panel stay untouched. */}
      <Modal
        show={quickAddOpen}
        onClose={() => { if (!quickAddCommitting) setQuickAddOpen(false); }}
        title={t('ADD_TO_DECK', userPrefs.interfaceLanguage)}
        maxWidth="max-w-md"
      >
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <input
              autoFocus
              value={quickAddText}
              onChange={e => { setQuickAddText(e.target.value); if (quickAddError) setQuickAddError(null); }}
              onKeyDown={e => {
                if (e.key === 'Enter' && !quickAddLoading && quickAddText.trim()) runQuickAddExplain();
                else if (e.key === 'Escape') setQuickAddOpen(false);
              }}
              placeholder={t('EXPLAIN_WORD', userPrefs.interfaceLanguage)}
              // 16px on mobile to dodge iOS Safari's focus-zoom.
              className="flex-1 min-w-0 text-base sm:text-sm px-3 py-2 border border-[var(--border-main)] rounded bg-[var(--bg-panel)] text-[var(--text-primary)]"
            />
            <button
              onClick={runQuickAddExplain}
              disabled={quickAddLoading || !quickAddText.trim()}
              className="px-3 py-2 rounded-md bg-[var(--text-primary)] text-[var(--bg-panel)] text-xs font-bold uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
            >
              {quickAddLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {t('EXPLAIN', userPrefs.interfaceLanguage)}
            </button>
          </div>
          {quickAddError && <div className="text-xs text-red-500">{quickAddError}</div>}
          {quickAddResult && (() => {
            const preview = deriveCard(quickAddResult, textLanguage, quickAddText.trim());
            return (
              <div className="rounded-lg border border-[var(--border-main)] bg-[var(--bg-surface)] px-3 py-2">
                <div className="text-sm font-semibold text-[var(--text-primary)] break-words">{preview?.front || quickAddResult.selection}</div>
                {preview?.back && <div className="text-xs text-[var(--text-tertiary)] mt-1 break-words">{preview.back}</div>}
              </div>
            );
          })()}
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={() => setQuickAddOpen(false)}
              disabled={quickAddCommitting}
              className="px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50"
            >
              {t('CANCEL', userPrefs.interfaceLanguage)}
            </button>
            <button
              onClick={commitQuickAdd}
              disabled={!quickAddResult || quickAddCommitting}
              className="px-3 py-1.5 text-xs font-bold uppercase tracking-wider bg-emerald-500 hover:bg-emerald-600 text-white rounded-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
            >
              {quickAddCommitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              {t('ADD_TO_DECK', userPrefs.interfaceLanguage)}
            </button>
          </div>
        </div>
      </Modal>


      <Modal
        show={showImageOcr}
        onClose={() => { if (!ocrLoading) { setShowImageOcr(false); setOcrPreviewUrl(null); setOcrError(null); setOcrCrop(null); setOcrNaturalSize(null); } }}
        title={t('OCR_TITLE', userPrefs.interfaceLanguage)}
      >
        <div className="flex flex-col gap-4">
          {/* Camera input: capture="environment" forces the rear camera on mobile.
              Library input: no capture attribute → user picks from photo library / files. */}
          <input
            ref={ocrCameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={e => handleOcrFilePick(e.target.files?.[0] || null)}
          />
          <input
            ref={ocrLibraryInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={e => handleOcrFilePick(e.target.files?.[0] || null)}
          />
          {!ocrPreviewUrl ? (
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => ocrCameraInputRef.current?.click()}
                className="flex flex-col items-center justify-center gap-2 py-6 rounded-xl border-2 border-dashed border-[var(--border-main)] hover:border-[var(--border-accent)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] transition-all"
              >
                <Camera className="w-6 h-6 text-[var(--text-muted)]" />
                <span className="text-sm font-medium text-[var(--text-primary)]">{t('OCR_TAKE_PHOTO', userPrefs.interfaceLanguage)}</span>
              </button>
              <button
                onClick={() => ocrLibraryInputRef.current?.click()}
                className="flex flex-col items-center justify-center gap-2 py-6 rounded-xl border-2 border-dashed border-[var(--border-main)] hover:border-[var(--border-accent)] bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] transition-all"
              >
                <ImageIcon className="w-6 h-6 text-[var(--text-muted)]" />
                <span className="text-sm font-medium text-[var(--text-primary)]">{t('OCR_CHOOSE_IMAGE', userPrefs.interfaceLanguage)}</span>
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2 items-center">
              <ReactCrop
                crop={ocrCrop ?? undefined}
                onChange={(_, percentCrop) => setOcrCrop(percentCrop)}
                disabled={ocrLoading}
                style={{ maxHeight: '45vh', maxWidth: '100%' }}
              >
                <img
                  src={ocrPreviewUrl}
                  alt=""
                  onLoad={handleOcrImageLoad}
                  style={{ maxHeight: '45vh', maxWidth: '100%', objectFit: 'contain' }}
                  className="rounded-xl"
                />
              </ReactCrop>
              <p className="text-xs text-[var(--text-muted)] text-center">{t('OCR_CROP_HINT', userPrefs.interfaceLanguage)}</p>
              <div className="flex gap-3 items-center text-xs">
                <button
                  onClick={() => ocrCameraInputRef.current?.click()}
                  disabled={ocrLoading}
                  className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-50"
                >
                  {t('OCR_TAKE_PHOTO', userPrefs.interfaceLanguage)}
                </button>
                <span className="text-[var(--text-faint)]">·</span>
                <button
                  onClick={() => ocrLibraryInputRef.current?.click()}
                  disabled={ocrLoading}
                  className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-50"
                >
                  {t('OCR_CHOOSE_IMAGE', userPrefs.interfaceLanguage)}
                </button>
              </div>
            </div>
          )}
          {ocrError && <p className="text-xs text-red-500">{ocrError}</p>}
          <button
            onClick={handleOcrExtract}
            disabled={!ocrPreviewUrl || ocrLoading}
            className="w-full bg-[var(--bg-accent)] text-[var(--text-on-accent)] py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-2 hover:bg-[var(--bg-accent-hover)] transition-colors disabled:opacity-50"
          >
            {ocrLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
            {ocrLoading ? t('OCR_EXTRACTING', userPrefs.interfaceLanguage) : t('OCR_SUBMIT', userPrefs.interfaceLanguage)}
          </button>
        </div>
      </Modal>

      {showGenerateText && (
        <div className="fixed inset-0 bg-[var(--bg-overlay)] flex items-center justify-center z-50 p-4">
          <div className="bg-[var(--bg-panel)] rounded-2xl shadow-lg max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-semibold text-[var(--text-primary)]">{t('GENERATE_TITLE', userPrefs.interfaceLanguage)}</h2>
              <button onClick={() => setShowGenerateText(false)} className="p-2 -m-2 text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex flex-col gap-4">
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">{t('LANGUAGE_LEVEL', userPrefs.interfaceLanguage)}</label>
                <select
                  value={generateLevel}
                  onChange={e => setGenerateLevel(e.target.value)}
                  className="w-full text-sm px-3 py-2 border border-[var(--border-main)] rounded-lg bg-[var(--bg-panel)] text-[var(--text-primary)]"
                >
                  {['A1','A2','B1','B2','C1','C2'].map(l => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">{t('NUM_SENTENCES', userPrefs.interfaceLanguage)}</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={generateSentences}
                  onChange={e => setGenerateSentences(e.target.value.replace(/[^0-9]/g, ''))}
                  onBlur={() => {
                    const anonMax = anonLimitsOn ? parseInt(appSettings.anon_max_generate_sentences || '5', 10) : 30;
                    const freeMax = freeLimitsOn ? freeMaxGenerateSentences : 30;
                    const maxS = isPaidUser ? 30 : isAnonymous ? anonMax : freeMax;
                    const n = parseInt(generateSentences) || 10;
                    setGenerateSentences(String(Math.min(maxS, Math.max(5, n))));
                  }}
                  className="w-full text-sm px-3 py-2 border border-[var(--border-main)] rounded-lg bg-[var(--bg-panel)] text-[var(--text-primary)]"
                />
                {!isPaidUser && ((isAnonymous ? anonLimitsOn : freeLimitsOn) && freeMaxGenerateSentences < 30) && (
                  <p className="text-[11px] text-red-500 mt-1">{(t('FREE_GENERATE_LIMIT', userPrefs.interfaceLanguage) || '').replace('{max}', String(freeMaxGenerateSentences))}</p>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">{t('TOPIC', userPrefs.interfaceLanguage)}</label>
                <input
                  type="text"
                  maxLength={200}
                  value={generateTopic}
                  onChange={e => setGenerateTopic(e.target.value)}
                  placeholder={t('TOPIC_PLACEHOLDER', userPrefs.interfaceLanguage)}
                  className="w-full text-sm px-3 py-2 border border-[var(--border-main)] rounded-lg bg-[var(--bg-panel)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">{t('ADDITIONAL_INSTRUCTIONS', userPrefs.interfaceLanguage)}</label>
                <textarea
                  rows={2}
                  value={generateInstructions}
                  onChange={e => setGenerateInstructions(e.target.value)}
                  placeholder={t('INSTRUCTIONS_PLACEHOLDER', userPrefs.interfaceLanguage)}
                  className="w-full text-sm px-3 py-2 border border-[var(--border-main)] rounded-lg bg-[var(--bg-panel)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] resize-none"
                />
              </div>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={generateDialog}
                  onChange={e => setGenerateDialog(e.target.checked)}
                  className="w-4 h-4 accent-[var(--bg-accent)] cursor-pointer"
                />
                <span className="text-sm text-[var(--text-secondary)]">{t('GENERATE_DIALOG', userPrefs.interfaceLanguage)}</span>
              </label>
              <button
                onClick={handleGenerateText}
                disabled={generateLoading}
                className="w-full bg-[var(--bg-accent)] text-[var(--text-on-accent)] py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-2 hover:bg-[var(--bg-accent-hover)] transition-colors disabled:opacity-50"
              >
                {generateLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                {t('GENERATE', userPrefs.interfaceLanguage)}
              </button>
            </div>
          </div>
        </div>
      )}

      <Modal show={showFeedback} onClose={() => setShowFeedback(false)} title={t('FEEDBACK', userPrefs.interfaceLanguage)}>
            {feedbackSent ? (
              <div className="text-center py-6">
                <div className="text-2xl mb-2">&#10003;</div>
                <p className="text-[var(--text-secondary)]">{t('FEEDBACK_THANKS', userPrefs.interfaceLanguage)}</p>
                <button
                  onClick={() => setShowFeedback(false)}
                  className="mt-4 px-4 py-2 bg-[var(--bg-accent)] text-[var(--text-on-accent)] rounded-lg font-medium hover:bg-[var(--bg-accent-hover)] transition-colors"
                >
                  {t('CLOSE', userPrefs.interfaceLanguage)}
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                    {t('FEEDBACK_TYPE', userPrefs.interfaceLanguage)}
                  </label>
                  <div className="flex gap-2">
                    {(['bug', 'feature', 'other'] as const).map(type => (
                      <button
                        key={type}
                        onClick={() => setFeedbackType(type)}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                          feedbackType === type
                            ? type === 'bug' ? 'bg-red-100 text-red-700 ring-1 ring-red-300'
                            : type === 'feature' ? 'bg-blue-100 text-blue-700 ring-1 ring-blue-300'
                            : 'bg-[var(--bg-muted)] text-[var(--text-secondary)] ring-1 ring-[var(--ring-color)]'
                            : 'bg-[var(--bg-hover)] text-[var(--text-tertiary)] hover:bg-[var(--bg-muted)]'
                        }`}
                      >
                        {type === 'bug' ? t('BUG', userPrefs.interfaceLanguage)
                          : type === 'feature' ? t('FEATURE', userPrefs.interfaceLanguage)
                          : t('OTHER_TYPE', userPrefs.interfaceLanguage)}
                      </button>
                    ))}
                  </div>
                </div>
                <textarea
                  value={feedbackText}
                  onChange={e => setFeedbackText(e.target.value)}
                  placeholder={t('FEEDBACK_PLACEHOLDER', userPrefs.interfaceLanguage)}
                  className="w-full h-32 px-3 py-2 border border-[var(--border-main)] rounded-lg text-[var(--text-secondary)] resize-none focus:outline-none focus:border-[var(--border-main)]"
                />
                <button
                  onClick={async () => {
                    if (!feedbackText.trim() || !sessionId) return;
                    try {
                      await fetch('/api/log', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'X-Session-Id': sessionId },
                        body: JSON.stringify({ action: 'feedback', detail: `[${feedbackType}] ${feedbackText.trim()}`, device: window.matchMedia('(pointer: coarse)').matches ? 'mobile' : 'desktop' }),
                      });
                    } catch (err) {
                      console.error('Failed to send feedback:', err);
                    }
                    setFeedbackSent(true);
                  }}
                  disabled={!feedbackText.trim()}
                  className="w-full px-4 py-2 bg-[var(--bg-accent)] text-[var(--text-on-accent)] rounded-lg font-medium hover:bg-[var(--bg-accent-hover)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {t('FEEDBACK_SEND', userPrefs.interfaceLanguage)}
                </button>
              </div>
            )}
      </Modal>

      {/* Share Link Modal */}
      <Modal show={!!shareUrl} onClose={() => setShareUrl(null)} title={t('SHARE_LESSON', userPrefs.interfaceLanguage)}>
        <div className="flex items-center gap-2">
          <input
            type="text"
            readOnly
            value={shareUrl || ''}
            onFocus={e => e.target.select()}
            className="flex-1 px-3 py-2 border border-[var(--border-main)] rounded-lg bg-[var(--bg-surface)] text-[var(--text-primary)] text-sm font-mono select-all focus:outline-none focus:border-[var(--border-accent)]"
          />
          <button
            onClick={copyShareUrl}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
              shareCopied
                ? 'bg-green-600 text-white'
                : 'bg-[var(--bg-accent)] text-[var(--text-on-accent)] hover:bg-[var(--bg-accent-hover)]'
            }`}
          >
            {shareCopied ? '✓' : t('SHARE_COPY', userPrefs.interfaceLanguage)}
          </button>
        </div>
      </Modal>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 40 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-red-600 text-white px-4 py-2.5 rounded-xl shadow-lg text-sm font-medium flex items-center gap-3 max-w-[90vw]"
          >
            <span>{toast.msg}</span>
            {toast.actionLabel && (
              <button
                onClick={() => { toast.onAction?.(); setToast(null); }}
                className="px-2 py-0.5 rounded bg-white/15 hover:bg-white/25 text-white text-xs font-bold uppercase tracking-wider"
              >
                {toast.actionLabel}
              </button>
            )}
            <button onClick={() => setToast(null)} className="text-white/70 hover:text-white text-lg leading-none">&times;</button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tutorial Overlay */}
      <AnimatePresence>
        {tutorialStep !== null && TUTORIAL_STEPS[tutorialStep] && (
          <TutorialOverlay
            step={tutorialStep}
            totalSteps={TUTORIAL_STEPS.length}
            stepDef={TUTORIAL_STEPS[tutorialStep]}
            lang={userPrefs.interfaceLanguage}
            onNext={() => {
              // Skip steps whose target element is not in the DOM (unless forceShow — element appears when step activates)
              let next = tutorialStep + 1;
              while (next < TUTORIAL_STEPS.length && !TUTORIAL_STEPS[next].forceShow && !document.querySelector(`[data-tutorial="${TUTORIAL_STEPS[next].target}"]`)) {
                next++;
              }
              if (next < TUTORIAL_STEPS.length) {
                setTutorialStep(next);
              } else {
                completeTutorial();
              }
            }}
            onSkip={completeTutorial}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
