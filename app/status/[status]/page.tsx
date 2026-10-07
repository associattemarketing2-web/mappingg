import { notFound } from 'next/navigation';
import EntityListing from '@/components/seo/EntityListing';
import { getStatusGroups, getLocalityGroups, findGroup, STATUS_ROUTES } from '@/lib/seo/entities';

export const revalidate = 600;
// Closed set (3 indexed statuses) → prerender + hard-404 on unknown slugs.
export const dynamicParams = false;
export async function generateStaticParams() {
  return STATUS_ROUTES.map((s) => ({ status: s.slug }));
}

export default async function StatusPage({ params }: { params: { status: string } }) {
  const g = await findGroup(getStatusGroups, params.status);
  if (!g) notFound();

  const locs = await getLocalityGroups();
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
      title={`${g.label} Projects in Pune & MMR`}
      lede={`${g.label} real estate projects across Pune and the Mumbai Metropolitan Region, with developer, locality, configuration and pricing details.`}
      stats={[{ b: g.count, span: `${g.label} projects` }]}
      pins={g.pins}
      projectsHeading={`${g.label} projects (${g.count})`}
      relatedTitle="Other statuses & localities"
      related={related}
      faqs={[
        {
          q: `How many ${g.label.toLowerCase()} projects are listed?`,
          a: `Mappingg currently maps ${g.count} ${g.label.toLowerCase()} project${g.count === 1 ? '' : 's'} across Pune and the Mumbai Metropolitan Region.`,
        },
      ]}
    />
  );
}
