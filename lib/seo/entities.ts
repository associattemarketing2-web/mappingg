import { cache } from 'react';
import { runDbOp } from '@/lib/db-engine';
import { cachedRead } from '@/lib/data-cache';
import { withMediaUrls } from '@/lib/pin-media';
import { localitiesOf } from '@/lib/locality';
import { slugify, projectSlug, projectNumberFromSlug } from './slug';
import { cityFrom, CITY_LABELS, citiesPhrase as phraseFor, hasCityHub, type CityKey } from './city';
import { isPropertyProject } from './project-filter';
import { displayDeveloperName, displayPlaceName } from './developer-name';
import { applyFieldVisibility, displayProjectName } from './project-meta';

/**
 * Public form of a pin: fields the admin hid from the public card are removed
 * (same switches as the live map), and ALL-CAPS project/developer names are shown
 * in title case. Display only — slugify() ignores case, so URLs don't change.
 */
const withDisplayName = <T extends Pin>(raw: T): T => {
  const p = applyFieldVisibility(raw);
  return {
    ...p,
    ...(p.title ? { title: displayProjectName(p.title) } : {}),
    ...(p.developer ? { developer: displayDeveloperName(p.developer) } : {}),
  };
};

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
  rera_number?: string;
  /** Admin switches for the public card: { price: false } hides the price. */
  field_visibility?: Record<string, unknown> | null;
  image?: string; // base64 on the raw row; a /api/media URL after withMediaUrls
  brochure_image?: string;
  created_at?: string;
  updated_at?: string;
}

// lat/lng are needed to tell which city a project is in (lib/seo/city.ts).
// description is needed to tell empty placeholder pages apart (lib/seo/indexing.ts).
// field_visibility is needed so listings never show a field the admin hid.
const LIST_COLUMNS =
  'id,number,title,type,status,price,configuration,sqft,possession_timeline,launch_date,developer,location,key_usp,description,rera_number,field_visibility,lat,lng,updated_at';

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

/** Every public pin that is a property project (lib/seo/project-filter.ts), lightweight
 *  (no base64 images). Office markers and land parcels stay on the map but are left out. */
// Shared data cache (lib/data-cache.ts): every pin write clears it at once, so the
// 10-minute window only matters for writes made outside the app.
const readPublicPins = cachedRead('seo-public-pins', ['pins'], 600, async (): Promise<Pin[]> => {
  const res = await runDbOp(
    { table: 'pins', action: 'select', columns: LIST_COLUMNS, order: { col: 'number', ascending: true } },
    false,
  );
  if (res.error || !Array.isArray(res.data)) throw new Error(`pins read failed: ${res.error?.message || 'no data'}`);
  return (res.data as Pin[]).filter(isPropertyProject).map(withDisplayName);
});

export const getPublicPins = cache(async (): Promise<Pin[]> => {
  try {
    return await readPublicPins();
  } catch (e) {
    return dbFailure(e, []);
  }
});

/**
 * A failed database read must not look like "no projects" or "no such project":
 * that turned brief DB hiccups into 404s on valid pages and empty listings that
 * ISR then cached for an hour. At request time we throw instead — Next keeps
 * serving the last good cached page, or returns a 5xx that crawlers retry.
 * During `next build` (where the DB may be unreachable) the old fallback is kept,
 * so a deploy never fails on it; those pages regenerate on the first request.
 */
function dbFailure<T>(e: unknown, fallback: T): T {
  if (process.env.NEXT_PHASE === 'phase-production-build') {
    console.warn('[seo] DB read failed during build; using empty fallback:', (e as Error)?.message || e);
    return fallback;
  }
  throw e;
}

/**
 * Every public property project carrying pin number `n`, in the same order the
 * single lookup used. Normally one; two projects can share a number by mistake
 * (e.g. 116: "Yoo One" and "Codename Autobiography by Jhamtani").
 */
const readPinsByNumber = cachedRead('seo-pins-by-number', ['pins'], 600, async (n: number): Promise<Pin[]> => {
  const res = await runDbOp(
    { table: 'pins', action: 'select', filters: [{ op: 'eq', col: 'number', val: n }] },
    false,
  );
  // An empty list is a real 404; a failed read throws (never a false "not found").
  if (res.error || !Array.isArray(res.data)) throw new Error(`pin ${n} read failed: ${res.error?.message || 'no data'}`);
  // Office markers and land parcels have no project page. Covers are requested as
  // an optimized ~1000px WebP from /api/media, not the full-size original.
  return (res.data as Pin[])
    .filter(isPropertyProject)
    .map((row) => withDisplayName(withMediaUrls('pins', row, { width: 1000 }) as Pin));
});

export const getPinsByNumber = cache(async (n: number): Promise<Pin[]> => {
  try {
    return await readPinsByNumber(n);
  } catch (e) {
    return dbFailure(e, []);
  }
});

/**
 * Resolve a /projects/<slug> URL to its pin via the trailing number (any title
 * prefix matches, and the layout redirects to the canonical slug). When two
 * projects share the number, the one whose canonical slug is the URL wins, so
 * each keeps its own page; any other prefix resolves to the first, as before.
 */
export async function getPinBySlug(slug: string): Promise<Pin | null> {
  const n = projectNumberFromSlug(slug);
  if (n == null) return null;
  const pins = await getPinsByNumber(n);
  if (pins.length <= 1) return pins[0] || null;
  return pins.find((p) => slugForProject(p) === slug) || pins[0];
}

// ---- derivations ----------------------------------------------------------

/** Localities named in a location, in display form (same slugs as the raw names). */
export function placesOf(location?: string): string[] {
  return localitiesOf(location).map(displayPlaceName).filter(Boolean);
}

export function primaryLocality(pin: Pin): string {
  return placesOf(pin.location)[0] || '';
}

export function cityOf(pin: Pin): CityKey {
  return cityFrom(pin.location, pin.lat, pin.lng);
}

export { CITY_LABELS, hasCityHub, type CityKey };

/** The cities these projects are in, e.g. "Bengaluru, Pune & Mumbai" (lib/seo/city.ts). */
export function citiesPhrase(pins: Pin[], max = 3): string {
  return phraseFor(pins.map(cityOf), max);
}

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
    for (const loc of placesOf(p.location)) {
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
