// Centralized SEO/site configuration. One source of truth for the canonical
// origin, brand strings and social handles, so metadata, JSON-LD, the sitemap
// and OG images never drift out of sync.

// The canonical origin used in canonical tags, the sitemap, robots.txt, Open
// Graph and JSON-LD. Production serves www.mappingg.com (the apex 308-redirects
// there), so an apex value is upgraded to www: a canonical that redirects sends
// Google conflicting signals. NEXT_PUBLIC_SITE_URL itself is left alone because
// Google sign-in builds its whitelisted redirect URI from it (lib/google-oauth.ts);
// set NEXT_PUBLIC_CANONICAL_URL to override the canonical origin explicitly.
export const SITE_URL = (process.env.NEXT_PUBLIC_CANONICAL_URL || process.env.NEXT_PUBLIC_SITE_URL || 'https://www.mappingg.com')
  .replace(/\/$/, '')
  .replace(/^https?:\/\/mappingg\.com$/i, 'https://www.mappingg.com');

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
