import type { Metadata } from 'next';
import './landing.css';
import './home-finder.css';
import { LANDING_BODY } from '@/components/landing/body';
import LandingClient from '@/components/landing/LandingClient';
import SiteHeader from '@/components/SiteHeader';
import IconFont from '@/components/IconFont';
import { getGlobeData } from '@/lib/globe-data';
import { getFeaturedProject } from '@/lib/featured-project';
import { featuredCardHtml } from '@/components/landing/featured-card';
import { trustedLogos } from '@/lib/developers';
import { trustedDevelopersHtml } from '@/components/landing/trusted-developers';
import HomeFinder from '@/components/landing/HomeFinder';
import { getProjectCards } from '@/lib/home/cards';
import { listPublished } from '@/lib/blog';

import { SITE, SITE_URL } from '@/lib/seo/config';

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
  const [globe, featured, logos, cards, posts] = await Promise.all([
    getGlobeData(), getFeaturedProject(), trustedLogos().catch(() => []), getProjectCards(), listPublished(),
  ]);
  // Swap the sample card for a real project with a video (keeps the sample if none).
  const landingHtml = (featured
    ? LANDING_BODY.replace(/<!--PV_CARD-->[\s\S]*?<!--\/PV_CARD-->/, () => featuredCardHtml(featured))
    : LANDING_BODY
  // "Trusted by developers" logo row (nothing is shown until a few developers have logos).
  ).replace('<!--DEV_LOGOS-->', () => trustedDevelopersHtml(logos));
  // The buyer finder (React) sits after the hero and the "Explore the live project map" section.
  const liveAt = landingHtml.indexOf('<section class="live-sec"');
  const split = liveAt > 0 ? landingHtml.indexOf('</section>', liveAt) + '</section>'.length : -1;
  const [heroHtml, restHtml] = split > 0 ? [landingHtml.slice(0, split), landingHtml.slice(split)] : [landingHtml, ''];

  return (
    <>
      {/* Icon font, loaded without blocking the first paint (shared with every page). */}
      <IconFont />
      {/* Organization + WebSite JSON-LD come from the root layout (one source, no conflicting @ids). */}

      {/* Real per-country project counts for the hero globe (read by landing.js). */}
      <script
        id="mpg-globe-data"
        type="application/json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(globe) }}
      />

      {/* One shared header across the whole site. */}
      <SiteHeader />

      {/* Full landing markup is server-rendered (great for SEO); all behaviour is
          wired up client-side by LandingClient + /landing.js. */}
      <div className="mpg" dangerouslySetInnerHTML={{ __html: heroHtml }} />
      {/* Search → projects near you → localities → featured → browse → guides → enquire. */}
      <HomeFinder cards={cards} posts={posts} />
      {restHtml && <div className="mpg" dangerouslySetInnerHTML={{ __html: restHtml }} />}
      <LandingClient />
    </>
  );
}
