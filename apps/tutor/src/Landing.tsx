import { useEffect, useRef, useState, useMemo, type ReactNode } from 'react';
import {
  Languages, BookOpen, Volume2, Mic, Brain, Layers,
  Eye, Ear, MessageSquare, ArrowRight,
  Sparkles, Globe,
} from 'lucide-react';
import { GoogleLogin } from '@react-oauth/google';
import { motion, useInView, AnimatePresence } from 'motion/react';
import { LANGUAGES, t } from './i18n';

/* ------------------------------------------------------------------ */
/*  Promo source capture                                               */
/* ------------------------------------------------------------------ */
function capturePromoSource() {
  const s = new URLSearchParams(window.location.search).get('s');
  if (s) localStorage.setItem('promo_source', s.slice(0, 8));
}

/* ------------------------------------------------------------------ */
/*  Detect landing page language from browser / localStorage           */
/* ------------------------------------------------------------------ */
function detectLang(): string {
  try {
    const stored = localStorage.getItem('userPrefs');
    if (stored) {
      const prefs = JSON.parse(stored);
      if (prefs.interfaceLanguage && LANGUAGES[prefs.interfaceLanguage]) return prefs.interfaceLanguage;
    }
  } catch { /* ignore */ }
  const nav = navigator.language?.slice(0, 2);
  if (nav && LANGUAGES[nav]) return nav;
  return 'en';
}

/* ------------------------------------------------------------------ */
/*  Detect in-app browsers (LinkedIn, Facebook, etc.)                  */
/* ------------------------------------------------------------------ */
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

/* ------------------------------------------------------------------ */
/*  Reusable animated section wrapper                                  */
/* ------------------------------------------------------------------ */
function Section({ children, className = '' }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-80px' });
  return (
    <motion.section
      ref={ref}
      initial={{ opacity: 0, y: 32 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.6, ease: 'easeOut' }}
      className={className}
    >
      {children}
    </motion.section>
  );
}

/* ------------------------------------------------------------------ */
/*  Step card for "How it works"                                       */
/* ------------------------------------------------------------------ */
function Step({ num, title, icon, children }: { num: number; title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <div className="relative ps-10 sm:ps-12 pb-10 sm:pb-12 border-s border-zinc-800 last:pb-0 group">
      {/* number badge */}
      <div className="absolute -start-5 top-0 w-10 h-10 rounded-full bg-zinc-900 border border-zinc-700 flex items-center justify-center text-sm font-bold text-zinc-300 group-hover:border-blue-500/60 transition-colors">
        {num}
      </div>
      <div className="flex items-center gap-3 mb-3">
        <span className="text-blue-400">{icon}</span>
        <h3 className="text-lg sm:text-xl font-semibold text-zinc-100">{title}</h3>
      </div>
      <div className="text-zinc-400 leading-relaxed space-y-3 text-[15px]">
        {children}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Use-case pill                                                      */
/* ------------------------------------------------------------------ */
function UseCase({ icon, title, desc }: { icon: ReactNode; title: string; desc: string }) {
  return (
    <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-5 hover:border-zinc-700 transition-colors">
      <div className="flex items-center gap-3 mb-2">
        <span className="text-blue-400">{icon}</span>
        <h4 className="font-medium text-zinc-200">{title}</h4>
      </div>
      <p className="text-sm text-zinc-500 leading-relaxed">{desc}</p>
    </div>
  );
}

/* ================================================================== */
/*  LANDING PAGE                                                       */
/* ================================================================== */
export default function Landing() {
  const isLoggedIn = !!localStorage.getItem('session_id');
  const [showStickyCta, setShowStickyCta] = useState(false);
  const [showChoiceModal, setShowChoiceModal] = useState(false);
  const [anonLoading, setAnonLoading] = useState(false);
  const [inAppDismissed, setInAppDismissed] = useState(false);
  const lang = useMemo(() => detectLang(), []);
  const inAppBrowser = useMemo(() => detectInAppBrowser(), []);
  const isRtl = lang === 'he' || lang === 'ar';
  const dir = isRtl ? 'rtl' as const : 'ltr' as const;

  useEffect(() => { capturePromoSource(); }, []);

  useEffect(() => {
    if (window.location.hash === '#lp-content') {
      setTimeout(() => {
        document.getElementById('lp-content')?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    }
  }, []);

  useEffect(() => {
    const onScroll = () => setShowStickyCta(window.scrollY > window.innerHeight * 0.8);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const startAnonymous = async () => {
    setAnonLoading(true);
    try {
      const sourceCode = localStorage.getItem('promo_source');
      const res = await fetch('/api/auth/anonymous', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_code: sourceCode || undefined }),
      });
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      localStorage.setItem('session_id', data.sessionId);
      if (sourceCode) localStorage.removeItem('promo_source');
      window.location.href = '/app';
    } catch {
      setAnonLoading(false);
    }
  };

  const handleCtaClick = () => {
    if (inAppBrowser) {
      // In-app browsers can't do Google OAuth — go straight to anonymous
      startAnonymous();
    } else {
      setShowChoiceModal(true);
    }
  };

  const cta = isLoggedIn ? (
    <a
      href="/app"
      className="inline-flex items-center gap-2 bg-white text-zinc-950 px-8 py-3.5 rounded-xl text-base font-semibold hover:bg-zinc-200 transition-colors"
    >
      {t('LP_OPEN_APP', lang)} <ArrowRight className="w-4 h-4" />
    </a>
  ) : (
    <button
      onClick={handleCtaClick}
      disabled={anonLoading}
      className="inline-flex items-center gap-2 bg-white text-zinc-950 px-8 py-3.5 rounded-xl text-base font-semibold hover:bg-zinc-200 transition-colors disabled:opacity-50"
    >
      {anonLoading ? '...' : t('LP_OPEN_APP', lang)} <ArrowRight className="w-4 h-4" />
    </button>
  );

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-300 font-sans selection:bg-blue-500/30" dir={dir}>

      {/* In-app browser warning */}
      {inAppBrowser && !inAppDismissed && (
        <div className="relative bg-amber-600/15 border-b border-amber-600/25 px-4 py-3 text-center text-sm">
          <p className="text-amber-200/90 max-w-xl mx-auto leading-relaxed">
            {t('INAPP_BROWSER_WARNING', lang).replace('{browser}', inAppBrowser)}
          </p>
          <button
            onClick={() => setInAppDismissed(true)}
            className="absolute top-2 right-3 text-amber-200/50 hover:text-amber-200 text-lg leading-none"
          >&times;</button>
        </div>
      )}

      {/* ============================================================ */}
      {/*  HERO                                                         */}
      {/* ============================================================ */}
      <header className="relative min-h-screen flex flex-col items-center justify-center text-center px-6 overflow-hidden">
        {/* Subtle radial glow */}
        <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse 60% 50% at 50% 40%, rgba(59,130,246,0.06) 0%, transparent 70%)' }} />

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="relative z-10 max-w-2xl"
        >
          {/* Logo */}
          <div className="w-14 h-14 bg-white/10 backdrop-blur border border-white/10 rounded-2xl flex items-center justify-center mx-auto mb-8">
            <Languages className="text-white w-7 h-7" />
          </div>

          <h1 className="text-4xl sm:text-6xl md:text-7xl tracking-tight text-white mb-6">
            <span className="font-extralight">poly</span><span className="font-black">Glottos</span>
          </h1>

          <p className="text-xl sm:text-2xl text-zinc-300 font-light leading-snug mb-3">
            {t('LP_HERO_TITLE', lang)}
          </p>
          <p className="text-lg text-zinc-500 font-light">
            {t('LP_HERO_SUBTITLE', lang)}
          </p>

          <div className="mt-10 flex justify-center gap-3">
            <button
              onClick={() => document.getElementById('lp-content')?.scrollIntoView({ behavior: 'smooth' })}
              className="inline-flex items-center gap-2 bg-transparent text-white border border-white/80 px-8 py-3.5 rounded-xl text-base font-semibold hover:bg-white/10 transition-colors"
            >
              {t('LP_LEARN_MORE', lang)}
            </button>
            {cta}
          </div>

        </motion.div>
      </header>

      <div id="lp-content" className="max-w-3xl mx-auto px-5 sm:px-6 pb-20 sm:pb-32">

        {/* ============================================================ */}
        {/*  WHAT IT DOES                                                 */}
        {/* ============================================================ */}
        <Section className="py-14 sm:py-24 border-t border-zinc-900">
          <h2 className="text-2xl sm:text-4xl font-bold text-white mb-8 sm:mb-10 tracking-tight">
            {t('LP_WHAT_TITLE', lang)}
          </h2>
          <p className="text-zinc-400 leading-relaxed mb-8">
            {t('LP_WHAT_DESC1', lang)}
          </p>
          <p className="text-zinc-400 leading-relaxed mb-10">
            {t('LP_WHAT_DESC2', lang)}
          </p>

          <div className="flex flex-wrap gap-3">
            {[
              { icon: <Eye className="w-4 h-4" />, label: t('LP_PILL_UNDERSTAND', lang) },
              { icon: <Brain className="w-4 h-4" />, label: t('LP_PILL_GRAMMAR', lang) },
              { icon: <Ear className="w-4 h-4" />, label: t('LP_PILL_HEAR', lang) },
              { icon: <Mic className="w-4 h-4" />, label: t('LP_PILL_SPEAK', lang) },
              { icon: <Layers className="w-4 h-4" />, label: t('LP_PILL_REMEMBER', lang) },
            ].map(f => (
              <span key={f.label} className="inline-flex items-center gap-2 bg-zinc-900/80 border border-zinc-800 rounded-full px-4 py-2 text-sm text-zinc-300">
                <span className="text-blue-400">{f.icon}</span> {f.label}
              </span>
            ))}
          </div>
        </Section>

        {/* ============================================================ */}
        {/*  HOW IT WORKS — LEARNING CYCLE                                */}
        {/* ============================================================ */}
        <Section className="py-14 sm:py-24 border-t border-zinc-900">
          <h2 className="text-2xl sm:text-4xl font-bold text-white mb-3 sm:mb-4 tracking-tight">
            {t('LP_HOW_TITLE', lang)}
          </h2>
          <p className="text-zinc-400 mb-3">{t('LP_HOW_CYCLE', lang)}</p>
          <div className="flex flex-wrap gap-2 mb-12 text-sm">
            {[t('LP_CYCLE_READ', lang), t('LP_CYCLE_UNDERSTAND', lang), t('LP_CYCLE_LISTEN', lang), t('LP_CYCLE_SPEAK', lang), t('LP_CYCLE_REMEMBER', lang)].map((s, i) => (
              <span key={s} className="inline-flex items-center gap-2">
                <span className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-zinc-300 font-medium">{s}</span>
                {i < 4 && <ArrowRight className="w-3.5 h-3.5 text-zinc-700 hidden sm:block" />}
              </span>
            ))}
          </div>

          {/* Steps timeline */}
          <div className="mt-4">
            <Step num={1} title={t('LP_STEP1_TITLE', lang)} icon={<BookOpen className="w-5 h-5" />}>
              <p>{t('LP_STEP1_P1', lang)}</p>
              <p>{t('LP_STEP1_P2', lang)}</p>
            </Step>

            <Step num={2} title={t('LP_STEP2_TITLE', lang)} icon={<Eye className="w-5 h-5" />}>
              <p>{t('LP_STEP2_P1', lang)}</p>
              <p>{t('LP_STEP2_P2', lang)}</p>
              <p className="text-zinc-500 italic">{t('LP_STEP2_P3', lang)}</p>
            </Step>

            <Step num={3} title={t('LP_STEP3_TITLE', lang)} icon={<Ear className="w-5 h-5" />}>
              <p>{t('LP_STEP3_P1', lang)}</p>
              <p>{t('LP_STEP3_P2', lang)}</p>
              <p className="text-zinc-500">{t('LP_STEP3_P3', lang)}</p>
            </Step>

            <Step num={4} title={t('LP_STEP4_TITLE', lang)} icon={<Mic className="w-5 h-5" />}>
              <p>{t('LP_STEP4_P1', lang)}</p>
              <p>{t('LP_STEP4_P2', lang)}</p>
              <p>{t('LP_STEP4_P3', lang)}</p>
            </Step>

            <Step num={5} title={t('LP_STEP5_TITLE', lang)} icon={<Layers className="w-5 h-5" />}>
              <p>{t('LP_STEP5_P1', lang)}</p>
              <p>{t('LP_STEP5_P2', lang)}</p>
            </Step>
          </div>

          {/* Mid-page CTA */}
          <div className="mt-12 flex justify-center">
            {cta}
          </div>
        </Section>

        {/* ============================================================ */}
        {/*  FOCUSED LEARNING                                             */}
        {/* ============================================================ */}
        <Section className="py-14 sm:py-24 border-t border-zinc-900">
          <h2 className="text-2xl sm:text-4xl font-bold text-white mb-4 sm:mb-6 tracking-tight">
            {t('LP_FOCUS_TITLE', lang)}
          </h2>
          <p className="text-zinc-400 leading-relaxed mb-6">
            {t('LP_FOCUS_DESC1', lang)}
          </p>
          <p className="text-zinc-400 leading-relaxed mb-6">
            {t('LP_FOCUS_DESC2', lang)}
          </p>
          <p className="text-zinc-500 leading-relaxed">
            {t('LP_FOCUS_DESC3', lang)}
          </p>
        </Section>

        {/* ============================================================ */}
        {/*  USE CASES                                                    */}
        {/* ============================================================ */}
        <Section className="py-14 sm:py-24 border-t border-zinc-900">
          <h2 className="text-2xl sm:text-4xl font-bold text-white mb-8 sm:mb-10 tracking-tight">
            {t('LP_USECASES_TITLE', lang)}
          </h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <UseCase icon={<BookOpen className="w-5 h-5" />} title={t('LP_UC1_TITLE', lang)} desc={t('LP_UC1_DESC', lang)} />
            <UseCase icon={<Brain className="w-5 h-5" />} title={t('LP_UC2_TITLE', lang)} desc={t('LP_UC2_DESC', lang)} />
            <UseCase icon={<Sparkles className="w-5 h-5" />} title={t('LP_UC3_TITLE', lang)} desc={t('LP_UC3_DESC', lang)} />
            <UseCase icon={<Volume2 className="w-5 h-5" />} title={t('LP_UC4_TITLE', lang)} desc={t('LP_UC4_DESC', lang)} />
            <UseCase icon={<Mic className="w-5 h-5" />} title={t('LP_UC5_TITLE', lang)} desc={t('LP_UC5_DESC', lang)} />
            <UseCase icon={<MessageSquare className="w-5 h-5" />} title={t('LP_UC6_TITLE', lang)} desc={t('LP_UC6_DESC', lang)} />
          </div>
        </Section>

        {/* ============================================================ */}
        {/*  LANGUAGES                                                    */}
        {/* ============================================================ */}
        <Section className="py-14 sm:py-24 border-t border-zinc-900">
          <div className="flex items-start sm:items-center gap-3 mb-4 sm:mb-6">
            <Globe className="w-6 h-6 text-blue-400 shrink-0 mt-0.5 sm:mt-0" />
            <h2 className="text-2xl sm:text-4xl font-bold text-white tracking-tight">
              {t('LP_LANGS_TITLE', lang).replace('{count}', String(Object.keys(LANGUAGES).length))}
            </h2>
          </div>
          <p className="text-zinc-400 leading-relaxed mb-8">
            {t('LP_LANGS_DESC', lang)}
          </p>
          <div className="flex flex-wrap gap-2">
            {Object.values(LANGUAGES).map(l => (
              <span key={l.label} className="bg-zinc-900/60 border border-zinc-800 rounded-full px-3 py-1 text-xs text-zinc-400">{l.label}</span>
            ))}
          </div>

          <div className="mt-12 flex justify-center">
            {cta}
          </div>
        </Section>

        {/* Footer */}
        <footer className="pt-16 pb-20 sm:pb-8 border-t border-zinc-900 text-center">
          <div className="flex items-center justify-center gap-2 mb-3">
            <div className="w-8 h-8 bg-white/10 rounded-lg flex items-center justify-center">
              <Languages className="text-white w-4 h-4" />
            </div>
            <span className="text-zinc-500 text-sm">
              <span className="font-light">poly</span><span className="font-bold">Glottos</span>
            </span>
          </div>
          <p className="text-xs text-zinc-700">&copy; {new Date().getFullYear()} polyGlottos</p>
        </footer>
      </div>

      {/* Sticky CTA bar */}
      <AnimatePresence>
        {showStickyCta && !isLoggedIn && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="fixed bottom-0 left-0 right-0 z-50 bg-zinc-900/95 backdrop-blur border-t border-zinc-800 px-4 py-3 flex items-center justify-center gap-4"
          >
            <span className="text-sm text-zinc-400 hidden sm:inline">{t('LP_STICKY_CTA', lang)}</span>
            <button
              onClick={handleCtaClick}
              disabled={anonLoading}
              className="inline-flex items-center gap-2 bg-white text-zinc-950 px-6 py-2.5 rounded-xl text-sm font-semibold hover:bg-zinc-200 transition-colors disabled:opacity-50"
            >
              {anonLoading ? '...' : t('LP_OPEN_APP', lang)} <ArrowRight className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Choice modal: Google sign-in vs anonymous */}
      <AnimatePresence>
        {showChoiceModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setShowChoiceModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-sm w-full p-6 text-center"
              onClick={e => e.stopPropagation()}
            >
              <h3 className="text-lg font-semibold text-white mb-6">{t('CHOICE_TITLE', lang)}</h3>

              <div className="flex justify-center mb-4">
                <GoogleLogin
                  onSuccess={() => {}}
                  ux_mode="redirect"
                  login_uri={`${window.location.origin}/api/auth/google/redirect`}
                />
              </div>

              <div className="flex items-center gap-3 my-4">
                <div className="flex-1 h-px bg-zinc-800" />
                <span className="text-xs text-zinc-600 uppercase">{t('CHOICE_OR', lang)}</span>
                <div className="flex-1 h-px bg-zinc-800" />
              </div>

              <button
                onClick={startAnonymous}
                disabled={anonLoading}
                className="w-full px-4 py-3 bg-zinc-800 hover:bg-zinc-700 text-white font-medium rounded-xl transition-colors disabled:opacity-50"
              >
                {anonLoading ? '...' : t('CHOICE_TRY', lang)}
              </button>
              <p className="text-xs text-zinc-600 mt-2">
                {t('CHOICE_TRY_DESC', lang).replace('{days}', '7')}
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
