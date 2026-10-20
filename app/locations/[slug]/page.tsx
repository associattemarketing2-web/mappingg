import { notFound } from 'next/navigation';
import EntityListing from '@/components/seo/EntityListing';
import {
  getLocalityGroups,
  getDeveloperGroups,
  getStatusGroups,
  findGroup,
  cityOf,
  CITY_LABELS,
  hasCityHub,
} from '@/lib/seo/entities';
import { slugify } from '@/lib/seo/slug';
import { LOCALITY_GUIDES } from '@/lib/seo/locality-guides';
import { formatBhk, formatLakhs, summarizeLocality } from '@/lib/seo/locality-summary';
import { guidesFor } from '@/lib/seo/blog-links';
import { listPublished } from '@/lib/blog';

export const revalidate = 3600;
// Localities come from the live project data, so new ones appear between deploys.
// Known ones are prerendered; a new one renders on first request (ISR). Unknown
// slugs get a real 404 from this route's layout.tsx (generateMetadata), which
// runs before streaming starts. (dynamicParams = false
// used to 404 any page added after the last build, e.g. /locations/wanowri.)
export const dynamicParams = true;
export async function generateStaticParams() {
  return (await getLocalityGroups()).map((g) => ({ slug: g.slug }));
}

export default async function LocationPage({ params }: { params: { slug: string } }) {
  const g = await findGroup(getLocalityGroups, params.slug);
  if (!g) notFound();

  const cityKey = g.pins[0] ? cityOf(g.pins[0]) : 'pune';
  const city = CITY_LABELS[cityKey];

  // Other localities in the same city + developers active here, for internal links.
  const [allLocs, devGroups, statuses, posts] = await Promise.all([
    getLocalityGroups(),
    getDeveloperGroups(),
    getStatusGroups(),
    listPublished(), // lenient: a blog read failure just drops the guide links
  ]);
  const guides = guidesFor(g.slug, posts).map((p) => ({ label: `Guide: ${p.title}`, path: `/blog/${p.slug}` }));
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
        ...(hasCityHub(cityKey) ? [{ name: city, path: `/cities/${cityKey}` }] : []),
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
        <>
          {guide ? (
            guide.intro.map((para) => <p key={para.slice(0, 24)}>{para}</p>)
          ) : (
            <p>
              {g.label} is one of the active real-estate micro-markets we track in {city}. Below are the projects currently
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
          a: devsHere.length
            ? `Developers with projects in ${g.label} include ${devsHere.map((d) => d.label).join(', ')}.`
            : `Developer details for ${g.label} are listed on each project page.`,
        },
      ]}
    />
  );
}
