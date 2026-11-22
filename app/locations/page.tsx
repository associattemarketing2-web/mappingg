import Link from 'next/link';
import SeoShell from '@/components/seo/SeoShell';
import { getLocalityGroups, getPublicPins, cityOf, citiesPhrase, CITY_LABELS, type CityKey } from '@/lib/seo/entities';
import { itemListSchema, jsonLd } from '@/lib/seo/schema';
import { localityIndexing } from '@/lib/seo/indexing';

// Locality directory (restored 22 Nov 2026). Lists only the locality hubs that
// are indexable (≥3 projects or a written area guide, lib/seo/indexing.ts), so
// every link here leads to a page worth crawling.
export const revalidate = 3600;
export const dynamic = 'force-static';

export default async function LocationsIndex() {
  const [all, pins] = await Promise.all([getLocalityGroups(), getPublicPins()]);
  const groups = all.filter((g) => localityIndexing(g.slug, g.count).index);
  const byCity = new Map<CityKey, typeof groups>();
  for (const g of groups) {
    const key = g.pins[0] ? cityOf(g.pins[0]) : 'pune';
    byCity.set(key, [...(byCity.get(key) || []), g]);
  }
  // Cities with the most listed localities first.
  const cities = [...byCity.entries()].sort((a, b) => b[1].length - a[1].length);

  return (
    <SeoShell crumbs={[{ name: 'Home', path: '/' }, { name: 'Localities', path: '/locations' }]}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLd(itemListSchema(groups.map((g) => ({ name: g.label, path: `/locations/${g.slug}` })))),
        }}
      />
      <header className="seo-hero">
        <div className="eyebrow">Localities</div>
        <h1>Flats &amp; New Projects by Locality</h1>
        <p className="lede">
          Browse projects area by area in {citiesPhrase(pins, 5)}. Each locality page gathers the projects we map there,
          their developers, prices, possession dates and status — so you can compare a whole micro-market at a glance.
        </p>
        <div className="stats">
          <div><b>{groups.length}</b><span>Localities</span></div>
          <div><b>{pins.length}</b><span>Projects</span></div>
        </div>
      </header>

      {cities.map(([city, list]) => (
        <section className="seo-section" key={city}>
          <h2>{CITY_LABELS[city]}</h2>
          <div className="seo-grid">
            {list.map((g) => (
              <Link key={g.slug} href={`/locations/${g.slug}`} className="seo-card">
                <h3 className="title">{g.label}</h3>
                <p className="meta">{g.count} project{g.count === 1 ? '' : 's'}</p>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </SeoShell>
  );
}
