import type { Metadata } from 'next';
import { paginate, type PageParam } from '@/lib/seo/paginate';
import { notFound, permanentRedirect } from 'next/navigation';
import EntityListing from '@/components/seo/EntityListing';
import { pagedMetadata, projectsMeta } from '@/lib/seo/listing-meta';
import { getPublicPins, getLocalityGroups, getStatusGroups, citiesPhrase } from '@/lib/seo/entities';

export const revalidate = 3600;

type Props = { searchParams?: { page?: PageParam } & Record<string, string | string[] | undefined> };

/** Search / filter result pages (?q=, ?bhk=, ?budget=, ?size=, ?city=) were removed:
 *  old links land on the full list. */
function dropFilters(sp: Props['searchParams']) {
  if (sp && Object.keys(sp).some((k) => k !== 'page')) permanentRedirect('/projects');
}

// Page 2+ (?page=N) gets its own title and self-canonical; page 1 uses the layout's.
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  dropFilters(searchParams);
  const pins = await getPublicPins();
  const pg = paginate(pins, searchParams?.page);
  return pg ? pagedMetadata(projectsMeta(pins), pg.page, pg.pages) : {};
}

export default async function ProjectsIndex({ searchParams }: Props) {
  dropFilters(searchParams);
  const [pins, locs, statuses] = await Promise.all([getPublicPins(), getLocalityGroups(), getStatusGroups()]);
  const pg = paginate(pins, searchParams?.page);
  if (!pg) notFound();
  const where = citiesPhrase(pins, 4);
  const related = statuses.map((s) => ({ label: s.label, path: `/status/${s.slug}`, count: s.count }));
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
      relatedTitle="Browse by status"
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
