// Centralized SEO/site configuration. One source of truth for the canonical
// origin, brand strings and social handles, so metadata, JSON-LD, the sitemap
// and OG images never drift out of sync.

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://mappingg.com').replace(/\/$/, '');

export const SITE = {
  url: SITE_URL,
  name: 'Mappingg',
  legalName: 'Associatte PropTech Pvt Ltd',
  tagline: 'Live Real Estate Project Map for Pune & MMR',
  description:
    'Explore a live, interactive map of real estate projects across Pune and the Mumbai Metropolitan Region — colour-coded by status, with developer, pricing, configuration and infrastructure details.',
  logo: `${SITE_URL}/img/Associattelogo.png`,
  ogFallback: `${SITE_URL}/img/mappingg-icon-mark.png`,
  twitter: '@mappingg',
  locale: 'en_IN',
} as const;

/** Absolute URL for any site path. */
export function abs(path = '/'): string {
  if (!path) return SITE_URL;
  if (/^https?:\/\//i.test(path)) return path;
  return `${SITE_URL}${path.startsWith('/') ? '' : '/'}${path}`;
}
