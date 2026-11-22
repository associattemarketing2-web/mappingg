import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import EntityListing from '@/components/seo/EntityListing';
import { paginate, type PageParam } from '@/lib/seo/paginate';
import { pagedMetadata, statusMeta } from '@/lib/seo/listing-meta';
import { getStatusGroups, findGroup, STATUS_ROUTES, citiesPhrase } from '@/lib/seo/entities';

// /status/<status> list, shared by page 1 (../page.tsx) and pages 2+
// (./p/[page]/page.tsx — public URL /status/<status>?page=N via a rewrite).
// Neither route reads searchParams, so both are cached instead of server-rendered per visit.

export async function statusPageMetadata(status: string, page: PageParam): Promise<Metadata> {
  const g = await findGroup(getStatusGroups, status);
  const pg = g && paginate(g.pins, page);
  return g && pg ? pagedMetadata(statusMeta(g), pg.page, pg.pages) : {};
}

export default async function StatusListing({ status, page }: { status: string; page: PageParam }) {
  const g = await findGroup(getStatusGroups, status);
  if (!g) notFound();
  const pg = paginate(g.pins, page);
  if (!pg) notFound();

  const where = citiesPhrase(g.pins);
  const related = [
    ...STATUS_ROUTES.filter((s) => s.slug !== g.slug).map((s) => ({ label: s.label, path: `/status/${s.slug}` })),
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
