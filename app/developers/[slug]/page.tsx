import { notFound } from 'next/navigation';
import EntityListing from '@/components/seo/EntityListing';
import { getDeveloperGroups, findGroup, primaryLocality, citiesPhrase } from '@/lib/seo/entities';
import { slugify } from '@/lib/seo/slug';
import { formatBhk, formatLakhs, summarizeLocality } from '@/lib/seo/locality-summary';

// Open set (new pins can introduce new developers) → on-demand ISR so new
// developer hubs appear immediately.
// Not-found and redirect decisions are made in this route's layout.tsx (generateMetadata), which runs
// before the response starts streaming — so they produce a real 404 / 308
// status. (The root loading.tsx streams every page, so a notFound() thrown only
// in the page body would arrive after a 200 had already been sent.)
export const revalidate = 3600;

export default async function DeveloperPage({ params }: { params: { slug: string } }) {
  const g = await findGroup(getDeveloperGroups, params.slug);
  if (!g) notFound();

  const locs = Array.from(new Set(g.pins.map(primaryLocality).filter(Boolean)))
    .slice(0, 8)
    .map((l) => ({ label: l, path: `/locations/${slugify(l)}`, count: g.pins.filter((p) => primaryLocality(p) === l).length }));

  // Facts from this developer's mapped projects only (same helper as locality pages).
  const sum = summarizeLocality(g.pins);
  const where = citiesPhrase(g.pins, 5);
  const statusCounts = [
    ['under construction', g.pins.filter((p) => /construction/i.test(p.status || '')).length],
    ['upcoming', g.pins.filter((p) => /upcoming/i.test(p.status || '')).length],
    ['ready to move', g.pins.filter((p) => /available/i.test(p.status || '')).length],
  ].filter(([, n]) => Number(n) > 0).map(([label, n]) => `${n} ${label}`);
  const withRera = g.pins.filter((p) => (p.rera_number || '').trim()).length;
  const facts = [
    `Mappingg maps ${g.count} project${g.count === 1 ? '' : 's'} by ${g.label} in ${where}${locs.length ? `, across ${locs.length} localit${locs.length === 1 ? 'y' : 'ies'} including ${locs.slice(0, 4).map((l) => l.label).join(', ')}` : ''}.`,
    statusCounts.length ? `By status: ${statusCounts.join(', ')}.` : '',
    sum.minLakhs != null && sum.maxLakhs != null
      ? `Listed starting prices range from ${formatLakhs(sum.minLakhs)}${sum.maxLakhs !== sum.minLakhs ? ` to ${formatLakhs(sum.maxLakhs)}` : ''} (${sum.priced} of ${g.count} projects publish a price).`
      : '',
    sum.bhk.length ? `Configurations on offer include ${formatBhk(sum.bhk)} homes.` : '',
    sum.possessionYears ? (sum.possessionYears[0] === sum.possessionYears[1] ? `Listed possession dates are in ${sum.possessionYears[0]}.` : `Listed possession dates run from ${sum.possessionYears[0]} to ${sum.possessionYears[1]}.`) : '',
    withRera ? `${withRera} of these projects list a RERA registration number on their page.` : '',
  ].filter(Boolean).join(' ');

  return (
    <EntityListing
      prose={<p>{facts}</p>}
      crumbs={[
        { name: 'Home', path: '/' },
        { name: 'Developers', path: '/developers' },
        { name: g.label, path: `/developers/${g.slug}` },
      ]}
      eyebrow="Developer"
      title={`${g.label} — Projects`}
      lede={`Projects by ${g.label} that we map in ${citiesPhrase(g.pins)}, with locations, configurations, pricing and current status.`}
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
