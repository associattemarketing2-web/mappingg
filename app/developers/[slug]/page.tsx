import { notFound } from 'next/navigation';
import EntityListing from '@/components/seo/EntityListing';
import { getDeveloperGroups, findGroup, primaryLocality } from '@/lib/seo/entities';
import { slugify } from '@/lib/seo/slug';

// Open set (new pins can introduce new developers) → on-demand ISR so new
// developer hubs appear immediately.
// Not-found and redirect decisions are made in this route's layout.tsx (generateMetadata), which runs
// before the response starts streaming — so they produce a real 404 / 308
// status. (The root loading.tsx streams every page, so a notFound() thrown only
// in the page body would arrive after a 200 had already been sent.)
export const revalidate = 600;

export default async function DeveloperPage({ params }: { params: { slug: string } }) {
  const g = await findGroup(getDeveloperGroups, params.slug);
  if (!g) notFound();

  const locs = Array.from(new Set(g.pins.map(primaryLocality).filter(Boolean)))
    .slice(0, 8)
    .map((l) => ({ label: l, path: `/locations/${slugify(l)}`, count: g.pins.filter((p) => primaryLocality(p) === l).length }));

  return (
    <EntityListing
      crumbs={[
        { name: 'Home', path: '/' },
        { name: 'Developers', path: '/developers' },
        { name: g.label, path: `/developers/${g.slug}` },
      ]}
      eyebrow="Developer"
      title={`${g.label} — Projects`}
      lede={`Projects by ${g.label} that we map across Pune and the Mumbai Metropolitan Region, with locations, configurations, pricing and current status.`}
      stats={[
        { b: g.count, span: 'Projects' },
        { b: locs.length, span: 'Localities' },
      ]}
      pins={g.pins}
      projectsHeading={`Projects by ${g.label} (${g.count})`}
      relatedTitle="Localities where this developer is active"
      related={locs}
      faqs={[
        {
          q: `How many projects does ${g.label} have on Mappingg?`,
          a: `We currently map ${g.count} project${g.count === 1 ? '' : 's'} by ${g.label}${locs.length ? `, across ${locs.map((l) => l.label).join(', ')}` : ''}.`,
        },
      ]}
    />
  );
}
