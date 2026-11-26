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
import { slugify } from '@/lib/seo/slug';
import { LOCALITY_GUIDES } from '@/lib/seo/locality-guides';
import { formatBhk, formatLakhs, summarizeLocality } from '@/lib/seo/locality-summary';
import { guidesFor } from '@/lib/seo/blog-links';
import { listPublished } from '@/lib/blog';
import { developerIndexing, localityIndexing } from '@/lib/seo/indexing';
import { staticParamsOr } from '@/lib/seo/static-params';

// Locality hub: every public project in one micro-market (restored 22 Nov 2026;
// removed 4 Nov in 11c7dac — see seo-doc/IMPLEMENTATION-PLAN.md).
// Thin localities (lib/seo/indexing.ts) render `noindex, follow` and are left out
// of the sitemap and of the hub links. City pages stay retired, so there is no
// city level in the breadcrumb.
export const revalidate = 3600;
// Rendered once, refreshed by ISR (it reads no cookies/headers/searchParams).
export const dynamic = 'force-static';
// Localities come from live project data: unknown-at-build ones render on first
// request; unknown slugs get a real 404 from layout.tsx (generateMetadata).
export const dynamicParams = true;
export async function generateStaticParams() {
  return staticParamsOr('/locations/[slug]', async () => (await getLocalityGroups())
    .filter((g) => localityIndexing(g.slug, g.count).index)
    .map((g) => ({ slug: g.slug })));
}

export default async function LocationPage({ params }: { params: { slug: string } }) {
  const g = await findGroup(getLocalityGroups, params.slug);
  if (!g) notFound();

  const cityKey = g.pins[0] ? cityOf(g.pins[0]) : 'pune';
  const city = CITY_LABELS[cityKey];

  // Other localities in the same city + developers active here, for internal links
  // (only hubs that are themselves indexable).
  const [allLocs, devGroups, statuses, posts] = await Promise.all([
    getLocalityGroups(),
    getDeveloperGroups(),
    getStatusGroups(),
    listPublished(), // lenient: a blog read failure just drops the guide links
  ]);
  const guides = guidesFor(g.slug, posts).map((p) => ({ label: `Guide: ${p.title}`, path: `/blog/${p.slug}` }));
  const nearbyLocs = allLocs
    .filter((l) => l.slug !== g.slug && l.pins[0] && cityOf(l.pins[0]) === cityKey && localityIndexing(l.slug, l.count).index)
    .slice(0, 8)
    .map((l) => ({ label: l.label, path: `/locations/${l.slug}`, count: l.count }));
  const devCount = new Map(devGroups.map((d) => [d.slug, d.count]));
  const devNames = Array.from(new Set(g.pins.map((p) => p.developer).filter(Boolean) as string[]));
  const devsHere = devNames
    .filter((d) => developerIndexing(devCount.get(slugify(d)) || 0).index)
    .slice(0, 6)
    .map((d) => ({ label: d, path: `/developers/${slugify(d)}` }));
  const statusHere = statuses
    .map((s) => ({ ...s, n: s.pins.filter((p) => g.pins.some((gp) => gp.number === p.number)).length }))
    .filter((s) => s.n > 0)
    // The status pages cover every city, so the link names that (and shows its own count).
    .map((s) => ({ label: `All ${s.label.toLowerCase()} projects`, path: `/status/${s.slug}`, count: s.count }));

  // Area guide (top localities) + a paragraph of facts from the projects' own data.
  const guide = LOCALITY_GUIDES[g.slug];
  const sum = summarizeLocality(g.pins);
  const priceRange = sum.minLakhs != null && sum.maxLakhs != null
    ? sum.minLakhs === sum.maxLakhs ? `from ${formatLakhs(sum.minLakhs)}` : `from ${formatLakhs(sum.minLakhs)} to ${formatLakhs(sum.maxLakhs)}`
    : '';
  const dataLine = [
    `Mappingg lists ${sum.projects} project${sum.projects === 1 ? '' : 's'} in ${g.label}` +
      (sum.commercial && sum.residential ? ` (${sum.residential} residential or mixed-use, ${sum.commercial} commercial)` : '') + '.',
    priceRange && `Listed starting prices range ${priceRange}${sum.priced < sum.projects ? ` (${sum.priced} of ${sum.projects} projects publish a price)` : ''}.`,
    sum.bhk.length ? `Homes on offer include ${formatBhk(sum.bhk)} configurations.` : '',
    sum.possessionYears ? (sum.possessionYears[0] === sum.possessionYears[1]
      ? `Listed possession dates are in ${sum.possessionYears[0]}.`
      : `Listed possession dates run from ${sum.possessionYears[0]} to ${sum.possessionYears[1]}.`) : '',
    sum.readyNow ? `${sum.readyNow} project${sum.readyNow === 1 ? ' is' : 's are'} listed as ready to move or with ready towers.` : '',
  ].filter(Boolean).join(' ');
  const priceFaq = priceRange
    ? {
        q: `What is the starting price of new projects in ${g.label}?`,
        a: `Among the projects on Mappingg, listed starting prices in ${g.label} range ${priceRange}. Prices change often, so confirm the latest price sheet with the developer.`,
      }
    : null;

  return (
    <EntityListing
      crumbs={[
        { name: 'Home', path: '/' },
        { name: 'Localities', path: '/locations' },
        { name: g.label, path: `/locations/${g.slug}` },
      ]}
      eyebrow={`${city} · Locality`}
      title={`Flats & New Projects in ${g.label}`}
      lede={`Every project we map in ${g.label}${city ? `, ${city}` : ''} — with developer, status, configuration and pricing details, plus a live map of the area and its upcoming infrastructure.`}
      stats={[
        { b: g.count, span: 'Projects' },
        { b: devNames.length, span: 'Developers' },
      ]}
      prose={
        <>
          {guide ? (
            guide.intro.map((para) => <p key={para.slice(0, 24)}>{para}</p>)
          ) : (
            <p>
              {g.label} is one of the real-estate micro-markets we track in {city}. Below are the projects currently
              on Mappingg here, spanning different developers, budgets and possession timelines. Use the live map to see
              exactly where each project sits and what infrastructure is planned nearby.
            </p>
          )}
          {dataLine && <p>{dataLine}</p>}
        </>
      }
      pins={g.pins}
      projectsHeading={`Projects in ${g.label} (${g.count})`}
      relatedTitle="Guides, nearby localities & developers"
      related={[...guides, ...statusHere, ...nearbyLocs, ...devsHere]}
      faqs={[
        ...(priceFaq ? [priceFaq] : []),
        {
          q: `How many projects are available in ${g.label}?`,
          a: `Mappingg currently maps ${g.count} project${g.count === 1 ? '' : 's'} in ${g.label}${city ? `, ${city}` : ''}. The list is updated as new projects launch.`,
        },
        {
          q: `Which developers have projects in ${g.label}?`,
          a: devNames.length
            ? `Developers with projects in ${g.label} include ${devNames.slice(0, 8).join(', ')}.`
            : `Developer details for ${g.label} are listed on each project page.`,
        },
      ]}
    />
  );
}
