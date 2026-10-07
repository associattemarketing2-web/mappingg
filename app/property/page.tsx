import Link from 'next/link';
import SeoShell from '@/components/seo/SeoShell';
import { getTypeGroups } from '@/lib/seo/entities';
import { itemListSchema, jsonLd } from '@/lib/seo/schema';

export const revalidate = 600;

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
