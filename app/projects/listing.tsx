import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import EntityListing from '@/components/seo/EntityListing';
import { paginate, type PageParam } from '@/lib/seo/paginate';
import { pagedMetadata, projectsMeta } from '@/lib/seo/listing-meta';
import { getPublicPins, getLocalityGroups, getStatusGroups, citiesPhrase } from '@/lib/seo/entities';
import { localityIndexing } from '@/lib/seo/indexing';

// The /projects list, shared by page 1 (app/projects/page.tsx) and pages 2+
// (app/projects/p/[page]/page.tsx — the public URL stays /projects?page=N; a
// beforeFiles rewrite in next.config.mjs maps it there). Neither route reads
// searchParams, so both are rendered once and cached (ISR + CDN) instead of on
// every request.

// Page 2+ gets its own title and self-canonical (/projects?page=N); page 1 keeps the layout's.
export async function projectsPageMetadata(page: PageParam): Promise<Metadata> {
  const pins = await getPublicPins();
  const pg = paginate(pins, page);
  return pg ? pagedMetadata(projectsMeta(pins), pg.page, pg.pages) : {};
}

export default async function ProjectsListing({ page }: { page: PageParam }) {
  const [pins, locs, statuses] = await Promise.all([getPublicPins(), getLocalityGroups(), getStatusGroups()]);
  const pg = paginate(pins, page);
  if (!pg) notFound();
  const where = citiesPhrase(pins, 4);
  const topLocs = locs
    .filter((l) => localityIndexing(l.slug, l.count).index)
    .slice(0, 12)
    .map((l) => ({ label: l.label, path: `/locations/${l.slug}`, count: l.count }));
  const related = [
    ...statuses.map((s) => ({ label: s.label, path: `/status/${s.slug}`, count: s.count })),
    ...topLocs,
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
      relatedTitle="Browse by status & locality"
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
