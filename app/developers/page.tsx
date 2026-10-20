import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import SeoShell from '@/components/seo/SeoShell';
import Pager from '@/components/seo/Pager';
import { getDeveloperGroups, getPublicPins, citiesPhrase } from '@/lib/seo/entities';
import { itemListSchema, jsonLd } from '@/lib/seo/schema';
import { paginate, type PageParam } from '@/lib/seo/paginate';
import { pagedMetadata } from '@/lib/seo/listing-meta';

export const revalidate = 3600;

// 570+ developers: 96 per page (?page=N) instead of one ~450 KB page.
const PER_PAGE = 96;

type Props = { searchParams?: { page?: PageParam } };

const metaBase = (where: string) => ({
  title: `Real Estate Developers in ${where}`,
  description: `Browse real estate developers building in ${where}, and explore each builder's projects, locations, RERA numbers and current status on Mappingg.`,
  path: '/developers',
});

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const [groups, pins] = await Promise.all([getDeveloperGroups(), getPublicPins()]);
  const pg = paginate(groups, searchParams?.page, PER_PAGE);
  return pg ? pagedMetadata(metaBase(citiesPhrase(pins, 3)), pg.page, pg.pages) : {};
}

export default async function DevelopersIndex({ searchParams }: Props) {
  const [groups, pins] = await Promise.all([getDeveloperGroups(), getPublicPins()]);
  const pg = paginate(groups, searchParams?.page, PER_PAGE);
  if (!pg) notFound();
  return (
    <SeoShell crumbs={[{ name: 'Home', path: '/' }, { name: 'Developers', path: '/developers' }]}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLd(itemListSchema(pg.items.map((g) => ({ name: g.label, path: `/developers/${g.slug}` })))),
        }}
      />
      <header className="seo-hero">
        <div className="eyebrow">Developers</div>
        <h1>Real Estate Developers in {citiesPhrase(pins, 3)}</h1>
        <p className="lede">
          The developers behind the projects we map. Each developer page lists their projects, the localities they are
          active in and the current status of each development.
        </p>
        <div className="stats">
          <div><b>{groups.length}</b><span>Developers</span></div>
        </div>
      </header>
      <section className="seo-section">
        <h2>All developers, most projects first</h2>
        {pg.pages > 1 && (
          <p className="seo-range">
            Showing {pg.from}–{pg.from + pg.items.length - 1} of {pg.total} · page {pg.page} of {pg.pages}
          </p>
        )}
        <div className="seo-grid">
          {pg.items.map((g) => (
            <Link key={g.slug} href={`/developers/${g.slug}`} className="seo-card">
              <h3 className="title">{g.label}</h3>
              <p className="meta">{g.count} project{g.count === 1 ? '' : 's'}</p>
            </Link>
          ))}
        </div>
        <Pager base="/developers" page={pg.page} pages={pg.pages} label="Developer list pages" />
      </section>
    </SeoShell>
  );
}
