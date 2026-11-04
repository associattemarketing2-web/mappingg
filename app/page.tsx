import type { Metadata } from 'next';
import './landing.css';
import './home-finder.css';
import './home.css';
import './mobile-home.css';
import { LANDING_BODY } from '@/components/landing/body';
import LandingClient from '@/components/landing/LandingClient';
import SiteHeader from '@/components/SiteHeader';
import IconFont from '@/components/IconFont';
import { trustedLogos } from '@/lib/developers';
import { trustedDevelopersHtml } from '@/components/landing/trusted-developers';
import HomeFinder from '@/components/landing/HomeFinder';
import { getProjectCards } from '@/lib/home/cards';
import { homeStats, statsStripHtml, statsBandHtml, mapPreviewHtml, heroProjectHtml, heroSkylinePinsHtml, buyersSectionHtml } from '@/components/landing/home-sections';

import { SITE, SITE_URL } from '@/lib/seo/config';
import { mobileTrustHtml, mobileCatsHtml, mobileDiscoverHtml, mobileInsightsHtml, type MobilePost } from '@/components/landing/mobile-sections';
import { listPublished, readingTime } from '@/lib/blog';

// ISR: served static & fast, but re-renders periodically so admin-set SEO values
// (Search Console verification, GTM) from the shared layout show up without a redeploy.
export const revalidate = 3600;

export const metadata: Metadata = {
  // Absolute: the brand is already in the title, so skip the layout's ' — Mappingg' suffix.
  title: { absolute: 'New Flats & Residential Projects in Pune & Mumbai | Mappingg' },
  // ~155 chars so Google shows it whole; meta keywords dropped (search engines ignore them).
  description:
    'Find new flats and residential projects in Pune, Mumbai & more by locality, BHK and budget — on a live map with RERA, possession and price where published.',
  alternates: { canonical: SITE_URL },
  openGraph: {
    type: 'website',
    title: 'Mappingg.com — Every Property Project, Mapped & Verified',
    description:
      'One interactive map of every live real estate project in India and Dubai — status, verified RERA, possession dates and nearby infrastructure.',
    url: SITE_URL,
    images: [{ url: SITE.ogFallback, width: 1200, height: 630, alt: SITE.ogFallbackAlt }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Mappingg.com — Every Property Project, Mapped & Verified',
    description:
      'One interactive map of every live real estate project in India and Dubai — status, verified RERA, possession dates and nearby infrastructure.',
    images: [{ url: SITE.ogFallback, width: 1200, height: 630, alt: SITE.ogFallbackAlt }],
  },
};

export default async function HomePage() {
  const [logos, cards] = await Promise.all([trustedLogos().catch(() => []), getProjectCards()]);
  const stats = homeStats(cards);
  const posts = await mobilePosts();
  const landingHtml = LANDING_BODY
    .replace('<!--MAP_PREVIEW-->', () => mapPreviewHtml(cards, heroProjectHtml(cards)))
    .replace('<!--HERO_SKY_PINS-->', () => heroSkylinePinsHtml(cards))
    .replace('<!--STATS_STRIP-->', () => statsStripHtml(stats, cards))
    .replace('<!--STATS_BAND-->', () => statsBandHtml(stats))
    .replace('<!--BUYER_JOURNEY-->', () => buyersSectionHtml(cards, stats))
    // "Trusted by developers" logo row (nothing is shown until a few developers have logos).
    .replace('<!--DEV_LOGOS-->', () => trustedDevelopersHtml(logos))
    // Phone-only sections around the existing ones (hidden above 720 px).
    .replace('<!--M_TRUST-->', () => mobileTrustHtml(cards))
    .replace('<!--M_CATS-->', () => mobileCatsHtml(cards))
    .replace('<!--M_DISCOVER-->', () => mobileDiscoverHtml())
    .replace('<!--M_INSIGHTS-->', () => mobileInsightsHtml(posts, stats));
  // "Projects near you" (React) sits between the hero (search + live map + stats) and the rest.
  const [heroHtml, restHtml = ''] = landingHtml.split('<!--SPLIT-->');

  return (
    <>
      {/* Icon font, loaded without blocking the first paint (shared with every page). */}
      <IconFont />
      {/* Organization + WebSite JSON-LD come from the root layout (one source, no conflicting @ids). */}

      {/* One shared header across the whole site. */}
      <SiteHeader />

      {/* Full landing markup is server-rendered (great for SEO); all behaviour is
          wired up client-side by LandingClient + /landing.js. */}
      <div className="mpg" dangerouslySetInnerHTML={{ __html: heroHtml }} />
      {/* Projects near you (+ the "Enquire now" popup). */}
      <HomeFinder cards={cards} />
      {restHtml && <div className="mpg" dangerouslySetInnerHTML={{ __html: restHtml }} />}
      <LandingClient />
    </>
  );
}

/** Blog posts for the phone-only "Key insights" section. The read is cached
 *  (lib/data-cache.ts); a failure just leaves the section out. */
async function mobilePosts(): Promise<MobilePost[]> {
  const published = await listPublished().catch(() => []);
  return published.slice(0, 6).map((p) => ({
    href: `/blog/${p.slug}`,
    title: p.title,
    tag: (p.tags || [])[0] || '',
    minutes: readingTime(p.content),
    // Only linkable images (an inline data: URL would bloat the page).
    image: p.cover_image && /^(\/|https:\/\/)/.test(p.cover_image) ? p.cover_image : '',
  }));
}
