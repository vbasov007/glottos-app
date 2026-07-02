import type { MetadataRoute } from 'next';
import { COURSES, TARGETS } from '../lib/content-types';
import { locales } from '../i18n/request';
import { siteUrlAsync } from '../lib/site-url';

// Sitemap covers: landing, every target landing, every (target, native)
// course-selection page, every course home, every lesson, every dictionary.
// Tests aren't in the sitemap — the course-home page links to them and
// they're not the SEO targets.
//
// `dynamic = 'force-dynamic'` opts out of the build-time static render so
// the sitemap is regenerated per request from the live request host. That
// keeps the URLs in sync with whatever domain the request actually arrived
// on (no risk of baking in `localhost:3000` from a misconfigured env).
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = await siteUrlAsync();
  const url = (path: string) => `${base}${path.startsWith('/') ? path : `/${path}`}`;
  const now = new Date();
  const entries: MetadataRoute.Sitemap = [
    {
      url: url('/'),
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 1.0,
    },
  ];

  for (const t of TARGETS) {
    entries.push({
      url: url(`/${t.code}`),
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.85,
    });
    for (const n of t.natives) {
      if (!(locales as readonly string[]).includes(n)) continue;
      const pairBase = `/${t.code}/${n}`;
      entries.push({
        url: url(pairBase),
        lastModified: now,
        changeFrequency: 'weekly',
        priority: 0.9,
      });
      entries.push({
        url: url(`${pairBase}/dictionary`),
        lastModified: now,
        changeFrequency: 'monthly',
        priority: 0.7,
      });
      for (const c of COURSES) {
        const courseBase = `${pairBase}/${c.slug}`;
        entries.push({
          url: url(courseBase),
          lastModified: now,
          changeFrequency: 'weekly',
          priority: 0.85,
        });
        for (let i = 1; i <= t.lessons; i++) {
          entries.push({
            url: url(`${pairBase}/lesson/${c.slug}/${i}`),
            lastModified: now,
            changeFrequency: 'monthly',
            priority: 0.8,
          });
        }
      }
    }
  }

  return entries;
}
