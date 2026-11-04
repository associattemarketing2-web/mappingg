import Link from 'next/link';
import EntityListing, { type RelatedPill } from '@/components/seo/EntityListing';
import type { Paged } from '@/lib/seo/paginate';
import type { Pin } from '@/lib/seo/entities';
import { CITY_LABELS, hasCityHub, statusLabel } from '@/lib/seo/entities';
import { CITY_SHORT } from '@/lib/seo/city';
import { facetHeading, facetQuery, getAllFacetPages, localityBreakdown, priceRangeText, type FacetPage } from '@/lib/seo/facet-pages';
import { guidesFor } from '@/lib/seo/blog-links';
import { isFacetGuide } from '@/lib/seo/facets';
import { listPublished } from '@/lib/blog';
import TrackOnView from '@/components/TrackOnView';

// One template for /cities/<city>/<facet> and /locations/<locality>/<facet>.
// Every sentence is computed from the matching projects' own data: counts,
// listed starting prices, status mix and localities. Nothing is estimated.

const STATE_RERA: Partial<Record<string, { name: string; url: string }>> = {
  pune: { name: 'MahaRERA', url: 'https://maharera.maharashtra.gov.in/' },
  mumbai: { name: 'MahaRERA', url: 'https://maharera.maharashtra.gov.in/' },
  bengaluru: { name: 'Karnataka RERA', url: 'https://rera.karnataka.gov.in/' },
  hyderabad: { name: 'TG RERA', url: 'https://rera.telangana.gov.in/' },
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export default async function FacetListing({ p, pg }: { p: FacetPage; pg: Paged<Pin> }) {
  const [all, posts] = await Promise.all([getAllFacetPages(), listPublished()]);
  const heading = facetHeading(p.facet);
  const q = facetQuery(p.facet);
  const s = p.summary;
  const range = priceRangeText(s);
  const city = CITY_LABELS[p.cityKey];
  // 'Bengaluru East, Bengaluru' reads oddly: skip the city when the place already names it.
  const where = p.scope === 'city' || p.placeName.includes(CITY_SHORT[p.cityKey]) ? p.placeName : `${p.placeName}, ${city}`;

  // Status mix of the matching projects.
  const status = new Map<string, number>();
  for (const pin of p.pins) {
    const l = statusLabel(pin.status) || 'Status not listed';
    status.set(l, (status.get(l) || 0) + 1);
  }
  const statusText = [...status].sort((a, b) => b[1] - a[1]).map(([l, n]) => `${n} ${l.toLowerCase()}`).join(', ');

  const areas = p.scope === 'city' ? localityBreakdown(p.pins) : [];
  const sameFacetLocalities = new Map(
    all.filter((x) => x.scope === 'locality' && x.facet.slug === p.facet.slug).map((x) => [x.place.slug, x.path]),
  );
  const rera = STATE_RERA[p.cityKey];

  const kindText = p.facet.kind === 'bhk' ? `with ${p.facet.short} homes` : `with homes starting ${p.facet.label.replace(/^(luxury )?flats /i, '')}`;
  const facts = [
    `Mappingg lists ${plural(p.pins.length, 'project', 'projects')} in ${where} ${kindText}` +
      (areas.length > 1 ? `, across ${plural(areas.length, 'locality', 'localities')}` : '') + '.',
    statusText && `By status: ${statusText}.`,
    range
      ? `Listed starting prices range ${range}${s.priced < s.count ? ` (${s.priced} of ${s.count} projects publish a price; the rest are price on request)` : ''}.`
      : 'None of these projects publishes a price yet — prices are on request from the developer.',
  ].filter(Boolean).join(' ');

  // Internal links: other facets here, the same facet elsewhere, parent pages, guides.
  const here = all.filter((x) => x.scope === p.scope && x.place.slug === p.place.slug && x.facet.slug !== p.facet.slug);
  const elsewhere = all.filter((x) => x.scope === 'city' && x.facet.slug === p.facet.slug && x.place.slug !== p.place.slug);
  const cityFacet = p.scope === 'locality' ? all.find((x) => x.scope === 'city' && x.place.slug === p.cityKey && x.facet.slug === p.facet.slug) : undefined;
  // The written guide for exactly this search (e.g. /blog/2-bhk-flats-in-pune) comes first.
  const guide = posts.find((x) => isFacetGuide(p.facet.slug, p.place.slug, x.slug));
  const related: RelatedPill[] = [
    ...(guide ? [{ label: `Guide: ${guide.title}`, path: `/blog/${guide.slug}` }] : []),
    ...guidesFor(p.place.slug, posts).filter((x) => x.slug !== guide?.slug).map((g) => ({ label: `Guide: ${g.title}`, path: `/blog/${g.slug}` })),
    ...here.map((x) => ({ label: `${facetHeading(x.facet)} in ${x.placeShort}`, path: x.path, count: x.pins.length })),
    ...(cityFacet ? [{ label: `${heading} in ${cityFacet.placeShort}`, path: cityFacet.path, count: cityFacet.pins.length }] : []),
    ...elsewhere.map((x) => ({ label: `${heading} in ${x.placeShort}`, path: x.path, count: x.pins.length })),
    { label: `All projects in ${p.placeName}`, path: p.base, count: p.place.count },
  ];

  const crumbs = [
    { name: 'Home', path: '/' },
    ...(hasCityHub(p.cityKey) ? [{ name: city, path: `/cities/${p.cityKey}` }] : []),
    ...(p.scope === 'locality' ? [{ name: p.placeName, path: p.base }] : []),
    { name: heading, path: p.path },
  ];

  const faqs = [
    {
      q: `How many ${q} projects are there in ${where}?`,
      a: `Mappingg currently lists ${plural(p.pins.length, 'project', 'projects')} in ${where} ${kindText} (${statusText}). Sold-out projects are not included. The list updates as projects are added or change.`,
    },
    ...(range
      ? [{
          q: `What is the starting price of ${q} in ${where}?`,
          a: `Among the projects listed here, starting prices range ${range}${s.priced < s.count ? ` (${s.priced} of ${s.count} projects publish a price)` : ''}. These are developer-listed asking prices; confirm the current price sheet and all-inclusive cost with the developer before booking.`,
        }]
      : []),
    ...(areas.length > 1
      ? [{
          q: `Which localities in ${p.placeName} have the most ${q}?`,
          a: `By number of listed projects: ${areas.slice(0, 5).map((a) => `${a.label} (${a.count})`).join(', ')}.`,
        }]
      : []),
    ...(rera
      ? [{
          q: `How do I check a project's RERA registration?`,
          a: `Each project page shows the RERA number where one is on record. Search that number on the ${rera.name} website (${rera.url.replace(/^https:\/\//, '').replace(/\/$/, '')}) to confirm the registration, promoter and approved completion date before you pay a booking amount.`,
        }]
      : []),
  ];

  return (
    <EntityListing
      crumbs={crumbs}
      eyebrow={p.scope === 'city' ? `${city} · ${p.facet.kind === 'bhk' ? 'By BHK' : 'By budget'}` : `${city} · ${p.placeName}`}
      title={`${heading} in ${where}`}
      lede={`New and under-construction projects in ${where} ${kindText}, with location on a live map, developer, RERA number, configuration and possession details for each.`}
      stats={[
        { b: p.pins.length, span: 'Projects' },
        ...(areas.length > 1 ? [{ b: areas.length, span: 'Localities' }] : []),
        ...(s.priceFrom != null ? [{ b: `${range.replace(/^from /, '').split(' to ')[0]}`, span: 'Lowest listed start' }] : []),
      ]}
      prose={
        <>
          <TrackOnView event="view_item_list" params={{ item_list_id: p.path, item_list_name: `${heading} in ${where}`, results: p.pins.length }} />
          <p>{facts}</p>
          {guide && (
            <p>
              For prices by locality, what to check and how to compare these projects, read our guide{' '}
              <Link href={`/blog/${guide.slug}`}>{guide.title}</Link>.
            </p>
          )}
          {areas.length > 1 && (
            <>
              <h2>Where these projects are</h2>
              <ul>
                {areas.map((a) => (
                  <li key={a.slug}>
                    <Link href={sameFacetLocalities.get(a.slug) || `/locations/${a.slug}`}>
                      {sameFacetLocalities.has(a.slug) ? `${heading} in ${a.label}` : a.label}
                    </Link>{' '}
                    — {plural(a.count, 'project', 'projects')}
                  </li>
                ))}
              </ul>
            </>
          )}
          <p>
            Prices and configurations come from developer listings and RERA records and can change. Read{' '}
            <Link href="/data-sources">how Mappingg sources and checks project data</Link>
            {rera ? <> and verify registrations on the <a href={rera.url} rel="noopener" target="_blank">{rera.name} website</a></> : null}.
          </p>
          <p>
            Not finding the right fit? <Link href="/buyer-requirement">Share your requirement</Link> — budget, BHK and
            preferred area — and we will send matching projects.
          </p>
        </>
      }
      pins={pg.items}
      pagination={{ ...pg, base: p.path }}
      projectsHeading={`${heading} in ${where} (${p.pins.length})`}
      relatedTitle="Related searches"
      related={related}
      faqs={faqs}
    />
  );
}
