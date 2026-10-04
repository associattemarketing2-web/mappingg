import type { MetadataRoute } from 'next';
import { listPublished } from '@/lib/blog';
import { SITE_URL } from '@/lib/seo/config';
import {
  getPublicPins,
  getLocalityGroups,
  getDeveloperGroups,
  getCityGroups,
  getStatusGroups,
  getTypeGroups,
  slugForProject,
} from '@/lib/seo/entities';

// Regenerate at most every 10 minutes so newly published blog posts and new
// projects/localities appear without a redeploy (search engines re-fetch
// sitemaps periodically anyway).
export const revalidate = 600;

// Public, crawlable pages + every published blog post + all derived SEO
// entities (projects, localities, developers, cities, status, property types).
// The admin editor and APIs are intentionally excluded (see robots.ts).
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, lastModified: now, changeFrequency: 'daily', priority: 1 },
    { url: `${SITE_URL}/map`, lastModified: now, changeFrequency: 'daily', priority: 0.9 },
    { url: `${SITE_URL}/projects`, lastModified: now, changeFrequency: 'daily', priority: 0.9 },
    { url: `${SITE_URL}/locations`, lastModified: now, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${SITE_URL}/developers`, lastModified: now, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${SITE_URL}/cities`, lastModified: now, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${SITE_URL}/property`, lastModified: now, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${SITE_URL}/blog`, lastModified: now, changeFrequency: 'daily', priority: 0.8 },
    { url: `${SITE_URL}/how-it-works`, lastModified: now, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${SITE_URL}/features`, lastModified: now, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${SITE_URL}/faq`, lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${SITE_URL}/mundhwa-map-3d`, lastModified: now, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${SITE_URL}/about`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${SITE_URL}/contact`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${SITE_URL}/careers`, lastModified: now, changeFrequency: 'monthly', priority: 0.3 },
    { url: `${SITE_URL}/advertise`, lastModified: now, changeFrequency: 'monthly', priority: 0.3 },
    { url: `${SITE_URL}/privacy`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${SITE_URL}/terms`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${SITE_URL}/disclaimer`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${SITE_URL}/map-data`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
  ];

  // Derived entity routes (never throws — each getter is cached & fail-safe).
  const [pins, locs, devs, cities, statuses, types, posts] = await Promise.all([
    getPublicPins(),
    getLocalityGroups(),
    getDeveloperGroups(),
    getCityGroups(),
    getStatusGroups(),
    getTypeGroups(),
    listPublished(),
  ]);

  const projectRoutes: MetadataRoute.Sitemap = pins.map((p) => ({
    url: `${SITE_URL}/projects/${slugForProject(p)}`,
    lastModified: p.updated_at ? new Date(p.updated_at) : now,
    changeFrequency: 'weekly',
    priority: 0.7,
  }));

  const group = (base: string, slugs: string[], priority: number): MetadataRoute.Sitemap =>
    slugs.map((slug) => ({ url: `${SITE_URL}${base}/${slug}`, lastModified: now, changeFrequency: 'weekly', priority }));

  const locRoutes = group('/locations', locs.map((g) => g.slug), 0.75);
  const devRoutes = group('/developers', devs.map((g) => g.slug), 0.6);
  const cityRoutes = group('/cities', cities.map((g) => g.slug), 0.7);
  const statusRoutes = group('/status', statuses.map((g) => g.slug), 0.6);
  const typeRoutes = group('/property', types.map((g) => g.slug), 0.6);

  const postRoutes: MetadataRoute.Sitemap = posts.map((p) => ({
    url: `${SITE_URL}/blog/${p.slug}`,
    lastModified: p.updated_at ? new Date(p.updated_at) : now,
    changeFrequency: 'weekly',
    priority: 0.7,
  }));

  return [
    ...staticRoutes,
    ...projectRoutes,
    ...locRoutes,
    ...devRoutes,
    ...cityRoutes,
    ...statusRoutes,
    ...typeRoutes,
    ...postRoutes,
  ];
}
