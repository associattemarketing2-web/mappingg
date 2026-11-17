import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { NextRequest } from 'next/server';
import { startTestDb } from './helpers/api-db';

// Subscription security at the HTTP layer: the real route handlers, a real
// signed session cookie, real SQL (PGlite). Checks that limits, roles and
// ownership are enforced on the server — not just hidden in the UI.

process.env.RAZORPAY_KEY_ID = 'rzp_test_FAKEKEY';
process.env.RAZORPAY_KEY_SECRET = 'test_key_secret';
process.env.RAZORPAY_WEBHOOK_SECRET = 'test_webhook_secret';
process.env.SUBSCRIPTION_ENFORCE = '1';

const require = createRequire(import.meta.url);
// Next's server runtime puts AsyncLocalStorage on globalThis before any route runs.
(globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage ??= require('node:async_hooks').AsyncLocalStorage;
const { requestAsyncStorage } = require('next/dist/client/components/request-async-storage.external.js');
const { RequestCookies } = require('next/dist/compiled/@edge-runtime/cookies');

let auth: typeof import('../lib/auth');
let L: typeof import('../lib/subscriptions/lifecycle');
let pgq: (sql: string, p?: unknown[]) => Promise<{ rows: any[] }>;

type U = { id: string; email: string; role: string };
const DEV = { id: 'r-dev', email: 'rdev@example.test', role: 'developer' };
const CP1 = { id: 'r-cp1', email: 'rcp1@example.test', role: 'agent' };
const CP2 = { id: 'r-cp2', email: 'rcp2@example.test', role: 'agent' };
const BUY1 = { id: 'r-b1', email: 'rb1@example.test', role: 'buyer' };
const BUY2 = { id: 'r-b2', email: 'rb2@example.test', role: 'buyer' };
const OWNER = { id: 'r-owner', email: 'owner@example.test', role: 'admin' };
const EMPLOYEE = { id: 'r-emp', email: 'emp@example.test', role: 'employee' };

/** Call a route handler as `user` (null = signed out). */
async function call(handler: (req: NextRequest, ctx?: any) => Promise<Response>, url: string, init: { method?: string; body?: unknown; user?: U | null; params?: Record<string, string>; headers?: Record<string, string>; raw?: string } = {}) {
  const headers = new Headers({ 'x-forwarded-for': `10.1.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`, ...(init.headers || {}) });
  if (init.user) headers.set('cookie', `${auth.SESSION_COOKIE}=${await auth.createSessionToken(init.user)}`);
  if (init.body !== undefined || init.raw) headers.set('content-type', 'application/json');
  const req = new NextRequest(`http://localhost${url}`, { method: init.method || 'GET', headers, body: init.raw ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined) });
  const store = { headers, cookies: new RequestCookies(headers), mutableCookies: new RequestCookies(headers), draftMode: { isEnabled: false } };
  const res: Response = await requestAsyncStorage.run(store, () => handler(req, { params: init.params || {} }));
  const text = await res.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body, headers: res.headers };
}

const pins = [
  ...Array.from({ length: 6 }, (_, i) => ({ id: `rp${i}`, number: 500 + i, title: `Route Pune ${i}`, location: 'Kharadi, Pune', lat: 18.55, lng: 73.94, status: 'upcoming', type: 'Residential', price: '₹ 1 Cr', brochure_url: 'https://example.test/b.pdf' })),
  { id: 'rm0', number: 600, title: 'Route Thane', location: 'Thane', lat: 19.2, lng: 72.97, status: 'upcoming', type: 'Residential' },
  ...Array.from({ length: 3 }, (_, i) => ({ id: `rd${i}`, number: 700 + i, title: `Dev Project ${i}`, location: 'Baner, Pune', lat: 18.56, lng: 73.78, owner_user_id: DEV.id, pending_review: false, hidden: false })),
];

before(async () => {
  const { pg, insert } = await startTestDb();
  pgq = (s, p) => pg.query(s, p as never[]) as never;
  for (const t of ['leads', 'account_activity']) await pg.exec(`CREATE TABLE IF NOT EXISTS "${t}" (id text PRIMARY KEY, doc jsonb NOT NULL DEFAULT '{}'::jsonb)`);
  await pg.exec(`CREATE TABLE IF NOT EXISTS partners_media (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), filename text NOT NULL, content_type text NOT NULL DEFAULT 'application/octet-stream', metadata jsonb NOT NULL DEFAULT '{}', upload_date timestamptz NOT NULL DEFAULT now(), data bytea NOT NULL)`);
  await insert('pins', pins);
  await insert('users', [DEV, CP1, CP2, BUY1, BUY2, OWNER, EMPLOYEE].map((u) => ({
    ...u, name: `Test ${u.role}`, mobile: '+91 9000000001', verification: 'approved', access: 'editor', permissions: [],
  })));
  auth = await import('../lib/auth');
  L = await import('../lib/subscriptions/lifecycle');
  await (await import('../lib/subscriptions/db')).ensureSchema();
});

test('subscription APIs require a signed-in public account; staff and visitors are refused', async () => {
  const { GET } = await import('../app/api/subscriptions/current/route');
  assert.equal((await call(GET as never, '/api/subscriptions/current')).status, 401);
  assert.equal((await call(GET as never, '/api/subscriptions/current', { user: OWNER })).status, 403);
  const r = await call(GET as never, '/api/subscriptions/current', { user: CP1 });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.plan.code, 'cp_free');
  assert.equal(r.headers.get('cache-control'), 'private, no-store');
});

test('CP free: the 4th project via "Enquire now" and via the details API is blocked (402)', async () => {
  const { POST } = await import('../app/api/my/enquire/route');
  const QV = await import('../app/api/project-quickview/route');
  for (const id of ['rp0', 'rp1', 'rp2']) {
    const r = await call(POST as never, '/api/my/enquire', { method: 'POST', user: CP1, body: { pin_id: id, consent: { enquiry: true } } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }
  // Same project again (refresh / another tab): still fine.
  assert.equal((await call(POST as never, '/api/my/enquire', { method: 'POST', user: CP1, body: { pin_id: 'rp1', consent: { enquiry: true } } })).status, 200);
  const blocked = await call(POST as never, '/api/my/enquire', { method: 'POST', user: CP1, body: { pin_id: 'rp3', consent: { enquiry: true } } });
  assert.equal(blocked.status, 402);
  assert.equal(blocked.body.error.code, 'limit_reached');
  assert.equal(blocked.body.error.upgrade.code, 'cp_pro');
  assert.equal(blocked.body.error.usage.used, 3);
  // Calling the details API directly doesn't get around it.
  const direct = await call(QV.GET as never, '/api/project-quickview?n=504', { user: CP1 });
  assert.equal(direct.status, 402);
  // Visitors keep the public details (SEO / guests unchanged).
  const anon = await call(QV.GET as never, '/api/project-quickview?n=504');
  assert.notEqual(anon.status, 402);
  // No lead was created for the refused project.
  assert.equal((await pgq(`SELECT count(*)::int n FROM leads WHERE doc->>'pin_id' = 'rp3'`)).rows[0].n, 0);
});

test('CP brochure download needs Pro; CRM needs a plan; leads are private to each CP', async () => {
  const B = await import('../app/api/brochure/[id]/route');
  const LEADS = await import('../app/api/cp/leads/route');
  assert.equal((await call(B.GET as never, '/api/brochure/rp0?download=1', { user: CP2, params: { id: 'rp0' } })).status, 402);
  assert.equal((await call(LEADS.POST as never, '/api/cp/leads', { method: 'POST', user: CP2, body: { name: 'Client A' } })).status, 402);

  await L.adminActivate({ userId: CP1.id, plan: 'cp_pro', months: 1, city: 'pune', reason: 'route test', actor: OWNER.email });
  await L.adminActivate({ userId: CP2.id, plan: 'cp_promax', months: 1, reason: 'route test', actor: OWNER.email });
  const made = await call(LEADS.POST as never, '/api/cp/leads', { method: 'POST', user: CP1, body: { name: 'Private Client', phone: '9000000000', pin_id: 'rp0' } });
  assert.equal(made.status, 201);
  const id = made.body.data.id;
  const other = await call(LEADS.GET as never, '/api/cp/leads', { user: CP2 });
  assert.equal(other.body.data.leads.some((l: any) => l.id === id), false, 'CP2 cannot see CP1’s lead');
  assert.equal((await call(LEADS.PATCH as never, '/api/cp/leads', { method: 'PATCH', user: CP2, body: { id, status: 'lost' } })).status, 404);
  assert.equal((await call(LEADS.DELETE as never, `/api/cp/leads?id=${id}`, { method: 'DELETE', user: CP2 })).status, 404);
  // Pro: no CSV export (CRM is Pro Max).
  assert.equal((await call(LEADS.GET as never, '/api/cp/leads?format=csv', { user: CP1 })).status, 402);
  const csv = await call(LEADS.GET as never, '/api/cp/leads?format=csv', { user: CP2 });
  assert.equal(csv.status, 200);
  // Buyers and developers have no CP lead book.
  assert.equal((await call(LEADS.GET as never, '/api/cp/leads', { user: BUY1 })).status, 403);
  // Pro CP outside the chosen city.
  const { POST } = await import('../app/api/my/enquire/route');
  const city = await call(POST as never, '/api/my/enquire', { method: 'POST', user: CP1, body: { pin_id: 'rm0', consent: { enquiry: true } } });
  assert.equal(city.status, 402);
  assert.equal(city.body.error.code, 'city_not_allowed');
});

test('buyers: premium tools are refused on Free; portfolios are private', async () => {
  const PF = await import('../app/api/buyer/portfolio/route');
  const SV = await import('../app/api/buyer/services/route');
  assert.equal((await call(PF.POST as never, '/api/buyer/portfolio', { method: 'POST', user: BUY1, body: { name: 'My flat' } })).status, 402);
  assert.equal((await call(SV.POST as never, '/api/buyer/services', { method: 'POST', user: BUY1, body: { type: 'legal' } })).status, 402);
  await L.adminActivate({ userId: BUY1.id, plan: 'buyer_premium', months: 3, reason: 'route test', actor: OWNER.email });
  const made = await call(PF.POST as never, '/api/buyer/portfolio', { method: 'POST', user: BUY1, body: { name: 'My flat', purchase_price: '8500000' } });
  assert.equal(made.status, 201);
  const svc = await call(SV.POST as never, '/api/buyer/services', { method: 'POST', user: BUY1, body: { type: 'legal', message: 'Check my agreement' } });
  assert.equal(svc.status, 201);
  assert.equal(svc.body.data.status, 'requested', 'a request is only a booking, never shown as done');
  const theirs = await call(PF.GET as never, '/api/buyer/portfolio', { user: BUY2 });
  assert.deepEqual(theirs.body.data, []);
  assert.equal((await call(PF.DELETE as never, `/api/buyer/portfolio?id=${made.body.data.id}`, { method: 'DELETE', user: BUY2 })).status, 404);
  assert.equal((await call(PF.POST as never, '/api/buyer/portfolio', { method: 'POST', user: DEV, body: { name: 'x' } })).status, 403);
});

test('developers: free listing limit and bulk upload are enforced on the API', async () => {
  const P = await import('../app/api/my/projects/route');
  // 3 projects already (the free limit).
  const r = await call(P.POST as never, '/api/my/projects', { method: 'POST', user: DEV, body: { title: 'Fourth project' } });
  assert.equal(r.status, 402);
  assert.match(r.body.error.message, /up to 3 projects/);
  const bulk = await call(P.POST as never, '/api/my/projects', { method: 'POST', user: DEV, body: { projects: [{ title: 'Bulk one' }] } });
  assert.equal(bulk.status, 402);
  assert.equal(bulk.body.error.code, 'feature_not_in_plan');
  // Editing a live project needs a paid plan for that project.
  const edit = await call(P.PATCH as never, '/api/my/projects', { method: 'PATCH', user: DEV, body: { id: 'rd0', price: '₹ 2 Cr' } });
  assert.equal(edit.status, 402);
  // Media upload into their folder needs the plan, and only real images/PDFs are accepted.
  const S = await import('../app/api/partners/storage/route');
  const upload = async (bytes: Buffer, type: string) => {
    const fd = new FormData();
    fd.set('bucket', 'project-media'); fd.set('path', `dev/${DEV.id}/rd0/gallery/x.png`); fd.set('contentType', type);
    fd.set('file', new Blob([new Uint8Array(bytes)], { type }), 'x.png');
    const headers = new Headers({ cookie: `${auth.SESSION_COOKIE}=${await auth.createSessionToken(DEV)}` });
    const req = new NextRequest('http://localhost/api/partners/storage', { method: 'POST', body: fd, headers });
    const store = { headers, cookies: new RequestCookies(headers), mutableCookies: new RequestCookies(headers), draftMode: { isEnabled: false } };
    const res: Response = await requestAsyncStorage.run(store, () => S.POST(req));
    return res.status;
  };
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
  assert.equal(await upload(png, 'image/png'), 402, 'free plan: no gallery uploads');
  await L.adminActivate({ userId: DEV.id, plan: 'dev_medium', months: 1, projectIds: ['rd0'], reason: 'route test', actor: OWNER.email });
  assert.equal(await upload(Buffer.from('<html><script>alert(1)</script></html>'), 'image/png'), 415, 'HTML disguised as PNG is refused');
  assert.equal(await upload(Buffer.from('<svg/>'), 'image/svg+xml'), 415);
  assert.equal(await upload(png, 'image/png'), 200);
  // Medium now: editing rd0 (covered) works; rd1 (not covered) still needs the plan.
  assert.equal((await call(P.PATCH as never, '/api/my/projects', { method: 'PATCH', user: DEV, body: { id: 'rd0', price: '₹ 2 Cr' } })).status, 200);
  assert.equal((await call(P.PATCH as never, '/api/my/projects', { method: 'PATCH', user: DEV, body: { id: 'rd1', price: '₹ 2 Cr' } })).status, 402);
  // Another developer's folder is never writable.
  const fd = new FormData();
  fd.set('bucket', 'project-media'); fd.set('path', `dev/someone-else/rd0/gallery/x.png`); fd.set('contentType', 'image/png');
  fd.set('file', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'x.png');
  const headers = new Headers({ cookie: `${auth.SESSION_COOKIE}=${await auth.createSessionToken(DEV)}` });
  const res: Response = await requestAsyncStorage.run({ headers, cookies: new RequestCookies(headers), mutableCookies: new RequestCookies(headers), draftMode: { isEnabled: false } }, () => S.POST(new NextRequest('http://localhost/api/partners/storage', { method: 'POST', body: fd, headers })));
  assert.equal(res.status, 401);
});

test('checkout: the browser cannot set the price; another user’s invoice is not readable', async () => {
  const Q = await import('../app/api/subscriptions/quote/route');
  const r = await call(Q.POST as never, '/api/subscriptions/quote', { method: 'POST', user: BUY2, body: { plan: 'buyer_premium', amount: 100, total_paise: 1, price_paise: 1 } });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.quote.total_paise, 199_900);
  const wrong = await call(Q.POST as never, '/api/subscriptions/quote', { method: 'POST', user: BUY2, body: { plan: 'dev_bulk' } });
  assert.equal(wrong.status, 400);
  // Fake "success" can't activate anything: an order id the user doesn't own.
  const V = await import('../app/api/subscriptions/verify-payment/route');
  const fake = await call(V.POST as never, '/api/subscriptions/verify-payment', { method: 'POST', user: BUY2, body: { razorpay_order_id: 'order_x', razorpay_payment_id: 'pay_x', razorpay_signature: 'sig' } });
  assert.equal(fake.status, 404);
  const inv = (await pgq(`SELECT id FROM sub_invoices LIMIT 1`)).rows[0];
  if (inv) {
    const I = await import('../app/api/subscriptions/invoices/[id]/route');
    const owner = (await pgq(`SELECT user_id FROM sub_invoices WHERE id = $1`, [inv.id])).rows[0].user_id;
    const stranger = [BUY1, BUY2, CP1, CP2, DEV].find((u) => u.id !== owner)!;
    assert.equal((await call(I.GET as never, `/api/subscriptions/invoices/${inv.id}`, { user: stranger, params: { id: inv.id } })).status, 404);
  }
});

test('webhook endpoint: unsigned or forged events are rejected and change nothing', async () => {
  const W = await import('../app/api/subscriptions/webhook/route');
  const raw = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_forged', order_id: 'order_forged', amount: 1, status: 'captured' } } } });
  assert.equal((await call(W.POST as never, '/api/subscriptions/webhook', { method: 'POST', raw })).status, 400);
  assert.equal((await call(W.POST as never, '/api/subscriptions/webhook', { method: 'POST', raw, headers: { 'x-razorpay-signature': createHmac('sha256', 'wrong').update(raw).digest('hex') } })).status, 400);
  const signed = await call(W.POST as never, '/api/subscriptions/webhook', { method: 'POST', raw, headers: { 'x-razorpay-signature': createHmac('sha256', 'test_webhook_secret').update(raw).digest('hex'), 'x-razorpay-event-id': 'evt_route_1' } });
  assert.equal(signed.status, 200);
  assert.equal(signed.body.outcome, 'unknown_order');
});

test('admin subscription management: owner only, every change audited', async () => {
  const A = await import('../app/api/admin/subscriptions/route');
  assert.equal((await call(A.GET as never, '/api/admin/subscriptions?view=overview', { user: BUY1 })).status, 401);
  assert.equal((await call(A.GET as never, '/api/admin/subscriptions?view=overview', { user: EMPLOYEE })).status, 403);
  const ov = await call(A.GET as never, '/api/admin/subscriptions?view=overview', { user: OWNER });
  assert.equal(ov.status, 200);
  assert.equal(ov.body.data.gateway.mode, 'test');
  const upd = await call(A.POST as never, '/api/admin/subscriptions', { method: 'POST', user: OWNER, body: { action: 'plan.update', id: 'cp_pro', plan: { price_paise: 120_000, limits: { cp_weekly_project_access: 12, not_a_feature: 5 } } } });
  assert.equal(upd.status, 200, JSON.stringify(upd.body));
  assert.equal(upd.body.data.price_paise, 120_000);
  assert.equal(upd.body.data.limits.not_a_feature, undefined, 'unknown limit keys are dropped');
  const plans = await import('../app/api/subscriptions/plans/route');
  const pub = await call(plans.GET as never, '/api/subscriptions/plans?category=cp');
  assert.equal(pub.body.data.plans.find((p: any) => p.code === 'cp_pro').price_paise, 120_000);
  // A non-owner cannot change a plan or activate one for themselves.
  assert.equal((await call(A.POST as never, '/api/admin/subscriptions', { method: 'POST', user: EMPLOYEE, body: { action: 'sub.activate', user: EMPLOYEE.email, plan: 'cp_promax', reason: 'me' } })).status, 403);
  assert.equal((await call(A.POST as never, '/api/admin/subscriptions', { method: 'POST', user: CP1, body: { action: 'sub.activate', user: CP1.email, plan: 'cp_promax', reason: 'me' } })).status, 401);
  const audit = await pgq(`SELECT action, actor FROM sub_audit WHERE action = 'plan.update' ORDER BY at DESC LIMIT 1`);
  assert.equal(audit.rows[0].actor, OWNER.email);
});
