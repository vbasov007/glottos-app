// The courses app is served under a base path (`/courses`) in the merged
// deployment. Next.js `basePath` rebases pages/links/assets automatically, but
// NOT raw `fetch('/api/...')` calls — those are origin-absolute. This helper
// prefixes API paths so they hit `/courses/api/...` (which nginx routes to the
// Next process). Set NEXT_PUBLIC_BASE_PATH='' to serve courses at the root.
export const BASE_PATH =
  process.env.NEXT_PUBLIC_BASE_PATH === ''
    ? ''
    : process.env.NEXT_PUBLIC_BASE_PATH || '/courses';

/** Prefix a site-absolute API path with the app's base path. */
export function withBase(path: string): string {
  if (!path.startsWith('/')) return path;
  return `${BASE_PATH}${path}`;
}
