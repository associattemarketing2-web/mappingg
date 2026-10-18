// Location check + address for every scraped record that is NOT live yet (live ones: live-details.mjs).
//
//   node --env-file=.env migration/enrichment/scraped/scraped-location-check.mjs [--apply | --revert]
//
// For each non-deleted record with a point: OpenStreetMap reverse lookup (cached, <cache>/live-details/osm-cache.json)
// compared with the registry pincode and city, plus a check for points shared by different developers (placeholders).
// Writes doc.enrichment.location_check = { result, note, osm_postcode, osm_area, checked_at }.
// A BLANK data.address is filled with the RERA full address when the registry gave one, else with the OSM address
// of the point (recorded in enrichment.data_filled.address with its source). lat/lng, pin_check and `original`
// are never touched. Records without a point are listed in the report as "no coordinates".

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const DIR = path.resolve('migration/backup/scraped-enrichment-cache/live-details');
const mode = process.argv.includes('--apply') ? 'apply' : process.argv.includes('--revert') ? 'revert' : 'dry';
const url = new URL(process.env.DATABASE_URL); url.searchParams.delete('sslmode');
const db = new pg.Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false }, query_timeout: 300000 });
await db.connect();

if (mode === 'revert') {
  const last = readdirSync(DIR).filter((f) => /^scraped-before-.*\.json$/.test(f)).sort().pop();
  const b = JSON.parse(readFileSync(path.join(DIR, last), 'utf8'));
  await db.query('BEGIN');
  for (const r of b) await db.query(`UPDATE scraped_projects SET doc = $2::jsonb WHERE id = $1`, [r.id, JSON.stringify(r.doc)]);
  await db.query('COMMIT');
  console.log(`reverted ${b.length} records from ${last}`); await db.end(); process.exit(0);
}

const osm = JSON.parse(readFileSync(path.join(DIR, 'osm-cache.json'), 'utf8'));
const suggest = existsSync(path.join(DIR, 'osm-suggest.json')) ? JSON.parse(readFileSync(path.join(DIR, 'osm-suggest.json'), 'utf8')) : {};
const key = (lat, lng) => `${(+lat).toFixed(6)},${(+lng).toFixed(6)}`;
const cityWords = { Bengaluru: /bengaluru|bangalore/i, Noida: /noida|gautam buddha nagar/i, Gurugram: /gurugram|gurgaon/i, Mumbai: /mumbai/i, Pune: /pune/i,
  Thane: /thane/i, Hyderabad: /hyderabad|rangareddy|ranga reddy|medchal|sangareddy/i, Palghar: /palghar/i, Raigad: /raigad/i };
const { rows } = await db.query(`SELECT id, doc FROM scraped_projects WHERE NOT coalesce((doc->>'deleted')::boolean,false) AND doc->>'submission_id' IS NULL`);

const atPoint = new Map();
for (const r of rows) { const d = r.doc.data || {}; if (d.lat == null || d.lng == null) continue; const k = key(d.lat, d.lng); atPoint.set(k, [...(atPoint.get(k) || []), r]); }
const nd = (s) => String(s || '').toLowerCase().replace(/\b(m\/?s|pvt|private|ltd|limited|llp)\b/g, '').replace(/[^a-z0-9]+/g, '');

const report = [], upd = [], before = [], now = new Date().toISOString();
for (const r of rows) {
  const doc = r.doc, d = doc.data || {}, e = doc.enrichment || null, f = e?.fields || {};
  const reraPin = String(d.pincode || f.pincode || '').replace(/\s/g, '') || null;
  let check, osmPin = null, osmArea = '', osmAddr = null;
  if (d.lat == null || d.lng == null) {
    const s = suggest[r.id];
    check = s
      ? { result: 'no coordinates', note: `The registry gives no map point. Area point for review only (${s.precision}, OpenStreetMap search "${s.query}"): ${s.lat.toFixed(6)}, ${s.lng.toFixed(6)} — not the site, not put on the map`, suggested_point: s }
      : { result: 'no coordinates', note: 'The registry gives no map point, and OpenStreetMap found no village / locality / pincode for it' };
  }
  else {
    const o = osm[key(d.lat, d.lng)], a = o?.address || {};
    osmPin = (a.postcode || '').replace(/\s/g, '') || null;
    osmArea = [a.suburb || a.neighbourhood || a.village || a.city_district, a.city || a.town || a.county, a.state_district, a.state].filter(Boolean).filter((v, i, x) => x.indexOf(v) === i).join(', ');
    osmAddr = o && !o.error ? [a.road, a.neighbourhood || a.suburb || a.quarter, a.village || a.city_district, a.city || a.town || a.county, a.state, osmPin].filter(Boolean).filter((v, i, x) => x.indexOf(v) === i).join(', ') : null;
    const sharers = (atPoint.get(key(d.lat, d.lng)) || []).filter((x) => x.id !== r.id && nd(x.doc.data?.developer_name) !== nd(d.developer_name));
    const inCity = cityWords[d.city] ? cityWords[d.city].test(`${osmArea} ${o?.display_name || ''}`) : null;
    if (!o || o.error) check = { result: 'not checked', note: 'OpenStreetMap had no answer for this point' };
    else if (sharers.length) check = { result: 'shared point', note: `Same point as ${sharers.length} record(s) of other developers (e.g. ${sharers[0].doc.data?.project_name}) — a placeholder, not the site` };
    else if (inCity === false) check = { result: 'outside city', note: `Point is in ${osmArea} per OpenStreetMap, not ${d.city}` };
    else if (reraPin && osmPin && reraPin !== osmPin) check = { result: 'pincode differs', note: `Registry pincode ${reraPin}, OpenStreetMap postcode at the point ${osmPin}` };
    else check = { result: 'ok', note: `Point is in ${osmArea}${osmPin ? ` (${osmPin})` : ''} per OpenStreetMap, matching the registry` };
  }
  const next = structuredClone(doc);
  next.enrichment = next.enrichment || { review_status: 'Pending Review', fields: {}, updated_fields: [], review_required: [] };
  next.enrichment.location_check = { ...check, registry_pin_check: d.pin_check || null, osm_postcode: osmPin, osm_area: osmArea || null, checked_at: now };
  let addrFilled = null;
  if (!d.address) {
    const v = f.full_address || (check.result === 'ok' || check.result === 'pincode differs' ? osmAddr : null);
    if (v) {
      addrFilled = f.full_address ? 'RERA full address' : 'OpenStreetMap address of the registry point';
      next.data = { ...next.data, address: v };
      next.enrichment.data_filled = { ...(next.enrichment.data_filled || {}), address: { new: v, old: null, source: addrFilled } };
    }
  }
  upd.push({ id: r.id, doc: next }); before.push({ id: r.id, doc });
  report.push({ id: r.id, city: d.city, regulator: d.regulator, project: d.project_name, developer: d.developer_name, rera: d.rera_number,
    lat: d.lat ?? '', lng: d.lng ?? '', registry_pin_check: d.pin_check, location_check: check.result, note: check.note, rera_pincode: reraPin, osm_postcode: osmPin,
    address: next.data.address || '', address_filled_from: addrFilled || '',
    area_point_for_review: check.suggested_point ? `${check.suggested_point.lat.toFixed(6)}, ${check.suggested_point.lng.toFixed(6)} (${check.suggested_point.precision})` : '' });
}
const by = (k) => report.reduce((m, x) => ((m[x[k]] = (m[x[k]] || 0) + 1), m), {});
console.log('records', report.length, '| location check', by('location_check'));
console.log('address filled', by('address_filled_from'), '| still no address', report.filter((x) => !x.address).length);
const csv = (rs) => [Object.keys(rs[0]).join(','), ...rs.map((x) => Object.values(x).map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
const OUT = path.resolve('seo-doc/enrichment/scraped-project-enrichment/SCRAPED-LOCATION-CHECK.csv');
writeFileSync(OUT, csv(report)); console.log('report →', path.relative(process.cwd(), OUT));
if (mode === 'dry') { console.log('dry run — pass --apply to write'); await db.end(); process.exit(0); }
const stamp = now.replace(/[:.]/g, '-');
writeFileSync(path.join(DIR, `scraped-before-${stamp}.json`), JSON.stringify(before));
await db.query('BEGIN');
for (const u of upd) await db.query(`UPDATE scraped_projects SET doc = $2::jsonb WHERE id = $1`, [u.id, JSON.stringify(u.doc)]);
await db.query('COMMIT');
console.log(`updated ${upd.length} records (backup scraped-before-${stamp}.json)`);
await db.end();
