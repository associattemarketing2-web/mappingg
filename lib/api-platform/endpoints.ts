import { z } from 'zod';
import { query as pgQuery } from '../pg';
import { slugify } from '../seo/slug';
import { localitiesOf } from '../locality';
import { API_VERSION, LIMITS, SCOPES } from './config';
import { apiRoute, ApiError, pageParams, paginate, slugParam, notFound } from './handler';
import * as data from './data';
import {
  serializeProject, serializeProjectSummary, serializeMapPin, serializeBlog, serializeBlogSummary, serializeInfra,
  apiStatus, coordsOf, cityKeyOf, developerNameOf, visible, isProject, pinNumber, type PinRow,
} from './serializers';
import { openApiSpec } from './openapi';

// Every /api/v1 endpoint. Route files under app/api/v1 just re-export these.

const slug = z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be a slug (a-z, 0-9, hyphens)').max(120);
const lat = z.coerce.number().min(-90).max(90);
const lng = z.coerce.number().min(-180).max(180);
const statusEnum = z.enum(['upcoming', 'under_construction', 'ready_to_move', 'sold']);
const cityEnum = z.enum(['pune', 'mumbai', 'hyderabad', 'bengaluru', 'dubai', 'nashik', 'delhi']);

// ---- health / metadata / openapi ------------------------------------------------

export const health = apiRoute({
  route: '/health',
  scope: 'public',
  publicCache: 'no-store',
  handler: async () => {
    // Minimal: up/down only. No versions of dependencies, hosts, env or errors.
    const database = await Promise.race([
      pgQuery('SELECT 1').then(() => 'ok' as const),
      new Promise<'unavailable'>((r) => setTimeout(() => r('unavailable'), 2000)),
    ]).catch(() => 'unavailable' as const);
    return { data: { status: database === 'ok' ? 'ok' : 'degraded', version: API_VERSION, time: new Date().toISOString() } };
  },
});

export const openapi = apiRoute({
  route: '/openapi.json',
  scope: 'public',
  publicCache: 'public, max-age=300',
  handler: async () => new Response(JSON.stringify(openApiSpec(), null, 2), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=300' } }),
});

export const metadata = apiRoute({
  route: '/metadata',
  scope: null,
  handler: async ({ app }) => ({
    data: {
      api_version: API_VERSION,
      application: { id: app!.id, name: app!.name, status: app!.status, expires_at: app!.expires_at },
      scopes: app!.scopes.map((s) => ({ id: s, description: SCOPES[s] })),
      limits: {
        requests_per_minute: app!.rate_per_minute,
        daily_quota: app!.daily_quota,
        max_page_size: Math.min(app!.max_page_size, LIMITS.maxPageSize),
        max_records_reachable_by_paging: LIMITS.maxOffset,
        max_concurrent_requests: LIMITS.maxConcurrentPerApp,
      },
      attribution: 'Data © Mappingg (mappingg.com). Show “Source: Mappingg” with a link to the project or page URL wherever you display it.',
      documentation_url: 'https://www.mappingg.com/developer-api',
    },
  }),
});

// ---- projects -------------------------------------------------------------------

const projectQuery = z.object({
  ...pageParams,
  q: z.string().trim().min(2).max(80).optional(),
  locality: slug.optional(),
  developer: slug.optional(),
  city: cityEnum.optional(),
  status: statusEnum.optional(),
  type: slug.optional(),
  updated_since: z.string().datetime({ offset: true }).optional(),
  sort: z.enum(['id', 'name', '-updated_at']).default('id'),
}).strict();

function filterProjects(all: PinRow[], f: z.infer<typeof projectQuery>) {
  const q = f.q?.toLowerCase();
  const since = f.updated_since ? Date.parse(f.updated_since) : null;
  const out = all.filter((p) => {
    if (q && !(visible(p, 'name') && (p.title || '').toLowerCase().includes(q))) return false;
    if (f.locality && !(visible(p, 'location') && localitiesOf(p.location).some((l) => slugify(l) === f.locality))) return false;
    if (f.developer && slugify(developerNameOf(p) || '') !== f.developer) return false;
    if (f.city && cityKeyOf(p) !== f.city) return false;
    if (f.status && !(visible(p, 'status') && apiStatus(p.status) === f.status)) return false;
    if (f.type && !(visible(p, 'type') && slugify(p.type || '') === f.type)) return false;
    if (since != null && !(p.updated_at && Date.parse(p.updated_at) >= since)) return false;
    return true;
  });
  if (f.sort === 'name') out.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  else if (f.sort === '-updated_at') out.sort((a, b) => (Date.parse(b.updated_at || '') || 0) - (Date.parse(a.updated_at || '') || 0));
  else out.sort((a, b) => (pinNumber(a) || 0) - (pinNumber(b) || 0));
  return out;
}

export const projects = apiRoute({
  route: '/projects',
  scope: 'projects:read',
  query: projectQuery,
  handler: async ({ query, app }) => {
    const page = paginate(filterProjects(await data.loadProjects(), query), query.page, query.limit, app);
    return { ...page, data: page.data.map(serializeProjectSummary) };
  },
});

export const project = apiRoute({
  route: '/projects/{id}',
  scope: 'projects:read',
  handler: async ({ params }) => {
    const id = params.id || '';
    if (!/^\d{1,7}$/.test(id) && !/^[a-z0-9]+(?:-[a-z0-9]+)*-\d{1,7}$/.test(id)) throw new ApiError(400, 'invalid_parameter', 'Project id must be a number or a project slug ending in its number.');
    const p = await data.findProject(id);
    if (!p) throw notFound('Project');
    return { data: serializeProject(p) };
  },
});

// Unauthenticated demo: three projects, summary fields only, for trying the API in a browser.
export const sampleProjects = apiRoute({
  route: '/sample/projects',
  scope: 'public',
  publicCache: 'public, max-age=300, s-maxage=300',
  handler: async () => {
    const all = (await data.loadProjects()).filter((p) => visible(p, 'name') && visible(p, 'price') && p.price && coordsOf(p));
    return { data: all.slice(0, 3).map(serializeProjectSummary) };
  },
});

// ---- developers / localities ---------------------------------------------------

const groupQuery = z.object({ ...pageParams, q: z.string().trim().min(2).max(80).optional(), city: cityEnum.optional() }).strict();

function groupList(kind: 'developer' | 'locality') {
  return async ({ query, app }: { query: z.infer<typeof groupQuery>; app: Parameters<typeof paginate>[3] }) => {
    let groups = kind === 'developer' ? await data.loadDevelopers() : await data.loadLocalities();
    if (query.q) groups = groups.filter((g) => g.name.toLowerCase().includes(query.q!.toLowerCase()));
    if (query.city) groups = groups.filter((g) => g.projects.some((p) => cityKeyOf(p) === query.city));
    const page = paginate(groups, query.page, query.limit, app);
    return { ...page, data: page.data.map((g) => data.groupSummary(g, kind)) };
  };
}

function groupOne(kind: 'developer' | 'locality') {
  return async ({ params }: { params: Record<string, string> }) => {
    const id = slugParam(params.id);
    const groups = kind === 'developer' ? await data.loadDevelopers() : await data.loadLocalities();
    const g = groups.find((x) => x.id === id);
    if (!g) throw notFound(kind === 'developer' ? 'Developer' : 'Locality');
    // Capped: a group page is not a way around project pagination.
    const projects = g.projects.slice(0, LIMITS.maxPageSize).map(serializeProjectSummary);
    return { data: { ...data.groupSummary(g, kind), projects, projects_truncated: g.projects.length > projects.length }, records: projects.length };
  };
}

export const developers = apiRoute({ route: '/developers', scope: 'developers:read', query: groupQuery, handler: groupList('developer') });
export const developer = apiRoute({ route: '/developers/{id}', scope: 'developers:read', handler: groupOne('developer') });
export const localities = apiRoute({ route: '/localities', scope: 'localities:read', query: groupQuery, handler: groupList('locality') });
export const locality = apiRoute({ route: '/localities/{id}', scope: 'localities:read', handler: groupOne('locality') });

// ---- categories ---------------------------------------------------------------------

export const categories = apiRoute({
  route: '/categories',
  scope: 'projects:read',
  handler: async () => ({ data: await data.loadCategories() }),
});

// ---- map -----------------------------------------------------------------------------

const bbox = { north: lat, south: lat, east: lng, west: lng };
const checkBox = (b: { north: number; south: number; east: number; west: number }, ctx: z.RefinementCtx) => {
  if (b.north < b.south) ctx.addIssue({ code: 'custom', path: ['north'], message: 'north must be ≥ south' });
  if (b.east < b.west) ctx.addIssue({ code: 'custom', path: ['east'], message: 'east must be ≥ west (boxes across the antimeridian are not supported)' });
};
const MAP_MAX = 500;
const ZOOM_CLUSTER_BELOW = 13; // same threshold as the public map (/api/map/pins)

const mapQuery = z.object({
  ...bbox,
  zoom: z.coerce.number().min(0).max(22).optional(),
  limit: z.coerce.number().int().min(1).max(MAP_MAX).default(200),
  status: statusEnum.optional(),
  type: slug.optional(),
  developer: slug.optional(),
  locality: slug.optional(),
}).strict().superRefine(checkBox);

export const mapPins = apiRoute({
  route: '/map/pins',
  scope: 'map:read',
  query: mapQuery,
  handler: async ({ query: f }) => {
    const inBox = (await data.loadPublicPins()).filter((p) => {
      const c = coordsOf(p);
      if (!c || !isProject(p) || pinNumber(p) == null) return false;
      if (c.lat < f.south || c.lat > f.north || c.lng < f.west || c.lng > f.east) return false;
      if (f.status && !(visible(p, 'status') && apiStatus(p.status) === f.status)) return false;
      if (f.type && !(visible(p, 'type') && slugify(p.type || '') === f.type)) return false;
      if (f.developer && slugify(developerNameOf(p) || '') !== f.developer) return false;
      if (f.locality && !(visible(p, 'location') && localitiesOf(p.location).some((l) => slugify(l) === f.locality))) return false;
      return true;
    });
    const total = inBox.length;
    let clusters: { lat: number; lng: number; count: number }[] = [];
    let singles = inBox;
    if (f.zoom != null && f.zoom < ZOOM_CLUSTER_BELOW) {
      // Grid clustering, same cell sizes as the public map.
      const decimals = f.zoom <= 8 ? 1 : f.zoom <= 10 ? 2 : 3;
      const k = 10 ** decimals;
      const cells = new Map<string, PinRow[]>();
      for (const p of inBox) {
        const c = coordsOf(p)!;
        const key = `${Math.round(c.lat * k)}:${Math.round(c.lng * k)}`;
        cells.set(key, [...(cells.get(key) || []), p]);
      }
      singles = [];
      for (const ps of cells.values()) {
        if (ps.length === 1) { singles.push(ps[0]); continue; }
        const pts = ps.map((p) => coordsOf(p)!);
        clusters.push({ lat: +(pts.reduce((s, c) => s + c.lat, 0) / ps.length).toFixed(6), lng: +(pts.reduce((s, c) => s + c.lng, 0) / ps.length).toFixed(6), count: ps.length });
      }
      clusters = clusters.slice(0, MAP_MAX);
    }
    const pins = singles.slice(0, f.limit).map(serializeMapPin);
    return {
      data: { bounds: { north: f.north, south: f.south, east: f.east, west: f.west }, zoom: f.zoom ?? null, total, truncated: singles.length > pins.length, clusters, pins },
      records: pins.length + clusters.length,
    };
  },
});

const infraQuery = z.object({
  ...pageParams,
  north: lat.optional(), south: lat.optional(), east: lng.optional(), west: lng.optional(),
  type: slug.optional(),
}).strict().superRefine((v, ctx) => {
  const given = [v.north, v.south, v.east, v.west].filter((x) => x != null).length;
  if (given !== 0 && given !== 4) ctx.addIssue({ code: 'custom', path: ['north'], message: 'give all of north, south, east and west, or none' });
  else if (given === 4) checkBox(v as { north: number; south: number; east: number; west: number }, ctx);
});

export const infrastructure = apiRoute({
  route: '/map/infrastructure',
  scope: 'infrastructure:read',
  query: infraQuery,
  handler: async ({ query: f, app }) => {
    const { markers, labels } = await data.loadInfrastructure();
    const rows = markers.map((m) => serializeInfra(m, labels)).filter((m) => {
      if (!m.coordinates) return false;
      if (f.type && slugify(m.type) !== f.type) return false;
      if (f.north != null) {
        const { lat: la, lng: ln } = m.coordinates;
        if (la < f.south! || la > f.north || ln < f.west! || ln > f.east!) return false;
      }
      return true;
    }).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    return paginate(rows, f.page, f.limit, app, 50);
  },
});

// ---- blogs ------------------------------------------------------------------------------

const blogQuery = z.object({ ...pageParams, tag: z.string().trim().min(1).max(40).optional() }).strict();

export const blogs = apiRoute({
  route: '/blogs',
  scope: 'blogs:read',
  query: blogQuery,
  handler: async ({ query, app }) => {
    let all = await data.loadBlogs();
    if (query.tag) all = all.filter((b) => (b.tags || []).some((t) => t.toLowerCase() === query.tag!.toLowerCase()));
    const page = paginate(all, query.page, query.limit, app, 10);
    return { ...page, data: page.data.map(serializeBlogSummary) };
  },
});

export const blog = apiRoute({
  route: '/blogs/{slug}',
  scope: 'blogs:read',
  handler: async ({ params }) => {
    const b = await data.findBlog(slugParam(params.slug));
    if (!b) throw notFound('Article');
    return { data: serializeBlog(b) };
  },
});
