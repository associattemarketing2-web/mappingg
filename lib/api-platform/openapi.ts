import { API_BASE_PATH, API_VERSION, LIMITS, SCOPES, SCOPE_LIST } from './config';
import { SITE_URL } from '../seo/config';

// OpenAPI 3.1 description of /api/v1, built from the same constants the server
// enforces (scopes, limits). Served at /api/v1/openapi.json and rendered by the
// /developer-api/reference page. tests/api-openapi.test.ts checks that every
// documented path has a route file and every route file is documented.

type Obj = Record<string, unknown>;
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const nullable = (type: string, extra: Obj = {}) => ({ type: [type, 'null'], ...extra });
const qp = (name: string, schema: Obj, description: string, required = false) => ({ name, in: 'query', required, description, schema });
const pp = (name: string, description: string, schema: Obj = { type: 'string' }) => ({ name, in: 'path', required: true, description, schema });

const SLUG = { type: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$', maxLength: 120 };
const PAGE = [
  qp('page', { type: 'integer', minimum: 1, maximum: 1000, default: 1 }, `Page number. Paging stops at record ${LIMITS.maxOffset}.`),
  qp('limit', { type: 'integer', minimum: 1, maximum: LIMITS.maxPageSize }, `Page size (default 20, capped by your application's max page size, at most ${LIMITS.maxPageSize}).`),
];
const BBOX = (required: boolean) => [
  qp('north', { type: 'number', minimum: -90, maximum: 90 }, 'Northern latitude of the box.', required),
  qp('south', { type: 'number', minimum: -90, maximum: 90 }, 'Southern latitude of the box.', required),
  qp('east', { type: 'number', minimum: -180, maximum: 180 }, 'Eastern longitude of the box.', required),
  qp('west', { type: 'number', minimum: -180, maximum: 180 }, 'Western longitude of the box.', required),
];
const STATUS = { type: 'string', enum: ['upcoming', 'under_construction', 'ready_to_move', 'sold'] };
const CITY = { type: 'string', enum: ['pune', 'mumbai', 'hyderabad', 'bengaluru', 'dubai', 'nashik', 'delhi'] };

const ok = (data: Obj, paginated = false) => ({
  description: 'Success',
  headers: {
    'X-Request-Id': { schema: { type: 'string' } },
    'X-RateLimit-Remaining': { schema: { type: 'integer' } },
    'X-Quota-Remaining': { schema: { type: 'integer' } },
  },
  content: { 'application/json': { schema: {
    type: 'object', required: ['success', 'data', 'meta'],
    properties: { success: { const: true }, data, ...(paginated ? { pagination: ref('Pagination') } : {}), meta: ref('Meta') },
  } } },
});
const errors = (...codes: number[]) => Object.fromEntries(codes.map((c) => [String(c), { $ref: `#/components/responses/E${c}` }]));
const AUTHED = errors(400, 401, 403, 429, 500, 503);

function op(summary: string, scope: string | null, params: Obj[], data: Obj, opts: { paginated?: boolean; extra?: number[]; description?: string } = {}) {
  return {
    summary,
    ...(opts.description ? { description: opts.description } : {}),
    tags: [summary.split(' ')[0]],
    ...(scope === 'public' ? { security: [] } : { 'x-required-scope': scope ?? 'any valid key' }),
    parameters: params,
    responses: { 200: ok(data, opts.paginated), ...(scope === 'public' ? errors(429, 500) : AUTHED), ...errors(...(opts.extra || [])) },
  };
}

export function openApiSpec(): Obj {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Mappingg Developer API',
      version: API_VERSION,
      description:
        'Read-only access to Mappingg’s public real-estate data: projects, developers, localities, map pins, infrastructure markers and published articles. ' +
        'Access is by approved application only. Send your key as `Authorization: Bearer <key>` from your server — never from browser code.',
      contact: { name: 'Mappingg', url: `${SITE_URL}/contact` },
      termsOfService: `${SITE_URL}/terms`,
    },
    servers: [{ url: `${SITE_URL}${API_BASE_PATH}` }],
    security: [{ bearerAuth: [] }],
    tags: ['Health', 'Metadata', 'Projects', 'Sample', 'Categories', 'Developers', 'Localities', 'Map', 'Infrastructure', 'Blogs'].map((name) => ({ name })),
    'x-scopes': Object.fromEntries(SCOPE_LIST.map((s) => [s, SCOPES[s]])),
    paths: {
      '/health': { get: op('Health check', 'public', [], { type: 'object', properties: { status: { enum: ['ok', 'degraded'] }, version: { type: 'string' }, time: { type: 'string', format: 'date-time' } } }) },
      '/openapi.json': { get: { summary: 'Metadata: this OpenAPI document', tags: ['Metadata'], security: [], responses: { 200: { description: 'OpenAPI 3.1 JSON' } } } },
      '/metadata': { get: op('Metadata for your application: scopes and limits', null, [], ref('AppMetadata')) },
      '/sample/projects': { get: op('Sample: three projects, no key needed', 'public', [], { type: 'array', items: ref('ProjectSummary') }, { description: 'A fixed, tiny sample so you can see the response shape before you have a key. Rate limited per client.' }) },
      '/projects': {
        get: op('Projects: list public projects', 'projects:read', [
          ...PAGE,
          qp('q', { type: 'string', minLength: 2, maxLength: 80 }, 'Search in project names.'),
          qp('locality', SLUG, 'Locality id (from /localities), e.g. `kharadi`.'),
          qp('developer', SLUG, 'Developer id (from /developers), e.g. `kumar-properties`.'),
          qp('city', CITY, 'City.'),
          qp('status', STATUS, 'Project status.'),
          qp('type', SLUG, 'Property type id (from /categories).'),
          qp('updated_since', { type: 'string', format: 'date-time' }, 'Only projects updated at or after this time (ISO 8601 with time zone).'),
          qp('sort', { type: 'string', enum: ['id', 'name', '-updated_at'], default: 'id' }, 'Sort order.'),
        ], { type: 'array', items: ref('ProjectSummary') }, { paginated: true }),
      },
      '/projects/{id}': {
        get: op('Projects: one project', 'projects:read', [pp('id', 'Project number (e.g. `135`) or its slug (e.g. `new-beginnings-kharadi-135`).')], ref('Project'), { extra: [404] }),
      },
      '/categories': { get: op('Categories: statuses, property types and cities with project counts', 'projects:read', [], ref('Categories')) },
      '/developers': {
        get: op('Developers: list developers', 'developers:read', [...PAGE, qp('q', { type: 'string', minLength: 2, maxLength: 80 }, 'Search in names.'), qp('city', CITY, 'Only developers with projects in this city.')],
          { type: 'array', items: ref('DeveloperSummary') }, { paginated: true }),
      },
      '/developers/{id}': { get: op('Developers: one developer and their projects', 'developers:read', [pp('id', 'Developer id (slug).', SLUG)], ref('DeveloperDetail'), { extra: [404] }) },
      '/localities': {
        get: op('Localities: list localities', 'localities:read', [...PAGE, qp('q', { type: 'string', minLength: 2, maxLength: 80 }, 'Search in names.'), qp('city', CITY, 'Only localities in this city.')],
          { type: 'array', items: ref('LocalitySummary') }, { paginated: true }),
      },
      '/localities/{id}': { get: op('Localities: one locality and its projects', 'localities:read', [pp('id', 'Locality id (slug).', SLUG)], ref('LocalityDetail'), { extra: [404] }) },
      '/map/pins': {
        get: op('Map: project pins in a bounding box', 'map:read', [
          ...BBOX(true),
          qp('zoom', { type: 'number', minimum: 0, maximum: 22 }, 'Map zoom. Below 13, nearby pins are grouped into clusters.'),
          qp('limit', { type: 'integer', minimum: 1, maximum: 500, default: 200 }, 'Maximum individual pins returned.'),
          qp('status', STATUS, 'Project status.'), qp('type', SLUG, 'Property type id.'), qp('developer', SLUG, 'Developer id.'), qp('locality', SLUG, 'Locality id.'),
        ], ref('MapPins')),
      },
      '/map/infrastructure': {
        get: op('Infrastructure: public map markers', 'infrastructure:read', [...PAGE, ...BBOX(false), qp('type', SLUG, 'Marker type, e.g. `metro`, `hospital`.')],
          { type: 'array', items: ref('InfraMarker') }, { paginated: true, description: 'Give all four bounds or none.' }),
      },
      '/blogs': { get: op('Blogs: published articles', 'blogs:read', [...PAGE, qp('tag', { type: 'string', maxLength: 40 }, 'Only articles with this tag (case-insensitive).')], { type: 'array', items: ref('BlogSummary') }, { paginated: true }) },
      '/blogs/{slug}': { get: op('Blogs: one published article (with HTML)', 'blogs:read', [pp('slug', 'Article slug.', SLUG)], ref('Blog'), { extra: [404] }) },
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'mgk_<16 hex>_<43 chars>', description: 'Your Mappingg API key. Server-side only.' },
      },
      responses: Object.fromEntries([
        [400, 'Invalid parameter (unknown, repeated or out of range)'], [401, 'Missing, invalid, revoked or expired API key'],
        [403, 'Application disabled/revoked/expired, or the key lacks the required scope'], [404, 'Not found'],
        [429, 'Rate limit, daily quota or concurrency limit exceeded — see Retry-After'], [500, 'Internal error'],
        [503, 'API temporarily unavailable'],
      ].map(([code, description]) => [`E${code}`, { description, content: { 'application/json': { schema: ref('Error') } } }])),
      schemas: {
        Meta: { type: 'object', properties: { requestId: { type: 'string' }, apiVersion: { const: API_VERSION } } },
        Pagination: { type: 'object', properties: { page: { type: 'integer' }, limit: { type: 'integer' }, total: { type: 'integer' }, hasMore: { type: 'boolean' } } },
        Error: {
          type: 'object',
          properties: {
            success: { const: false },
            error: { type: 'object', required: ['code', 'message', 'requestId'], properties: {
              code: { type: 'string', enum: ['invalid_parameter', 'missing_api_key', 'invalid_api_key', 'revoked_api_key', 'expired_api_key', 'application_disabled', 'application_revoked', 'application_expired', 'insufficient_scope', 'not_found', 'rate_limited', 'quota_exceeded', 'client_blocked', 'timeout', 'response_too_large', 'internal_error', 'api_disabled', 'api_unavailable'] },
              message: { type: 'string' }, details: {}, requestId: { type: 'string' },
            } },
          },
        },
        Ref: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } } },
        ProjectSummary: {
          type: 'object',
          description: 'Fields an admin has hidden from the project’s public card are null.',
          properties: {
            id: { type: 'integer', description: 'Stable project number.' }, slug: { type: 'string' }, url: { type: 'string', format: 'uri' },
            name: nullable('string'), developer: { anyOf: [ref('Ref'), { type: 'null' }] }, property_type: nullable('string'),
            status: { anyOf: [STATUS, { type: 'null' }] }, status_label: nullable('string'), configuration: nullable('string', { description: 'As published, e.g. "2 / 3 BHK".' }),
            price: nullable('string', { description: 'As published, e.g. "₹ 1.12 Cr Onwards". Not normalised.' }), possession: nullable('string'),
            locality: { anyOf: [ref('Ref'), { type: 'null' }] }, city: ref('Ref'),
            coordinates: { anyOf: [{ type: 'object', properties: { lat: { type: 'number' }, lng: { type: 'number' } } }, { type: 'null' }] },
            image_url: nullable('string', { format: 'uri' }), updated_at: nullable('string', { format: 'date-time' }),
          },
        },
        Project: {
          allOf: [ref('ProjectSummary'), { type: 'object', properties: {
            description: nullable('string'), highlights: nullable('string'), address: nullable('string'), area_sqft: nullable('string'),
            launch_date: nullable('string'), rera_number: nullable('string', { description: 'MahaRERA number as listed by the developer. Mappingg does not certify it — verify on maharera.maharashtra.gov.in.' }),
            video_url: nullable('string', { format: 'uri' }),
          } }],
        },
        Categories: { type: 'object', properties: {
          statuses: { type: 'array', items: { type: 'object', properties: { id: STATUS, name: { type: 'string' }, project_count: { type: 'integer' } } } },
          property_types: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, project_count: { type: 'integer' } } } },
          cities: { type: 'array', items: { type: 'object', properties: { id: CITY, name: { type: 'string' }, project_count: { type: 'integer' } } } },
        } },
        DeveloperSummary: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, project_count: { type: 'integer' }, url: { type: 'string', format: 'uri' }, cities: { type: 'array', items: ref('Ref') }, localities: { type: 'array', items: { type: 'string' } } } },
        DeveloperDetail: { allOf: [ref('DeveloperSummary'), { type: 'object', properties: { projects: { type: 'array', items: ref('ProjectSummary') }, projects_truncated: { type: 'boolean' } } }] },
        LocalitySummary: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, project_count: { type: 'integer' }, url: { type: 'string', format: 'uri' }, cities: { type: 'array', items: ref('Ref') }, center: { description: 'Average of the locality’s project coordinates (a map centre, not a boundary).', anyOf: [{ type: 'object', properties: { lat: { type: 'number' }, lng: { type: 'number' } } }, { type: 'null' }] } } },
        LocalityDetail: { allOf: [ref('LocalitySummary'), { type: 'object', properties: { projects: { type: 'array', items: ref('ProjectSummary') }, projects_truncated: { type: 'boolean' } } }] },
        MapPins: { type: 'object', properties: {
          bounds: { type: 'object' }, zoom: nullable('number'), total: { type: 'integer' }, truncated: { type: 'boolean' },
          clusters: { type: 'array', items: { type: 'object', properties: { lat: { type: 'number' }, lng: { type: 'number' }, count: { type: 'integer' } } } },
          pins: { type: 'array', items: { type: 'object', properties: {
            id: { type: 'integer' }, slug: { type: 'string' }, url: { type: 'string' }, name: nullable('string'), developer: nullable('string'),
            status: { anyOf: [STATUS, { type: 'null' }] }, property_type: nullable('string'), locality: nullable('string'),
            coordinates: { type: 'object', properties: { lat: { type: 'number' }, lng: { type: 'number' } } },
          } } },
        } },
        InfraMarker: { type: 'object', properties: { id: { type: 'string' }, name: nullable('string'), type: { type: 'string' }, type_label: { type: 'string' }, coordinates: { type: 'object', properties: { lat: { type: 'number' }, lng: { type: 'number' } } }, updated_at: nullable('string') } },
        BlogSummary: { type: 'object', properties: {
          id: { type: 'string' }, slug: { type: 'string' }, url: { type: 'string', format: 'uri' }, title: { type: 'string' }, excerpt: nullable('string'),
          description: nullable('string'), tags: { type: 'array', items: { type: 'string' } }, author: { type: 'string' }, cover_image_url: nullable('string', { format: 'uri' }),
          reading_minutes: { type: 'integer' }, published_at: nullable('string', { format: 'date-time' }), updated_at: nullable('string', { format: 'date-time' }),
        } },
        Blog: { allOf: [ref('BlogSummary'), { type: 'object', properties: { content_html: { type: 'string', description: 'Article HTML as published on mappingg.com. Sanitise before rendering in your own pages.' } } }] },
        AppMetadata: { type: 'object', properties: {
          api_version: { type: 'string' }, application: { type: 'object' }, scopes: { type: 'array', items: { type: 'object', properties: { id: { type: 'string', enum: SCOPE_LIST }, description: { type: 'string' } } } },
          limits: { type: 'object' }, attribution: { type: 'string' }, documentation_url: { type: 'string' },
        } },
      },
    },
  };
}
