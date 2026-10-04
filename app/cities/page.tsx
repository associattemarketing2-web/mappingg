import type { Metadata } from 'next';
import Link from 'next/link';
import SeoShell from '@/components/seo/SeoShell';
import { getCityGroups } from '@/lib/seo/entities';
import { buildMetadata } from '@/lib/seo/metadata';
import { itemListSchema, jsonLd } from '@/lib/seo/schema';

export const revalidate = 600;

export const metadata: Metadata = buildMetadata({
  title: 'Real Estate by City — Pune & Mumbai (MMR)',
  description:
    'Explore real estate projects city by city. Choose Pune or the Mumbai Metropolitan Region to drill into localities, developers and projects on Mappingg.',
  path: '/cities',
});

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
        <h1>Real Estate by City</h1>
        <p className="lede">Pick a city to explore its localities, developers and projects.</p>
      </header>
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
