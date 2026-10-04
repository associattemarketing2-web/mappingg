import type { Metadata } from 'next';
import Link from 'next/link';
import SeoShell from '@/components/seo/SeoShell';
import { getTypeGroups } from '@/lib/seo/entities';
import { buildMetadata } from '@/lib/seo/metadata';
import { itemListSchema, jsonLd } from '@/lib/seo/schema';

export const revalidate = 600;

export const metadata: Metadata = buildMetadata({
  title: 'Property Types in Pune & MMR',
  description:
    'Explore real estate by property type across Pune and the Mumbai Metropolitan Region — residential, commercial and more, with projects, locations and status on Mappingg.',
  path: '/property',
});

export default async function PropertyIndex() {
  const groups = await getTypeGroups();
  return (
    <SeoShell crumbs={[{ name: 'Home', path: '/' }, { name: 'Property types', path: '/property' }]}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLd(itemListSchema(groups.map((g) => ({ name: g.label, path: `/property/${g.slug}` })))),
        }}
      />
      <header className="seo-hero">
        <div className="eyebrow">Property types</div>
        <h1>Explore by Property Type</h1>
        <p className="lede">Browse projects by the kind of property — pick a type to see every matching project.</p>
      </header>
      <section className="seo-section">
        <div className="seo-grid">
          {groups.map((g) => (
            <Link key={g.slug} href={`/property/${g.slug}`} className="seo-card">
              <h3 className="title">{g.label}</h3>
              <p className="meta">{g.count} project{g.count === 1 ? '' : 's'}</p>
            </Link>
          ))}
        </div>
      </section>
    </SeoShell>
  );
}
