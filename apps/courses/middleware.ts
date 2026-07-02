import { NextResponse, type NextRequest } from 'next/server';
import { locales, defaultLocale } from './i18n/request';
import { TARGET_BY_CODE, type TargetLang } from './lib/content-types';

// Custom middleware (replaces next-intl's createMiddleware) because the locale
// segment is no longer at the URL root. Routes look like /<target>/<native>/...
//
// Responsibilities:
//   1. /                       → render the multi-course landing.
//   2. /<target>               → render the target-language landing (native
//      picker + sign-in + course pitch). NOT a redirect — this is a real
//      indexable page so /de, /fr, … are first-class SEO entry points.
//   3. /<target>/<native>/...  → render the course/lesson/etc.
//   4. Anything else           → pass through (Next handles 404s).
//   5. Strip explicit ports from any redirect Location header so the public
//      edge (always on 443) serves the rewrite, not the container's 8080.
//   6. Set x-pathname and x-locale request headers so the root layout can
//      emit <html lang> per native (the root layout sits outside [native]
//      and has no params; reading the pathname via headers() is the
//      idiomatic workaround). For target-landing paths with no native in
//      the URL, x-locale comes from Accept-Language so the page renders
//      in the visitor's most-preferred supported language.

function pickAcceptLanguage(
  header: string | null,
  allowed: readonly string[] = locales as readonly string[],
): string {
  if (!header) return allowed.includes(defaultLocale) ? defaultLocale : allowed[0]!;
  // Parse a comma-separated list of language tags with q-values, take the
  // first one whose 2-letter prefix matches the allowed set.
  const candidates = header
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params
        .map((p) => p.trim().match(/^q=([\d.]+)$/))
        .find((m): m is RegExpMatchArray => m !== null);
      return { tag: (tag ?? '').toLowerCase(), q: q ? parseFloat(q[1]!) : 1 };
    })
    .sort((a, b) => b.q - a.q);
  for (const { tag } of candidates) {
    const head = tag.slice(0, 2);
    if (allowed.includes(head)) return head;
  }
  return allowed.includes(defaultLocale) ? defaultLocale : allowed[0]!;
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Detect the native locale from the URL: /<target>/<native>/... — second
  // segment is the native when it's one of the supported locales. For the
  // /<target> target-landing path, fall back to Accept-Language *constrained*
  // to that target's available natives — otherwise <html lang> on a French
  // landing could end up "en" while the page itself renders in Russian
  // because French only ships ru.
  const seg = pathname.split('/').filter(Boolean);
  const candidate = seg[1];
  let locale: string;
  if (candidate && (locales as readonly string[]).includes(candidate)) {
    locale = candidate;
  } else if (seg.length === 1) {
    const meta = TARGET_BY_CODE[seg[0] as TargetLang];
    locale = meta
      ? pickAcceptLanguage(req.headers.get('accept-language'), meta.natives)
      : pickAcceptLanguage(req.headers.get('accept-language'));
  } else {
    locale = defaultLocale;
  }

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-pathname', pathname);
  requestHeaders.set('x-locale', locale);

  // Telegram Mini App marker — the client TelegramProvider sets a `tma=1`
  // cookie on the first launch inside Telegram. Forward it as a request
  // header so app/layout.tsx can render `<html data-tma="true">` on the
  // server and skip the web chrome without a hydration mismatch.
  if (req.cookies.get('tma')?.value === '1') {
    requestHeaders.set('x-tma', '1');
  }

  // Embed marker — the desktop ModalNavLink loads Courses / Dictionary /
  // Progress in an iframe with `?embed=1` so the same data-tma-hide CSS
  // rule hides the inner TopBar and MobileBottomNav, avoiding double
  // chrome inside the modal. Forwarded as a request header so the SSR
  // pass sets <html data-embed="true"> on first paint — no flicker.
  if (req.nextUrl.searchParams.get('embed') === '1') {
    requestHeaders.set('x-embed', '1');
  }

  const res = NextResponse.next({ request: { headers: requestHeaders } });

  // Same fix as before: rewrite Location header host/proto/port to match the
  // public URL when behind the App Platform proxy. Without this the redirect
  // contains the container's listen port (8080) and the browser tries TLS on
  // that port, which is plain HTTP → SSL_ERROR_RX_RECORD_TOO_LONG.
  const location = res.headers.get('location');
  if (location) {
    try {
      const url = new URL(location);
      const xfHost = req.headers.get('x-forwarded-host');
      const xfProto = req.headers.get('x-forwarded-proto');
      if (xfHost) url.host = xfHost;
      if (xfProto) url.protocol = `${xfProto}:`;
      url.port = '';
      res.headers.set('location', url.toString());
    } catch {
      /* relative or malformed */
    }
  }
  return res;
}

// `/api`, `/_next`, `/_vercel`, and any path containing a dot (static
// files) are excluded as before. `/sso` is also excluded so the SSO
// landing page receives the raw `?sso=…` token without any locale-
// detection side effects: it never gets x-locale headers set and isn't
// reachable via a target-language redirect path.
export const config = {
  matcher: ['/((?!api|sso|_next|_vercel|.*\\..*).*)'],
};

// Re-export locales so the rest of the app continues to import from a single place.
export { locales, defaultLocale };
