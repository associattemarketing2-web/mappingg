import { notFound } from 'next/navigation';
import EntityListing from '@/components/seo/EntityListing';
import { getTypeGroups, getLocalityGroups, findGroup } from '@/lib/seo/entities';

export const revalidate = 600;
// Closed vocabulary of property types → prerender + hard-404 on unknown slugs.
export const dynamicParams = false;
export async function generateStaticParams() {
  return (await getTypeGroups()).map((g) => ({ type: g.slug }));
}

export default async function PropertyTypePage({ params }: { params: { type: string } }) {
  const g = await findGroup(getTypeGroups, params.type);
  if (!g) notFound();

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
      title={`${g.label} Projects in Pune & MMR`}
      lede={`${g.label} real estate projects across Pune and the Mumbai Metropolitan Region, with developer, locality, configuration and pricing details.`}
      stats={[{ b: g.count, span: `${g.label} projects` }]}
      pins={g.pins}
      projectsHeading={`${g.label} projects (${g.count})`}
      relatedTitle="Other types & localities"
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
