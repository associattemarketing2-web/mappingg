import LegacyApp from '@/components/LegacyApp';
import LegacyPreloads from '@/components/LegacyPreloads';
import MapAuthGate from '@/components/MapAuthGate';
import { getPublicPins, citiesPhrase } from '@/lib/seo/entities';

// Regenerate the text below periodically (ISR) — fast to serve and cheap on the database.
export const revalidate = 3600;

export default async function MapPage() {
  // The map loads its own data in the browser, so a failed read here must never
  // take the page down — the description just drops its numbers.
  const pins = await getPublicPins().catch(() => []);

  return (
    <>
      {/* A heading and short description for screen-reader users (the map itself is
          visual). This used to also hold every project and long area lists for
          crawlers only; /projects and the city and locality pages show those
          visibly, and the site menu links to them. */}
      <div className="sr-only">
        <h1>Live real estate project map</h1>
        <p>
          An interactive map of {pins.length ? `${pins.length} real estate projects in ${citiesPhrase(pins, 5)}` : 'real estate projects'}, colour-coded by status,
          with each project&apos;s developer, configuration, price, RERA number and possession date where listed.
          The same projects are listed on the All projects page.
        </p>
      </div>

      <LegacyPreloads slug="public-map" />
      <LegacyApp slug="public-map" />
      {/* Guests get a short peek, then a sign-in prompt. */}
      <MapAuthGate />
    </>
  );
}
