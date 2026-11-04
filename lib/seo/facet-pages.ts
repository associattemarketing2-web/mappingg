// Data + metadata for the BHK / budget landing pages:
//   /cities/<city>/<facet>        e.g. /cities/pune/2-bhk-flats
//   /locations/<locality>/<facet> e.g. /locations/mundhwa/3-bhk-flats
// The matching rules live in lib/seo/facets.ts (pure, unit-tested). A page only
// exists when at least MIN_FACET_PROJECTS projects match; otherwise it 404s, so
// no empty or near-empty "doorway" pages are ever served or listed.

import type { Metadata } from 'next';
import { buildMetadata } from './metadata';
import { clip } from './project-meta';
import { cache } from 'react';
import {
  getCityGroups,
  getLocalityGroups,
  findGroup,
  cityOf,
  placesOf,
  CITY_LABELS,
  hasCityHub,
  type Group,
  type Pin,
  type CityKey,
} from './entities';
import { CITY_SHORT } from './city';
import { slugify } from './slug';
import { availableFacets, facetBySlug, facetPins, summarise, MIN_FACET_PROJECTS, type Facet, type FacetSummary } from './facets';
import { formatLakh } from '../home/finder';

export interface FacetPage {
  scope: 'city' | 'locality';
  facet: Facet;
  /** The city or locality group the page belongs to. */
  place: Group;
  /** Display name used in headings: "Pune", "Mundhwa". */
  placeName: string;
  /** Short name for titles: "Mumbai" rather than "Mumbai & MMR". */
  placeShort: string;
  cityKey: CityKey;
  base: string;
  path: string;
  pins: Pin[];
  summary: FacetSummary;
}

/** "3 BHK Flats", "Flats Under ₹1 Crore" — title case for H1s. */
export function facetHeading(f: Facet): string {
  if (f.kind === 'bhk') return f.slug === '4-bhk-flats' ? '4 BHK & Larger Flats' : f.label.replace('flats', 'Flats');
  return f.label.replace(/^flats under/i, 'Flats Under').replace(/^luxury flats above/i, 'Luxury Flats Above').replace('crore', 'Crore').replace('lakh', 'Lakh');
}

/** The words people type: "3 BHK flats", "flats under 1 crore" (no ₹ sign). */
export function facetQuery(f: Facet): string {
  return f.label.replace('₹', '').replace('4+ BHK', '4 BHK');
}

function build(scope: FacetPage['scope'], facet: Facet, place: Group, cityKey: CityKey): FacetPage {
  const pins = facetPins(place.pins, facet);
  const base = scope === 'city' ? `/cities/${place.slug}` : `/locations/${place.slug}`;
  return {
    scope,
    facet,
    place,
    placeName: place.label,
    placeShort: scope === 'city' ? CITY_SHORT[cityKey] : place.label,
    cityKey,
    base,
    path: `${base}/${facet.slug}`,
    pins,
    summary: summarise(pins),
  };
}

export const getCityFacetPage = cache(async (city: string, slug: string): Promise<FacetPage | null> => {
  const facet = facetBySlug(slug);
  const g = facet && (await findGroup(getCityGroups, city));
  if (!facet || !g) return null;
  const page = build('city', facet, g, g.slug as CityKey);
  return page.pins.length >= MIN_FACET_PROJECTS ? page : null;
});

export const getLocalityFacetPage = cache(async (loc: string, slug: string): Promise<FacetPage | null> => {
  const facet = facetBySlug(slug);
  const g = facet && (await findGroup(getLocalityGroups, loc));
  if (!facet || !g || !g.pins[0]) return null;
  const page = build('locality', facet, g, cityOf(g.pins[0]));
  return page.pins.length >= MIN_FACET_PROJECTS ? page : null;
});

/** Every facet page that currently has enough projects (for the sitemap and static params). */
export const getAllFacetPages = cache(async (): Promise<FacetPage[]> => {
  const [cities, locs] = await Promise.all([getCityGroups(), getLocalityGroups()]);
  const out: FacetPage[] = [];
  for (const c of cities) for (const { facet } of availableFacets(c.pins)) out.push(build('city', facet, c, c.slug as CityKey));
  for (const l of locs) {
    if (!l.pins[0] || l.count < MIN_FACET_PROJECTS) continue;
    for (const { facet } of availableFacets(l.pins)) out.push(build('locality', facet, l, cityOf(l.pins[0])));
  }
  return out;
});

/** Facet links for a city or locality page ("2 BHK · 94"), only for pages that exist. */
export async function facetLinksFor(scope: FacetPage['scope'], slug: string): Promise<{ label: string; path: string; count: number }[]> {
  const all = await getAllFacetPages();
  return all
    .filter((p) => p.scope === scope && p.place.slug === slug)
    .map((p) => ({ label: `${facetHeading(p.facet)} in ${p.placeShort}`, path: p.path, count: p.pins.length }));
}

/** Matching projects per locality (for the city facet page's breakdown table). */
export function localityBreakdown(pins: Pin[], max = 12): { label: string; slug: string; count: number }[] {
  const map = new Map<string, { label: string; slug: string; count: number }>();
  for (const p of pins) {
    const name = placesOf(p.location)[0];
    const slug = name && slugify(name);
    if (!slug) continue;
    const row = map.get(slug) || { label: name, slug, count: 0 };
    row.count += 1;
    map.set(slug, row);
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)).slice(0, max);
}

export function priceRangeText(s: FacetSummary): string {
  if (s.priceFrom == null || s.priceTo == null) return '';
  return s.priceFrom === s.priceTo ? `from ${formatLakh(s.priceFrom)}` : `from ${formatLakh(s.priceFrom)} to ${formatLakh(s.priceTo)}`;
}

export function facetMetadata(p: FacetPage, page = 1, pages = 1): Metadata {
  const n = p.pins.length;
  const where = p.scope === 'locality' && hasCityHub(p.cityKey) && !p.placeName.includes(CITY_SHORT[p.cityKey]) ? `${p.placeName}, ${CITY_SHORT[p.cityKey]}` : p.placeShort;
  const q = facetQuery(p.facet);
  const range = priceRangeText(p.summary);
  const base = {
    // "Flats Under 1 Crore in Pune: 45 Projects" — the words people search, no ₹ sign.
    title: `${facetHeading(p.facet).replace('₹', '').replace('4 BHK & Larger', '4+ BHK')} in ${where}: ${n} Projects`,
    description: clip(
      `Compare ${n} projects in ${where} with ${p.facet.kind === 'bhk' ? `${p.facet.short} homes` : `homes starting ${p.facet.label.replace(/^(luxury )?flats /i, '')}`}` +
        `${range ? `, listed ${range}` : ''} — locations on a live map, RERA numbers, configurations and possession dates.`,
      160,
    ),
    path: p.path,
    keywords: [`${q} in ${p.placeShort}`, `${q} ${p.placeShort}`, `new ${q} in ${p.placeShort}`],
  };
  const meta =
    page > 1
      ? buildMetadata({ ...base, title: `${base.title} — Page ${page}`, description: clip(`Page ${page} of ${pages}. ${base.description}`, 160), path: `${p.path}?page=${page}` })
      : buildMetadata(base);
  // The parent locality layout may mark a thin locality noindex; a facet page
  // that exists always has MIN_FACET_PROJECTS projects, so say so explicitly.
  // Nested under a layout with a plain-string title, the root "%s — Mappingg" template
  // would not apply, so the brand is added here explicitly.
  return { ...meta, title: { absolute: `${String(meta.title)} — Mappingg` }, robots: { index: true, follow: true } };
}

export { CITY_LABELS };
