// Single source of truth for the public origin used in sitemap, robots,
// canonical URLs, hreflang alternates, and OpenGraph metadata.
//
// Resolution order (first non-empty wins):
//   1. SITE_URL / NEXT_PUBLIC_SITE_URL env var.
//   2. Inside a request context (e.g. dynamic sitemap.ts): the actual
//      request Host + x-forwarded-proto — robust against misconfigured envs.
//   3. Hard-coded fallback to the production domain so a missing env in a
//      static build never emits localhost.
import { headers } from 'next/headers';

const FALLBACK = 'https://courses.glottos.com';

function fromEnv(): string | null {
  const raw = process.env.SITE_URL ?? process.env.NEXT_PUBLIC_SITE_URL;
  return raw && raw.trim() ? raw.trim().replace(/\/+$/, '') : null;
}

// Hosts we never want to canonicalize as — even if the request came from
// these, sitemap and SEO links should point at the production domain.
const NON_CANONICAL_HOST_PATTERNS = [
  /\.ondigitalocean\.app$/i, // App Platform's internal hostname
  /^localhost(:|$)/i,
  /^127\./,
  /\.local(:|$)/i,
];

function isCanonicalHost(host: string): boolean {
  return !NON_CANONICAL_HOST_PATTERNS.some((re) => re.test(host));
}

async function fromRequestHeaders(): Promise<string | null> {
  try {
    const h = await headers();
    const host = h.get('x-forwarded-host') ?? h.get('host');
    if (!host || !isCanonicalHost(host)) return null;
    const proto = h.get('x-forwarded-proto') ?? 'https';
    return `${proto}://${host}`;
  } catch {
    // headers() throws outside a request context (e.g. during static build).
    return null;
  }
}

export function siteUrl(): string {
  return fromEnv() ?? FALLBACK;
}

export function absoluteUrl(path: string): string {
  const base = siteUrl();
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}`;
}

/** Async variant for dynamic route handlers (sitemap.ts, robots.ts).
 *  Resolution: SITE_URL env → request Host (only if canonical-looking) →
 *  hard-coded production fallback. Env always wins so a deployment with
 *  SITE_URL set can never leak its internal *.ondigitalocean.app hostname
 *  into the sitemap. */
export async function siteUrlAsync(): Promise<string> {
  return fromEnv() ?? (await fromRequestHeaders()) ?? FALLBACK;
}

export async function absoluteUrlAsync(path: string): Promise<string> {
  const base = await siteUrlAsync();
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}`;
}
