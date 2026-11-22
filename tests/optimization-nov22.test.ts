import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { NextRequest } from 'next/server';
import { startTestDb, FIXTURE_PINS } from './helpers/api-db';
import { publicImageUrl } from '../lib/seo/public-media';

// Regression tests for the 22 Nov 2026 optimisation pass
// (seo-doc/IMPLEMENTATION-PLAN.md, seo-doc/MAPPINGG-OPTIMIZATION-REPORT.md).
// Everything runs against an in-process PGlite database — never production.

const require = createRequire(import.meta.url);
(globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage ??= require('node:async_hooks').AsyncLocalStorage;
const { requestAsyncStorage } = require('next/dist/client/components/request-async-storage.external.js');
const { RequestCookies } = require('next/dist/compiled/@edge-runtime/cookies');

let pgq: (sql: string, p?: unknown[]) => Promise<{ rows: any[] }>;

async function call(handler: (req: NextRequest) => Promise<Response>, url: string) {
  const headers = new Headers({ 'x-forwarded-for': '10.7.7.7' });
  const req = new NextRequest(`http://localhost${url}`, { headers });
  const store = { headers, cookies: new RequestCookies(headers), mutableCookies: new RequestCookies(headers), draftMode: { isEnabled: false } };
  const res: Response = await requestAsyncStorage.run(store, () => handler(req));
  return { status: res.status, body: await res.json().catch(() => null) };
}

before(async () => {
  const { pg, insert } = await startTestDb();
  pgq = (s, p) => pg.query(s, p as never[]) as never;
  await pg.exec(`CREATE TABLE IF NOT EXISTS api_counters (k text PRIMARY KEY, n integer NOT NULL DEFAULT 0, expires_at timestamptz NOT NULL)`);
  await insert('pins', FIXTURE_PINS);
});

// ---------------------------------------------------------------------------
// Crawlable public image addresses (robots.txt blocks /api/)
// ---------------------------------------------------------------------------

test('publicImageUrl: pin media → /media/pins, keeps query, sets width', () => {
  assert.equal(publicImageUrl('/api/media/pins/abc-1?f=image&v=12ab'), '/media/pins/abc-1?f=image&v=12ab');
  assert.equal(publicImageUrl('/api/media/pins/abc-1?f=image&v=12ab&w=96', { width: 1200 }), '/media/pins/abc-1?f=image&v=12ab&w=1200');
});

test('publicImageUrl: public project-media images → /media/project/<path>', () => {
  const u = '/api/partners/storage?bucket=project-media&path=13207bee%2Fofficial-pin415-01.jpg&public=1';
  assert.equal(publicImageUrl(u), '/media/project/13207bee/official-pin415-01.jpg');
  assert.equal(publicImageUrl(u, { width: 640 }), '/media/project/13207bee/official-pin415-01.jpg?w=640');
});

test('publicImageUrl: private buckets, non-public files, PDFs and other URLs are left alone', () => {
  const pdf = '/api/partners/storage?bucket=project-media&path=x%2Fbrochure.pdf&public=1';
  const priv = '/api/partners/storage?bucket=submission-files&path=x%2Fa.jpg&public=1';
  const notPublic = '/api/partners/storage?bucket=project-media&path=x%2Fa.jpg';
  for (const u of [pdf, priv, notPublic, 'https://cdn.example/a.jpg', '/img/logo.png']) assert.equal(publicImageUrl(u), u);
  assert.equal(publicImageUrl(undefined), undefined);
});

test('blogThumb: known covers → 640px WebP; anything else unchanged', async () => {
  const { blogThumb } = await import('../lib/blog-thumb');
  const { BLOG_THUMBS: THUMBS } = await import('../lib/blog-thumbs');
  const sample = THUMBS[0];
  assert.ok(sample, 'manifest lists covers');
  assert.equal(blogThumb(`/img/blog/${sample}`), `/img/blog/thumbs/${sample.replace(/\.(jpe?g|png)$/i, '')}-640.webp`);
  assert.equal(blogThumb('/img/blog/not-in-manifest.jpg'), '/img/blog/not-in-manifest.jpg');
  assert.equal(blogThumb('https://cdn.example/x.jpg'), 'https://cdn.example/x.jpg');
  assert.equal(blogThumb(''), '');
});

// ---------------------------------------------------------------------------
// Shared (database) rate limit — holds across server instances
// ---------------------------------------------------------------------------

test('rateLimitShared: the count lives in the database, not just this process', async () => {
  const { rateLimitShared } = await import('../lib/rate-limit');
  const fresh = () => (globalThis as unknown as { __rateLimit?: Map<string, unknown> }).__rateLimit?.clear();
  // Simulate a new serverless instance before every call: in-memory counters are empty each time.
  for (let i = 1; i <= 3; i++) {
    fresh();
    assert.equal(await rateLimitShared('test-acct', 3, 60_000), null, `attempt ${i} allowed`);
  }
  fresh();
  const blocked = await rateLimitShared('test-acct', 3, 60_000);
  assert.ok(blocked, '4th attempt blocked even though this "instance" never saw the first three');
  assert.equal(blocked!.status, 429);
  assert.ok(Number(blocked!.headers.get('Retry-After')) >= 1);
  fresh();
  assert.equal(await rateLimitShared('other-acct', 3, 60_000), null, 'other keys are independent');
});

test('rateLimitShared: an expired window starts again from 1', async () => {
  const { rateLimitShared } = await import('../lib/rate-limit');
  await pgq(`INSERT INTO api_counters (k, n, expires_at) VALUES ('rl:old-acct', 99, now() - interval '1 minute')`);
  (globalThis as unknown as { __rateLimit?: Map<string, unknown> }).__rateLimit?.clear();
  assert.equal(await rateLimitShared('old-acct', 3, 60_000), null);
  const { rows } = await pgq(`SELECT n FROM api_counters WHERE k='rl:old-acct'`);
  assert.equal(Number(rows[0].n), 1);
});

// ---------------------------------------------------------------------------
// Public data API: plain filters only, internal pin fields stay private
// ---------------------------------------------------------------------------

test('/api/db: visitors cannot send operator filters', async () => {
  const { GET } = await import('../app/api/db/route');
  const op = (o: unknown) => `/api/db?op=${encodeURIComponent(JSON.stringify(o))}`;
  const bad = await call(GET, op({ table: 'pins', action: 'select', filters: [{ op: 'eq', col: 'title', val: { $regex: '.*' } }] }));
  assert.equal(bad.status, 400);
  const badIn = await call(GET, op({ table: 'pins', action: 'select', filters: [{ op: 'in', col: 'id', vals: [{ $ne: null }] }] }));
  assert.equal(badIn.status, 400);
  const badCol = await call(GET, op({ table: 'pins', action: 'select', filters: [{ op: 'eq', col: '$or', val: 1 }] }));
  assert.equal(badCol.status, 400);
  const ok = await call(GET, op({ table: 'pins', action: 'select', filters: [{ op: 'eq', col: 'id', val: 'p1' }] }));
  assert.equal(ok.status, 200);
  assert.equal(ok.body.data.length, 1);
});

test('/api/db: visitors never get workflow fields of a pin', async () => {
  const { GET } = await import('../app/api/db/route');
  const res = await call(GET, `/api/db?op=${encodeURIComponent(JSON.stringify({ table: 'pins', action: 'select' }))}`);
  assert.equal(res.status, 200);
  const p1 = res.body.data.find((p: { id: string }) => p.id === 'p1');
  assert.ok(p1, 'public pin is returned');
  for (const k of ['source', 'owner_user_id', 'intake_project_id', 'pending_review', 'rejected', 'brochure_url']) {
    assert.ok(!(k in p1), `${k} is not sent to visitors`);
  }
  assert.equal(p1.title, 'Test Towers', 'normal fields are still there');
  assert.ok(!res.body.data.some((p: { id: string }) => p.id === 'p3'), 'hidden pins stay out');
});

// ---------------------------------------------------------------------------
// Blog links to locality / developer hubs
// ---------------------------------------------------------------------------

test('resolveInternalLinks: city and facet links are unwrapped, unknown hubs unwrapped, project links kept', async () => {
  const { resolveInternalLinks } = await import('../lib/seo/resolve-links');
  const html = [
    '<a href="/cities/pune">Pune</a>',
    '<a href="/locations/kharadi/2-bhk-flats">2 BHK in Kharadi</a>',
    '<a href="/locations/no-such-place">Nowhere</a>',
    '<a href="https://www.mappingg.com/developers/nobody">Nobody</a>',
    '<a href="/projects/test-towers-kharadi-1">Test Towers</a>',
  ].join(' ');
  const out = await resolveInternalLinks(html);
  assert.ok(!out.includes('/cities/'), 'city link dropped');
  assert.ok(out.includes('2 BHK in Kharadi') && !out.includes('2-bhk-flats'), 'facet link dropped, text kept');
  assert.ok(out.includes('Nowhere') && !out.includes('no-such-place'), 'unknown locality dropped, text kept');
  assert.ok(out.includes('Nobody') && !out.includes('/developers/nobody'), 'unknown developer dropped, text kept');
  assert.ok(out.includes('href="/projects/'), 'project links kept');
});
