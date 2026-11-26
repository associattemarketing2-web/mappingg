import { notFound } from 'next/navigation';
import EntityListing from '@/components/seo/EntityListing';
import { getDeveloperGroups, getLocalityGroups, findGroup, primaryLocality, citiesPhrase } from '@/lib/seo/entities';
import { slugify } from '@/lib/seo/slug';
import { formatBhk, formatLakhs, summarizeLocality } from '@/lib/seo/locality-summary';
import { developerIndexing, localityIndexing } from '@/lib/seo/indexing';
import { staticParamsOr } from '@/lib/seo/static-params';

// Developer hub: the developer's projects that are on the public map (restored
// 22 Nov 2026; removed 4 Nov in 11c7dac). Every sentence is computed from those
// projects' own fields — no company facts are written that the data doesn't hold.
// Developers with fewer than 3 projects render `noindex, follow` (lib/seo/indexing.ts).
export const revalidate = 3600;
// Rendered once, refreshed by ISR (it reads no cookies/headers/searchParams).
export const dynamic = 'force-static';
export const dynamicParams = true;
export async function generateStaticParams() {
  return staticParamsOr('/developers/[slug]', async () => (await getDeveloperGroups())
    .filter((g) => developerIndexing(g.count).index)
    .map((g) => ({ slug: g.slug })));
}

export default async function DeveloperPage({ params }: { params: { slug: string } }) {
  const g = await findGroup(getDeveloperGroups, params.slug);
  if (!g) notFound();

  const locGroups = await getLocalityGroups();
  const locCount = new Map(locGroups.map((l) => [l.slug, l.count]));
  const allLocs = Array.from(new Set(g.pins.map(primaryLocality).filter(Boolean)));
  const locs = allLocs
    .map((l) => ({ label: l, slug: slugify(l), count: g.pins.filter((p) => primaryLocality(p) === l).length }))
    // Link only locality hubs that are indexable themselves.
    .filter((l) => localityIndexing(l.slug, locCount.get(l.slug) || 0).index)
    .slice(0, 8)
    .map((l) => ({ label: l.label, path: `/locations/${l.slug}`, count: l.count }));

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
    `Mappingg maps ${g.count} project${g.count === 1 ? '' : 's'} by ${g.label} in ${where}${allLocs.length ? `, across ${allLocs.length} localit${allLocs.length === 1 ? 'y' : 'ies'} including ${allLocs.slice(0, 4).join(', ')}` : ''}.`,
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
        { b: allLocs.length, span: 'Localities' },
      ]}
      pins={g.pins}
      projectsHeading={`Projects by ${g.label} (${g.count})`}
      relatedTitle="Localities where this developer is active"
      related={locs}
      faqs={[
        {
          q: `How many projects does ${g.label} have on Mappingg?`,
          a: `We currently map ${g.count} project${g.count === 1 ? '' : 's'} by ${g.label}${allLocs.length ? `, across ${allLocs.slice(0, 8).join(', ')}` : ''}.`,
        },
      ]}
    />
  );
}
