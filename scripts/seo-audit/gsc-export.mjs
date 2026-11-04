// READ-ONLY Search Console export + quick-win report.
//
//   node --env-file=.env scripts/seo-audit/gsc-export.mjs [--months=16] [--site=sc-domain:mappingg.com]
//
// Needs (see seo-doc/GSC-OPPORTUNITY-REPORT.md):
//   1. "Google Search Console API" enabled in the service account's Google Cloud project.
//   2. The service account email added as a user on the Search Console property.
//   3. GSC_SERVICE_ACCOUNT_JSON (or GSC_SERVICE_ACCOUNT_EMAIL + GSC_PRIVATE_KEY) in .env.
//
// Writes a NEW dated folder every run (history is never overwritten):
//   reports/gsc/<YYYY-MM-DD>/queries.csv, pages.csv, query-page.csv, devices.csv,
//   countries.csv, daily.csv, opportunities.csv, summary.json
// Then merge into the keyword sheet:
//   node --experimental-transform-types --no-warnings --import ./tests/register.mjs \
//     scripts/seo-audit/keyword-sheet.mts --gsc=reports/gsc/<date>/queries.csv

import { SignJWT, importPKCS8 } from 'jose';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const API = 'https://searchconsole.googleapis.com/webmasters/v3';

function creds() {
  const j = process.env.GSC_SERVICE_ACCOUNT_JSON;
  if (j) { const o = JSON.parse(j); return { email: o.client_email, key: o.private_key }; }
  if (process.env.GSC_SERVICE_ACCOUNT_EMAIL && process.env.GSC_PRIVATE_KEY) {
    return { email: process.env.GSC_SERVICE_ACCOUNT_EMAIL, key: process.env.GSC_PRIVATE_KEY.replace(/\\n/g, '\n') };
  }
  throw new Error('Search Console credentials are not set (GSC_SERVICE_ACCOUNT_JSON).');
}

async function token() {
  const c = creds();
  const now = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/webmasters.readonly' })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' }).setIssuer(c.email).setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt(now).setExpirationTime(now + 3600).sign(await importPKCS8(c.key, 'RS256'));
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  const b = await r.json();
  if (!b.access_token) throw new Error(`token request failed: ${b.error_description || r.status}`);
  return { value: b.access_token, email: c.email };
}

const tk = await token();
async function api(p, body) {
  const r = await fetch(API + p, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${tk.value}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${r.status} ${b.error?.message || ''}`.trim());
  return b;
}

let site = arg('site', process.env.GSC_SITE_URL || '');
if (!site) {
  const list = (await api('/sites')).siteEntry || [];
  site = (list.find((s) => s.siteUrl === 'sc-domain:mappingg.com') || list.find((s) => /mappingg\.com/.test(s.siteUrl)))?.siteUrl || '';
  if (!site) throw new Error(`Service account ${tk.email} has no access to a mappingg.com property. Add it in Search Console → Settings → Users and permissions.`);
}

const ymd = (d) => d.toISOString().slice(0, 10);
const end = new Date(); end.setUTCDate(end.getUTCDate() - 2); // finalised data
const start = new Date(end); start.setUTCMonth(start.getUTCMonth() - Number(arg('months', 16)));
const range = { startDate: ymd(start), endDate: ymd(end) };

/** Every row for these dimensions (25k per request, paged). */
async function all(dimensions, extra = {}) {
  const rows = [];
  for (let startRow = 0; ; startRow += 25000) {
    const b = await api(`/sites/${encodeURIComponent(site)}/searchAnalytics/query`, { ...range, dimensions, rowLimit: 25000, startRow, dataState: 'final', ...extra });
    rows.push(...(b.rows || []));
    if (!b.rows || b.rows.length < 25000) break;
  }
  return rows.map((r) => ({ ...Object.fromEntries(dimensions.map((d, i) => [d, r.keys[i]])), clicks: r.clicks, impressions: r.impressions, ctr: +r.ctr.toFixed(4), position: +r.position.toFixed(1) }));
}

const [queries, pages, queryPage, devices, countries, daily] = await Promise.all([
  all(['query']), all(['page']), all(['query', 'page']), all(['device']), all(['country']), all(['date']),
]);

const dir = path.join('reports', 'gsc', ymd(new Date()) + (existsSync(path.join('reports', 'gsc', ymd(new Date()))) ? `-${Date.now()}` : ''));
mkdirSync(dir, { recursive: true });
const csv = (rows) => {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return '﻿' + [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n') + '\n';
};
// Same column names as a Search Console UI export, so keyword-sheet.mts can read either.
writeFileSync(path.join(dir, 'queries.csv'), csv(queries.map((r) => ({ 'Top queries': r.query, Clicks: r.clicks, Impressions: r.impressions, CTR: r.ctr, Position: r.position }))));
for (const [name, rows] of Object.entries({ pages, 'query-page': queryPage, devices, countries, daily })) writeFileSync(path.join(dir, `${name}.csv`), csv(rows));

// Quick wins: real impressions, position 5–30, CTR below the site's median for that band.
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const band = queries.filter((q) => q.position >= 5 && q.position <= 30 && q.impressions >= 50);
const mCtr = median(band.map((q) => q.ctr));
const bestPage = new Map();
for (const r of queryPage) { const b = bestPage.get(r.query); if (!b || r.impressions > b.impressions) bestPage.set(r.query, r); }
const opportunities = band
  .filter((q) => q.ctr <= mCtr)
  .sort((a, b) => b.impressions - a.impressions)
  .map((q) => ({ query: q.query, impressions: q.impressions, clicks: q.clicks, ctr: q.ctr, position: q.position, ranking_page: bestPage.get(q.query)?.page || '', note: 'Check intent, title and description of the ranking page before changing it' }));
writeFileSync(path.join(dir, 'opportunities.csv'), csv(opportunities));

const sum = (rows, k) => rows.reduce((a, r) => a + r[k], 0);
const summary = {
  site, range, generated: new Date().toISOString(),
  totals: { clicks: sum(daily, 'clicks'), impressions: sum(daily, 'impressions') },
  rows: { queries: queries.length, pages: pages.length, queryPage: queryPage.length },
  quickWins: opportunities.length, medianCtrPos5to30: mCtr,
  branded: queries.filter((q) => /mapping/i.test(q.query)).reduce((a, q) => ({ clicks: a.clicks + q.clicks, impressions: a.impressions + q.impressions }), { clicks: 0, impressions: 0 }),
};
writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(`Search Console ${site} ${range.startDate} → ${range.endDate}: written to ${dir}`);
console.log(summary);
