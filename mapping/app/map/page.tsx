import type { Metadata } from 'next';
import LegacyApp from '@/components/LegacyApp';
import LegacyPreloads from '@/components/LegacyPreloads';
import MapAuthGate from '@/components/MapAuthGate';
import { getSeoProjects, statusLabel, AREAS_PUNE, AREAS_MMR } from '@/lib/seo-data';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://mappingg.com';

// Regenerate the crawlable content periodically (ISR) — fast to serve, fresh
// enough for search engines, and cheap on the database.
export const revalidate = 600;

export const metadata: Metadata = {
  title: 'Live Real Estate Map — Projects in Pune & MMR',
  description:
    'Explore a live, interactive map of real estate projects across Pune (Mundhwa, Kharadi, Magarpatta, Hadapsar, Viman Nagar, Wagholi, Kothrud) and the Mumbai region (Andheri, Khar, Vashi, Nerul, Kharghar, Thane, Dombivli, Palava). Colour-coded by status with developer, pricing, configuration, carpet area, possession and infrastructure details.',
  keywords: [
    'real estate map', 'property map Pune', 'projects in Mundhwa', 'Kharadi projects',
    'Magarpatta property', 'Hadapsar flats', 'MMR real estate', 'new launches Pune',
    'under construction projects', 'ready to move flats', 'Mappingg', 'Associatte Proptech',
  ],
  alternates: { canonical: `${SITE_URL}/map` },
  openGraph: {
    title: 'Mappingg Live Map — Real Estate Projects, Pune & MMR',
    description: 'Explore live projects, upcoming launches and infrastructure across Pune and the Mumbai region.',
    url: `${SITE_URL}/map`,
    images: ['/img/mappingg-icon-mark.png'],
  },
};

export default async function MapPage() {
  const projects = await getSeoProjects();

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
      },
      {
        '@type': 'RealEstateAgent',
        '@id': `${SITE_URL}/#organization`,
        name: 'Associatte Proptech Pvt Ltd',
        url: 'https://associatte.co.in/',
        areaServed: [...AREAS_PUNE, ...AREAS_MMR].map((a) => ({ '@type': 'Place', name: a })),
        knowsAbout: ['Real estate', 'Property investment', 'Home buying'],
      },
      {
        '@type': 'ItemList',
        name: 'Mapped real estate projects',
        numberOfItems: projects.length,
        itemListElement: projects.slice(0, 200).map((p, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          name: p.title || `Project #${p.number ?? ''}`.trim(),
          url: `${SITE_URL}/map?pin=${encodeURIComponent(p.id)}`,
        })),
      },
    ],
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      {/* Crawlable content for search engines. Visually hidden so the map UI is
          unchanged, but fully indexable — gives Google real text about every
          project and area, which is what drives organic discovery. */}
      <div className="sr-only">
        <h1>Mappingg — Live interactive real estate project map for Pune and the Mumbai Metropolitan Region</h1>
        <p>
          Browse {projects.length} live real estate projects on an interactive map, colour-coded by
          status (available, under construction, upcoming, sold), with developer, configuration,
          carpet area, price, possession timeline and nearby infrastructure such as metro stations,
          bridges, schools and hospitals.
        </p>
        <h2>Areas covered in Pune</h2>
        <p>{AREAS_PUNE.join(', ')}.</p>
        <h2>Areas covered in the Mumbai region</h2>
        <p>{AREAS_MMR.join(', ')}.</p>

        {projects.length > 0 && (
          <nav aria-label="All mapped projects">
            <h2>Projects on the map</h2>
            <ul>
              {projects.map((p) => (
                <li key={p.id}>
                  <a href={`/map?pin=${encodeURIComponent(p.id)}`}>
                    {p.title || `Project #${p.number ?? ''}`}
                    {p.location ? ` — ${p.location}` : ''}
                    {p.status ? ` (${statusLabel(p.status)})` : ''}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </div>

      <LegacyPreloads slug="public-map" />
      <LegacyApp slug="public-map" />
      {/* Guests get a short peek, then a sign-in prompt. Server HTML above stays
          crawlable so the map page keeps its SEO. */}
      <MapAuthGate />
    </>
  );
}
