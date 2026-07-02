import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { SessionProvider } from '../components/SessionProvider';
import { PostHogProvider } from '../components/PostHogProvider';
import { TelegramScript } from '../components/TelegramScript';
import { TelegramProvider } from '../components/TelegramProvider';
import { TelegramThemeBridge } from '../components/TelegramThemeBridge';
import { TelegramAutoSignIn } from '../components/TelegramAutoSignIn';
import { ThemeProvider } from '../components/ThemeProvider';
import { ThemeScript } from '../components/ThemeScript';
import { defaultLocale } from '../i18n/request';
import './globals.css';

export const metadata: Metadata = {
  title: 'Glottos Matrix — structural language courses',
  description:
    'Glottos Matrix · structural language courses for German, French, Spanish, Serbian, Georgian, Hebrew. 50 lessons, 150 listening texts, 50 tests per course.',
  // Suppress the browser's auto-translate banner site-wide. We're a language-
  // learning app — Chrome silently turning "Ich heiße Anna" into "I'm called
  // Anna" mid-lesson ruins the exercise. Pair the `google: notranslate` meta
  // (handled by Chrome) with the HTML `translate="no"` attribute on <html>
  // and a `notranslate` class on <body> for Firefox/Safari coverage.
  other: { google: 'notranslate' },
};

// Next.js 15 App Router exposes viewport as a separate metadata API. Without
// this, mobile browsers render the page at desktop width (~980px) and zoom
// out, producing a tiny illegible layout and breaking every responsive
// breakpoint. `viewportFit: 'cover'` opts into the safe-area inset insets
// (iPhone notch) — pages can then use `env(safe-area-inset-*)` if they want
// to draw under the system bars.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

// Root layout must define <html> and <body>. SessionProvider lives here (not
// inside the [native] segment) so auth state is available on the landing too.
// <html lang> is set per request from the middleware-provided x-locale header
// so search engines tag each native variant (ru/en/pl) with its real language.
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const h = await headers();
  const lang = h.get('x-locale') ?? defaultLocale;
  // x-tma is forwarded by middleware whenever the `tma` cookie is present
  // (set by TelegramProvider on first launch inside Telegram). When true,
  // <html data-tma="true"> is server-rendered so [data-tma-hide] elements
  // (TopBar, MobileBottomNav) are hidden on first paint — no flash.
  const isTma = h.get('x-tma') === '1';
  // x-embed is forwarded by middleware when the URL carries ?embed=1 —
  // the ModalNavLink loads the three nav targets in an iframe that way so
  // the same [data-tma-hide] rule hides chrome inside the modal.
  const isEmbed = h.get('x-embed') === '1';
  return (
    <html
      lang={lang}
      translate="no"
      suppressHydrationWarning
      {...(isTma ? { 'data-tma': 'true' } : {})}
      {...(isEmbed ? { 'data-embed': 'true' } : {})}
    >
      <body className="notranslate">
        {/* Pre-paint script: must run before React hydrates so the dark
            class is set on first paint, avoiding a light → dark flash for
            users whose saved preference is dark. */}
        <ThemeScript />
        <TelegramScript />
        <PostHogProvider>
          <ThemeProvider>
            <TelegramProvider>
              <TelegramThemeBridge />
              <SessionProvider>
                <TelegramAutoSignIn />
                {children}
              </SessionProvider>
            </TelegramProvider>
          </ThemeProvider>
        </PostHogProvider>
      </body>
    </html>
  );
}
