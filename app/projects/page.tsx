import type { Metadata } from 'next';
import { paginate, type PageParam } from '@/lib/seo/paginate';
import { notFound } from 'next/navigation';
import EntityListing from '@/components/seo/EntityListing';
import { pagedMetadata, projectsMeta } from '@/lib/seo/listing-meta';
import { getPublicPins, getLocalityGroups, getStatusGroups, getCityGroups, citiesPhrase } from '@/lib/seo/entities';

export const revalidate = 3600;

type Props = { searchParams?: { page?: PageParam } };

// Page 2+ (?page=N) gets its own title and self-canonical; page 1 uses the layout's.
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const pins = await getPublicPins();
  const pg = paginate(pins, searchParams?.page);
  return pg ? pagedMetadata(projectsMeta(pins), pg.page, pg.pages) : {};
}

export default async function ProjectsIndex({ searchParams }: Props) {
  const [pins, locs, statuses, cities] = await Promise.all([getPublicPins(), getLocalityGroups(), getStatusGroups(), getCityGroups()]);
  const pg = paginate(pins, searchParams?.page);
  if (!pg) notFound();
  const where = citiesPhrase(pins, 4);
  const related = [
    ...cities.map((c) => ({ label: `Projects in ${c.label}`, path: `/cities/${c.slug}`, count: c.count })),
    ...statuses.map((s) => ({ label: s.label, path: `/status/${s.slug}`, count: s.count })),
    ...locs.slice(0, 10).map((l) => ({ label: l.label, path: `/locations/${l.slug}`, count: l.count })),
  ];
  return (
    <EntityListing
      crumbs={[{ name: 'Home', path: '/' }, { name: 'Projects', path: '/projects' }]}
      eyebrow="All projects"
      title={`Real Estate Projects in ${where}`}
      lede={`Every project we map in ${citiesPhrase(pins, 6)}, with developer, status, configuration and pricing details — and a live map to see exactly where each one is.`}
      stats={[
        { b: pins.length, span: 'Projects mapped' },
        { b: locs.length, span: 'Localities' },
      ]}
      pins={pg.items}
      pagination={{ ...pg, base: '/projects' }}
      projectsHeading={`All projects (${pins.length})`}
      relatedTitle="Browse by city, status & locality"
      related={related}
      faqs={[
        {
          q: 'How many real estate projects are listed on Mappingg?',
          a: `Mappingg currently maps ${pins.length} projects in ${citiesPhrase(pins, 6)}, spanning ${locs.length} localities. New projects are added regularly.`,
        },
        {
          q: 'Can I see where each project is located?',
          a: 'Yes. Every project has a pin on the live interactive map, colour-coded by status, along with a dedicated page covering its developer, configuration, pricing and possession timeline.',
        },
      ]}
    />
  );
}
