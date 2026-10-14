import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { startTestDb, FIXTURE_PINS, FIXTURE_POSTS, FIXTURE_INFRA } from './helpers/api-db';

// Integration tests for the Developer API (/api/v1): real route handlers, real
// SQL, against an in-process PostgreSQL (PGlite). See tests/helpers/api-db.ts.

let E: typeof import('../lib/api-platform/endpoints');
let store: typeof import('../lib/api-platform/store');
let settle: () => Promise<void>;
let pgq: (sql: string, p?: unknown[]) => Promise<{ rows: any[] }>;

const ADMIN = 'owner@test';
type Handler = (req: NextRequest, ctx?: { params?: Record<string, string> }) => Promise<Response>;

let ipSeq = 0;
async function call(h: Handler, path: string, key?: string | null, params?: Record<string, string>, ip?: string) {
  const headers: Record<string, string> = { 'x-forwarded-for': ip || `10.0.0.${(ipSeq++ % 250) + 1}` };
  if (key) headers.authorization = `Bearer ${key}`;
  const res = await h(new NextRequest(`http://localhost/api/v1${path}`, { headers }), { params });
  const body = await res.json();
  await settle();
  return { res, body, status: res.status };
}

async function newApp(scopes: string[], extra: Record<string, unknown> = {}) {
  return store.createApp({ name: `App ${Math.random().toString(36).slice(2, 7)}`, contact_email: 'dev@example.com', scopes, ...extra }, ADMIN);
}

before(async () => {
  const { pg, insert } = await startTestDb();
  pgq = (s, p) => pg.query(s, p as never[]) as never;
  await insert('pins', FIXTURE_PINS);
  await insert('posts', FIXTURE_POSTS);
  await insert('infra_markers', FIXTURE_INFRA);
  await insert('infra_types', [{ id: 't1', key: 'metro', label: 'Metro station' }]);
  E = await import('../lib/api-platform/endpoints');
  store = await import('../lib/api-platform/store');
  settle = (await import('../lib/api-platform/handler')).__settle;
});

// ---- authentication -----------------------------------------------------------------

test('1. valid key → 200 with data, pagination, request id and rate-limit headers', async () => {
  const { secret } = await newApp(['projects:read']);
  const { status, body, res } = await call(E.projects, '/projects', secret);
  assert.equal(status, 200);
  assert.equal(body.success, true);
  assert.ok(Array.isArray(body.data));
  assert.deepEqual(Object.keys(body.pagination).sort(), ['hasMore', 'limit', 'page', 'total']);
  assert.match(res.headers.get('x-request-id')!, /^[0-9a-f-]{36}$/);
  assert.equal(body.meta.requestId, res.headers.get('x-request-id'));
  assert.equal(res.headers.get('x-ratelimit-limit'), '60');
  assert.equal(res.headers.get('cache-control'), 'private, max-age=30');
  assert.equal(res.headers.get('vary'), 'Authorization');
  assert.equal(res.headers.get('access-control-allow-origin'), null, 'keyed endpoints send no CORS headers');
});

test('2. missing key → 401 missing_api_key with WWW-Authenticate', async () => {
  const { status, body, res } = await call(E.projects, '/projects');
  assert.equal(status, 401);
  assert.equal(body.success, false);
  assert.equal(body.error.code, 'missing_api_key');
  assert.ok(body.error.requestId);
  assert.match(res.headers.get('www-authenticate')!, /Bearer/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('3. invalid keys → 401 invalid_api_key (malformed, unknown id, wrong secret, wrong scheme)', async () => {
  const { secret } = await newApp(['projects:read']);
  const wrongSecret = secret.slice(0, -4) + (secret.endsWith('AAAA') ? 'BBBB' : 'AAAA');
  for (const k of ['nope', 'mgk_0000000000000000_' + 'a'.repeat(43), wrongSecret]) {
    const { status, body } = await call(E.projects, '/projects', k);
    assert.equal(status, 401, k);
    assert.equal(body.error.code, 'invalid_api_key');
  }
  // Key in a query string or another scheme is not accepted.
  const res = await E.projects(new NextRequest(`http://localhost/api/v1/projects?api_key=${secret}`, { headers: { authorization: `Basic ${secret}` } }));
  assert.equal(res.status, 401);
  await settle();
});

test('4. revoked key → 401; revoked application → 403 and every key dies', async () => {
  const { app, key, secret } = await newApp(['projects:read']);
  assert.equal((await call(E.projects, '/projects', secret)).status, 200);
  assert.equal(await store.revokeKey(app.id, key.id, ADMIN), true);
  const r = await call(E.projects, '/projects', secret);
  assert.equal(r.status, 401);
  assert.equal(r.body.error.code, 'revoked_api_key');

  const b = await newApp(['projects:read']);
  await store.setAppStatus(b.app.id, 'revoked', ADMIN);
  const r2 = await call(E.projects, '/projects', b.secret);
  assert.equal(r2.status, 403);
  assert.equal(r2.body.error.code, 'application_revoked');
  await assert.rejects(store.setAppStatus(b.app.id, 'active', ADMIN), /cannot be re-enabled/);
});

test('5. expired key / expired application / disabled application', async () => {
  const exp = await newApp(['projects:read'], { expires_at: new Date(Date.now() - 1000).toISOString() });
  const r = await call(E.projects, '/projects', exp.secret);
  assert.equal(r.status, 401);
  assert.equal(r.body.error.code, 'expired_api_key'); // the first key inherits the app expiry

  const app2 = await newApp(['projects:read']);
  await pgq(`UPDATE api_apps SET expires_at = now() - interval '1 minute' WHERE id=$1`, [app2.app.id]);
  assert.equal((await call(E.projects, '/projects', app2.secret)).body.error.code, 'application_expired');

  const app3 = await newApp(['projects:read']);
  await store.setAppStatus(app3.app.id, 'disabled', ADMIN);
  const d = await call(E.projects, '/projects', app3.secret);
  assert.equal(d.status, 403);
  assert.equal(d.body.error.code, 'application_disabled');
  await store.setAppStatus(app3.app.id, 'active', ADMIN);
  assert.equal((await call(E.projects, '/projects', app3.secret)).status, 200, 'disable is reversible');
});

test('6. insufficient scope → 403; no scopes granted by default', async () => {
  const { app, secret } = await newApp([]);
  assert.deepEqual(app.scopes, [], 'new apps get no scopes unless chosen');
  const r = await call(E.projects, '/projects', secret);
  assert.equal(r.status, 403);
  assert.equal(r.body.error.code, 'insufficient_scope');
  const b = await newApp(['blogs:read', 'not:a-scope', 'admin']);
  assert.deepEqual(b.app.scopes, ['blogs:read'], 'unknown scopes are dropped');
  assert.equal((await call(E.projects, '/projects', b.secret)).status, 403);
  assert.equal((await call(E.blogs, '/blogs', b.secret)).status, 200);
  assert.equal((await call(E.metadata, '/metadata', b.secret)).status, 200, '/metadata needs only a valid key');
});

// ---- limits -----------------------------------------------------------------------------

test('7. per-minute rate limit → 429 with Retry-After', async () => {
  const { secret } = await newApp(['projects:read'], { rate_per_minute: 3 });
  const statuses = [];
  for (let i = 0; i < 5; i++) statuses.push((await call(E.categories, '/categories', secret)).status);
  assert.deepEqual(statuses.slice(0, 3), [200, 200, 200]);
  const r = await call(E.categories, '/categories', secret);
  assert.equal(r.status, 429);
  assert.equal(r.body.error.code, 'rate_limited');
  assert.ok(Number(r.res.headers.get('retry-after')) >= 1);
  assert.equal(r.res.headers.get('x-ratelimit-remaining'), '0');
});

test('8. daily quota → 429 quota_exceeded', async () => {
  const { secret } = await newApp(['projects:read'], { daily_quota: 2 });
  assert.equal((await call(E.categories, '/categories', secret)).status, 200);
  assert.equal((await call(E.categories, '/categories', secret)).status, 200);
  const r = await call(E.categories, '/categories', secret);
  assert.equal(r.status, 429);
  assert.equal(r.body.error.code, 'quota_exceeded');
  assert.equal(r.res.headers.get('x-quota-remaining'), '0');
});

test('repeated failed authentication from one client → temporary block', async () => {
  const ip = '203.0.113.9';
  for (let i = 0; i < 30; i++) await call(E.projects, '/projects', 'mgk_0000000000000000_' + 'b'.repeat(43), undefined, ip);
  const { secret } = await newApp(['projects:read']);
  const r = await call(E.projects, '/projects', secret, undefined, ip);
  assert.equal(r.status, 429);
  assert.equal(r.body.error.code, 'client_blocked');
  assert.equal((await call(E.projects, '/projects', secret, undefined, '203.0.113.10')).status, 200, 'other clients unaffected');
});

// ---- visibility ---------------------------------------------------------------------------

test('9. hidden, pending-review, rejected pins and non-project markers are never returned', async () => {
  const { secret } = await newApp(['projects:read', 'map:read']);
  const list = await call(E.projects, '/projects', secret);
  assert.deepEqual(list.body.data.map((p: { id: number }) => p.id), [1, 2, 7]);
  for (const id of ['3', '4', '5', '6']) assert.equal((await call(E.project, `/projects/${id}`, secret, { id })).status, 404, `pin ${id}`);
  const map = await call(E.mapPins, '/map/pins?north=20&south=18&east=74&west=72', secret);
  assert.deepEqual(map.body.data.pins.map((p: { id: number }) => p.id).sort(), [1, 2, 7]);
});

test('10. only published blogs; drafts are 404', async () => {
  const { secret } = await newApp(['blogs:read']);
  const list = await call(E.blogs, '/blogs', secret);
  assert.deepEqual(list.body.data.map((b: { slug: string }) => b.slug), ['published-post']);
  assert.equal(list.body.data[0].content_html, undefined, 'list has no bodies');
  assert.equal((await call(E.blog, '/blogs/draft-post', secret, { slug: 'draft-post' })).status, 404);
  const one = await call(E.blog, '/blogs/published-post', secret, { slug: 'published-post' });
  assert.equal(one.body.data.content_html, '<p>Body</p>');
});

test('11. pagination and maximum page size', async () => {
  const { secret } = await newApp(['projects:read'], { max_page_size: 2 });
  const p1 = await call(E.projects, '/projects?limit=2', secret);
  assert.deepEqual(p1.body.pagination, { page: 1, limit: 2, total: 3, hasMore: true });
  const p2 = await call(E.projects, '/projects?limit=2&page=2', secret);
  assert.deepEqual(p2.body.data.map((p: { id: number }) => p.id), [7]);
  assert.equal(p2.body.pagination.hasMore, false);
  assert.equal((await call(E.projects, '/projects?limit=3', secret)).status, 400, 'above the app cap');
  assert.equal((await call(E.projects, '/projects?limit=101', secret)).status, 400, 'above the hard cap');
  assert.equal((await call(E.projects, '/projects?page=1000&limit=2', secret)).status, 200, '1000*2 is under the deep-paging limit');
  const big = await newApp(['projects:read'], { max_page_size: 100 });
  assert.equal((await call(E.projects, '/projects?page=60&limit=100', big.secret)).body.error.code, 'invalid_parameter', 'deep paging refused');
});

test('12. malformed filters, unknown/repeated params and invalid coordinates → 400', async () => {
  const { secret } = await newApp(['projects:read', 'map:read', 'infrastructure:read', 'developers:read']);
  const bad = [
    [E.projects, '/projects?status=done'], [E.projects, '/projects?locality=Kharadi%20Pune'], [E.projects, '/projects?foo=1'],
    [E.projects, '/projects?page=0'], [E.projects, '/projects?page=1&page=2'], [E.projects, '/projects?q=a'],
    [E.projects, '/projects?updated_since=yesterday'], [E.projects, "/projects?developer=x'%20OR%201=1--"],
    [E.mapPins, '/map/pins?north=18&south=19&east=74&west=73'], [E.mapPins, '/map/pins?north=91&south=18&east=74&west=73'],
    [E.mapPins, '/map/pins?north=abc&south=18&east=74&west=73'], [E.mapPins, '/map/pins'],
    [E.infrastructure, '/map/infrastructure?north=19'], [E.categories, '/categories?x=1'],
  ] as const;
  for (const [h, path] of bad) {
    const r = await call(h as Handler, path, secret);
    assert.equal(r.status, 400, path);
    assert.equal(r.body.error.code, 'invalid_parameter', path);
  }
  for (const id of ['../etc', 'abc', '1;drop', '1'.repeat(9)]) assert.equal((await call(E.project, `/projects/${id}`, secret, { id })).status, 400, id);
  assert.equal((await call(E.developer, '/developers/BAD_ID', secret, { id: 'BAD_ID' })).status, 400);
});

test('13. private fields never appear; field_visibility is honoured', async () => {
  const { secret } = await newApp(['projects:read']);
  const one = await call(E.project, '/projects/1', secret, { id: '1' });
  const text = JSON.stringify(one.body);
  for (const leak of ['user-secret', 'intake-secret', 'internal.example', 'do not leak', 'owner_user_id', 'source', 'hidden', 'pending_review', 'field_visibility', 'custom_fields']) {
    assert.ok(!text.includes(leak), `leaked ${leak}`);
  }
  assert.equal(one.body.data.rera_number, 'P52100000001');
  assert.equal(one.body.data.developer.name, 'Test Builders', 'display name');
  assert.equal(one.body.data.url, 'https://www.mappingg.com/projects/test-towers-kharadi-1');
  const p2 = await call(E.project, '/projects/price-hidden-residency-mundhwa-2', secret, { id: 'price-hidden-residency-mundhwa-2' });
  assert.equal(p2.status, 200);
  assert.equal(p2.body.data.price, null);
  assert.equal(p2.body.data.rera_number, null);
  assert.ok(!JSON.stringify(p2.body).includes('9 Cr secret'));

  const infra = await newApp(['infrastructure:read']);
  const m = await call(E.infrastructure, '/map/infrastructure', infra.secret);
  assert.ok(!JSON.stringify(m.body).includes('internal note') && !JSON.stringify(m.body).includes('base64'));
  assert.equal(m.body.data.find((x: { id: string }) => x.id === 'i1').type_label, 'Metro station');
});

test('14. API keys never authenticate admin or account routes', async () => {
  // Admin/account APIs authenticate with the session cookie only. Statically
  // verify none of them reads the Authorization header or the API key store.
  const { readFileSync, readdirSync, statSync } = await import('node:fs');
  const path = await import('node:path');
  const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = path.join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
  for (const dir of ['app/api/admin', 'app/api/my', 'app/api/auth', 'app/api/db', 'app/api/partners']) {
    for (const f of walk(dir).filter((x) => x.endsWith('.ts'))) {
      const src = readFileSync(f, 'utf8');
      assert.ok(!/api-platform\/(store|handler|keys)/.test(src) || f.includes('developer-api'), `${f} must not use API-key auth`);
      assert.ok(!/headers\.get\(['"]authorization['"]\)/i.test(src), `${f} reads Authorization`);
    }
  }
  const auth = readFileSync('lib/auth.ts', 'utf8');
  assert.ok(!/authorization/i.test(auth), 'session auth ignores Authorization headers');
});

test('15. key rotation: new key works, old key works during grace, then not; grace 0 revokes at once', async () => {
  const { app, secret: oldKey } = await newApp(['projects:read']);
  const rot = await store.rotateKey(app.id, 24, ADMIN);
  assert.ok(rot && rot.secret !== oldKey);
  assert.equal((await call(E.categories, '/categories', rot!.secret)).status, 200);
  assert.equal((await call(E.categories, '/categories', oldKey)).status, 200, 'old key still valid in grace');
  await pgq(`UPDATE api_keys SET expires_at = now() - interval '1 second' WHERE app_id=$1 AND id <> $2`, [app.id, rot!.key.id]);
  assert.equal((await call(E.categories, '/categories', oldKey)).body.error.code, 'expired_api_key');

  const rot2 = await store.rotateKey(app.id, 0, ADMIN);
  assert.equal((await call(E.categories, '/categories', rot!.secret)).body.error.code, 'revoked_api_key');
  assert.equal((await call(E.categories, '/categories', rot2!.secret)).status, 200);
  // Only hashes are stored.
  const { rows } = await pgq(`SELECT secret_hash FROM api_keys WHERE app_id=$1`, [app.id]);
  for (const r of rows) assert.ok(!r.secret_hash.includes('mgk_') && r.secret_hash.length === 64);
});

test('16. caching: keyed responses are private + Vary: Authorization; errors no-store; public endpoints public', async () => {
  const { secret } = await newApp(['projects:read']);
  const ok = await call(E.projects, '/projects', secret);
  assert.equal(ok.res.headers.get('cache-control'), 'private, max-age=30');
  const err = await call(E.projects, '/projects?foo=1', secret);
  assert.equal(err.res.headers.get('cache-control'), 'no-store');
  const pub = await call(E.sampleProjects, '/sample/projects');
  assert.equal(pub.status, 200);
  assert.match(pub.res.headers.get('cache-control')!, /^public/);
  assert.equal(pub.res.headers.get('access-control-allow-origin'), '*');
  assert.ok(pub.body.data.length <= 3);
  const h = await call(E.health, '/health');
  assert.equal(h.body.data.status, 'ok');
  assert.deepEqual(Object.keys(h.body.data).sort(), ['status', 'time', 'version']);
});

test('17. separate applications have separate counters and usage stats; logs hold no secrets', async () => {
  const a = await newApp(['projects:read'], { rate_per_minute: 2 });
  const b = await newApp(['projects:read'], { rate_per_minute: 2 });
  await call(E.categories, '/categories', a.secret);
  await call(E.categories, '/categories', a.secret);
  assert.equal((await call(E.categories, '/categories', a.secret)).status, 429);
  assert.equal((await call(E.categories, '/categories', b.secret)).status, 200, 'b has its own limit');
  const usage = await store.usageSummary();
  const ua = usage.find((u) => u.app_id === a.app.id)!, ub = usage.find((u) => u.app_id === b.app.id)!;
  assert.equal(ua.today, 3);
  assert.equal(ua.rate_limited_7_days, 1);
  assert.equal(ub.today, 1);
  const { rows } = await pgq(`SELECT * FROM api_request_log`);
  const dump = JSON.stringify(rows);
  assert.ok(!dump.includes('mgk_') && !dump.includes('Bearer'), 'no keys in logs');
  assert.ok(!/10\.0\.0\.\d|203\.0\.113/.test(dump), 'no raw IPs in logs');
  const events = await store.recentEvents({ securityOnly: true });
  assert.ok(events.some((e) => e.event === 'auth_failed') && events.some((e) => e.event === 'rate_limited'));
});

test('developers, localities, categories and map clustering are derived from public projects only', async () => {
  const { secret } = await newApp(['developers:read', 'localities:read', 'projects:read', 'map:read']);
  const devs = await call(E.developers, '/developers', secret);
  assert.deepEqual(devs.body.data.map((d: { id: string; project_count: number }) => [d.id, d.project_count]), [['test-builders', 2], ['other-corp', 1]]);
  const dev = await call(E.developer, '/developers/test-builders', secret, { id: 'test-builders' });
  assert.deepEqual(dev.body.data.projects.map((p: { id: number }) => p.id), [1, 2]);
  assert.equal((await call(E.developer, '/developers/nobody', secret, { id: 'nobody' })).status, 404);
  const locs = await call(E.localities, '/localities?city=pune', secret);
  assert.deepEqual(locs.body.data.map((l: { id: string }) => l.id).sort(), ['kharadi', 'mundhwa']);
  const cats = await call(E.categories, '/categories', secret);
  assert.deepEqual(cats.body.data.cities.map((c: { id: string }) => c.id), ['pune', 'mumbai']);
  const filtered = await call(E.projects, '/projects?status=ready_to_move', secret);
  assert.deepEqual(filtered.body.data.map((p: { id: number }) => p.id), [2]);
  const clustered = await call(E.mapPins, '/map/pins?north=20&south=18&east=74&west=72&zoom=6', secret);
  assert.equal(clustered.body.data.total, 3);
  assert.equal(clustered.body.data.clusters.reduce((s: number, c: { count: number }) => s + c.count, 0) + clustered.body.data.pins.length, 3);
});

test('kill switch turns data endpoints off but leaves health up', async () => {
  const { secret } = await newApp(['projects:read']);
  process.env.DEVELOPER_API_DISABLED = '1';
  try {
    assert.equal((await call(E.projects, '/projects', secret)).body.error.code, 'api_disabled');
    assert.equal((await call(E.health, '/health')).status, 200);
  } finally { delete process.env.DEVELOPER_API_DISABLED; }
});

test('admin audit trail records every key action without secrets', async () => {
  const { app, key, secret } = await newApp(['projects:read']);
  await store.rotateKey(app.id, 1, ADMIN);
  await store.revokeKey(app.id, key.id, ADMIN);
  await store.updateApp(app.id, { name: 'Renamed', scopes: ['blogs:read'], daily_quota: 999_999_999 }, ADMIN);
  const trail = await store.auditTrail(app.id);
  assert.deepEqual(trail.map((t) => t.action).reverse(), ['app.create', 'key.rotate', 'key.revoke', 'app.update']);
  assert.ok(!JSON.stringify(trail).includes(secret));
  assert.equal((await store.getApp(app.id))!.daily_quota, 200_000, 'limits are clamped to the hard ceiling');
});
