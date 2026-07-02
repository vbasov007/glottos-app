import type { MetadataRoute } from 'next';
import { absoluteUrl } from '../lib/site-url';

// Allow crawling of all public lesson/dictionary/course pages. The user
// dashboard and settings depend on a client-side store and aren't useful
// to index; API routes never should be.

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/admin', '/*/*/dashboard', '/*/*/settings'],
      },
    ],
    sitemap: absoluteUrl('/sitemap.xml'),
  };
}
