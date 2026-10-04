import type { Metadata } from 'next';
import Link from 'next/link';
import SeoShell from '@/components/seo/SeoShell';
import { getLocalityGroups, cityOf, CITY_LABELS } from '@/lib/seo/entities';
import { buildMetadata } from '@/lib/seo/metadata';
import { itemListSchema, jsonLd } from '@/lib/seo/schema';

export const revalidate = 600;

export const metadata: Metadata = buildMetadata({
  title: 'Real Estate by Locality in Pune & MMR',
  description:
    'Explore real estate projects locality by locality across Pune and the Mumbai Metropolitan Region — Kharadi, Mundhwa, Magarpatta, Wagholi, Thane, Kharghar and more.',
  path: '/locations',
  keywords: ['real estate localities Pune', 'property by area Pune', 'MMR localities'],
});

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

      {(['pune', 'mumbai'] as const).map((city) =>
        byCity[city] && byCity[city].length ? (
          <section className="seo-section" key={city}>
            <h2>
              <Link href={`/cities/${city}`}>{CITY_LABELS[city]}</Link>
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
