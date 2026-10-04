import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import EntityListing from '@/components/seo/EntityListing';
import { getTypeGroups, getLocalityGroups, findGroup } from '@/lib/seo/entities';
import { buildMetadata } from '@/lib/seo/metadata';

export const revalidate = 600;
// Closed vocabulary of property types → prerender + hard-404 on unknown slugs.
export const dynamicParams = false;
export async function generateStaticParams() {
  return (await getTypeGroups()).map((g) => ({ type: g.slug }));
}

export async function generateMetadata({ params }: { params: { type: string } }): Promise<Metadata> {
  const g = await findGroup(getTypeGroups, params.type);
  if (!g) return { title: 'Not found', robots: { index: false, follow: false } };
  return buildMetadata({
    title: `${g.label} Projects in Pune & MMR`,
    description: `Explore ${g.count} ${g.label.toLowerCase()} project${g.count === 1 ? '' : 's'} across Pune and the Mumbai Metropolitan Region — locations, developers, pricing and status on Mappingg.`,
    path: `/property/${g.slug}`,
    keywords: [`${g.label.toLowerCase()} projects Pune`, `${g.label.toLowerCase()} property MMR`],
  });
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
