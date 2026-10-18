// Counts per city: records, how many are on the admin's "Added data — Check & go live" tab (mirror of lib/scraped.ts
// readyGaps — keep the two in step), how many of those have a verified location and a developer logo.
//   node --env-file=.env migration/enrichment/scraped/go-live-stats.mjs [City]   (City: also show what blocks that city's current rows)
import pg from 'pg';
const url = new URL(process.env.DATABASE_URL); url.searchParams.delete('sslmode');
const db = new pg.Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } });
await db.connect();
const CONFIG = ['Studio', '1 BHK', '1.5 BHK', '2 BHK', '2.5 BHK', '3 BHK', '3.5 BHK', '4 BHK', '5+ BHK', 'Villa', 'Row House', 'Penthouse', 'Duplex', 'Plot', 'Shop', 'Office', 'Showroom', 'Warehouse', 'Land'];
const configs = (f) => String(f.configurations || '').split(',').map((s) => s.trim().replace(/^(\d(?:\.5)?)\s*BHK\b.*$/i, (_m, n) => (Number(n) >= 5 ? '5+ BHK' : `${n} BHK`)).replace(/^(residential\s+)?plots?$/i, 'Plot')).filter((s) => CONFIG.some((o) => o.toLowerCase() === s.toLowerCase()));
const today = new Date().toISOString().slice(0, 10), CLOSED = /Lapsed|Withdrawn|Revoked|Transferred|Superseded/i;
// MahaRERA rows with facts from the developer's own site (approved 18 Oct 2026): units / cost / land not required, but the
// developer page must show the RERA no., the pin must be verified and the developer logo must match.
const nk = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const logoKeys = new Set(); for (const x of (await db.query(`SELECT doc->>'name' name, doc->'aliases' a FROM developers WHERE coalesce(doc->>'logo','') <> ''`)).rows) [x.name, ...(x.a || [])].forEach((y) => logoKeys.add(nk(y)));
const gapsOf = (d, e) => { if (!e) return ['Not enriched']; const f = e.fields || {}, g = []; const dev = d.regulator === 'MahaRERA' && e.source_type === 'developer_official_site';
  if ((e.review_required || []).length) g.push('conflict'); if (!configs(f).length) g.push('no form configuration');
  if (f.total_units == null && f.total_plots == null && !dev) g.push('no units'); if (!f.proposed_completion) g.push('no completion'); else if (f.proposed_completion < today) g.push('completion passed');
  if (!f.project_cost && d.regulator !== 'UP RERA' && !dev) g.push('no cost'); if (/default on QPR/i.test(d.status_category || '')) g.push('QPR default');
  if (!f.land_area && !dev) g.push('no land');
  if (dev) { if (f.rera_on_official_page !== true) g.push('rera not on dev page'); if (!['verified', 'manual'].includes(d.pin_check)) g.push('pin not verified'); if (!logoKeys.has(nk(d.developer_name))) g.push('no logo'); } if (!(d.pincode || f.pincode) && !(d.regulator === 'UP RERA' && d.pin_check === 'verified')) g.push('no pincode');
  if (!d.project_name || !d.developer_name || !d.rera_number || !d.locality) g.push('name/dev/rera/locality missing');
  if (CLOSED.test(d.status_category || '') || f.registry_project_status === 'Completed') g.push('closed'); return g; };
const { rows } = await db.query(`SELECT id, doc->'data' d, doc->'enrichment' e FROM scraped_projects WHERE NOT coalesce((doc->>'deleted')::boolean,false)`);
const by = {}, gaps = {};
for (const r of rows) { const c = r.d.city; by[c] ||= { records: 0, go_live_tab: 0, located: 0 }; by[c].records++; const g = gapsOf(r.d, r.e);
  if (!g.length) { by[c].go_live_tab++; if (['verified', 'manual'].includes(r.d.pin_check)) by[c].located++; }
  if (c === process.argv[2] && !g.includes("completion passed")) { const k = g.join(" + ") || "READY"; gaps[k] = (gaps[k] || 0) + 1; } }
console.table(by); if (process.argv[2]) console.log(process.argv[2], gaps);
await db.end();
// logos for go-live rows per city
{
  const db2 = new pg.Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } }); await db2.connect();
  const n = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const keys = new Set(); for (const d of (await db2.query(`SELECT doc->>'name' name, doc->'aliases' a FROM developers WHERE coalesce(doc->>'logo','') <> ''`)).rows) [d.name, ...(d.a || [])].forEach((x) => keys.add(n(x)));
  const per = {}; for (const r of rows) { if (gapsOf(r.d, r.e).length) continue; const c = r.d.city; per[c] ||= { go_live: 0, with_logo: 0 }; per[c].go_live++; if (keys.has(n(r.d.developer_name))) per[c].with_logo++; }
  console.table(per); await db2.end();
}
