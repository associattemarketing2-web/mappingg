import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import EntityListing from '@/components/seo/EntityListing';
import { paginate, type PageParam } from '@/lib/seo/paginate';
import { pagedMetadata, typeMeta } from '@/lib/seo/listing-meta';
import { getTypeGroups, findGroup, citiesPhrase } from '@/lib/seo/entities';

// /property/<type> list, shared by page 1 (../page.tsx) and pages 2+
// (./p/[page]/page.tsx — public URL /property/<type>?page=N via a rewrite).
// Neither route reads searchParams, so both are cached instead of server-rendered per visit.

export async function propertyTypePageMetadata(type: string, page: PageParam): Promise<Metadata> {
  const g = await findGroup(getTypeGroups, type);
  const pg = g && paginate(g.pins, page);
  return g && pg ? pagedMetadata(typeMeta(g), pg.page, pg.pages) : {};
}

export default async function PropertyTypeListing({ type, page }: { type: string; page: PageParam }) {
  const g = await findGroup(getTypeGroups, type);
  if (!g) notFound();
  const pg = paginate(g.pins, page);
  if (!pg) notFound();

  const types = await getTypeGroups();
  const related = [
    ...types.filter((t) => t.slug !== g.slug).map((t) => ({ label: t.label, path: `/property/${t.slug}`, count: t.count })),
  ];

  return (
    <EntityListing
      crumbs={[
        { name: 'Home', path: '/' },
        { name: 'Property types', path: '/property' },
        { name: g.label, path: `/property/${g.slug}` },
      ]}
      eyebrow="Property type"
      title={`${g.label} Projects in ${citiesPhrase(g.pins)}`}
      lede={`${g.label} real estate projects in ${citiesPhrase(g.pins)}, with developer, locality, configuration and pricing details.`}
      stats={[{ b: g.count, span: `${g.label} projects` }]}
      pins={pg.items}
      pagination={{ ...pg, base: `/property/${g.slug}` }}
      projectsHeading={`${g.label} projects (${g.count})`}
      relatedTitle="Other types & localities"
      related={related}
      faqs={[
        {
          q: `How many ${g.label.toLowerCase()} projects are listed?`,
          a: `Mappingg currently maps ${g.count} ${g.label.toLowerCase()} project${g.count === 1 ? '' : 's'} in ${citiesPhrase(g.pins, 5)}.`,
        },
      ]}
    />
  );
}
