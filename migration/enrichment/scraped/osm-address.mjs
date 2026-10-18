// Address for live scraped records that have a verified map pin but no address anywhere (data.address and the
// registry's full_address both blank) — mostly MahaRERA rows, whose project pages sit behind a CAPTCHA.
//
//   node --env-file=.env migration/enrichment/scraped/osm-address.mjs            dry run
//   node --env-file=.env migration/enrichment/scraped/osm-address.mjs --apply
//
// The address is the OpenStreetMap address at the verified point (Nominatim reverse geocoding, 1 request/second as
// its usage policy asks). It is used only when OpenStreetMap's postcode at that point equals the record's pincode
// (or the record has none), and only fills a blank data.address; nothing else changes. Answers are cached.

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const APPLY = process.argv.includes('--apply');
const DIR = path.resolve('migration/backup/scraped-enrichment-cache/osm-reverse');
const LOG = path.resolve('seo-doc/enrichment/scraped-project-enrichment/PROJECT-CHANGE-LOG.csv');
const RUN = new Date().toISOString();
mkdirSync(DIR, { recursive: true });

const url = new URL(process.env.DATABASE_URL);
const mode = url.searchParams.get('sslmode');
url.searchParams.delete('sslmode');
const db = new pg.Client(mode === 'disable' ? { connectionString: process.env.DATABASE_URL } : { connectionString: url.toString(), ssl: mode ? true : { rejectUnauthorized: false } });
await db.connect();
const { rows } = await db.query(`SELECT id, doc->'data' d FROM scraped_projects
  WHERE NOT coalesce((doc->>'deleted')::boolean, false) AND doc->'data'->>'pin_check' IN ('verified', 'manual') AND doc->'data'->>'lat' IS NOT NULL
    AND coalesce(doc->'data'->>'address', '') = '' AND coalesce(doc->'enrichment'->'fields'->>'full_address', '') = ''`);

const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
let saved = 0, planned = 0;
for (const { id, d } of rows) {
  const f = path.join(DIR, `${id}.json`);
  let j;
  if (existsSync(f)) j = JSON.parse(readFileSync(f, 'utf8'));
  else {
    const u = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=18&lat=${d.lat}&lon=${d.lng}`;
    const r = await fetch(u, { headers: { 'User-Agent': 'mappingg.com scraped-data address check (admin script)', 'Accept-Language': 'en' } });
    j = await r.json();
    writeFileSync(f, JSON.stringify(j));
    await new Promise((s) => setTimeout(s, 1100));
  }
  const pc = j.address?.postcode?.replace(/\s/g, '');
  if (!j.display_name || (d.pincode && pc && pc !== String(d.pincode))) { console.log(`skip ${d.project_name}: OSM postcode ${pc || '-'} vs record ${d.pincode || '-'}`); continue; }
  // Street / area / city / state / pincode only — never the name of a shop or building that happens to be at the point.
  const a = j.address || {};
  const address = [...new Set([a.road, a.neighbourhood || a.quarter, a.suburb, a.city || a.town || a.village || a.county, a.state, pc || d.pincode]
    .filter(Boolean))].join(', ');
  if (!a.road && !a.suburb && !a.neighbourhood) { console.log(`skip ${d.project_name}: OpenStreetMap has no street or area at the point`); continue; }
  planned++;
  console.log(`${d.project_name} → ${address}`);
  if (!APPLY) continue;
  const data = { ...d, address };
  const r = await db.query(`UPDATE scraped_projects SET doc = doc || jsonb_build_object('data', $2::jsonb, 'osm_address', $3::jsonb) WHERE id = $1 AND doc->'data' = $4::jsonb`,
    [id, JSON.stringify(data), JSON.stringify({ source: 'openstreetmap_nominatim_reverse', osm: `${j.osm_type}/${j.osm_id}`, at_point: [d.lat, d.lng], checked_at: RUN }), JSON.stringify(d)]);
  const st = r.rowCount === 1 ? 'saved' : 'skipped_changed';
  if (st === 'saved') saved++;
  appendFileSync(LOG, [id, d.project_name, 'data.address', '', address, `https://www.openstreetmap.org/${j.osm_type}/${j.osm_id}`, 'openstreetmap_reverse_at_verified_pin', 'medium', RUN, st].map(q).join(',') + '\n');
}
console.log({ records: rows.length, address_found: planned, saved });
await db.end();
