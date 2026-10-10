import { cache } from 'react';
import { runDbOp } from '@/lib/db-engine';
import { withMediaUrls } from '@/lib/pin-media';
import { localitiesOf } from '@/lib/locality';
import { slugify, projectSlug, projectNumberFromSlug } from './slug';
import { cityFrom, CITY_LABELS, hasCityHub, type CityKey } from './city';

// -----------------------------------------------------------------------------
// SEO entity layer. "Projects" are the public `pins` (224 rows). Locations,
// developers, cities, statuses and property types are DERIVED from those rows —
// we never invent an entity that has no real pins behind it, so there are no
// thin pages. All reads go through the existing Postgres-backed data layer
// (runDbOp, isAuthed=false → hidden/pending pins are excluded automatically).
// -----------------------------------------------------------------------------

export interface Pin {
  id: string;
  number: number;
  title?: string;
  type?: string;
  status?: string;
  price?: string;
  configuration?: string;
  sqft?: string | number;
  possession_timeline?: string;
  launch_date?: string;
  developer?: string;
  location?: string;
  key_usp?: string;
  description?: string;
  lat?: number;
  lng?: number;
  youtube_video_url?: string;
  image?: string; // base64 on the raw row; a /api/media URL after withMediaUrls
  brochure_image?: string;
  created_at?: string;
  updated_at?: string;
}

// lat/lng are needed to tell which city a project is in (lib/seo/city.ts).
const LIST_COLUMNS =
  'id,number,title,type,status,price,configuration,sqft,possession_timeline,launch_date,developer,location,key_usp,lat,lng,updated_at';

export const STATUS_ROUTES = [
  { slug: 'upcoming', label: 'Upcoming', match: ['upcoming'] },
  // The live data uses "construction"; "under_construction" kept for safety.
  { slug: 'under-construction', label: 'Under Construction', match: ['construction', 'under_construction'] },
  { slug: 'ready-to-move', label: 'Ready to Move', match: ['available'] },
] as const;

export function statusLabel(status?: string): string {
  switch ((status || '').toLowerCase()) {
    case 'available': return 'Ready to Move';
    case 'construction':
    case 'under_construction': return 'Under Construction';
    case 'upcoming': return 'Upcoming';
    case 'sold': return 'Sold';
    default: return status || '';
  }
}

/** DB status value → public /status/<slug> route, or null if not an indexed status. */
export function statusRouteSlug(status?: string): string | null {
  const s = (status || '').toLowerCase();
  const route = STATUS_ROUTES.find((r) => (r.match as readonly string[]).includes(s));
  return route ? route.slug : null;
}

/** Every public pin, lightweight (no base64 images). Deduped per request. */
export const getPublicPins = cache(async (): Promise<Pin[]> => {
  try {
    const res = await runDbOp(
      { table: 'pins', action: 'select', columns: LIST_COLUMNS, order: { col: 'number', ascending: true } },
      false,
    );
    if (res.error || !Array.isArray(res.data)) return [];
    return res.data as Pin[];
  } catch {
    return [];
  }
});

/** One pin by its number, WITH images converted to cacheable /api/media URLs. */
export const getPinByNumber = cache(async (n: number): Promise<Pin | null> => {
  try {
    const res = await runDbOp(
      { table: 'pins', action: 'select', filters: [{ op: 'eq', col: 'number', val: n }], single: true },
      false,
    );
    if (res.error || !res.data) return null;
    // Request an optimized ~1000px WebP cover (served by /api/media) rather than
    // the full-size base64 original, so the project page stays fast (P0).
    return withMediaUrls('pins', res.data, { width: 1000 }) as Pin;
  } catch {
    return null;
  }
});

/** Resolve a /projects/<slug> URL to its pin via the trailing number (any title prefix matches). */
export async function getPinBySlug(slug: string): Promise<Pin | null> {
  const n = projectNumberFromSlug(slug);
  return n == null ? null : getPinByNumber(n);
}

// ---- derivations ----------------------------------------------------------

export function primaryLocality(pin: Pin): string {
  return localitiesOf(pin.location)[0] || '';
}

export function cityOf(pin: Pin): CityKey {
  return cityFrom(pin.location, pin.lat, pin.lng);
}

export { CITY_LABELS, hasCityHub, type CityKey };

export function typeLabel(type?: string): string {
  const t = (type || '').trim();
  if (!t) return 'Property';
  return t.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function slugForProject(pin: Pin): string {
  return projectSlug(pin.title, primaryLocality(pin), pin.number);
}

export interface Group {
  slug: string;
  label: string;
  count: number;
  pins: Pin[];
}

function groupBy(pins: Pin[], keyFn: (p: Pin) => { slug: string; label: string } | null): Group[] {
  const map = new Map<string, Group>();
  for (const p of pins) {
    const k = keyFn(p);
    if (!k || !k.slug) continue;
    const g = map.get(k.slug) || { slug: k.slug, label: k.label, count: 0, pins: [] };
    g.count += 1;
    g.pins.push(p);
    map.set(k.slug, g);
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** Locality groups — a pin can appear under several localities it names. */
export const getLocalityGroups = cache(async (): Promise<Group[]> => {
  const pins = await getPublicPins();
  const map = new Map<string, Group>();
  for (const p of pins) {
    for (const loc of localitiesOf(p.location)) {
      const slug = slugify(loc);
      if (!slug) continue;
      const g = map.get(slug) || { slug, label: loc, count: 0, pins: [] };
      g.count += 1;
      g.pins.push(p);
      map.set(slug, g);
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
});

export const getDeveloperGroups = cache(async (): Promise<Group[]> => {
  const pins = await getPublicPins();
  return groupBy(pins, (p) => (p.developer ? { slug: slugify(p.developer), label: p.developer } : null));
});

/** City hub groups (Pune, Mumbai/MMR) — projects in other cities have no hub page. */
export const getCityGroups = cache(async (): Promise<Group[]> => {
  const pins = await getPublicPins();
  return groupBy(pins, (p) => {
    const key = cityOf(p);
    return hasCityHub(key) ? { slug: key, label: CITY_LABELS[key] } : null;
  });
});

export const getTypeGroups = cache(async (): Promise<Group[]> => {
  const pins = await getPublicPins();
  return groupBy(pins, (p) => (p.type ? { slug: slugify(p.type), label: typeLabel(p.type) } : null));
});

export const getStatusGroups = cache(async (): Promise<Group[]> => {
  const pins = await getPublicPins();
  const out: Group[] = [];
  for (const route of STATUS_ROUTES) {
    const matched = pins.filter((p) => (route.match as readonly string[]).includes((p.status || '').toLowerCase()));
    if (matched.length) out.push({ slug: route.slug, label: route.label, count: matched.length, pins: matched });
  }
  return out;
});

export async function findGroup(getter: () => Promise<Group[]>, slug: string): Promise<Group | null> {
  const groups = await getter();
  return groups.find((g) => g.slug === slug) || null;
}
