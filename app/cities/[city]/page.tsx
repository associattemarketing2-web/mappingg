import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import EntityListing from '@/components/seo/EntityListing';
import {
  getCityGroups,
  getLocalityGroups,
  getStatusGroups,
  findGroup,
  cityOf,
  CITY_LABELS,
} from '@/lib/seo/entities';
import { buildMetadata } from '@/lib/seo/metadata';

export const revalidate = 600;
// Closed set (Pune / Mumbai-MMR) → prerender + hard-404 on unknown.
export const dynamicParams = false;
export async function generateStaticParams() {
  return (await getCityGroups()).map((g) => ({ city: g.slug }));
}

export async function generateMetadata({ params }: { params: { city: string } }): Promise<Metadata> {
  const g = await findGroup(getCityGroups, params.city);
  if (!g) return { title: 'City not found', robots: { index: false, follow: false } };
  return buildMetadata({
    title: `Real Estate Projects in ${g.label}`,
    description: `Explore ${g.count} real estate project${g.count === 1 ? '' : 's'} across ${g.label} — by locality, developer and status, with an interactive map on Mappingg.`,
    path: `/cities/${g.slug}`,
    keywords: [`real estate projects ${g.label}`, `property in ${g.label}`],
  });
}

export default async function CityPage({ params }: { params: { city: string } }) {
  const g = await findGroup(getCityGroups, params.city);
  if (!g) notFound();

  const [allLocs, statuses] = await Promise.all([getLocalityGroups(), getStatusGroups()]);
  const localitiesHere = allLocs
    .filter((l) => l.pins[0] && cityOf(l.pins[0]) === g.slug)
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
        { b: localitiesHere.length, span: 'Localities' },
      ]}
      prose={
        <p>
          {g.label} is one of two regions Mappingg covers. Start from a locality below to focus on a specific
          micro-market, or browse every project in the city here.
        </p>
      }
      pins={g.pins}
      projectsHeading={`All projects in ${g.label} (${g.count})`}
      relatedTitle={`Localities in ${g.label}`}
      related={[...statusHere, ...localitiesHere]}
      faqs={[
        {
          q: `How many real estate projects are there in ${g.label} on Mappingg?`,
          a: `Mappingg currently maps ${g.count} project${g.count === 1 ? '' : 's'} across ${localitiesHere.length} localit${localitiesHere.length === 1 ? 'y' : 'ies'} in ${g.label}.`,
        },
      ]}
    />
  );
}
