// Builds <cache>/dev-logos/accepted.json (read by dev-logos-apply.mjs) from the reviewed results:
//   results.json picks (own site / portal), minus dev-logo-rejects.json, plus dev-logo-same-as.json (SPVs that use
//   another promoter's logo) and manual.json (logos found by hand), grouped into one entry per logo image.
// Promoters already covered by Super admin → Developers (same name, or an alias in dev-logo-aliases.json) are left out.
// Also prints the records that would still have no logo.
//   node --env-file=.env migration/enrichment/scraped/dev-logos-accept.mjs

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import pg from 'pg';

const CACHE = path.resolve('migration/backup/scraped-enrichment-cache/dev-logos');
const DIR = 'migration/enrichment/scraped';
const normDev = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const read = (f, d) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : d);

const url = new URL(process.env.DATABASE_URL);
url.searchParams.delete('sslmode');
const db = new pg.Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } });
await db.connect();
const ids = JSON.parse(readFileSync(process.env.IDS_FILE || 'migration/backup/scraped-enrichment-cache/ready-ids.json', 'utf8'));
const recs = (await db.query(`SELECT doc->'data'->>'developer_name' dev, doc->'data'->>'project_name' p FROM scraped_projects WHERE id = ANY($1)`, [ids])).rows;
const dirRows = (await db.query(`SELECT doc->>'name' name, doc->'aliases' aliases, (coalesce(doc->>'logo','') <> '') has FROM developers`)).rows;
await db.end();

// Names that already get a logo from the directory (name or alias, now or after the aliases file is applied).
const covered = new Set();
for (const d of dirRows) if (d.has) [d.name, ...(d.aliases || [])].forEach((n) => covered.add(normDev(n)));
for (const [k, v] of Object.entries(read(`${DIR}/dev-logo-aliases.json`, {}))) if (!k.startsWith('_')) v.forEach((n) => covered.add(normDev(n)));

const results = read(path.join(CACHE, 'results.json'), {});
const rej = read(`${DIR}/dev-logo-rejects.json`, { bad_src: [], bad_dev: {} });
const sameAs = read(`${DIR}/dev-logo-same-as.json`, {});
const manual = read(path.join(CACHE, 'manual.json'), {}); // dev → { logo, site, brand }

// dev (normDev) → pick
const picks = new Map();
for (const [dev, r] of Object.entries(results)) {
  const p = r.pick;
  if (!p?.logo || rej.bad_src.some((s) => (p.logo_src || '').includes(s)) || rej.bad_dev[dev] === p.logo_src) continue;
  if (!picks.has(normDev(dev))) picks.set(normDev(dev), { ...p, from: dev });
}
for (const [dev, m] of Object.entries(manual)) picks.set(normDev(dev), { ...m, source: 'found by hand', from: dev });
for (const [dev, other] of Object.entries(sameAs)) if (!dev.startsWith('_') && picks.has(normDev(other))) picks.set(normDev(dev), { ...picks.get(normDev(other)), from: other });

// One entry per logo image; the brand name comes from the portal label or the promoter with most records.
const rowsOf = new Map();
for (const r of recs) rowsOf.set(r.dev, (rowsOf.get(r.dev) || 0) + 1);
const groups = new Map();
for (const [dev, n] of [...rowsOf].sort((a, b) => b[1] - a[1])) {
  const k = normDev(dev);
  if (covered.has(k) || !picks.has(k)) continue;
  const p = picks.get(k);
  const hash = createHash('md5').update(readFileSync(path.join(CACHE, p.logo))).digest('hex');
  const g = groups.get(hash) || { logo: p.logo, white_only: !!p.white_only, site: p.site, logo_src: p.logo_src, source: p.source, brand: null, devs: [] };
  if (!g.brand && p.brand && !/\b(pvt|private|ltd|limited|llp)\b/i.test(p.brand)) g.brand = p.brand;
  g.devs.push(dev);
  groups.set(hash, g);
}
const accepted = [...groups.values()].map((g) => ({ ...g, name: g.brand || undefined }));
writeFileSync(path.join(CACHE, 'accepted.json'), JSON.stringify(accepted, null, 1));

const missing = recs.filter((r) => !covered.has(normDev(r.dev)) && !picks.has(normDev(r.dev)));
writeFileSync(path.join(CACHE, 'missing.json'), JSON.stringify(missing, null, 1));
console.log(`records ${recs.length}: covered by directory ${recs.filter((r) => covered.has(normDev(r.dev))).length}, new logos ${recs.length - missing.length - recs.filter((r) => covered.has(normDev(r.dev))).length}, still missing ${missing.length}`);
console.log(`${accepted.length} new directory entries`);
