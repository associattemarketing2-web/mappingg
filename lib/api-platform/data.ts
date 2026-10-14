import { runDbOp } from '../db-engine';
import { withMediaUrls } from '../pin-media';
import { localitiesOf } from '../locality';
import { listPublished, getBySlug } from '../blog';
import { slugify } from '../seo/slug';
import { CITY_LABELS } from '../seo/city';
import { abs } from '../seo/config';
import {
  type PinRow, type InfraRow, type BlogRow, isPublicPin, isProject, visible, primaryLocalityOf, cityKeyOf,
  developerNameOf, coordsOf, apiStatus, STATUS_LABELS,
} from './serializers';

// Read-only data access for the public API. Everything goes through the site's
// existing data layer (runDbOp with isAuthed=false — the same path the public
// pages use), so:
//   - hidden pins are excluded in the query, exactly as on the public site;
//   - pending-review and rejected pins are additionally excluded here;
//   - reads come from runDbOp's 30-second in-process cache, so API traffic does
//     not turn into one database scan per request;
//   - inline base64 images never leave the database (md5 digests → /api/media URLs).
// Only the columns below are loaded; serializers.ts decides what is returned.

const PIN_COLUMNS = [
  'id', 'number', 'title', 'type', 'status', 'price', 'configuration', 'sqft', 'possession_timeline', 'launch_date',
  'developer', 'location', 'key_usp', 'description', 'rera_number', 'lat', 'lng', 'youtube_video_url', 'image',
  'image_url', 'image_meta', 'field_visibility', 'hidden', 'pending_review', 'rejected', 'updated_at',
].join(',');

export class DataUnavailable extends Error {}

/** Every public pin on the map (projects and other markers), with image URLs. */
export async function loadPublicPins(): Promise<PinRow[]> {
  const res = await runDbOp({ table: 'pins', action: 'select', columns: PIN_COLUMNS, order: { col: 'number', ascending: true } }, false);
  if (res.error || !Array.isArray(res.data)) throw new DataUnavailable('pins');
  const rows = withMediaUrls('pins', res.data as Record<string, unknown>[], { width: 800 }) as unknown as PinRow[];
  return rows.filter(isPublicPin);
}

/** Public property projects (office markers and land parcels excluded, as on /projects). */
export async function loadProjects(): Promise<PinRow[]> {
  return (await loadPublicPins()).filter((p) => isProject(p) && (p.number != null && p.number !== ''));
}

export async function findProject(idOrSlug: string): Promise<PinRow | null> {
  const n = /^\d+$/.test(idOrSlug) ? Number(idOrSlug) : Number(/-(\d+)$/.exec(idOrSlug)?.[1]);
  if (!Number.isSafeInteger(n)) return null;
  return (await loadProjects()).find((p) => Number(p.number) === n) || null;
}

// ---- developers and localities (derived from public projects) -----------------

export interface Grouped { id: string; name: string; projects: PinRow[] }

function group(projects: PinRow[], keyOf: (p: PinRow) => string[]): Grouped[] {
  const map = new Map<string, Grouped>();
  for (const p of projects) {
    for (const name of keyOf(p)) {
      const id = slugify(name);
      if (!id) continue;
      const g = map.get(id) || { id, name, projects: [] };
      g.projects.push(p);
      map.set(id, g);
    }
  }
  return [...map.values()].sort((a, b) => b.projects.length - a.projects.length || a.name.localeCompare(b.name));
}

export async function loadDevelopers(): Promise<Grouped[]> {
  return group(await loadProjects(), (p) => { const d = developerNameOf(p); return d ? [d] : []; });
}

export async function loadLocalities(): Promise<Grouped[]> {
  // A project can name several localities ("Mundhwa / Magarpatta"), as on /locations.
  return group(await loadProjects(), (p) => (visible(p, 'location') ? localitiesOf(p.location) : []));
}

export function groupSummary(g: Grouped, kind: 'developer' | 'locality') {
  const cities = [...new Set(g.projects.map(cityKeyOf))];
  const pts = g.projects.map(coordsOf).filter(Boolean) as { lat: number; lng: number }[];
  const base = {
    id: g.id,
    name: g.name,
    project_count: g.projects.length,
    url: abs(kind === 'developer' ? `/developers/${g.id}` : `/locations/${g.id}`),
    cities: cities.map((c) => ({ id: c, name: CITY_LABELS[c] })),
  };
  if (kind === 'developer') {
    const locs = [...new Set(g.projects.filter((p) => visible(p, 'location')).map(primaryLocalityOf).filter(Boolean))];
    return { ...base, localities: locs.slice(0, 20) };
  }
  // Average of the locality's project coordinates — a map centre, not a boundary.
  const center = pts.length ? { lat: +(pts.reduce((s, p) => s + p.lat, 0) / pts.length).toFixed(6), lng: +(pts.reduce((s, p) => s + p.lng, 0) / pts.length).toFixed(6) } : null;
  return { ...base, center };
}

// ---- categories -----------------------------------------------------------------

export async function loadCategories() {
  const projects = await loadProjects();
  const count = <K extends string>(keys: (K | null)[]) => {
    const m = new Map<K, number>();
    for (const k of keys) if (k) m.set(k, (m.get(k) || 0) + 1);
    return m;
  };
  const statuses = count(projects.map((p) => (visible(p, 'status') ? apiStatus(p.status) : null)));
  const types = new Map<string, { name: string; n: number }>();
  for (const p of projects) {
    const t = visible(p, 'type') && typeof p.type === 'string' ? p.type.trim() : '';
    if (!t) continue;
    const id = slugify(t);
    const cur = types.get(id) || { name: t, n: 0 };
    cur.n += 1;
    types.set(id, cur);
  }
  const cities = count(projects.map(cityKeyOf));
  return {
    statuses: [...statuses].map(([id, n]) => ({ id, name: STATUS_LABELS[id], project_count: n })),
    property_types: [...types].map(([id, t]) => ({ id, name: t.name, project_count: t.n })).sort((a, b) => b.project_count - a.project_count),
    cities: [...cities].map(([id, n]) => ({ id, name: CITY_LABELS[id], project_count: n })).sort((a, b) => b.project_count - a.project_count),
  };
}

// ---- infrastructure ---------------------------------------------------------------

export async function loadInfrastructure(): Promise<{ markers: InfraRow[]; labels: Record<string, string> }> {
  const [m, t] = await Promise.all([
    runDbOp({ table: 'infra_markers', action: 'select', columns: 'id,title,type,lat,lng,updated_at' }, false),
    runDbOp({ table: 'infra_types', action: 'select', columns: 'id,key,label' }, false),
  ]);
  if (m.error || !Array.isArray(m.data)) throw new DataUnavailable('infra_markers');
  const labels: Record<string, string> = {};
  if (Array.isArray(t.data)) for (const r of t.data as { key?: string; label?: string }[]) if (r.key && r.label) labels[r.key] = r.label;
  return { markers: m.data as InfraRow[], labels };
}

// ---- blogs ------------------------------------------------------------------------

/** Published posts only (listPublished filters status = 'published'). */
export async function loadBlogs(): Promise<BlogRow[]> {
  return (await listPublished()).filter((b) => b.status === 'published') as BlogRow[];
}

export async function findBlog(slug: string): Promise<BlogRow | null> {
  const b = await getBySlug(slug);
  return b && b.status === 'published' ? (b as BlogRow) : null;
}
