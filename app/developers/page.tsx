import Link from 'next/link';
import SeoShell from '@/components/seo/SeoShell';
import { getDeveloperGroups } from '@/lib/seo/entities';
import { itemListSchema, jsonLd } from '@/lib/seo/schema';

export const revalidate = 600;

export default async function DevelopersIndex() {
  const groups = await getDeveloperGroups();
  return (
    <SeoShell crumbs={[{ name: 'Home', path: '/' }, { name: 'Developers', path: '/developers' }]}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLd(itemListSchema(groups.map((g) => ({ name: g.label, path: `/developers/${g.slug}` })))),
        }}
      />
      <header className="seo-hero">
        <div className="eyebrow">Developers</div>
        <h1>Real Estate Developers in Pune &amp; MMR</h1>
        <p className="lede">
          The developers behind the projects we map. Each developer page lists their projects, the localities they are
          active in and the current status of each development.
        </p>
        <div className="stats">
          <div><b>{groups.length}</b><span>Developers</span></div>
        </div>
      </header>
      <section className="seo-section">
        <div className="seo-grid">
          {groups.map((g) => (
            <Link key={g.slug} href={`/developers/${g.slug}`} className="seo-card">
              <h3 className="title">{g.label}</h3>
              <p className="meta">{g.count} project{g.count === 1 ? '' : 's'}</p>
            </Link>
          ))}
        </div>
      </section>
    </SeoShell>
  );
}
