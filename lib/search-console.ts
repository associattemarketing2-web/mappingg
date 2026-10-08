import { SignJWT, importPKCS8 } from 'jose';

// Live Google Search Console data for the admin "SEO & Health" tab.
//
// Auth is a Google Cloud *service account* (server-to-server, no login popup):
//   1. Cloud console → enable "Google Search Console API" → create a service
//      account → Keys → Add key → JSON.
//   2. Search Console → Settings → Users and permissions → Add user → paste the
//      service account's email (Restricted/Full is enough to read data).
//   3. Set GSC_SERVICE_ACCOUNT_EMAIL + GSC_PRIVATE_KEY (or the whole JSON in
//      GSC_SERVICE_ACCOUNT_JSON) and optionally GSC_SITE_URL. See .env.example.
// All of this is server-only; nothing here ever reaches the browser.

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://searchconsole.googleapis.com';
const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';

interface Creds { email: string; key: string }

function creds(): Creds | null {
  const json = process.env.GSC_SERVICE_ACCOUNT_JSON;
  if (json) {
    try {
      const j = JSON.parse(json) as { client_email?: string; private_key?: string };
      if (j.client_email && j.private_key) return { email: j.client_email, key: j.private_key };
    } catch { /* fall through to the split variables */ }
  }
  const email = process.env.GSC_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GSC_PRIVATE_KEY;
  // Hosting dashboards usually store the PEM with literal "\n" sequences.
  return email && key ? { email, key: key.replace(/\\n/g, '\n') } : null;
}

export function gscConfigured(): boolean {
  return creds() !== null;
}

export function serviceAccountEmail(): string {
  return creds()?.email || '';
}

let token: { value: string; exp: number } | null = null;

async function accessToken(): Promise<string> {
  if (token && token.exp > Date.now() + 60_000) return token.value;
  const c = creds();
  if (!c) throw new GscError('not_configured', 'Search Console credentials are not set');
  const now = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({ scope: SCOPE })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(c.email)
    .setAudience(TOKEN_URL)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(await importPKCS8(c.key, 'RS256'));
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    cache: 'no-store',
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !body.access_token) throw new GscError('auth_failed', body.error_description || `Token request failed (${res.status})`);
  token = { value: body.access_token, exp: Date.now() + (body.expires_in || 3600) * 1000 };
  return token.value;
}

export class GscError extends Error {
  constructor(public code: 'not_configured' | 'auth_failed' | 'no_access' | 'api_error', message: string) {
    super(message);
  }
}

async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(API + path, {
    method: init?.method || 'GET',
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
    body: init?.body ? JSON.stringify(init.body) : undefined,
    cache: 'no-store',
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (res.status === 403) throw new GscError('no_access', body.error?.message || 'The service account has no access to this property');
  if (!res.ok) throw new GscError('api_error', body.error?.message || `Search Console API error (${res.status})`);
  return body;
}

/* ------------------------------- property -------------------------------- */

export interface GscSite { siteUrl: string; permissionLevel: string }

/**
 * Picks the Search Console property to read. GSC_SITE_URL wins (e.g.
 * "sc-domain:mappingg.com" or "https://www.mappingg.com/"); otherwise the
 * property matching NEXT_PUBLIC_SITE_URL, preferring a Domain property.
 */
export async function resolveSite(): Promise<{ site: GscSite | null; all: GscSite[] }> {
  const list = await api<{ siteEntry?: GscSite[] }>('/webmasters/v3/sites');
  const all = (list.siteEntry || []).filter((s) => s.permissionLevel !== 'siteUnverifiedUser');
  const wanted = process.env.GSC_SITE_URL?.trim();
  if (wanted) return { site: all.find((s) => s.siteUrl === wanted) || null, all };
  const host = new URL(process.env.NEXT_PUBLIC_SITE_URL || 'https://mappingg.com').hostname.replace(/^www\./, '');
  const site =
    all.find((s) => s.siteUrl === `sc-domain:${host}`) ||
    all.find((s) => { try { return new URL(s.siteUrl).hostname.replace(/^www\./, '') === host; } catch { return false; } }) ||
    null;
  return { site, all };
}

/* ---------------------------- search analytics ---------------------------- */

export interface Row { keys?: string[]; clicks: number; impressions: number; ctr: number; position: number }

async function analytics(site: string, body: Record<string, unknown>): Promise<Row[]> {
  const r = await api<{ rows?: Row[] }>(`/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`, {
    method: 'POST',
    // "all" includes the freshest (not yet finalised) data, like the GSC UI.
    body: { dataState: 'all', ...body },
  });
  return r.rows || [];
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);
function range(days: number, offsetDays = 0) {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 1 - offsetDays); // up to yesterday
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return { startDate: ymd(start), endDate: ymd(end) };
}

function totals(rows: Row[]) {
  const clicks = rows.reduce((a, r) => a + r.clicks, 0);
  const impressions = rows.reduce((a, r) => a + r.impressions, 0);
  // Average position is impression-weighted, matching the Search Console UI.
  const position = impressions ? rows.reduce((a, r) => a + r.position * r.impressions, 0) / impressions : 0;
  return { clicks, impressions, ctr: impressions ? clicks / impressions : 0, position };
}

const slim = (r: Row) => ({
  key: r.keys?.[0] || '',
  clicks: r.clicks,
  impressions: r.impressions,
  ctr: r.ctr,
  position: r.position,
});

/* -------------------------------- report --------------------------------- */

export async function searchConsoleReport(days: number) {
  const { site, all } = await resolveSite();
  if (!site) {
    throw new GscError('no_access', all.length
      ? `Service account can see ${all.map((s) => s.siteUrl).join(', ')} but not the configured property. Set GSC_SITE_URL to one of these.`
      : 'The service account has not been added as a user in Search Console yet.');
  }
  const s = site.siteUrl;
  const cur = range(days);
  const prev = range(days, days);

  const [daily, prevDaily, queries, pages, countries, devices, sitemaps, inspection] = await Promise.all([
    analytics(s, { ...cur, dimensions: ['date'], rowLimit: 500 }),
    analytics(s, { ...prev, dimensions: ['date'], rowLimit: 500 }),
    analytics(s, { ...cur, dimensions: ['query'], rowLimit: 50 }),
    analytics(s, { ...cur, dimensions: ['page'], rowLimit: 50 }),
    analytics(s, { ...cur, dimensions: ['country'], rowLimit: 250 }), // every country, for the map
    analytics(s, { ...cur, dimensions: ['device'], rowLimit: 5 }),
    api<{ sitemap?: { path: string; lastSubmitted?: string; lastDownloaded?: string; isPending?: boolean; errors?: string; warnings?: string; contents?: { type: string; submitted?: string; indexed?: string }[] }[] }>(
      `/webmasters/v3/sites/${encodeURIComponent(s)}/sitemaps`,
    ).then((r) => r.sitemap || []).catch(() => []),
    inspectHome(s).catch(() => null),
  ]);

  // Fill missing days with zeros so the chart has one bar per day.
  const byDate = new Map(daily.map((r) => [r.keys?.[0] || '', r]));
  const series: { date: string; clicks: number; impressions: number; position: number }[] = [];
  for (let d = new Date(cur.startDate + 'T00:00:00Z'); ymd(d) <= cur.endDate; d.setUTCDate(d.getUTCDate() + 1)) {
    const r = byDate.get(ymd(d));
    series.push({ date: ymd(d), clicks: r?.clicks || 0, impressions: r?.impressions || 0, position: r?.position || 0 });
  }

  return {
    site: s,
    permission: site.permissionLevel,
    range: cur,
    totals: totals(daily),
    previous: totals(prevDaily),
    daily: series,
    queries: queries.map(slim),
    pages: pages.map(slim),
    countries: countries.map(slim),
    devices: devices.map(slim),
    sitemaps: sitemaps.map((m) => ({
      path: m.path,
      lastSubmitted: m.lastSubmitted || null,
      lastDownloaded: m.lastDownloaded || null,
      pending: !!m.isPending,
      errors: Number(m.errors || 0),
      warnings: Number(m.warnings || 0),
      submitted: (m.contents || []).reduce((a, c) => a + Number(c.submitted || 0), 0),
    })),
    homepage: inspection,
  };
}

/** URL Inspection of the homepage: is it indexed, and when was it last crawled. */
async function inspectHome(site: string) {
  const origin = (process.env.NEXT_PUBLIC_SITE_URL || 'https://mappingg.com').replace(/\/$/, '');
  const r = await api<{ inspectionResult?: { indexStatusResult?: { verdict?: string; coverageState?: string; lastCrawlTime?: string; googleCanonical?: string; robotsTxtState?: string; pageFetchState?: string } } }>(
    '/v1/urlInspection/index:inspect',
    { method: 'POST', body: { inspectionUrl: origin + '/', siteUrl: site } },
  );
  const x = r.inspectionResult?.indexStatusResult || {};
  return {
    url: origin + '/',
    verdict: x.verdict || 'UNKNOWN',
    coverage: x.coverageState || '',
    lastCrawl: x.lastCrawlTime || null,
    canonical: x.googleCanonical || '',
    robots: x.robotsTxtState || '',
    fetch: x.pageFetchState || '',
  };
}
