import { slugify } from '@/lib/seo/slug';
import { distanceKm } from './finder';
import type { ProjectCardData } from './cards';

// "Projects near you": ranks real project pins by distance from a point. Every
// project pin has map coordinates, so distances are measured, not guessed. The
// place name shown to the visitor comes from the nearest projects' own
// locality — we only name a locality when projects really are that close, and
// otherwise say just the city (or nothing).

export interface NearbyCard extends ProjectCardData {
  distanceKm: number;
}

export interface NearbyResult {
  /** What to call the area, only as precise as the data supports. */
  area: { locality: string; city: string } | null;
  projects: NearbyCard[];
}

/** Max distance for "near you" results, and for naming a locality / city. */
export const NEARBY_RADIUS_KM = 25;
const LOCALITY_KM = 2.5;

/**
 * Registry imports often name a taluka or district (Haveli, Mulshi, "Pune City",
 * "Bengaluru East") where a locality would be. Real, but too broad to say
 * "near Haveli" or to list as a popular locality.
 */
const ADMIN_AREA = /^(haveli|mulshi|ma[vw]al|pune( city)?|mumbai( city| suburban)?|thane district|bengaluru( (east|west|north|south|urban|rural))?|bangalore( (urban|rural))?)$/i;
export const isAdminArea = (name: string) => ADMIN_AREA.test(name.trim());

const usable = (c: ProjectCardData) => c.residential && c.lat != null && c.lng != null;

export function nearbyFrom(cards: ProjectCardData[], lat: number, lng: number, limit = 12): NearbyResult {
  const ranked = cards
    .filter(usable)
    .map((c) => ({ ...c, distanceKm: Math.round(distanceKm(lat, lng, c.lat as number, c.lng as number) * 10) / 10 }))
    .filter((c) => c.distanceKm <= NEARBY_RADIUS_KM)
    .sort((a, b) => a.distanceKm - b.distanceKm || a.number - b.number);
  if (!ranked.length) return { area: null, projects: [] };
  // Name the locality only when two or more of the closest projects agree on it and are close by.
  const close = ranked.filter((c) => c.distanceKm <= LOCALITY_KM && c.locality && !isAdminArea(c.locality));
  const votes = new Map<string, number>();
  for (const c of close) votes.set(c.locality, (votes.get(c.locality) || 0) + 1);
  const [top] = [...votes.entries()].sort((a, b) => b[1] - a[1]);
  const locality = top && top[1] >= 2 ? top[0] : '';
  return { area: { locality, city: ranked[0].city }, projects: ranked.slice(0, limit) };
}

export interface LocalityOption {
  slug: string;
  label: string;
  city: string;
  count: number;
}

/** Localities with at least `min` residential projects, most projects first, optionally for some cities only. */
export function localityOptions(cards: ProjectCardData[], cities?: string[], min = 3, opts: { localitiesOnly?: boolean } = {}): LocalityOption[] {
  const map = new Map<string, LocalityOption>();
  for (const c of cards) {
    if (!c.residential || !c.locality || (cities && !cities.includes(c.city))) continue;
    if (opts.localitiesOnly && isAdminArea(c.locality)) continue;
    const slug = slugify(c.locality);
    const o = map.get(slug) || { slug, label: c.locality, city: c.city, count: 0 };
    o.count += 1;
    map.set(slug, o);
  }
  return [...map.values()].filter((o) => o.count >= min).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** Projects in and around a chosen locality (from the centre of its project pins). */
export function nearbyLocality(cards: ProjectCardData[], slug: string, limit = 12): NearbyResult | null {
  const inIt = cards.filter((c) => usable(c) && c.locality && slugify(c.locality) === slug);
  if (!inIt.length) return null;
  const lat = inIt.reduce((s, c) => s + (c.lat as number), 0) / inIt.length;
  const lng = inIt.reduce((s, c) => s + (c.lng as number), 0) / inIt.length;
  const res = nearbyFrom(cards, lat, lng, limit);
  // The visitor picked this locality, so it is the name to show; its own projects come first.
  const own = new Set(inIt.map((c) => c.number));
  res.projects.sort((a, b) => Number(own.has(b.number)) - Number(own.has(a.number)) || a.distanceKm - b.distanceKm);
  return { area: { locality: inIt[0].locality, city: inIt[0].city }, projects: res.projects };
}
