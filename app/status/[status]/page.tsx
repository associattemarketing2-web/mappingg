import type { Metadata } from 'next';
import { paginate, type PageParam } from '@/lib/seo/paginate';
import { notFound } from 'next/navigation';
import { pagedMetadata, statusMeta } from '@/lib/seo/listing-meta';
import EntityListing from '@/components/seo/EntityListing';
import { getStatusGroups, getLocalityGroups, findGroup, STATUS_ROUTES, citiesPhrase } from '@/lib/seo/entities';

export const revalidate = 3600;
// Closed set (3 indexed statuses) → prerender + hard-404 on unknown slugs.
export const dynamicParams = false;
export async function generateStaticParams() {
  return STATUS_ROUTES.map((s) => ({ status: s.slug }));
}

type Props = { params: { status: string }; searchParams?: { page?: PageParam } };

// Page 2+ (?page=N) gets its own title and self-canonical; page 1 uses the layout's.
export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const g = await findGroup(getStatusGroups, params.status);
  const pg = g && paginate(g.pins, searchParams?.page);
  return g && pg ? pagedMetadata(statusMeta(g), pg.page, pg.pages) : {};
}

export default async function StatusPage({ params, searchParams }: Props) {
  const g = await findGroup(getStatusGroups, params.status);
  if (!g) notFound();
  const pg = paginate(g.pins, searchParams?.page);
  if (!pg) notFound();

  const locs = await getLocalityGroups();
  const where = citiesPhrase(g.pins);
  const related = [
    ...STATUS_ROUTES.filter((s) => s.slug !== g.slug).map((s) => ({ label: s.label, path: `/status/${s.slug}` })),
    ...locs.slice(0, 8).map((l) => ({ label: l.label, path: `/locations/${l.slug}`, count: l.count })),
  ];

  return (
    <EntityListing
      crumbs={[
        { name: 'Home', path: '/' },
        { name: 'Projects', path: '/projects' },
        { name: g.label, path: `/status/${g.slug}` },
      ]}
      eyebrow="By status"
      title={`${g.label} Projects in ${where}`}
      lede={`${g.label} real estate projects in ${where}, with developer, locality, configuration and pricing details.`}
      stats={[{ b: g.count, span: `${g.label} projects` }]}
      pins={pg.items}
      pagination={{ ...pg, base: `/status/${g.slug}` }}
      projectsHeading={`${g.label} projects (${g.count})`}
      relatedTitle="Other statuses & localities"
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
