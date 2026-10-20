import Link from 'next/link';
import LegacyApp from '@/components/LegacyApp';
import LegacyPreloads from '@/components/LegacyPreloads';
import MapAuthGate from '@/components/MapAuthGate';
import { getPublicPins, getCityGroups, citiesPhrase } from '@/lib/seo/entities';

// Regenerate the text below periodically (ISR) — fast to serve and cheap on the database.
export const revalidate = 3600;

export default async function MapPage() {
  // The map loads its own data in the browser, so a failed read here must never
  // take the page down — the description just drops its numbers.
  const [pins, cities] = await Promise.all([getPublicPins(), getCityGroups()]).catch(() => [[], []] as [Awaited<ReturnType<typeof getPublicPins>>, Awaited<ReturnType<typeof getCityGroups>>]);

  return (
    <>
      {/* A heading and short description for screen-reader users — the map itself
          is visual — plus links to the same projects as accessible lists. This
          used to also hold every project and long area lists for crawlers only;
          /projects and the city and locality pages now show those visibly. */}
      <div className="sr-only">
        <h1>Live real estate project map</h1>
        <p>
          An interactive map of {pins.length ? `${pins.length} real estate projects in ${citiesPhrase(pins, 5)}` : 'real estate projects'}, colour-coded by status,
          with each project&apos;s developer, configuration, price, RERA number and possession date where listed.
        </p>
        <nav aria-label="Projects as a list">
          <ul>
            <li><Link href="/projects">Browse all projects as a list</Link></li>
            {cities.map((c) => (
              <li key={c.slug}><Link href={`/cities/${c.slug}`}>Projects in {c.label}</Link></li>
            ))}
          </ul>
        </nav>
      </div>

      <LegacyPreloads slug="public-map" />
      <LegacyApp slug="public-map" />
      {/* Guests get a short peek, then a sign-in prompt. */}
      <MapAuthGate />
    </>
  );
}
