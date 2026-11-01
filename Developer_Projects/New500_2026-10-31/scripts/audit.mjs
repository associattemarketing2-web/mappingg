// Phase 1 of the "500 new projects" research: read-only audit of what Mappingg already holds, and the
// duplicate-exclusion list every new candidate is checked against.
//
//   node --env-file=.env Developer_Projects/New500_2026-10-31/scripts/audit.mjs
//
// Sources: live / hidden / pending map pins, every scraped_projects row (deleted ones too — a deleted row
// must not come back as "new"), every project submission, pins_history (old pin versions) and trash.
// Writes ../audit/audit-summary.json (counts) and ../audit/exclusion.json (RERA numbers, name keys, points).
// Nothing in the database is changed.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { reraKey, nameKey, devKey } from './keys.mjs';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../audit');
mkdirSync(OUT, { recursive: true });
const url = new URL(process.env.DATABASE_URL); url.searchParams.delete('sslmode');
const db = new pg.Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } });
await db.connect();
const q = async (s, a) => (await db.query(s, a)).rows;

const rera = new Map();   // reraKey -> where it was seen
const names = new Map();  // nameKey|devKey -> where
const points = [];        // [lat, lng, where]
const seen = (map, k, where) => { if (!k) return; if (!map.has(k)) map.set(k, []); map.get(k).push(where); };
const splitRera = (s) => String(s || '').split(/[,;\n/]+(?=\s*[A-Z]{2,})|\s*[,;\n]\s*/).map((x) => x.trim()).filter((x) => x.length >= 6);

// ---- live map pins ----
const pins = await q(`SELECT id, doc FROM pins`);
const pinStats = { total: pins.length, live: 0, hidden: 0, pending_review: 0, rejected: 0, no_rera: 0, by_city: {} };
for (const { id, doc: d } of pins) {
  const hidden = d.hidden === true, pending = d.pending_review === true, rejected = d.rejected === true;
  if (rejected) pinStats.rejected++; else if (pending) pinStats.pending_review++; else if (hidden) pinStats.hidden++; else pinStats.live++;
  const city = String(d.location || '').split(',').pop().trim() || '(none)';
  pinStats.by_city[city] = (pinStats.by_city[city] || 0) + 1;
  const where = `pin #${d.number} ${d.title}`;
  const rs = splitRera(d.rera_number); if (!rs.length) pinStats.no_rera++;
  rs.forEach((r) => seen(rera, reraKey(r), where));
  seen(names, `${nameKey(d.title)}|${devKey(d.developer)}`, where);
  if (Number.isFinite(+d.lat) && Number.isFinite(+d.lng)) points.push([+d.lat, +d.lng, where]);
}

// ---- scraped registry rows (deleted included) ----
const scraped = await q(`SELECT id, doc->'data' d, coalesce((doc->>'deleted')::boolean,false) del, doc->>'submission_id' sub FROM scraped_projects`);
const scrStats = { total: scraped.length, deleted: 0, added_to_projects: 0, by_city: {} };
for (const { id, d, del, sub } of scraped) {
  if (del) scrStats.deleted++; if (sub) scrStats.added_to_projects++;
  const c = d.city || '(none)'; scrStats.by_city[c] ||= { total: 0, deleted: 0 }; scrStats.by_city[c].total++; if (del) scrStats.by_city[c].deleted++;
  const where = `scraped ${id}${del ? ' (deleted)' : ''} ${d.project_name}`;
  seen(rera, reraKey(d.rera_number), where);
  seen(names, `${nameKey(d.project_name)}|${devKey(d.developer_name)}`, where);
  if (Number.isFinite(+d.lat) && Number.isFinite(+d.lng) && d.lat != null) points.push([+d.lat, +d.lng, where]);
}

// ---- project submissions (intake) ----
const subs = await q(`SELECT id, doc FROM project_submissions`);
const subStats = { total: subs.length, by_status: {} };
for (const { id, doc: d } of subs) {
  subStats.by_status[d.status || '(none)'] = (subStats.by_status[d.status || '(none)'] || 0) + 1;
  const where = `submission ${d.ref_code || id} ${d.project_name}`;
  (d.rera_numbers || []).forEach((r) => seen(rera, reraKey(r), where));
  seen(names, `${nameKey(d.project_name)}|${devKey(d.developer_name)}`, where);
  if (Number.isFinite(+d.lat) && Number.isFinite(+d.lng) && d.lat != null) points.push([+d.lat, +d.lng, where]);
}

// ---- old pin versions and trash ----
const hist = await q(`SELECT doc->'row_data' d FROM pins_history WHERE doc ? 'row_data'`);
for (const { d } of hist) { if (!d) continue; const where = `pins_history ${d.title}`; splitRera(d.rera_number).forEach((r) => seen(rera, reraKey(r), where)); seen(names, `${nameKey(d.title)}|${devKey(d.developer)}`, where); }
const trash = await q(`SELECT doc FROM trash`);
for (const { doc } of trash) for (const x of doc.docs || []) { const d = x.doc || {}; if (d.title || d.project_name) { const where = `trash ${d.title || d.project_name}`; splitRera(d.rera_number).forEach((r) => seen(rera, reraKey(r), where)); (d.rera_numbers || []).forEach((r) => seen(rera, reraKey(r), where)); seen(names, `${nameKey(d.title || d.project_name)}|${devKey(d.developer || d.developer_name)}`, where); } }

// ---- duplicates already inside Mappingg (same RERA on two live pins) ----
const dupLive = [...rera].filter(([, w]) => w.filter((x) => x.startsWith('pin #')).length > 1).map(([k, w]) => ({ rera: k, pins: w.filter((x) => x.startsWith('pin #')) }));

const summary = {
  generated: new Date().toISOString(),
  pins: pinStats, scraped: scrStats, submissions: subStats, pins_history_versions: hist.length, trash_batches: trash.length,
  exclusion: { rera_numbers: rera.size, name_developer_keys: names.size, points: points.length },
  live_pins_sharing_a_rera: dupLive,
};
writeFileSync(path.join(OUT, 'audit-summary.json'), JSON.stringify(summary, null, 2) + '\n');
writeFileSync(path.join(OUT, 'exclusion.json'), JSON.stringify({ generated: summary.generated, rera: Object.fromEntries(rera), names: Object.fromEntries(names), points }) + '\n');
console.log(JSON.stringify({ ...summary, pins: { ...pinStats, by_city: Object.keys(pinStats.by_city).length + ' cities' }, live_pins_sharing_a_rera: dupLive.length }, null, 2));
await db.end();
