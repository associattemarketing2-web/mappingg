// BHK and budget landing pages per city: /cities/<city>/<facet>, e.g.
// /cities/pune/2-bhk-flats or /cities/pune/flats-under-1-crore.
//
// Pure helpers (no database or Next.js imports) so the rules are unit-tested
// (tests/seo-facets.test.ts) and shared by the pages, the sitemap and reports.
//
// A project only counts towards a facet when its own data says so:
//  - BHK: the configuration text names that BHK size (lib/home/finder.ts bhkSizes).
//  - Budget: the price text parses to a range with explicit units, and the
//    starting price is inside the band. Prices the admin hid are not used.
// Sold-out projects are left out — these pages are for buyers looking now.
// A facet page exists only with MIN_FACET_PROJECTS matches, so no thin pages.

import { bhkSizes, parsePriceLakh, type Range } from '../home/finder';

export const MIN_FACET_PROJECTS = 6;

export interface FacetPin {
  status?: string;
  price?: string;
  configuration?: string;
  field_visibility?: Record<string, unknown> | null;
}

export interface Facet {
  slug: string;
  kind: 'bhk' | 'budget';
  /** "2 BHK flats", "Flats under ₹1 crore" — used in H1s and titles. */
  label: string;
  /** Short label for link lists: "2 BHK", "Under ₹1 Cr". */
  short: string;
  match: (p: FacetPin) => boolean;
}

const priceHidden = (p: FacetPin) => !!p.field_visibility && p.field_visibility.price === false;

/**
 * A starting price above ₹20 Cr for a project offering only 1–3 BHK homes is
 * almost certainly a unit typo (lakh typed as crore, e.g. "₹ 103.96 – 111.2 Cr"
 * for a 3 BHK). Such prices are treated as unknown here rather than shown.
 */
const IMPLAUSIBLE_SMALL_HOME_LAKH = 2000;

/** Starting-price range in lakh, or null when unknown, hidden or implausible. */
export function facetPrice(p: FacetPin): Range | null {
  if (priceHidden(p)) return null;
  const r = parsePriceLakh(p.price);
  if (!r) return null;
  const sizes = bhkSizes(p.configuration);
  if (sizes.length && Math.max(...sizes) <= 3 && r.min > IMPLAUSIBLE_SMALL_HOME_LAKH) return null;
  return r;
}

const isSold = (p: FacetPin) => (p.status || '').toLowerCase() === 'sold';

const bhk = (n: number, plus = false): Facet => ({
  slug: `${n}-bhk-flats`,
  kind: 'bhk',
  label: `${n}${plus ? '+' : ''} BHK flats`,
  short: `${n}${plus ? '+' : ''} BHK`,
  // 2.5 BHK counts as 2 BHK; 4 BHK page includes 4.5, 5 BHK and above.
  match: (p) => bhkSizes(p.configuration).some((v) => (plus ? v >= n : Math.floor(v) === n)),
});

const under = (slug: string, lakh: number, label: string, short: string): Facet => ({
  slug,
  kind: 'budget',
  label,
  short,
  match: (p) => {
    const r = facetPrice(p);
    return !!r && r.min < lakh;
  },
});

export const FACETS: readonly Facet[] = [
  bhk(1),
  bhk(2),
  bhk(3),
  bhk(4, true),
  under('flats-under-50-lakh', 50, 'Flats under ₹50 lakh', 'Under ₹50 L'),
  under('flats-under-1-crore', 100, 'Flats under ₹1 crore', 'Under ₹1 Cr'),
  under('flats-under-2-crore', 200, 'Flats under ₹2 crore', 'Under ₹2 Cr'),
  {
    slug: 'luxury-flats-above-2-crore',
    kind: 'budget',
    label: 'Luxury flats above ₹2 crore',
    short: '₹2 Cr+',
    match: (p) => {
      const r = facetPrice(p);
      return !!r && r.min >= 200;
    },
  },
];

export const facetBySlug = (slug: string): Facet | undefined => FACETS.find((f) => f.slug === slug);

/** Projects in `pins` that belong on this facet page (sold-out excluded). */
export function facetPins<T extends FacetPin>(pins: T[], facet: Facet): T[] {
  return pins.filter((p) => !isSold(p) && facet.match(p));
}

export interface FacetSummary {
  count: number;
  /** Lowest and highest parsed starting price among the matches, in lakh. */
  priceFrom: number | null;
  priceTo: number | null;
  /** How many matches have a parsed price (the rest are "price on request"). */
  priced: number;
}

export function summarise(pins: FacetPin[]): FacetSummary {
  const mins = pins.map(facetPrice).filter((r): r is Range => !!r).map((r) => r.min);
  return {
    count: pins.length,
    priceFrom: mins.length ? Math.min(...mins) : null,
    priceTo: mins.length ? Math.max(...mins) : null,
    priced: mins.length,
  };
}

/** Facets with enough projects in this city to deserve a page, in FACETS order. */
export function availableFacets<T extends FacetPin>(cityPins: T[]): { facet: Facet; pins: T[] }[] {
  return FACETS.map((facet) => ({ facet, pins: facetPins(cityPins, facet) })).filter(
    (x) => x.pins.length >= MIN_FACET_PROJECTS,
  );
}

/**
 * True when a blog post is the written guide for this facet page, e.g.
 * "2-bhk-flats-in-pune" ↔ /cities/pune/2-bhk-flats, "luxury-flats-villas-in-pune"
 * ↔ /cities/pune/luxury-flats-above-2-crore. The guide and the live list link to
 * each other so they serve different intents (price guide vs. current projects)
 * instead of competing for the same query.
 */
export function isFacetGuide(facetSlug: string, placeSlug: string, postSlug: string): boolean {
  const core = facetSlug.startsWith('luxury-') ? 'luxury-flats' : facetSlug;
  const s = `-${postSlug}-`;
  return s.includes(`-${core}-`) && s.includes(`-${placeSlug}-`);
}
