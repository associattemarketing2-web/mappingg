import LegacyApp from '@/components/LegacyApp';
import LegacyPreloads from '@/components/LegacyPreloads';
import MapAuthGate from '@/components/MapAuthGate';
import { getSeoProjects, statusLabel, AREAS_PUNE, AREAS_MMR } from '@/lib/seo-data';
import { slugForProject } from '@/lib/seo/entities';

import { SITE_URL } from '@/lib/seo/config';

// Regenerate the crawlable content periodically (ISR) — fast to serve, fresh
// enough for search engines, and cheap on the database.
export const revalidate = 600;

export default async function MapPage() {
  const projects = await getSeoProjects();

  const projectPath = (p: (typeof projects)[number]) => `/projects/${slugForProject({ ...p, number: p.number ?? 0 })}`;
  // Organization + WebSite come from the root layout; this page adds the project list.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Mapped real estate projects',
    numberOfItems: projects.length,
    itemListElement: projects.slice(0, 200).map((p, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: p.title || `Project #${p.number ?? ''}`.trim(),
      url: `${SITE_URL}${projectPath(p)}`,
    })),
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
                  <a href={projectPath(p)}>
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
