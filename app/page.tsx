import type { Metadata } from 'next';
import './landing.css';
import { LANDING_BODY } from '@/components/landing/body';
import LandingClient from '@/components/landing/LandingClient';
import SiteHeader from '@/components/SiteHeader';
import IconFont from '@/components/IconFont';
import { getGlobeData } from '@/lib/globe-data';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://mappingg.com';

// ISR: served static & fast, but re-renders periodically so admin-set SEO values
// (Search Console verification, GTM) from the shared layout show up without a redeploy.
export const revalidate = 600;

export const metadata: Metadata = {
  title: 'Mappingg.com — Every Property Project, Mapped & Verified | Pune',
  description:
    'Mappingg puts every live real estate project on one interactive map — with project status, MahaRERA-verified RERA numbers, possession dates, upcoming infrastructure and nearby places. Explore live Pune projects at no cost.',
  keywords: [
    'real estate map Pune', 'property projects Pune', 'MahaRERA verified projects', 'new launches Pune',
    'flats in Mundhwa', 'Kharadi projects', 'Magarpatta property', 'Hadapsar flats', 'ready to move Pune',
    'under construction projects Pune', 'plotted projects Pune', 'Mappingg', 'Associatte',
  ],
  alternates: { canonical: SITE_URL },
  openGraph: {
    type: 'website',
    title: 'Mappingg.com — Every Property Project, Mapped & Verified',
    description:
      'One interactive map of every live real estate project in Pune — status, MahaRERA-verified RERA, possession dates and nearby infrastructure.',
    url: SITE_URL,
    images: ['/img/mappingg-icon-mark.png'],
  },
};

export default async function HomePage() {
  const globe = await getGlobeData();

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': `${SITE_URL}/#website`,
        name: 'Mappingg',
        url: SITE_URL,
        description:
          'Live, interactive map of real estate projects in Pune and the Mumbai Metropolitan Region.',
        potentialAction: {
          '@type': 'SearchAction',
          target: `${SITE_URL}/map?pin={search_term_string}`,
          'query-input': 'required name=search_term_string',
        },
      },
      {
        '@type': 'RealEstateAgent',
        '@id': `${SITE_URL}/#organization`,
        name: 'Associatte Proptech Pvt Ltd',
        url: SITE_URL,
        areaServed: { '@type': 'Place', name: 'Pune, Maharashtra, India' },
        knowsAbout: ['Real estate', 'Property investment', 'Home buying', 'MahaRERA'],
      },
    ],
  };

  return (
    <>
      {/* Icon font, loaded without blocking the first paint (shared with every page). */}
      <IconFont />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

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
      <div className="mpg" dangerouslySetInnerHTML={{ __html: LANDING_BODY }} />
      <LandingClient />
    </>
  );
}
