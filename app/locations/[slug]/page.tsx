import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import EntityListing from '@/components/seo/EntityListing';
import {
  getLocalityGroups,
  getDeveloperGroups,
  getStatusGroups,
  findGroup,
  cityOf,
  CITY_LABELS,
} from '@/lib/seo/entities';
import { buildMetadata } from '@/lib/seo/metadata';
import { slugify } from '@/lib/seo/slug';

export const revalidate = 600;
// Localities are a closed set (matched from lib/locality.ts KNOWN) → prerender
// them all and hard-404 on anything else (no soft-200). A new locality is a code
// change to KNOWN, i.e. a deploy, so static params stay correct.
export const dynamicParams = false;
export async function generateStaticParams() {
  return (await getLocalityGroups()).map((g) => ({ slug: g.slug }));
}

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const g = await findGroup(getLocalityGroups, params.slug);
  if (!g) return { title: 'Locality not found', robots: { index: false, follow: false } };
  const city = g.pins[0] ? CITY_LABELS[cityOf(g.pins[0])] : '';
  return buildMetadata({
    title: `Real Estate Projects in ${g.label}${city ? `, ${city}` : ''}`,
    description: `Explore ${g.count} real estate project${g.count === 1 ? '' : 's'} in ${g.label}${city ? `, ${city}` : ''} — developers, configurations, pricing, status and an interactive map of the area on Mappingg.`,
    path: `/locations/${g.slug}`,
    keywords: [`real estate ${g.label}`, `property in ${g.label}`, `projects in ${g.label}`],
  });
}

export default async function LocationPage({ params }: { params: { slug: string } }) {
  const g = await findGroup(getLocalityGroups, params.slug);
  if (!g) notFound();

  const cityKey = g.pins[0] ? cityOf(g.pins[0]) : 'pune';
  const city = CITY_LABELS[cityKey];

  // Other localities in the same city + developers active here, for internal links.
  const [allLocs, devGroups, statuses] = await Promise.all([
    getLocalityGroups(),
    getDeveloperGroups(),
    getStatusGroups(),
  ]);
  const nearbyLocs = allLocs
    .filter((l) => l.slug !== g.slug && l.pins[0] && cityOf(l.pins[0]) === cityKey)
    .slice(0, 8)
    .map((l) => ({ label: l.label, path: `/locations/${l.slug}`, count: l.count }));
  const devsHere = Array.from(new Set(g.pins.map((p) => p.developer).filter(Boolean) as string[]))
    .slice(0, 6)
    .map((d) => ({ label: d, path: `/developers/${slugify(d)}` }));
  const statusHere = statuses
    .map((s) => ({ ...s, n: s.pins.filter((p) => g.pins.some((gp) => gp.number === p.number)).length }))
    .filter((s) => s.n > 0)
    .map((s) => ({ label: `${s.label} in ${g.label}`, path: `/status/${s.slug}`, count: s.n }));

  return (
    <EntityListing
      crumbs={[
        { name: 'Home', path: '/' },
        { name: city, path: `/cities/${cityKey}` },
        { name: g.label, path: `/locations/${g.slug}` },
      ]}
      eyebrow={`${city} · Locality`}
      title={`Real Estate Projects in ${g.label}`}
      lede={`Every project we map in ${g.label}${city ? `, ${city}` : ''} — with developer, status, configuration and pricing details, plus a live map of the area and its upcoming infrastructure.`}
      stats={[
        { b: g.count, span: 'Projects' },
        { b: devsHere.length, span: 'Developers' },
      ]}
      prose={
        <p>
          {g.label} is one of the active real-estate micro-markets we track in {city}. Below are the projects currently
          on Mappingg here, spanning different developers, budgets and possession timelines. Use the live map to see
          exactly where each project sits and what infrastructure is planned nearby.
        </p>
      }
      pins={g.pins}
      projectsHeading={`Projects in ${g.label} (${g.count})`}
      relatedTitle="Nearby localities & developers"
      related={[...statusHere, ...nearbyLocs, ...devsHere]}
      faqs={[
        {
          q: `How many projects are available in ${g.label}?`,
          a: `Mappingg currently maps ${g.count} project${g.count === 1 ? '' : 's'} in ${g.label}${city ? `, ${city}` : ''}. The list is updated as new projects launch.`,
        },
        {
          q: `Which developers have projects in ${g.label}?`,
          a: devsHere.length
            ? `Developers with projects in ${g.label} include ${devsHere.map((d) => d.label).join(', ')}.`
            : `Developer details for ${g.label} are listed on each project page.`,
        },
      ]}
    />
  );
}
