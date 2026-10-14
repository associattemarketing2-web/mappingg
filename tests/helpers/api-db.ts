import { PGlite } from '@electric-sql/pglite';

// Integration-test database: a real PostgreSQL engine (PGlite) running in this
// process, so tests exercise the same SQL as production without touching the
// production database. lib/pg.ts caches its pool on globalThis._pgPool; we put
// a PGlite-backed object there before anything queries, so the whole stack —
// mongo-compat, db-engine, blog, and the API store — runs against it.

export async function startTestDb() {
  const pg = new PGlite();
  for (const t of ['pins', 'posts', 'infra_markers', 'infra_types', 'roads', 'map_settings', 'area_boundaries', 'users']) {
    await pg.exec(`CREATE TABLE IF NOT EXISTS "${t}" (id text PRIMARY KEY, doc jsonb NOT NULL DEFAULT '{}'::jsonb)`);
  }
  (globalThis as unknown as { _pgPool: unknown })._pgPool = {
    query: async (text: string, params: unknown[] = []) => {
      const r = await pg.query(text, params as never[]);
      return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
    },
    on() {},
  };
  process.env.AUTH_SECRET ||= 'test-secret-not-used-in-production';
  const insert = async (table: string, docs: Record<string, unknown>[]) => {
    for (const d of docs) await pg.query(`INSERT INTO "${table}" (id, doc) VALUES ($1, $2::jsonb)`, [String(d.id), JSON.stringify(d)]);
  };
  return { pg, insert };
}

const vis = { name: true, developer: true, location: true, status: true, type: true, price: true, configuration: true, possession: true, rera: true, key_usp: true };

/** Test fixtures — clearly fake records, only ever written to the in-process test database. */
export const FIXTURE_PINS = [
  {
    id: 'p1', number: 1, title: 'Test Towers', developer: 'TEST BUILDERS', location: 'Kharadi, Pune', status: 'construction', type: 'Residential',
    price: '₹ 1 Cr Onwards', configuration: '2 / 3 BHK', sqft: '850-1200', possession_timeline: 'Dec 2030', rera_number: 'P52100000001',
    key_usp: 'Near test park', description: 'A fixture project.', lat: 18.55, lng: 73.94, field_visibility: vis, updated_at: '2026-10-01T00:00:00Z',
    source: 'intake', owner_user_id: 'user-secret', intake_project_id: 'intake-secret', brochure_url: 'https://internal.example/brochure.pdf',
    custom_fields: [{ label: 'Internal note', value: 'do not leak', visible: false }], hidden: false, pending_review: false, rejected: false,
  },
  {
    id: 'p2', number: 2, title: 'Price Hidden Residency', developer: 'Test Builders', location: 'Mundhwa, Pune', status: 'available', type: 'Residential',
    price: '₹ 9 Cr secret', configuration: '4 BHK', lat: 18.53, lng: 73.93, field_visibility: { ...vis, price: false, rera: false }, rera_number: 'P52100000002',
    updated_at: '2026-10-05T00:00:00Z',
  },
  { id: 'p3', number: 3, title: 'Hidden Project', developer: 'Test Builders', location: 'Kharadi, Pune', status: 'upcoming', price: '₹ 2 Cr', lat: 18.56, lng: 73.95, hidden: true },
  { id: 'p4', number: 4, title: 'Pending Project', developer: 'Test Builders', location: 'Kharadi, Pune', status: 'upcoming', price: '₹ 2 Cr', lat: 18.56, lng: 73.95, pending_review: true },
  { id: 'p5', number: 5, title: 'Rejected Project', developer: 'Test Builders', location: 'Kharadi, Pune', status: 'upcoming', price: '₹ 2 Cr', lat: 18.56, lng: 73.95, rejected: true },
  { id: 'p6', number: 6, title: 'Our Advisory Office', type: 'Office', location: 'Hadapsar, Pune', lat: 18.5, lng: 73.92 },
  { id: 'p7', number: 7, title: 'Thane Heights', developer: 'Other Corp', location: 'Thane', status: 'upcoming', type: 'Residential', price: '₹ 80 L', lat: 19.2, lng: 72.97, updated_at: '2026-09-01T00:00:00Z' },
];

export const FIXTURE_POSTS = [
  { id: 'b1', slug: 'published-post', title: 'Published post', excerpt: 'Hello', content: '<p>Body</p>', status: 'published', tags: ['Pune'], published_at: '2026-10-01T00:00:00Z' },
  { id: 'b2', slug: 'draft-post', title: 'Draft post', content: '<p>Secret draft</p>', status: 'draft', published_at: null },
];

export const FIXTURE_INFRA = [
  { id: 'i1', title: 'Test Metro', type: 'metro', lat: 18.55, lng: 73.94, notes: 'internal note', icon_image: 'data:image/png;base64,AAAA' },
  { id: 'i2', title: 'Far Hospital', type: 'hospital', lat: 19.2, lng: 72.9, notes: '' },
];
