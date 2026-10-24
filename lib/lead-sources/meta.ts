import { createHmac, timingSafeEqual } from 'node:crypto';
import { metaToLead, sha256, type MetaLead } from './normalize';
import { ingestLead } from './ingest';
import { lastOk, logRun, type Sql } from './store';

// Meta (Facebook / Instagram) Lead Ads through the official Graph API.
//
// Webhook: Meta calls /api/integrations/meta/leads with a `leadgen` change for
// each new lead (the lead id only). We check the X-Hub-Signature-256 HMAC with
// the app secret, then fetch the lead from the Graph API with the Page access
// token and save it. "Run sync" pulls recent leads from the Page's lead forms
// (Meta keeps them for 90 days), which also recovers anything a webhook missed.
//
// Secrets stay in server environment variables (never in the database, never
// sent to the browser). Every Graph call carries appsecret_proof.

export const META_SOURCE = 'meta_lead_ads';
const LEAD_FIELDS = 'id,created_time,field_data,form_id,ad_id,adset_id,campaign_id,platform,is_organic,custom_disclaimer_responses';
const MAX_SYNC_LEADS = 2000;

export const metaEnv = () => ({
  appSecret: (process.env.META_APP_SECRET || '').trim(),
  verifyToken: (process.env.META_WEBHOOK_VERIFY_TOKEN || '').trim(),
  pageId: (process.env.META_PAGE_ID || '').trim(),
  pageToken: (process.env.META_PAGE_ACCESS_TOKEN || '').trim(),
  version: (process.env.META_GRAPH_VERSION || 'v23.0').trim(),
  formIds: (process.env.META_LEAD_FORM_IDS || '').split(',').map((s) => s.trim()).filter(Boolean),
});
export const metaConfigured = () => { const e = metaEnv(); return !!(e.appSecret && e.verifyToken && e.pageId && e.pageToken); };

const safeEq = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** X-Hub-Signature-256: "sha256=<hex HMAC of the raw body with the app secret>". */
export function signatureValid(rawBody: string, header: string | null, secret = metaEnv().appSecret): boolean {
  if (!secret || !header?.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  return safeEq(header.slice(7).toLowerCase(), expected);
}

/** The GET handshake when you add the callback URL in the Meta app dashboard. */
export function verifyChallenge(params: URLSearchParams): string | null {
  const { verifyToken } = metaEnv();
  if (!verifyToken) return null;
  if (params.get('hub.mode') !== 'subscribe') return null;
  if (!safeEq(params.get('hub.verify_token') || '', verifyToken)) return null;
  return params.get('hub.challenge');
}

// ---- Graph API -------------------------------------------------------------------------

export class GraphError extends Error {
  constructor(message: string, readonly kind: 'permission' | 'failed', readonly code?: number) { super(message); }
}

/** Permission / app-review problems are "Permission required"; everything else is "Failed". */
function classify(err: { message?: string; code?: number; error_subcode?: number; type?: string }): GraphError {
  const code = Number(err.code);
  const msg = String(err.message || 'Graph API error');
  const permission = code === 10 || (code >= 200 && code < 300) || code === 3 || /permission|not authorized|requires .*review|leads_retrieval/i.test(msg);
  if (code === 190) return new GraphError(`Access token is invalid or expired: ${msg}`, 'failed', code);
  return new GraphError(msg, permission ? 'permission' : 'failed', code);
}

type Fetcher = typeof fetch;
let fetcher: Fetcher = (...a) => fetch(...a);
/** Tests replace the network. */
export function setFetcher(f: Fetcher | null) { fetcher = f || ((...a) => fetch(...a)); }

async function graph<T = any>(path: string, params: Record<string, string> = {}, method: 'GET' | 'POST' = 'GET'): Promise<T> {
  const e = metaEnv();
  const proof = createHmac('sha256', e.appSecret).update(e.pageToken).digest('hex');
  const qs = new URLSearchParams({ ...params, access_token: e.pageToken, appsecret_proof: proof });
  // Paging links come back from Meta as full URLs; only ever follow them to the Graph API.
  if (path.startsWith('https://') && new URL(path).hostname !== 'graph.facebook.com') throw new GraphError('Unexpected paging URL', 'failed');
  const url = path.startsWith('https://') ? path : `https://graph.facebook.com/${e.version}/${path}?${qs}`;
  const res = await fetcher(url, { method, signal: AbortSignal.timeout(15_000) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.error) throw classify(body?.error || { message: `HTTP ${res.status}` });
  return body as T;
}

export const fetchLead = (id: string) => graph<MetaLead>(encodeURIComponent(id), { fields: LEAD_FIELDS });

/** Meta's Lead Ads Testing Tool fills every field with "<test lead: dummy data for …>". */
export const isTestLead = (m: MetaLead) => (m.field_data || []).some((f) => (f.values || []).some((v) => /^<test lead/i.test(String(v))));

async function saveLead(m: MetaLead, sql?: Sql) {
  return ingestLead(META_SOURCE, String(m.id), metaToLead(m), { payloadHash: sha256(JSON.stringify(m.field_data || [])), sql });
}

// ---- webhook ---------------------------------------------------------------------------

interface LeadgenChange { field?: string; value?: { leadgen_id?: string; page_id?: string; form_id?: string; ad_id?: string; created_time?: number } }

/** Processes a verified webhook body. Always resolves; problems go to the sync log. */
export async function handleMetaWebhook(body: { object?: string; entry?: { id?: string; changes?: LeadgenChange[] }[] }, sql?: Sql) {
  const { pageId } = metaEnv();
  const changes = (body.entry || []).flatMap((en) => (en.changes || []).filter((c) => c.field === 'leadgen').map((c) => c.value || {}));
  let imported = 0, merged = 0, skipped = 0, tests = 0;
  const errors: string[] = [];
  let permissionError = false;
  for (const v of changes) {
    const id = String(v.leadgen_id || '');
    // The "Test" button in the app dashboard's Webhooks page sends sample ids (all 4s).
    if (!id || /^4+$/.test(id)) { tests++; continue; }
    if (pageId && v.page_id && String(v.page_id) !== pageId) { skipped++; continue; }
    try {
      const lead = await fetchLead(id);
      if (isTestLead(lead)) { tests++; continue; }
      const r = await saveLead(lead, sql);
      if (r.outcome === 'created') imported++; else if (r.outcome === 'merged') merged++; else skipped++;
    } catch (e) {
      if (e instanceof GraphError && e.kind === 'permission') permissionError = true;
      errors.push(`Lead ${id}: ${e instanceof Error ? e.message : 'failed'}`);
    }
  }
  const onlyTests = tests > 0 && tests === changes.length;
  await logRun({
    source: META_SOURCE, action: 'webhook', ok: errors.length === 0, imported, merged, skipped, is_test: onlyTests,
    error: errors.length ? `${errors.length} lead(s) could not be fetched — use Run sync to retry. ${errors[0]}` : null,
    detail: { changes: changes.length, tests, kind: permissionError ? 'permission' : errors.length ? 'failed' : undefined },
  }, sql);
}

// ---- test & sync -----------------------------------------------------------------------

export async function testMetaConnection(actor: string, sql?: Sql) {
  const e = metaEnv();
  try {
    const page = await graph<{ id: string; name?: string }>(encodeURIComponent(e.pageId), { fields: 'id,name' });
    const forms = await graph<{ data: { id: string; name?: string; status?: string }[] }>(`${encodeURIComponent(e.pageId)}/leadgen_forms`, { fields: 'id,name,status', limit: '50' });
    const apps = await graph<{ data: { id: string; name?: string; subscribed_fields?: string[] }[] }>(`${encodeURIComponent(e.pageId)}/subscribed_apps`);
    const subscribed = (apps.data || []).some((a) => (a.subscribed_fields || []).includes('leadgen'));
    const result = {
      page: page.name || page.id,
      forms: (forms.data || []).map((f) => ({ id: f.id, name: f.name || '', status: f.status || '' })),
      leadgen_subscribed: subscribed,
    };
    await logRun({ source: META_SOURCE, action: 'test', ok: true, is_test: true, actor, detail: { page_id: page.id, forms: result.forms.length, leadgen_subscribed: subscribed } }, sql);
    return { ok: true as const, ...result };
  } catch (err) {
    const g = err instanceof GraphError ? err : new GraphError(err instanceof Error ? err.message : 'Connection failed', 'failed');
    await logRun({ source: META_SOURCE, action: 'test', ok: false, is_test: true, actor, error: g.message, detail: { kind: g.kind, code: g.code } }, sql);
    return { ok: false as const, kind: g.kind, error: g.message };
  }
}

/** Subscribes the Page to this app's `leadgen` webhooks (needs pages_manage_metadata). */
export async function subscribePage(actor: string, sql?: Sql) {
  const e = metaEnv();
  try {
    await graph(`${encodeURIComponent(e.pageId)}/subscribed_apps`, { subscribed_fields: 'leadgen' }, 'POST');
    await logRun({ source: META_SOURCE, action: 'test', ok: true, is_test: true, actor, detail: { note: 'Page subscribed to leadgen webhooks' } }, sql);
    return { ok: true as const };
  } catch (err) {
    const g = err instanceof GraphError ? err : new GraphError(err instanceof Error ? err.message : 'Failed', 'failed');
    await logRun({ source: META_SOURCE, action: 'test', ok: false, is_test: true, actor, error: g.message, detail: { kind: g.kind, code: g.code } }, sql);
    return { ok: false as const, kind: g.kind, error: g.message };
  }
}

export async function runMetaSync(actor: string, sql?: Sql) {
  const e = metaEnv();
  // From the last successful sync (minus a day of overlap), at most Meta's 90-day retention.
  const prev = await lastOk(META_SOURCE, 'sync', sql);
  const lastSync = prev ? Date.parse(prev) : 0;
  const since = Math.max(Date.now() - 90 * 86_400_000, lastSync ? lastSync - 86_400_000 : 0);
  let imported = 0, merged = 0, skipped = 0, tests = 0, seen = 0;
  try {
    const formIds = e.formIds.length
      ? e.formIds
      : ((await graph<{ data: { id: string }[] }>(`${encodeURIComponent(e.pageId)}/leadgen_forms`, { fields: 'id', limit: '100' })).data || []).map((f) => f.id);
    for (const form of formIds) {
      let page: { data?: MetaLead[]; paging?: { next?: string } } | null = await graph(`${encodeURIComponent(form)}/leads`, {
        fields: LEAD_FIELDS, limit: '100',
        filtering: JSON.stringify([{ field: 'time_created', operator: 'GREATER_THAN', value: Math.floor(since / 1000) }]),
      });
      while (page && seen < MAX_SYNC_LEADS) {
        for (const m of page.data || []) {
          seen++;
          if (isTestLead(m)) { tests++; continue; }
          const r = await saveLead({ ...m, form_id: m.form_id || form }, sql);
          if (r.outcome === 'created') imported++; else if (r.outcome === 'merged') merged++; else skipped++;
        }
        page = page.paging?.next ? await graph(page.paging.next) : null;
      }
    }
    await logRun({ source: META_SOURCE, action: 'sync', ok: true, imported, merged, skipped, actor, detail: { forms: formIds.length, seen, tests, since: new Date(since).toISOString(), capped: seen >= MAX_SYNC_LEADS } }, sql);
    return { ok: true as const, forms: formIds.length, seen, imported, merged, skipped, tests };
  } catch (err) {
    const g = err instanceof GraphError ? err : new GraphError(err instanceof Error ? err.message : 'Sync failed', 'failed');
    await logRun({ source: META_SOURCE, action: 'sync', ok: false, imported, merged, skipped, actor, error: g.message, detail: { kind: g.kind, code: g.code, seen } }, sql);
    return { ok: false as const, kind: g.kind, error: g.message, imported, merged, skipped };
  }
}
