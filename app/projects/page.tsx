import type { Metadata } from 'next';
import EntityListing from '@/components/seo/EntityListing';
import { getPublicPins, getLocalityGroups, getStatusGroups } from '@/lib/seo/entities';
import { buildMetadata } from '@/lib/seo/metadata';

export const revalidate = 600;

export const metadata: Metadata = buildMetadata({
  title: 'Real Estate Projects in Pune & MMR',
  description:
    'Browse real estate projects across Pune and the Mumbai Metropolitan Region — by locality, developer, status and property type, with configurations, pricing and possession timelines.',
  path: '/projects',
  keywords: ['real estate projects Pune', 'property projects Mumbai', 'new projects MMR'],
});

export default async function ProjectsIndex() {
  const [pins, locs, statuses] = await Promise.all([getPublicPins(), getLocalityGroups(), getStatusGroups()]);
  const related = [
    ...statuses.map((s) => ({ label: s.label, path: `/status/${s.slug}`, count: s.count })),
    ...locs.slice(0, 10).map((l) => ({ label: l.label, path: `/locations/${l.slug}`, count: l.count })),
  ];
  return (
    <EntityListing
      crumbs={[{ name: 'Home', path: '/' }, { name: 'Projects', path: '/projects' }]}
      eyebrow="All projects"
      title="Real Estate Projects in Pune & MMR"
      lede="Every project we map across Pune and the Mumbai Metropolitan Region, with developer, status, configuration and pricing details — and a live map to see exactly where each one is."
      stats={[
        { b: pins.length, span: 'Projects mapped' },
        { b: locs.length, span: 'Localities' },
      ]}
      pins={pins}
      projectsHeading={`All projects (${pins.length})`}
      relatedTitle="Browse by location & status"
      related={related}
      faqs={[
        {
          q: 'How many real estate projects are listed on Mappingg?',
          a: `Mappingg currently maps ${pins.length} projects across Pune and the Mumbai Metropolitan Region, spanning ${locs.length} localities. New projects are added regularly.`,
        },
        {
          q: 'Can I see where each project is located?',
          a: 'Yes. Every project has a pin on the live interactive map, colour-coded by status, along with a dedicated page covering its developer, configuration, pricing and possession timeline.',
        },
      ]}
    />
  );
}
