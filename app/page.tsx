import type { Metadata } from 'next';
import './landing.css';
import { LANDING_BODY } from '@/components/landing/body';
import LandingClient from '@/components/landing/LandingClient';
import SiteHeader from '@/components/SiteHeader';
import IconFont from '@/components/IconFont';
import { getGlobeData } from '@/lib/globe-data';
import { getFeaturedProject } from '@/lib/featured-project';
import { featuredCardHtml } from '@/components/landing/featured-card';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://mappingg.com';

// ISR: served static & fast, but re-renders periodically so admin-set SEO values
// (Search Console verification, GTM) from the shared layout show up without a redeploy.
export const revalidate = 600;

export const metadata: Metadata = {
  // Absolute: the brand is already in the title, so skip the layout's ' — Mappingg' suffix.
  title: { absolute: 'Mappingg.com — Every Property Project, Mapped & Verified | India & Dubai' },
  description:
    'Mappingg puts every live real estate project on one interactive map — with project status, MahaRERA-verified RERA numbers, possession dates, upcoming infrastructure and nearby places. Explore live projects in Pune, Mumbai and Dubai at no cost.',
  keywords: [
    'real estate map Pune', 'property projects Pune', 'MahaRERA verified projects', 'new launches Pune',
    'flats in Mundhwa', 'Kharadi projects', 'Magarpatta property', 'Hadapsar flats', 'ready to move Pune',
    'under construction projects Pune', 'plotted projects Pune', 'Dubai property projects', 'Dubai off-plan projects', 'Mappingg', 'Associatte',
  ],
  alternates: { canonical: SITE_URL },
  openGraph: {
    type: 'website',
    title: 'Mappingg.com — Every Property Project, Mapped & Verified',
    description:
      'One interactive map of every live real estate project in India and Dubai — status, verified RERA, possession dates and nearby infrastructure.',
    url: SITE_URL,
    images: ['/img/mappingg-icon-mark.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Mappingg.com — Every Property Project, Mapped & Verified',
    description:
      'One interactive map of every live real estate project in India and Dubai — status, verified RERA, possession dates and nearby infrastructure.',
    images: ['/img/mappingg-icon-mark.png'],
  },
};

export default async function HomePage() {
  const [globe, featured] = await Promise.all([getGlobeData(), getFeaturedProject()]);
  // Swap the sample card for a real project with a video (keeps the sample if none).
  const landingHtml = featured
    ? LANDING_BODY.replace(/<!--PV_CARD-->[\s\S]*?<!--\/PV_CARD-->/, () => featuredCardHtml(featured))
    : LANDING_BODY;

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
