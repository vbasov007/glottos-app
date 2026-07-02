import React, { useRef } from 'react';
import {
  Languages,
  Info,
  MessageSquare,
  CircleHelp,
  Globe,
  GraduationCap,
  Settings,
  LogOut,
  Crown,
  ShieldCheck,
} from 'lucide-react';
import { t } from '../i18n';
import { TIMEOUTS } from '../constants';

interface HeaderUser {
  name: string;
  picture: string | null;
  role?: string;
}

interface HeaderProps {
  interfaceLanguage: string;
  user: HeaderUser;
  subscriptionStatus: string;
  isTouchDevice: boolean;
  showUserMenu: boolean;
  setShowUserMenu: React.Dispatch<React.SetStateAction<boolean>>;
  setTutorialStep: (step: number) => void;
  setShowFeedback: (show: boolean) => void;
  setFeedbackSent: (sent: boolean) => void;
  setFeedbackText: (text: string) => void;
  setShowSettings: (show: boolean) => void;
  onLogout: () => void;
  onOpenCourses?: () => void;
  userMenuRef: React.RefObject<HTMLDivElement | null>;
}

export function Header({
  interfaceLanguage,
  user,
  subscriptionStatus,
  isTouchDevice,
  showUserMenu,
  setShowUserMenu,
  setTutorialStep,
  setShowFeedback,
  setFeedbackSent,
  setFeedbackText,
  setShowSettings,
  onLogout,
  onOpenCourses,
  userMenuRef,
}: HeaderProps) {
  const userMenuTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  return (
    <header className="h-16 border-b border-[var(--border-main)] bg-[var(--bg-panel)] flex items-center px-3 lg:px-6 justify-between sticky top-0 z-10">
      <a href="/" className="flex items-center gap-3 no-underline text-inherit hover:opacity-80 transition-opacity">
        <div className="w-10 h-10 bg-[var(--bg-accent)] rounded-xl flex items-center justify-center">
          <Languages className="text-white w-5 h-5" />
        </div>
        <div>
          <h1 className="text-lg tracking-tight"><span className="font-light">poly</span><span className="font-black">Glottos</span></h1>
          <p className="hidden sm:block text-[10px] tracking-widest text-[var(--text-muted)] font-bold">{t('HEADER_SUBTITLE', interfaceLanguage)}</p>
        </div>
      </a>
      <div className="flex items-center gap-1 lg:gap-3">
        {onOpenCourses && (
          <button
            onClick={onOpenCourses}
            className="flex items-center gap-1.5 px-2 py-1.5 -my-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
            title={t('COURSES_LINK', interfaceLanguage)}
          >
            <GraduationCap className="w-4 h-4" />
            <span className="hidden lg:inline text-xs font-medium">{t('COURSES_LINK', interfaceLanguage)}</span>
          </button>
        )}
        <a
          href="/#lp-content"
          className="flex items-center gap-1.5 px-2 py-1.5 -my-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
          title={t('ABOUT', interfaceLanguage)}
        >
          <Globe className="w-4 h-4" />
          <span className="hidden lg:inline text-xs font-medium">{t('ABOUT', interfaceLanguage)}</span>
        </a>
        <button
          onClick={() => setTimeout(() => setTutorialStep(0), 100)}
          className="flex items-center gap-1.5 px-2 py-1.5 -my-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
          title={t('TUT_START_TOUR', interfaceLanguage)}
        >
          <Info className="w-4 h-4" />
          <span className="hidden lg:inline text-xs font-medium">{t('TUT_START_TOUR', interfaceLanguage)}</span>
        </button>
        <button
          data-tutorial="feedback-btn"
          onClick={() => { setShowFeedback(true); setFeedbackSent(false); setFeedbackText(''); }}
          className="flex items-center gap-1.5 px-2 py-1.5 -my-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
          title={t('FEEDBACK', interfaceLanguage)}
        >
          <MessageSquare className="w-4 h-4" />
          <span className="hidden lg:inline text-xs font-medium">{t('FEEDBACK', interfaceLanguage)}</span>
        </button>
        <a
          data-tutorial="help-btn"
          href="/guide"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-2 py-1.5 -my-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
          title={t('HELP', interfaceLanguage)}
        >
          <CircleHelp className="w-4 h-4" />
          <span className="hidden lg:inline text-xs font-medium">{t('HELP', interfaceLanguage)}</span>
        </a>
        <div
          ref={userMenuRef}
          className="relative pl-3 border-l border-[var(--border-main)]"
          onMouseEnter={() => { if (!isTouchDevice) { if (userMenuTimerRef.current) clearTimeout(userMenuTimerRef.current); setShowUserMenu(true); } }}
          onMouseLeave={() => { if (!isTouchDevice) { userMenuTimerRef.current = setTimeout(() => setShowUserMenu(false), TIMEOUTS.MENU_HOVER_CLOSE); } }}
        >
          <button
            onClick={() => { if (isTouchDevice) setShowUserMenu(v => !v); }}
            className="flex items-center gap-2 rounded-full hover:opacity-80 transition-opacity"
            title={user.name}
          >
            <div className="relative w-8 h-8 shrink-0">
              <div className="absolute inset-0 rounded-full bg-[var(--bg-accent)] flex items-center justify-center text-white text-sm font-semibold">
                {(user.name || '?')[0].toUpperCase()}
              </div>
              {user.picture && (
                <img
                  src={user.picture}
                  alt={user.name}
                  className="absolute inset-0 w-8 h-8 rounded-full object-cover"
                  referrerPolicy="no-referrer"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              )}
              {(subscriptionStatus === 'active' || subscriptionStatus === 'trialing') && (
                <div className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-amber-400 flex items-center justify-center shadow-sm">
                  <Crown className="w-2.5 h-2.5 text-white" />
                </div>
              )}
            </div>
          </button>
          {showUserMenu && (
            <div className="absolute right-0 top-full mt-2 w-48 rounded-xl border border-[var(--border-main)] bg-[var(--bg-panel)] shadow-lg py-1 z-50">
              <button
                data-tutorial="settings-btn"
                onClick={() => { setShowUserMenu(false); setShowSettings(true); }}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
              >
                <Settings className="w-4 h-4" />
                {t('SETTINGS', interfaceLanguage)}
              </button>
              {user?.role === 'admin' && (
                <a
                  href="/admin"
                  onClick={() => setShowUserMenu(false)}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
                >
                  <ShieldCheck className="w-4 h-4" />
                  Admin
                </a>
              )}
              <div className="mx-3 border-t border-[var(--border-main)]" />
              <button
                onClick={onLogout}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
              >
                <LogOut className="w-4 h-4" />
                {t('LOGOUT', interfaceLanguage)}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
