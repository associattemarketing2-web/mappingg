import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { NextRequest } from 'next/server';
import { startTestDb } from './helpers/api-db';
import { parseCsv } from '../lib/lead-sources/csv';
import { classifyQuestion, consentCell, csvRowToLead, googleAdsToLead, metaToLead, suggestMapping, type CsvProvenance } from '../lib/lead-sources/normalize';
import { parseRequirement } from '../lib/buyer-requirement';

// External buyer-lead sources: pure parsing and consent rules, then the real
// webhook handlers, idempotent ingestion, CSV import and source status against
// an in-process PostgreSQL (PGlite). Every person below is a clearly fake fixture
// that only ever exists in the in-memory test database.

const NOW = new Date('2026-10-24T10:00:00.000Z');
const KEY = 'test-google-key-0123456789abcdef';
const SECRET = 'test-meta-app-secret';

// ---- pure ---------------------------------------------------------------------------------

test('CSV parser: quotes, escaped quotes, newlines in quotes, BOM, semicolons, blank lines', () => {
  const a = parseCsv('﻿Name,Phone,Notes\r\n"Test, Asha",9876543210,"said ""hi""\nthen left"\r\n\r\nRavi,9123456789,\n');
  assert.deepEqual(a.headers, ['Name', 'Phone', 'Notes']);
  assert.deepEqual(a.rows, [['Test, Asha', '9876543210', 'said "hi"\nthen left'], ['Ravi', '9123456789', '']]);
  const b = parseCsv('Name;Phone\nAsha;9876543210');
  assert.deepEqual(b.rows, [['Asha', '9876543210']]);
});

test('column suggestions and question classification', () => {
  const m = suggestMapping(['Customer Name', 'Mobile No', 'E-mail', 'Preferred Area', 'Config', 'Budget', 'Consent', 'Consent date', 'Referred by']);
  assert.equal(m.name, 0); assert.equal(m.phone, 1); assert.equal(m.email, 2); assert.equal(m.locality, 3); assert.equal(m.bhk, 4);
  assert.equal(m.budget, 5); assert.equal(m.consent, 6); assert.equal(m.consent_date, 7); assert.equal(m.referred_by, 8);
  assert.equal(classifyQuestion('what_is_your_budget?'), 'budget');
  assert.equal(classifyQuestion('Which BHK are you looking for'), 'bhk');
  assert.equal(classifyQuestion('preferred_location'), 'locality');
  assert.equal(classifyQuestion('When do you plan to buy'), 'timeline');
  assert.equal(classifyQuestion('favourite colour'), null);
});

test('consent cells: only clear words count as yes', () => {
  for (const v of ['yes', 'Y', 'TRUE', '1', 'Opted in', 'agreed']) assert.equal(consentCell(v), 'yes', v);
  for (const v of ['no', 'N', 'false', '0', 'opted out']) assert.equal(consentCell(v), 'no', v);
  for (const v of ['', 'maybe', 'call later', 'unknown']) assert.equal(consentCell(v), 'unknown', v);
});

const PROV: CsvProvenance = { kind: 'broker_referral', supplied_by: 'Test Realty', consent_basis: 'Each buyer asked the broker in writing to share their details with Mappingg.', attest: true };

test('CSV rows: consent column, contact validation, consent date', () => {
  const map = { name: 0, phone: 1, email: 2, consent: 3, consent_date: 4 };
  const ok = csvRowToLead(['Asha Test', '9876543210', 'asha@example.com', 'yes', '2026-10-01'], 2, map, PROV, 'owner@test', NOW);
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.equal(ok.lead.phone, '+91 9876543210');
    assert.equal(ok.lead.consent.enquiry, true);
    assert.equal(ok.lead.consent.call, false);
    assert.equal(ok.lead.consent.asserted_by, 'uploader');
    assert.equal(ok.lead.consent.captured_at, '2026-10-01T00:00:00.000Z');
  }
  const reason = (cells: string[]) => { const r = csvRowToLead(cells, 3, map, PROV, 'owner@test', NOW); return r.ok ? 'ok' : r.reason; };
  assert.equal(reason(['Asha', '9876543210', '', 'no', '']), 'Consent column says no');
  assert.equal(reason(['Asha', '9876543210', '', '', '']), 'Consent column is blank or unclear');
  assert.equal(reason(['Asha', '12345', '', 'yes', '']), 'Phone is not a valid 10-digit mobile number');
  assert.equal(reason(['Asha', '', 'not-an-email', 'yes', '']), 'Email looks invalid');
  assert.equal(reason(['Asha', '', '', 'yes', '']), 'No phone or email');
  assert.equal(reason(['', '9876543210', '', 'yes', '']), 'No name');
  assert.equal(reason(['Asha', '9876543210', '', 'yes', '2027-01-01']), 'Consent date is in the future');
  // No consent column: the uploader's attested basis covers the row.
  assert.ok(csvRowToLead(['Asha', '9876543210'], 2, { name: 0, phone: 1 }, PROV, 'owner@test', NOW).ok);
});

test('Google Ads payload → lead: standard columns, custom questions, consent from the form', () => {
  const { externalId, lead } = googleAdsToLead({
    lead_id: 'L-1', form_id: 123, campaign_id: 456, google_key: KEY,
    user_column_data: [
      { column_id: 'FULL_NAME', string_value: 'Asha Test' }, { column_id: 'PHONE_NUMBER', string_value: '+919876543210' },
      { column_id: 'EMAIL', string_value: 'ASHA@example.com' }, { column_id: 'CITY', string_value: 'Pune' },
      { column_id: 'custom_q1', column_name: 'What is your budget?', string_value: '₹1 – 1.5 Cr' },
      { column_id: 'custom_q2', column_name: 'Which BHK?', string_value: '3 BHK' },
      { column_id: 'custom_q3', column_name: 'Anything else', string_value: 'Near school' },
    ],
  }, NOW);
  assert.equal(externalId, 'L-1');
  assert.equal(lead.name, 'Asha Test');
  assert.equal(lead.phone, '+91 9876543210');
  assert.equal(lead.email, 'asha@example.com');
  assert.equal(lead.city, 'Pune');
  assert.equal(lead.budget, '₹1 – 1.5 Cr');
  assert.equal(lead.bhk, '3 BHK');
  assert.match(lead.message || '', /Anything else: Near school/);
  assert.equal(lead.consent.enquiry, true);
  assert.equal(lead.consent.call, false);
  assert.equal(lead.consent.whatsapp, false);
  assert.ok(!JSON.stringify(lead).includes(KEY), 'the webhook key is never stored');
  assert.throws(() => googleAdsToLead({ user_column_data: [] }));
});

test('Meta lead → lead: field_data, custom questions, optional consent checkboxes', () => {
  const lead = metaToLead({
    id: 'M-1', form_id: 'F-9', created_time: '2026-10-23T08:00:00+0000', platform: 'ig',
    field_data: [
      { name: 'full_name', values: ['Ravi Test'] }, { name: 'phone_number', values: ['+919123456789'] }, { name: 'email', values: ['ravi@example.com'] },
      { name: 'preferred_location', values: ['Kharadi'] }, { name: 'when_do_you_plan_to_buy?', values: ['3–6 months'] },
    ],
    custom_disclaimer_responses: [{ checkbox_key: 'whatsapp_optin', is_checked: true }, { checkbox_key: 'call_optin', is_checked: false }],
  }, NOW);
  assert.equal(lead.name, 'Ravi Test');
  assert.equal(lead.phone, '+91 9123456789');
  assert.equal(lead.locality, 'Kharadi');
  assert.equal(lead.timeline, '3–6 months');
  assert.equal(lead.consent.whatsapp, true);
  assert.equal(lead.consent.call, false);
  assert.equal(lead.submitted_at, '2026-10-23T08:00:00.000Z');
});

test('Buyer requirement form: consent must be a literal true; required fields enforced', () => {
  const base = { name: 'Asha Test', phone: '9876543210', email: '', city: 'Pune', areas: 'Kharadi', bhk: '3 BHK', budget: '₹1 – 1.5 Cr', timeline: '1–3 months', consent: true };
  const ok = parseRequirement(base, NOW);
  assert.equal(ok.kind, 'ok');
  if (ok.kind === 'ok') {
    assert.equal(ok.lead.consent.enquiry, true);
    assert.equal(ok.lead.consent.call, false);
    assert.equal(ok.lead.consent.version, 'buyer-requirement-2026-10');
    assert.match(ok.lead.message, /Looking for: 3 BHK · Budget: ₹1 – 1.5 Cr · Preferred area: Kharadi, Pune · Planning to buy: 1–3 months/);
  }
  for (const consent of [undefined, false, 'true', 1, 'yes']) assert.equal(parseRequirement({ ...base, consent }, NOW).kind, 'invalid', String(consent));
  assert.equal(parseRequirement({ ...base, bhk: '' }, NOW).kind, 'invalid');
  assert.equal(parseRequirement({ ...base, budget: '₹9 Cr' }, NOW).kind, 'invalid');
  assert.equal(parseRequirement({ ...base, phone: '', email: '' }, NOW).kind, 'invalid');
  assert.equal(parseRequirement({ ...base, company: 'bot' }, NOW).kind, 'spam');
  const opted = parseRequirement({ ...base, consent_call: true, consent_whatsapp: 'yes' }, NOW);
  assert.ok(opted.kind === 'ok' && opted.lead.consent.call === true && opted.lead.consent.whatsapp === false);
});

// ---- integration (PGlite) ------------------------------------------------------------------

let pgq: (sql: string, p?: unknown[]) => Promise<{ rows: any[] }>;
const leadsOf = async (source: string) => (await pgq(`SELECT doc FROM leads WHERE doc->>'ingest_source' = $1`, [source])).rows.map((r) => r.doc);
let ip = 0;

before(async () => {
  delete process.env.CRM_WEBHOOK_URL; delete process.env.SMTP_USER; delete process.env.SMTP_PASS;
  process.env.GOOGLE_ADS_LEAD_WEBHOOK_KEY = KEY;
  Object.assign(process.env, { META_APP_SECRET: SECRET, META_WEBHOOK_VERIFY_TOKEN: 'verify-me', META_PAGE_ID: 'PAGE1', META_PAGE_ACCESS_TOKEN: 'page-token' });
  const { pg, insert } = await startTestDb();
  pgq = (s, p) => pg.query(s, p as never[]) as never;
  for (const t of ['leads', 'contact_leads']) await pg.exec(`CREATE TABLE IF NOT EXISTS "${t}" (id text PRIMARY KEY, doc jsonb NOT NULL DEFAULT '{}'::jsonb)`);
  // Already in the CRM: the CSV import must skip this person.
  await insert('contact_leads', [{ id: 'c1', name: 'Existing Buyer', phone: '+91 9000000001', email: 'existing@example.com', source: 'contact-form', created_at: '2026-10-01T00:00:00Z' }]);
});

async function googlePost(body: unknown) {
  const { POST } = await import('../app/api/integrations/google-ads/leads/route');
  const res = await POST(new NextRequest('http://localhost/api/integrations/google-ads/leads', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.1.0.${(ip++ % 250) + 1}` }, body: JSON.stringify(body),
  }));
  return { status: res.status, body: await res.json() };
}
const gLead = (id: string, extra: Record<string, unknown> = {}) => ({
  lead_id: id, form_id: 77, campaign_id: 88, google_key: KEY,
  user_column_data: [{ column_id: 'FULL_NAME', string_value: 'Asha Test' }, { column_id: 'PHONE_NUMBER', string_value: '+919876543210' }],
  ...extra,
});

test('Google webhook: wrong key → 401, test data → 200 but no lead, real lead → one lead, retry → still one', async () => {
  assert.equal((await googlePost({ ...gLead('G-1'), google_key: 'wrong' })).status, 401);
  assert.equal((await googlePost({ ...gLead('G-1'), google_key: undefined })).status, 401);
  const t = await googlePost({ ...gLead('G-TEST'), is_test: true });
  assert.equal(t.status, 200);
  assert.equal((await leadsOf('google_ads')).length, 0, 'test data is never saved as a lead');

  assert.equal((await googlePost(gLead('G-1'))).status, 200);
  assert.equal((await googlePost(gLead('G-1'))).status, 200); // Google retry
  const rows = await leadsOf('google_ads');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'new');
  assert.equal(rows[0].whatsapp, '+91 9876543210');
  assert.equal(rows[0].ingest.form_id, '77');
  assert.ok(!JSON.stringify(rows[0]).includes(KEY));

  // Same person, new lead id, within 24 h → merged into the same lead.
  await googlePost(gLead('G-2'));
  const after = await leadsOf('google_ads');
  assert.equal(after.length, 1);
  assert.equal(after[0].enquiry_clicks, 2);

  const log = (await pgq(`SELECT ok, is_test, imported, merged, skipped, error FROM lead_sync_log WHERE source='google_ads' ORDER BY id`)).rows;
  assert.equal(log.filter((l) => !l.ok).length, 1, 'repeated bad-key rejections are logged at most once a minute');
  assert.ok(log.some((l) => l.ok && l.is_test));
  assert.deepEqual(log.filter((l) => l.ok && !l.is_test).map((l) => [l.imported, l.merged, l.skipped]), [[1, 0, 0], [0, 0, 1], [0, 1, 0]]);
});

test('Meta: signature check, handshake, webhook fetches the lead, test leads ignored, sync is idempotent', async () => {
  const meta = await import('../lib/lead-sources/meta');
  const sign = (raw: string) => `sha256=${createHmac('sha256', SECRET).update(raw).digest('hex')}`;
  assert.equal(meta.signatureValid('{"a":1}', sign('{"a":1}')), true);
  assert.equal(meta.signatureValid('{"a":1}', sign('{"a":2}')), false);
  assert.equal(meta.signatureValid('{"a":1}', null), false);
  assert.equal(meta.verifyChallenge(new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-me', 'hub.challenge': 'abc' })), 'abc');
  assert.equal(meta.verifyChallenge(new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.verify_token': 'nope', 'hub.challenge': 'abc' })), null);

  const LEADS: Record<string, unknown> = {
    'M-1': { id: 'M-1', form_id: 'F-1', field_data: [{ name: 'full_name', values: ['Ravi Test'] }, { name: 'phone_number', values: ['+919123456789'] }] },
    'M-T': { id: 'M-T', form_id: 'F-1', field_data: [{ name: 'full_name', values: ['<test lead: dummy data for full_name>'] }] },
  };
  const calls: string[] = [];
  meta.setFetcher((async (url: string) => {
    const u = new URL(url);
    calls.push(u.pathname);
    assert.equal(u.searchParams.get('appsecret_proof'), createHmac('sha256', SECRET).update('page-token').digest('hex'));
    const id = u.pathname.split('/').pop()!;
    if (u.pathname.endsWith('/F-1/leads')) return new Response(JSON.stringify({ data: [LEADS['M-1'], LEADS['M-T']] }));
    if (u.pathname.endsWith('/leadgen_forms')) return new Response(JSON.stringify({ data: [{ id: 'F-1', name: 'Form', status: 'ACTIVE' }] }));
    if (u.pathname.endsWith('/subscribed_apps')) return new Response(JSON.stringify({ data: [{ id: 'app', subscribed_fields: ['leadgen'] }] }));
    if (u.pathname.endsWith('/PAGE1')) return new Response(JSON.stringify({ id: 'PAGE1', name: 'Test Page' }));
    if (LEADS[id]) return new Response(JSON.stringify(LEADS[id]));
    return new Response(JSON.stringify({ error: { message: 'Unsupported get request', code: 100 } }), { status: 400 });
  }) as typeof fetch);

  // Through the real route: bad signature → 401, good → 200 and one lead.
  const { POST } = await import('../app/api/integrations/meta/leads/route');
  const body = JSON.stringify({ object: 'page', entry: [{ id: 'PAGE1', changes: [
    { field: 'leadgen', value: { leadgen_id: 'M-1', page_id: 'PAGE1', form_id: 'F-1' } },
    { field: 'leadgen', value: { leadgen_id: 'M-T', page_id: 'PAGE1', form_id: 'F-1' } },
    { field: 'leadgen', value: { leadgen_id: '444444444444', page_id: '444444444444' } },
  ] }] });
  const req = (sig: string) => new NextRequest('http://localhost/api/integrations/meta/leads', { method: 'POST', headers: { 'x-hub-signature-256': sig, 'x-forwarded-for': '10.2.0.1' }, body });
  assert.equal((await POST(req('sha256=00'))).status, 401);
  assert.equal((await POST(req(sign(body)))).status, 200);
  let rows = await leadsOf('meta_lead_ads');
  assert.equal(rows.length, 1, 'test leads and sample ids are never saved');
  assert.equal(rows[0].name, 'Ravi Test');

  const t = await meta.testMetaConnection('owner@test');
  assert.ok(t.ok && t.page === 'Test Page' && t.leadgen_subscribed);
  const s = await meta.runMetaSync('owner@test');
  assert.ok(s.ok);
  assert.equal(s.imported, 0); assert.equal(s.skipped, 1); assert.equal(s.tests, 1);
  rows = await leadsOf('meta_lead_ads');
  assert.equal(rows.length, 1, 'sync after webhook creates no duplicate');

  // A permission error is reported as such.
  meta.setFetcher((async () => new Response(JSON.stringify({ error: { message: '(#200) Requires leads_retrieval permission', code: 200 } }), { status: 403 })) as typeof fetch);
  const bad = await meta.testMetaConnection('owner@test');
  assert.ok(!bad.ok && bad.kind === 'permission');
  const { listSources } = await import('../lib/lead-sources/sources');
  assert.equal((await listSources()).find((x) => x.id === 'meta_lead_ads')?.status, 'permission_required');
  meta.setFetcher(null);
});

test('CSV import: dry run saves nothing; import skips duplicates and existing leads; re-import is a no-op', async () => {
  const { runCsvImport } = await import('../lib/lead-sources/csv-import');
  const csv = [
    'Name,Mobile,Email,Area,BHK,Consent',
    'Neha Test,9811111111,neha@example.com,Baner,2 BHK,yes',
    'Neha Again,9811111111,,Baner,2 BHK,yes', // same phone as the row above
    'Existing,9000000001,,Kharadi,3 BHK,yes', // already in contact_leads
    'No Consent,9822222222,,Wakad,2 BHK,no',
    'Blank Consent,9833333333,,Wakad,2 BHK,',
    'Karan Test,9844444444,karan@example.com,Hinjewadi,3 BHK,Yes',
  ].join('\n');
  const input = { csv, file_name: 'test.csv', mapping: { name: 0, phone: 1, email: 2, locality: 3, bhk: 4, consent: 5 }, provenance: { ...PROV, supplier_rera: '', attest: true as const }, dry_run: true };
  const dry = await runCsvImport(input, 'owner@test');
  assert.equal(dry.total, 6);
  assert.equal(dry.valid, 2);
  assert.equal(dry.by_reason['Same person appears earlier in this file'], 1);
  assert.equal(dry.by_reason['Already in your leads'], 1);
  assert.equal(dry.by_reason['Consent column says no'], 1);
  assert.equal(dry.by_reason['Consent column is blank or unclear'], 1);
  assert.equal((await leadsOf('csv_import')).length, 0, 'dry run saves nothing');

  const real = await runCsvImport({ ...input, dry_run: false }, 'owner@test');
  assert.equal(real.imported, 2);
  const rows = await leadsOf('csv_import');
  assert.equal(rows.length, 2);
  assert.equal(rows.find((r) => r.name === 'Neha Test').locality, 'Baner');
  assert.match(rows[0].consent.source, /supplied by Test Realty/);

  const again = await runCsvImport({ ...input, dry_run: false }, 'owner@test');
  assert.equal(again.imported, 0);
  assert.equal((await leadsOf('csv_import')).length, 2);
});

test('source statuses: proven sources are Connected, nothing else is', async () => {
  const { listSources } = await import('../lib/lead-sources/sources');
  const byId = new Map((await listSources()).map((s) => [s.id, s]));
  assert.equal(byId.get('google_ads')?.status, 'connected');
  assert.equal(byId.get('google_ads')?.records, 1);
  assert.equal(byId.get('csv_import')?.records, 2);
  assert.equal(byId.get('website_contact')?.records, 1);
  assert.equal(byId.get('partner_api')?.status, 'not_configured'); // no Developer API app in this database
  for (const s of byId.values()) for (const c of s.credentials) assert.ok(!('value' in c), 'credential values are never returned');

  // Without the key, Google is not configured, whatever the log says.
  const k = process.env.GOOGLE_ADS_LEAD_WEBHOOK_KEY;
  delete process.env.GOOGLE_ADS_LEAD_WEBHOOK_KEY;
  assert.equal((await listSources()).find((s) => s.id === 'google_ads')?.status, 'not_configured');
  process.env.GOOGLE_ADS_LEAD_WEBHOOK_KEY = k;

  // Portals: never Connected, even with permission recorded.
  const store = await import('../lib/lead-sources/store');
  await store.upsertPortal({ id: 'p1', name: 'Test Portal', url: 'https://portal.example', data_scope: '', terms_url: '', permission: 'permitted', permission_note: 'Feed agreed', evidence_url: 'https://mail.example/1' }, 'owner@test');
  const portal = (await listSources()).find((s) => s.id === 'portal:p1');
  assert.equal(portal?.status, 'not_configured');
  assert.deepEqual(portal?.actions, []);
});

test('buyer rows: website and imported leads in one list with their requirement and consent', async () => {
  const { loadBuyerRows, summarize } = await import('../lib/lead-sources/buyer-intel');
  const rows = await loadBuyerRows();
  const neha = rows.find((r) => r.name === 'Neha Test');
  assert.equal(neha?.source_id, 'csv_import');
  assert.equal(neha?.area, 'Baner');
  assert.equal(neha?.bhk, '2 BHK');
  assert.equal(neha?.consent.enquiry, true);
  const existing = rows.find((r) => r.name === 'Existing Buyer');
  assert.equal(existing?.source_id, 'website_contact');
  assert.equal(existing?.consent.recorded, false);
  const s = summarize(rows, NOW.getTime());
  assert.equal(s.total, rows.length);
  assert.ok(s.by_bhk.some(([k]) => k === '2 BHK'));
});
