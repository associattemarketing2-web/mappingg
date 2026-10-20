import Link from 'next/link';
import SeoShell from '@/components/seo/SeoShell';
import { getCityGroups } from '@/lib/seo/entities';
import { itemListSchema, jsonLd } from '@/lib/seo/schema';

export const revalidate = 3600;

export default async function CitiesIndex() {
  const groups = await getCityGroups();
  return (
    <SeoShell crumbs={[{ name: 'Home', path: '/' }, { name: 'Cities', path: '/cities' }]}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLd(itemListSchema(groups.map((g) => ({ name: g.label, path: `/cities/${g.slug}` })))),
        }}
      />
      <header className="seo-hero">
        <div className="eyebrow">Cities</div>
        <h1>Real Estate Projects by City</h1>
        <p className="lede">Pick a city to explore its localities, developers and projects.</p>
      </header>
      <section className="seo-section">
        <div className="seo-prose">
          <p>
            Mappingg maps {groups.reduce((n, g) => n + g.count, 0)} projects across {groups.length} cities
            {groups.length ? ` — ${groups.map((g) => `${g.label} (${g.count})`).join(', ')}` : ''}. Each city page
            lists every project we track there, grouped by locality and construction status, with links to the
            developers building in that city. Every project is also a pin on the live map, so you can see exactly
            where it sits and what roads, metro lines and other infrastructure are planned nearby.
          </p>
        </div>
      </section>
      <section className="seo-section">
        <div className="seo-grid">
          {groups.map((g) => (
            <Link key={g.slug} href={`/cities/${g.slug}`} className="seo-card">
              <h3 className="title">{g.label}</h3>
              <p className="meta">{g.count} project{g.count === 1 ? '' : 's'}</p>
            </Link>
          ))}
        </div>
      </section>
    </SeoShell>
  );
}
