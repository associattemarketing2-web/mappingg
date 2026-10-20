import type { Metadata } from 'next';
import { paginate, type PageParam } from '@/lib/seo/paginate';
import { notFound } from 'next/navigation';
import { cityMeta, pagedMetadata } from '@/lib/seo/listing-meta';
import EntityListing from '@/components/seo/EntityListing';
import {
  getCityGroups,
  getLocalityGroups,
  getStatusGroups,
  findGroup,
  cityOf,
} from '@/lib/seo/entities';
import { guidesFor } from '@/lib/seo/blog-links';
import { listPublished } from '@/lib/blog';

export const revalidate = 3600;
// City hubs come from the live project data, so new ones appear between deploys.
// Known ones are prerendered; a new one renders on first request (ISR). Unknown
// slugs get a real 404 from this route's layout.tsx (generateMetadata), which
// runs before streaming starts. (dynamicParams = false
// used to 404 any page added after the last build, e.g. /locations/wanowri.)
export const dynamicParams = true;
export async function generateStaticParams() {
  return (await getCityGroups()).map((g) => ({ city: g.slug }));
}

type Props = { params: { city: string }; searchParams?: { page?: PageParam } };

// Page 2+ (?page=N) gets its own title and self-canonical; page 1 uses the layout's.
export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const g = await findGroup(getCityGroups, params.city);
  const pg = g && paginate(g.pins, searchParams?.page);
  return g && pg ? pagedMetadata(cityMeta(g), pg.page, pg.pages) : {};
}

export default async function CityPage({ params, searchParams }: Props) {
  const g = await findGroup(getCityGroups, params.city);
  if (!g) notFound();
  const pg = paginate(g.pins, searchParams?.page);
  if (!pg) notFound();

  const [allLocs, statuses, cities, posts] = await Promise.all([getLocalityGroups(), getStatusGroups(), getCityGroups(), listPublished()]);
  const guides = guidesFor(g.slug, posts).map((p) => ({ label: `Guide: ${p.title}`, path: `/blog/${p.slug}` }));
  const otherCities = cities.filter((c) => c.slug !== g.slug).map((c) => ({ label: `Projects in ${c.label}`, path: `/cities/${c.slug}`, count: c.count }));
  const allHere = allLocs.filter((l) => l.pins[0] && cityOf(l.pins[0]) === g.slug);
  const localityCount = allHere.length;
  const localitiesHere = allHere
    .slice(0, 16)
    .map((l) => ({ label: l.label, path: `/locations/${l.slug}`, count: l.count }));
  const statusHere = statuses
    .map((s) => ({ ...s, n: s.pins.filter((p) => cityOf(p) === g.slug).length }))
    .filter((s) => s.n > 0)
    .map((s) => ({ label: s.label, path: `/status/${s.slug}`, count: s.n }));

  return (
    <EntityListing
      crumbs={[
        { name: 'Home', path: '/' },
        { name: 'Cities', path: '/cities' },
        { name: g.label, path: `/cities/${g.slug}` },
      ]}
      eyebrow="City"
      title={`Real Estate Projects in ${g.label}`}
      lede={`Projects across ${g.label}, organised by locality, developer and status — with a live, colour-coded map of where everything is and what infrastructure is coming.`}
      stats={[
        { b: g.count, span: 'Projects' },
        { b: localityCount, span: 'Localities' },
      ]}
      prose={
        <p>
          Mappingg maps {g.count} project{g.count === 1 ? '' : 's'} in {g.label}, across {localityCount}{' '}
          {localityCount === 1 ? 'locality' : 'localities'} we track. Start from a locality below to focus on a
          specific micro-market, or browse every project in the city here.
        </p>
      }
      pins={pg.items}
      pagination={{ ...pg, base: `/cities/${g.slug}` }}
      projectsHeading={`All projects in ${g.label} (${g.count})`}
      relatedTitle={`Localities in ${g.label}`}
      related={[...guides, ...statusHere, ...localitiesHere, ...otherCities]}
      faqs={[
        {
          q: `How many real estate projects are there in ${g.label} on Mappingg?`,
          a: `Mappingg currently maps ${g.count} project${g.count === 1 ? '' : 's'} across ${localityCount} localit${localityCount === 1 ? 'y' : 'ies'} in ${g.label}.`,
        },
      ]}
    />
  );
}
