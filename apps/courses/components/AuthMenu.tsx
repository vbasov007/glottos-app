'use client';

import { useEffect, useRef, useState } from 'react';
import { GoogleLogin, GoogleOAuthProvider } from '@react-oauth/google';
import { withBase } from '../lib/api-base';
import { useSession } from './SessionProvider';
import { useTelegram } from './TelegramProvider';
import { SettingsModal } from './SettingsModal';
import { logToServer } from '../lib/api-client';
import type { NativeLang, TargetLang } from '../lib/content-types';

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? '';

function isIOSSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /iP(ad|hone|od)/.test(ua) && /Safari/.test(ua) && !/CriOS|FxiOS/.test(ua);
}

interface AuthMenuProps {
  /** Current (target, native) the user is inside. When set, the avatar
   *  dropdown shows a Settings entry that opens the modal preconfigured
   *  for this pair. Omit on locale-less contexts (e.g. /admin). */
  target?: TargetLang;
  native?: NativeLang;
  /** i18n label for the dropdown's Settings entry. */
  settingsLabel?: string;
  /** i18n label for the dropdown's Sign-out entry. Defaults to English. */
  signOutLabel?: string;
}

export function AuthMenu(props: AuthMenuProps = {}) {
  const { isTma } = useTelegram();
  // Inside Telegram, sign-in is automatic via initData (see
  // TelegramAutoSignIn) and the user can't sign out of the app independently
  // of Telegram itself. Render a compact identity badge instead of the
  // Google button. Also avoids loading the Google OAuth iframe inside a
  // Telegram WebView, which the host blocks in many configurations.
  if (isTma) return <TelegramBadge />;
  if (!CLIENT_ID) {
    // Sign-in is unconfigured. Render nothing rather than a broken button.
    return null;
  }
  return (
    <GoogleOAuthProvider clientId={CLIENT_ID}>
      <AuthMenuInner
        target={props.target}
        native={props.native}
        settingsLabel={props.settingsLabel}
        signOutLabel={props.signOutLabel}
      />
    </GoogleOAuthProvider>
  );
}

function TelegramBadge() {
  const { user, ready } = useSession();
  const { tgUser } = useTelegram();
  if (!ready) {
    return <div className="h-7 w-24 rounded bg-zinc-100 dark:bg-zinc-900 animate-pulse" />;
  }
  // Prefer the Telegram-supplied profile (avatar + name) since it's fresh
  // each launch; fall back to the DB user if we somehow have one without
  // initData (shouldn't happen in TMA).
  const name = tgUser
    ? [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') ||
      tgUser.username ||
      null
    : user?.name ?? user?.email ?? null;
  const picture = tgUser?.photo_url ?? user?.picture ?? null;
  const initials = (name ?? '?').slice(0, 1).toUpperCase();
  return (
    <div className="flex items-center gap-2 px-2 py-1">
      {picture ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={picture}
          alt=""
          className="h-7 w-7 rounded-full object-cover"
          referrerPolicy="no-referrer"
        />
      ) : (
        <span className="h-7 w-7 rounded-full bg-zinc-200 dark:bg-zinc-800 grid place-items-center text-xs font-semibold">
          {initials}
        </span>
      )}
      {name && (
        <span className="hidden sm:block text-sm truncate max-w-[10rem]">{name}</span>
      )}
    </div>
  );
}

function AuthMenuInner({
  target,
  native,
  settingsLabel,
  signOutLabel,
}: AuthMenuProps) {
  const { user, ready, signInWithCredential, signOut } = useSession();
  const [open, setOpen] = useState(false);
  // The Settings modal lives next to the dropdown; opening it closes the
  // dropdown but lets the modal own focus until it's dismissed.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close the dropdown on outside click.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!dropdownRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [open]);

  if (!ready) {
    return <div className="h-7 w-20 rounded bg-zinc-100 dark:bg-zinc-900 animate-pulse" />;
  }

  if (!user) {
    return <SignedOutButton onSignIn={signInWithCredential} />;
  }

  const initials = (user.name || user.email).slice(0, 1).toUpperCase();
  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-900"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {user.picture ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.picture}
            alt=""
            className="h-7 w-7 rounded-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <span className="h-7 w-7 rounded-full bg-zinc-200 dark:bg-zinc-800 grid place-items-center text-xs font-semibold">
            {initials}
          </span>
        )}
        <span className="hidden sm:block text-sm truncate max-w-[10rem]">
          {user.name || user.email}
        </span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-1 w-56 rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-lg z-40"
        >
          <div className="px-3 py-2 text-xs text-zinc-500 truncate">{user.email}</div>
          <div className="border-t border-zinc-200 dark:border-zinc-800" />
          {target && native && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                setSettingsOpen(true);
              }}
              className="block w-full text-left px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-900"
            >
              {settingsLabel ?? 'Settings'}
            </button>
          )}
          <button
            type="button"
            onClick={async () => {
              setOpen(false);
              await signOut();
            }}
            role="menuitem"
            className="w-full px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-900"
          >
            {signOutLabel ?? 'Sign out'}
          </button>
        </div>
      )}
      {target && native && (
        <SettingsModal
          target={target}
          native={native}
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}

function SignedOutButton({ onSignIn }: { onSignIn: (credential: string) => Promise<boolean> }) {
  // iOS Safari blocks the popup / FedCM path silently. The "redirect" ux_mode
  // works because Google itself POSTs the credential to login_uri, sidestepping
  // any browser policy that would otherwise block a same-window popup.
  const useRedirect = typeof window !== 'undefined' && isIOSSafari();
  const loginUri =
    typeof window !== 'undefined'
      ? `${window.location.origin}${withBase('/api/auth/google/redirect')}`
      : undefined;

  return (
    <GoogleLogin
      onSuccess={(resp) => {
        // Log every successful return from Google before we touch the credential.
        // Helps diagnose cases where Google says "success" but we don't get a
        // credential (e.g. select_by="user_1tap_x" with empty credential).
        logToServer('info', 'GoogleLogin', 'onSuccess', {
          hasCredential: !!resp.credential,
          credentialLength: resp.credential?.length ?? 0,
          select_by: resp.select_by,
          clientId: resp.clientId,
          uxMode: useRedirect ? 'redirect' : 'popup',
        });
        if (resp.credential) {
          void onSignIn(resp.credential);
        } else {
          logToServer('error', 'GoogleLogin', 'success-without-credential', { resp });
        }
      }}
      onError={() => {
        // GoogleLogin doesn't pass any details to onError. The most common
        // causes are: popup blocked, origin not in Authorized JavaScript
        // origins, FedCM disabled / blocked, third-party-cookie ban. Capture
        // what we can to narrow it down.
        logToServer('warn', 'GoogleLogin', 'onError', {
          uxMode: useRedirect ? 'redirect' : 'popup',
          loginUri,
          origin: typeof window !== 'undefined' ? window.location.origin : null,
          cookieEnabled: typeof navigator !== 'undefined' ? navigator.cookieEnabled : null,
          referrer: typeof document !== 'undefined' ? document.referrer : null,
        });
      }}
      ux_mode={useRedirect ? 'redirect' : 'popup'}
      login_uri={useRedirect ? loginUri : undefined}
      size="medium"
      shape="rectangular"
      theme="outline"
      // Narrower button so a 375px iPhone fits brand + button + lang switcher
      // without horizontal overflow. 160px still shows the Google "G" + label.
      width="160"
    />
  );
}
