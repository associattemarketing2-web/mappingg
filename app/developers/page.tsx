import Link from 'next/link';
import SeoShell from '@/components/seo/SeoShell';
import { getDeveloperGroups, getPublicPins, citiesPhrase } from '@/lib/seo/entities';
import { itemListSchema, jsonLd } from '@/lib/seo/schema';
import { developerIndexing } from '@/lib/seo/indexing';

// Developer directory (restored 22 Nov 2026). Only developers with enough mapped
// projects to have an indexable page (≥3, lib/seo/indexing.ts) are listed — one
// page, no ?page= parameter, so it is cached like any static page. Developers with
// 1–2 projects are still named on those projects' own pages.
export const revalidate = 3600;
export const dynamic = 'force-static';

export default async function DevelopersIndex() {
  const [all, pins] = await Promise.all([getDeveloperGroups(), getPublicPins()]);
  const groups = all.filter((g) => developerIndexing(g.count).index);
  const where = citiesPhrase(pins, 3);
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
        <h1>Real Estate Developers in {where}</h1>
        <p className="lede">
          The developers behind the projects we map. Each developer page lists their projects, the localities they are
          active in and the current status of each development.
        </p>
        <div className="stats">
          <div><b>{groups.length}</b><span>Developers with 3+ projects</span></div>
          <div><b>{all.length}</b><span>Developers mapped</span></div>
        </div>
      </header>
      <section className="seo-section">
        <h2>Developers, most projects first</h2>
        <div className="seo-grid">
          {groups.map((g) => (
            <Link key={g.slug} href={`/developers/${g.slug}`} className="seo-card">
              <h3 className="title">{g.label}</h3>
              <p className="meta">{g.count} projects</p>
            </Link>
          ))}
        </div>
      </section>
    </SeoShell>
  );
}
