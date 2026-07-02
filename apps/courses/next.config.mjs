import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

// In the merged monorepo the courses app is served under /courses (tutor owns
// the root origin), so a single browser origin means one shared session. Next's
// basePath rebases every page, <Link>, router navigation and /_next asset
// automatically; only raw fetch('/api/...') calls need the prefix (see
// lib/api-base.ts). Override with NEXT_PUBLIC_BASE_PATH ('' to serve at root).
const basePath =
  process.env.NEXT_PUBLIC_BASE_PATH === '' ? '' : process.env.NEXT_PUBLIC_BASE_PATH || '/courses';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  basePath,
  // @glottos/shared ships TypeScript source; Next must transpile it.
  transpilePackages: ['@glottos/shared'],
};

export default withNextIntl(nextConfig);
