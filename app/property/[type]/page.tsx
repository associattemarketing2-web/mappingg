import type { Metadata } from 'next';
import { paginate, type PageParam } from '@/lib/seo/paginate';
import { notFound } from 'next/navigation';
import { pagedMetadata, typeMeta } from '@/lib/seo/listing-meta';
import EntityListing from '@/components/seo/EntityListing';
import { getTypeGroups, getLocalityGroups, findGroup, citiesPhrase } from '@/lib/seo/entities';

export const revalidate = 3600;
// Property types come from the live project data, so new ones appear between deploys.
// Known ones are prerendered; a new one renders on first request (ISR). Unknown
// slugs get a real 404 from this route's layout.tsx (generateMetadata), which
// runs before streaming starts. (dynamicParams = false
// used to 404 any page added after the last build, e.g. /locations/wanowri.)
export const dynamicParams = true;
export async function generateStaticParams() {
  return (await getTypeGroups()).map((g) => ({ type: g.slug }));
}

type Props = { params: { type: string }; searchParams?: { page?: PageParam } };

// Page 2+ (?page=N) gets its own title and self-canonical; page 1 uses the layout's.
export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const g = await findGroup(getTypeGroups, params.type);
  const pg = g && paginate(g.pins, searchParams?.page);
  return g && pg ? pagedMetadata(typeMeta(g), pg.page, pg.pages) : {};
}

export default async function PropertyTypePage({ params, searchParams }: Props) {
  const g = await findGroup(getTypeGroups, params.type);
  if (!g) notFound();
  const pg = paginate(g.pins, searchParams?.page);
  if (!pg) notFound();

  const [types, locs] = await Promise.all([getTypeGroups(), getLocalityGroups()]);
  const related = [
    ...types.filter((t) => t.slug !== g.slug).map((t) => ({ label: t.label, path: `/property/${t.slug}`, count: t.count })),
    ...locs.slice(0, 8).map((l) => ({ label: l.label, path: `/locations/${l.slug}`, count: l.count })),
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
