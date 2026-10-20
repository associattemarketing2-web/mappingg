import type { Metadata } from 'next';
import './landing.css';
import { LANDING_BODY } from '@/components/landing/body';
import LandingClient from '@/components/landing/LandingClient';
import SiteHeader from '@/components/SiteHeader';
import IconFont from '@/components/IconFont';
import { getGlobeData } from '@/lib/globe-data';
import { getFeaturedProject } from '@/lib/featured-project';
import { featuredCardHtml } from '@/components/landing/featured-card';
import { trustedLogos } from '@/lib/developers';
import { trustedDevelopersHtml } from '@/components/landing/trusted-developers';

import { SITE, SITE_URL } from '@/lib/seo/config';

// ISR: served static & fast, but re-renders periodically so admin-set SEO values
// (Search Console verification, GTM) from the shared layout show up without a redeploy.
export const revalidate = 3600;

export const metadata: Metadata = {
  // Absolute: the brand is already in the title, so skip the layout's ' — Mappingg' suffix.
  title: { absolute: 'Mappingg.com — Every Property Project, Mapped & Verified | India & Dubai' },
  // ~155 chars so Google shows it whole; meta keywords dropped (search engines ignore them).
  description:
    'Every live real estate project on one interactive map — status, RERA numbers, possession dates and infrastructure. Pune, Mumbai, Bengaluru, Delhi NCR & Dubai.',
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
  const [globe, featured, logos] = await Promise.all([getGlobeData(), getFeaturedProject(), trustedLogos().catch(() => [])]);
  // Swap the sample card for a real project with a video (keeps the sample if none).
  const landingHtml = (featured
    ? LANDING_BODY.replace(/<!--PV_CARD-->[\s\S]*?<!--\/PV_CARD-->/, () => featuredCardHtml(featured))
    : LANDING_BODY
  // "Trusted by developers" logo row (nothing is shown until a few developers have logos).
  ).replace('<!--DEV_LOGOS-->', () => trustedDevelopersHtml(logos));

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
      <div className="mpg" dangerouslySetInnerHTML={{ __html: landingHtml }} />
      <LandingClient />
    </>
  );
}
