import Link from 'next/link';
import SeoShell from '@/components/seo/SeoShell';
import { getStatusGroups, getTypeGroups, getPublicPins } from '@/lib/seo/entities';
import { itemListSchema, jsonLd } from '@/lib/seo/schema';
import FacetIndex from '@/components/seo/FacetIndex';

export const revalidate = 3600;

export default async function PropertyIndex() {
  const [groups, statuses, pins] = await Promise.all([getTypeGroups(), getStatusGroups(), getPublicPins()]);
  const typed = groups.reduce((n, g) => n + g.count, 0);
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
        <p className="lede">Browse projects by the kind of property, by construction status, or by BHK and budget.</p>
      </header>
      <section className="seo-section">
        <div className="seo-prose">
          <p>
            Mappingg maps {pins.length} property projects. {typed} of them have a property type on record
            {groups.length ? ` — ${groups.map((g) => `${g.label.toLowerCase()} (${g.count})`).join(', ')}` : ''}. Pick a
            type to see every matching project with its developer, locality, configuration, price where published, and
            RERA number where one is on record.
          </p>
          <p>
            Construction status matters as much as type: an under-construction flat is usually cheaper but you wait for
            possession, while a ready-to-move home can be registered and occupied straight away. Always check the
            completion date the developer declared on the state RERA website, not only the date in the brochure.
          </p>
        </div>
      </section>
      <section className="seo-section">
        <h2>All property types</h2>
        <div className="seo-grid">
          {groups.map((g) => (
            <Link key={g.slug} href={`/property/${g.slug}`} className="seo-card">
              <h3 className="title">{g.label}</h3>
              <p className="meta">{g.count} project{g.count === 1 ? '' : 's'}</p>
            </Link>
          ))}
        </div>
      </section>
      {statuses.length > 0 && (
        <section className="seo-section">
          <h2>By construction status</h2>
          <div className="seo-pills">
            {statuses.map((s) => (
              <Link key={s.slug} href={`/status/${s.slug}`}>
                {s.label}
                <b>{s.count}</b>
              </Link>
            ))}
          </div>
        </section>
      )}
      <FacetIndex />
    </SeoShell>
  );
}
