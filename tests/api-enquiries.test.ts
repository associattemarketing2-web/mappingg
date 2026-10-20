import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { NextRequest } from 'next/server';
import { startTestDb, FIXTURE_PINS } from './helpers/api-db';

// POST /api/v1/enquiries — partner websites sending enquiries into the CRM.
// Real route handler + real SQL on an in-process PostgreSQL (PGlite). The sales-CRM
// webhook is pointed at a local listener so we can count pushes; mail is off (no SMTP).

let E: typeof import('../lib/api-platform/endpoints');
let store: typeof import('../lib/api-platform/store');
let settle: () => Promise<void>;
let pgq: (sql: string, p?: unknown[]) => Promise<{ rows: any[] }>;
let crm: Server;
const crmPushes: Record<string, any>[] = [];
const ADMIN = 'owner@test';
const SITE = 'https://partner.example';

let ip = 0;

// The CRM push is fire-and-forget and first does a geo-IP lookup, which can take
// well over the 30 ms post() waits when the whole suite runs in parallel. Wait
// for the push itself (bounded) instead of a fixed sleep.
async function until(ok: () => boolean, ms = 5000) {
  const end = Date.now() + ms;
  while (!ok() && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
}
async function post(key: string | null, body: unknown, opts: { raw?: string; type?: string } = {}) {
  const headers: Record<string, string> = { 'x-forwarded-for': `10.9.0.${(ip++ % 250) + 1}`, 'content-type': opts.type ?? 'application/json' };
  if (key) headers.authorization = `Bearer ${key}`;
  const res = await E.enquiries(new NextRequest('http://localhost/api/v1/enquiries', { method: 'POST', headers, body: opts.raw ?? JSON.stringify(body) }));
  const json = await res.json();
  await settle();
  await new Promise((r) => setTimeout(r, 30)); // let the background CRM push arrive
  return { status: res.status, body: json, res };
}

let seq = 0;
function enquiry(extra: Record<string, unknown> = {}) {
  return {
    submissionId: `sub-${Date.now()}-${seq++}`,
    name: 'Asha Test',
    phone: `+91 98${String(10000000 + seq).slice(-8)}`,
    email: 'asha@example.com',
    projectId: 1,
    bhk: '2 BHK',
    budget: '₹1–1.5 Cr',
    message: 'Please share the price sheet.',
    consent: { enquiry: true, whatsapp: true, text: 'I agree to be contacted by Partner Realty and Mappingg about this enquiry.', textVersion: 'v3', capturedAt: new Date().toISOString() },
    sourcePage: `${SITE}/projects/test-towers?utm_source=google&email=leak@example.com`,
    campaign: { source: 'google', medium: 'cpc', name: 'kharadi-oct' },
    ...extra,
  };
}

async function app(scopes: string[], extra: Record<string, unknown> = {}) {
  return store.createApp({ name: 'Partner Realty', contact_email: 'dev@partner.example', website: SITE, scopes, ...extra }, ADMIN);
}
const leads = async () => (await pgq(`SELECT doc FROM leads ORDER BY doc->>'created_at'`)).rows.map((r) => r.doc);

before(async () => {
  crm = createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { crmPushes.push(JSON.parse(b)); res.end('ok'); });
  });
  await new Promise<void>((r) => crm.listen(0, '127.0.0.1', () => r()));
  process.env.CRM_WEBHOOK_URL = `http://127.0.0.1:${(crm.address() as { port: number }).port}/hook`;
  delete process.env.SMTP_USER; delete process.env.SMTP_PASS;

  const { pg, insert } = await startTestDb();
  pgq = (s, p) => pg.query(s, p as never[]) as never;
  await pg.exec(`CREATE TABLE IF NOT EXISTS "leads" (id text PRIMARY KEY, doc jsonb NOT NULL DEFAULT '{}'::jsonb)`);
  await insert('pins', FIXTURE_PINS);
  // An existing CRM lead from someone else — must never leak through this endpoint.
  await insert('leads', [{ id: 'existing-lead', name: 'Private Person', whatsapp: '+91 9000000000', status: 'negotiation', notes: 'VIP, budget 5 Cr', assigned_to: 'emp-1', pin_id: 'p1', created_at: '2026-10-01T00:00:00Z' }]);
  E = await import('../lib/api-platform/endpoints');
  store = await import('../lib/api-platform/store');
  settle = (await import('../lib/api-platform/handler')).__settle;
});
after(() => { crm.close(); delete process.env.CRM_WEBHOOK_URL; });

test('authorised submission → 201 receipt; lead stored in the CRM `leads` table like a map enquiry; one CRM push', async () => {
  const { secret } = await app(['enquiries:submit']);
  const pushesBefore = crmPushes.length;
  const body = enquiry();
  const r = await post(secret, body);
  assert.equal(r.status, 201);
  assert.deepEqual(Object.keys(r.body.data).sort(), ['reference', 'status', 'submissionId']);
  assert.equal(r.body.data.status, 'received');
  assert.equal(r.body.data.submissionId, body.submissionId);
  assert.match(r.body.data.reference, /^enq_[A-Za-z0-9_-]{16}$/);
  assert.equal(r.res.headers.get('cache-control'), 'no-store');

  const lead = (await leads()).find((l) => l.integration?.reference === r.body.data.reference);
  assert.ok(lead, 'lead row created');
  // Same shape the CRM reads for map enquiries (app/api/admin/leads → mapLead).
  assert.equal(lead.pin_id, 'p1');
  assert.equal(lead.whatsapp, body.phone);
  assert.equal(lead.status, 'new');
  assert.equal(lead.notes, '');
  assert.equal(lead.role, 'buyer');
  assert.equal(lead.enquiry_clicks, 1);
  assert.equal(lead.assigned_to, undefined, 'unassigned: CRM assignment rules apply');
  assert.match(lead.message, /Looking for: 2 BHK · Budget: ₹1–1.5 Cr[\s\S]*price sheet/);
  assert.equal(lead.integration.website, 'partner.example');
  assert.equal(lead.integration.source_page, `${SITE}/projects/test-towers`, 'query string (may hold personal data) dropped');
  assert.deepEqual(lead.integration.campaign, body.campaign);
  // Consent recorded as stated by the partner, with their wording and version.
  assert.equal(lead.consent.enquiry, true);
  assert.equal(lead.consent.whatsapp, true);
  assert.equal(lead.consent.call, false);
  assert.equal(lead.consent.asserted_by_partner, true);
  assert.equal(lead.consent.text, body.consent.text);
  assert.match(lead.consent.version, /:v3$/);
  // Same follow-up as other enquiries: pushed to the sales CRM once.
  await until(() => crmPushes.length > pushesBefore);
  assert.equal(crmPushes.length, pushesBefore + 1);
  assert.match(crmPushes.at(-1)!.remark, /Partner website \(partner\.example\) via Mappingg API/);
  assert.equal(crmPushes.at(-1)!.project, 'Test Towers');
});

test('missing, invalid, expired and revoked keys; disabled application', async () => {
  assert.equal((await post(null, enquiry())).body.error.code, 'missing_api_key');
  assert.equal((await post('mgk_0000000000000000_' + 'a'.repeat(43), enquiry())).body.error.code, 'invalid_api_key');
  const exp = await app(['enquiries:submit'], { expires_at: new Date(Date.now() - 1000).toISOString() });
  assert.equal((await post(exp.secret, enquiry())).status, 401);
  const rev = await app(['enquiries:submit']);
  await store.revokeKey(rev.app.id, rev.key.id, ADMIN);
  assert.equal((await post(rev.secret, enquiry())).body.error.code, 'revoked_api_key');
  const dis = await app(['enquiries:submit']);
  await store.setAppStatus(dis.app.id, 'disabled', ADMIN);
  assert.equal((await post(dis.secret, enquiry())).body.error.code, 'application_disabled');
});

test('needs the enquiries:submit scope — read scopes are not enough, and it is never granted by default', async () => {
  const reader = await app(['projects:read', 'blogs:read', 'map:read', 'developers:read', 'localities:read', 'infrastructure:read']);
  const r = await post(reader.secret, enquiry());
  assert.equal(r.status, 403);
  assert.equal(r.body.error.code, 'insufficient_scope');
  const blank = await app([]);
  assert.deepEqual(blank.app.scopes, []);
  assert.equal(blank.app.enquiry_rate_per_minute, 10);
  assert.equal(blank.app.enquiry_daily_quota, 200);
});

test('protected fields cannot be set: unknown fields are rejected and nothing is stored', async () => {
  const { secret } = await app(['enquiries:submit']);
  const n = (await leads()).length;
  for (const extra of [{ status: 'won' }, { assigned_to: 'emp-1' }, { id: 'my-id' }, { notes: 'x' }, { pin_id: 'p3' }, { integration: {} }, { source: 'Walk-in' }, { consent: { ...enquiry().consent, asserted_by_partner: false } }]) {
    const r = await post(secret, enquiry(extra));
    assert.equal(r.status, 400, JSON.stringify(extra));
    assert.equal(r.body.error.code, 'invalid_request');
  }
  assert.equal((await leads()).length, n);
});

test('field validation: phone, email, name, bhk, budget, message length, URLs', async () => {
  const { secret } = await app(['enquiries:submit'], { enquiry_rate_per_minute: 120 });
  const bad: [Record<string, unknown>, number, string][] = [
    [{ phone: '12345' }, 400, 'invalid_request'],
    [{ phone: '+91 12345 67890 11' }, 422, 'invalid_phone'],
    [{ phone: '+999 9876543210' }, 422, 'invalid_phone'],
    [{ email: 'not-an-email' }, 400, 'invalid_request'],
    [{ name: '1234' }, 400, 'invalid_request'],
    [{ name: 'Visit https://spam.example' }, 422, 'content_rejected'],
    [{ message: 'see http://a.example http://b.example http://c.example' }, 422, 'content_rejected'],
    [{ bhk: '7 BHK' }, 400, 'invalid_request'],
    [{ budget: '<script>' }, 400, 'invalid_request'],
    [{ message: 'x'.repeat(1001) }, 400, 'invalid_request'],
    [{ submissionId: 'short' }, 400, 'invalid_request'],
  ];
  for (const [extra, status, code] of bad) {
    const r = await post(secret, enquiry(extra));
    assert.equal(r.status, status, JSON.stringify(extra));
    assert.equal(r.body.error.code, code, JSON.stringify(extra));
  }
  // International numbers in the site's format are accepted.
  assert.equal((await post(secret, enquiry({ phone: '+44 7911123456', projectId: undefined }))).status, 201);
});

test('invalid or unpublished project references are rejected', async () => {
  const { secret } = await app(['enquiries:submit']);
  for (const projectId of [3, 4, 5, 6, 999999]) { // hidden, pending, rejected, office marker, missing
    const r = await post(secret, enquiry({ projectId }));
    assert.equal(r.status, 422, String(projectId));
    assert.equal(r.body.error.code, 'project_not_found');
  }
  assert.equal((await post(secret, enquiry({ projectId: 1, projectName: 'Some Other Project' }))).body.error.code, 'project_mismatch');
  assert.equal((await post(secret, enquiry({ projectId: 1, projectName: 'test towers' }))).status, 201);
  assert.equal((await post(secret, enquiry({ projectId: '1' }))).status, 400, 'projectId must be a number');
});

test('consent is required, explicit, recent and with its wording', async () => {
  const { secret } = await app(['enquiries:submit']);
  const c = enquiry().consent;
  const cases: [unknown, number][] = [
    [undefined, 400],
    [{ ...c, enquiry: false }, 400],
    [{ ...c, enquiry: 'yes' }, 400],
    [{ ...c, text: 'ok' }, 400],
    [{ ...c, textVersion: undefined }, 400],
    [{ ...c, capturedAt: new Date(Date.now() - 25 * 3_600_000).toISOString() }, 422],
    [{ ...c, capturedAt: new Date(Date.now() + 60 * 60_000).toISOString() }, 422],
  ];
  for (const [consent, status] of cases) {
    const body = { ...enquiry(), consent } as Record<string, unknown>;
    if (consent === undefined) delete body.consent;
    assert.equal((await post(secret, body)).status, status, JSON.stringify(consent));
  }
  // Marketing opt-ins are only stored when literally true.
  const r = await post(secret, enquiry({ consent: { ...c, call: false, whatsapp: false } }));
  const lead = (await leads()).find((l) => l.integration?.reference === r.body.data.reference);
  assert.deepEqual([lead.consent.call, lead.consent.whatsapp], [false, false]);
});

test('sourcePage must be on the registered website; an app without a website cannot submit', async () => {
  const { secret } = await app(['enquiries:submit']);
  assert.equal((await post(secret, enquiry({ sourcePage: 'https://evil.example/form' }))).body.error.code, 'source_not_allowed');
  assert.equal((await post(secret, enquiry({ sourcePage: 'https://partner.example.evil.example/form' }))).body.error.code, 'source_not_allowed');
  assert.equal((await post(secret, enquiry({ sourcePage: 'http://partner.example/form' }))).status, 400, 'https only');
  assert.equal((await post(secret, enquiry({ sourcePage: 'https://homes.partner.example/form' }))).status, 201, 'subdomains allowed');
  const noSite = await store.createApp({ name: 'No site', contact_email: 'a@b.example', scopes: ['enquiries:submit'] }, ADMIN);
  assert.equal((await post(noSite.secret, enquiry())).body.error.code, 'website_not_registered');
});

test('idempotency: same submissionId + body → original receipt, one lead, no second CRM push; different body → 409', async () => {
  const { secret } = await app(['enquiries:submit']);
  const body = enquiry();
  const first = await post(secret, body);
  const pushes = crmPushes.length;
  const n = (await leads()).length;
  const again = await post(secret, body);
  assert.equal(again.status, 200);
  assert.equal(again.res.headers.get('idempotent-replayed'), 'true');
  assert.deepEqual(again.body.data, first.body.data);
  assert.equal((await leads()).length, n);
  assert.equal(crmPushes.length, pushes);
  const changed = await post(secret, { ...body, message: 'different' });
  assert.equal(changed.status, 409);
  assert.equal(changed.body.error.code, 'submission_id_reused');
});

test('duplicate-lead policy: same phone + project within 24 h updates the existing lead; the response looks the same', async () => {
  const { secret } = await app(['enquiries:submit']);
  const phone = '+91 9123456780';
  const a = await post(secret, enquiry({ phone }));
  const pushes = crmPushes.length;
  const b = await post(secret, enquiry({ phone, consent: { ...enquiry().consent, call: true } }));
  assert.equal(b.status, 201, 'indistinguishable from a new lead');
  assert.deepEqual(Object.keys(b.body.data).sort(), Object.keys(a.body.data).sort());
  assert.notEqual(b.body.data.reference, a.body.data.reference);
  const mine = (await leads()).filter((l) => l.whatsapp === phone);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].enquiry_clicks, 2);
  assert.equal(mine[0].consent.call, true, 'a new explicit opt-in is recorded');
  assert.equal(crmPushes.length, pushes, 'repeats are not pushed to the sales CRM again');
  // A different project is a new lead.
  await post(secret, enquiry({ phone, projectId: 2 }));
  assert.equal((await leads()).filter((l) => l.whatsapp === phone).length, 2);
});

test('the endpoint never returns or exposes existing leads', async () => {
  const { secret } = await app(['enquiries:submit']);
  const r = await post(secret, enquiry({ phone: '+91 9000000000', projectId: 1 })); // same phone as the existing private lead
  const text = JSON.stringify(r.body);
  for (const leak of ['Private Person', 'negotiation', 'VIP', 'emp-1', 'existing-lead']) assert.ok(!text.includes(leak), leak);
  const existing = (await leads()).find((l) => l.id === 'existing-lead');
  assert.equal(existing.status, 'negotiation', 'other leads are untouched');
  assert.equal(existing.notes, 'VIP, budget 5 Cr');
});

test('body limits: size, content type, JSON syntax', async () => {
  const { secret } = await app(['enquiries:submit']);
  assert.equal((await post(secret, null, { raw: JSON.stringify({ ...enquiry(), message: 'x'.repeat(20_000) }) })).status, 413);
  assert.equal((await post(secret, null, { raw: 'name=a', type: 'application/x-www-form-urlencoded' })).status, 415);
  assert.equal((await post(secret, null, { raw: '{"name":' })).body.error.code, 'invalid_json');
});

test('enquiry rate limit and daily quota (separate from read limits) → 429 with Retry-After', async () => {
  const rate = await app(['enquiries:submit'], { enquiry_rate_per_minute: 2 });
  assert.equal((await post(rate.secret, enquiry({ projectId: undefined }))).status, 201);
  assert.equal((await post(rate.secret, enquiry({ projectId: undefined }))).status, 201);
  const r = await post(rate.secret, enquiry({ projectId: undefined }));
  assert.equal(r.status, 429);
  assert.equal(r.body.error.code, 'rate_limited');
  assert.ok(Number(r.res.headers.get('retry-after')) >= 1);
  const quota = await app(['enquiries:submit'], { enquiry_daily_quota: 1 });
  await post(quota.secret, enquiry({ projectId: undefined }));
  assert.equal((await post(quota.secret, enquiry({ projectId: undefined }))).body.error.code, 'quota_exceeded');
});

test('repeated invalid submissions pause the application for the hour', async () => {
  const { secret } = await app(['enquiries:submit'], { enquiry_rate_per_minute: 120 });
  for (let i = 0; i < 50; i++) await post(secret, enquiry({ sourcePage: 'https://evil.example/x' }));
  const r = await post(secret, enquiry());
  assert.equal(r.status, 429);
  assert.equal(r.body.error.code, 'enquiries_paused');
});

test('no personal data in API logs or audit; scope grants are audited', async () => {
  const { app: a, secret } = await app(['projects:read']);
  await store.updateApp(a.id, { name: a.name, website: SITE, scopes: ['projects:read', 'enquiries:submit'], enquiry_daily_quota: 50 }, ADMIN);
  const body = enquiry({ name: 'Zed Logcheck', phone: '+91 9988776655', email: 'zed@private.example', message: 'secret message text' });
  assert.equal((await post(secret, body)).status, 201);
  const logs = JSON.stringify((await pgq(`SELECT * FROM api_request_log`)).rows) + JSON.stringify((await pgq(`SELECT * FROM api_audit`)).rows) + JSON.stringify((await pgq(`SELECT * FROM api_enquiry_submissions`)).rows);
  for (const s of ['Zed Logcheck', '9988776655', 'zed@private.example', 'secret message text', 'mgk_']) assert.ok(!logs.includes(s), s);
  const trail = await store.auditTrail(a.id);
  assert.deepEqual(trail.find((t) => t.action === 'app.update')!.detail.scopes_granted, ['enquiries:submit']);
  await store.updateApp(a.id, { name: a.name, website: SITE, scopes: ['projects:read'] }, ADMIN);
  assert.deepEqual((await store.auditTrail(a.id))[0].detail.scopes_revoked, ['enquiries:submit']);
  assert.equal((await post(secret, enquiry())).status, 403, 'revoking the scope takes effect at once');
});

test('usage summary counts accepted and rejected enquiries per application', async () => {
  const { app: a, secret } = await app(['enquiries:submit']);
  await post(secret, enquiry({ projectId: undefined }));
  await post(secret, enquiry({ projectId: 999999 }));
  const u = (await store.usageSummary()).find((x) => x.app_id === a.id)!;
  assert.equal(u.enquiries_accepted_7_days, 1);
  assert.equal(u.enquiries_rejected_7_days, 1);
});
