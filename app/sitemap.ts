import type { MetadataRoute } from 'next';
import { listPublished } from '@/lib/blog';
import { SITE_URL } from '@/lib/seo/config';
import {
  getPublicPins,
  getStatusGroups,
  getTypeGroups,
  slugForProject,
  type Pin,
} from '@/lib/seo/entities';
import { projectIndexing } from '@/lib/seo/indexing';

// Regenerate at most once an hour so newly published blog posts and new
// projects/localities appear without a redeploy (search engines re-fetch
// sitemaps periodically anyway).
export const revalidate = 3600;

// Public, crawlable pages + every published blog post + all derived SEO
// entities (projects, status, property types).
// The admin editor and APIs are intentionally excluded (see robots.ts).
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, changeFrequency: 'daily', priority: 1 },
    { url: `${SITE_URL}/map`, changeFrequency: 'daily', priority: 0.9 },
    { url: `${SITE_URL}/projects`, changeFrequency: 'daily', priority: 0.9 },
    { url: `${SITE_URL}/property`, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${SITE_URL}/blog`, changeFrequency: 'daily', priority: 0.8 },
    { url: `${SITE_URL}/how-it-works`, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${SITE_URL}/features`, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${SITE_URL}/faq`, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${SITE_URL}/mundhwa-map-3d`, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${SITE_URL}/about`, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${SITE_URL}/contact`, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${SITE_URL}/buyer-requirement`, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${SITE_URL}/careers`, changeFrequency: 'monthly', priority: 0.3 },
    { url: `${SITE_URL}/advertise`, changeFrequency: 'monthly', priority: 0.3 },
    { url: `${SITE_URL}/privacy`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${SITE_URL}/terms`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${SITE_URL}/cookies`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${SITE_URL}/disclaimer`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${SITE_URL}/data-sources`, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${SITE_URL}/map-data`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${SITE_URL}/developer-api`, changeFrequency: 'monthly', priority: 0.4 },
  ];

  // Derived entity routes (never throws — each getter is cached & fail-safe).
  const [pins, statuses, types, posts] = await Promise.all([
    getPublicPins(),
    getStatusGroups(),
    getTypeGroups(),
    listPublished({ strict: true }),
  ]);

  // lastModified comes only from real change dates: a value that is always "now"
  // teaches Google to ignore the field. A hub page changes when one of its projects does.
  const latest = (rows: { updated_at?: string }[]): Date | undefined => {
    const t = Math.max(0, ...rows.map((r) => Date.parse(r.updated_at || '')).filter(Number.isFinite));
    return t ? new Date(t) : undefined;
  };
  const DATA_PAGES = ['/', '/map', '/projects', '/property'];
  for (const r of staticRoutes) {
    const path = r.url.slice(SITE_URL.length);
    if (DATA_PAGES.includes(path)) r.lastModified = latest(pins);
    else if (path === '/blog') r.lastModified = latest(posts);
  }

  // Only indexable pages are listed: noindex pages (empty placeholder projects — lib/seo/indexing.ts) stay reachable but out of here.
  const projectRoutes: MetadataRoute.Sitemap = pins.filter((p) => projectIndexing(p).index).map((p) => ({
    url: `${SITE_URL}/projects/${slugForProject(p)}`,
    lastModified: latest([p]),
    changeFrequency: 'weekly',
    priority: 0.7,
  }));

  const group = (base: string, groups: { slug: string; pins: Pin[] }[], priority: number): MetadataRoute.Sitemap =>
    groups.map((g) => ({ url: `${SITE_URL}${base}/${g.slug}`, lastModified: latest(g.pins), changeFrequency: 'weekly', priority }));

  const statusRoutes = group('/status', statuses, 0.6);
  const typeRoutes = group('/property', types, 0.6);
  const postRoutes: MetadataRoute.Sitemap = posts.map((p) => ({
    url: `${SITE_URL}/blog/${p.slug}`,
    lastModified: latest([p]),
    changeFrequency: 'weekly',
    priority: 0.7,
  }));

  return [
    ...staticRoutes,
    ...projectRoutes,
    ...statusRoutes,
    ...typeRoutes,
    ...postRoutes,
  ];
}
