import Link from 'next/link';
import SeoShell from '@/components/seo/SeoShell';
import { getLocalityGroups, cityOf, CITY_LABELS, hasCityHub, type CityKey } from '@/lib/seo/entities';
import { itemListSchema, jsonLd } from '@/lib/seo/schema';

export const revalidate = 600;

export default async function LocationsIndex() {
  const groups = await getLocalityGroups();
  // Split localities into their city for a clear Pune / Mumbai hierarchy.
  const byCity: Record<string, typeof groups> = { pune: [], mumbai: [] };
  for (const g of groups) {
    const key = g.pins[0] ? cityOf(g.pins[0]) : 'pune';
    (byCity[key] ||= []).push(g);
  }

  return (
    <SeoShell crumbs={[{ name: 'Home', path: '/' }, { name: 'Locations', path: '/locations' }]}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLd(itemListSchema(groups.map((g) => ({ name: g.label, path: `/locations/${g.slug}` })))),
        }}
      />
      <header className="seo-hero">
        <div className="eyebrow">Localities</div>
        <h1>Real Estate by Locality in Pune &amp; MMR</h1>
        <p className="lede">
          Browse projects area by area. Each locality page gathers the projects we map there, their developers, status
          and property types — so you can compare an entire micro-market at a glance.
        </p>
        <div className="stats">
          <div><b>{groups.length}</b><span>Localities</span></div>
        </div>
      </header>

      {(Object.keys(CITY_LABELS) as CityKey[]).map((city) =>
        byCity[city] && byCity[city].length ? (
          <section className="seo-section" key={city}>
            <h2>
              {hasCityHub(city) ? <Link href={`/cities/${city}`}>{CITY_LABELS[city]}</Link> : CITY_LABELS[city]}
            </h2>
            <div className="seo-grid">
              {byCity[city].map((g) => (
                <Link key={g.slug} href={`/locations/${g.slug}`} className="seo-card">
                  <h3 className="title">{g.label}</h3>
                  <p className="meta">{g.count} project{g.count === 1 ? '' : 's'}</p>
                </Link>
              ))}
            </div>
          </section>
        ) : null,
      )}
    </SeoShell>
  );
}
