// Validates the Tamil Nadu RERA records (tn-research.mjs → <cache>/tn/records.json) and turns the ones that pass
// into Scraped-data rows (the admin's "Added data" list), like up-import.mjs does for UP RERA.
//
//   node --env-file=.env Developer_Projects/New500_2026-10-31/scripts/tn-build.mjs --batch=1            dry run + reports
//   node --env-file=.env Developer_Projects/New500_2026-10-31/scripts/tn-build.mjs --batch=1 --apply    insert the batch
//   node --env-file=.env Developer_Projects/New500_2026-10-31/scripts/tn-build.mjs --batch=1 --revert   remove that batch
//
// Checks per project (all must pass to be inserted; failures go to the rejected report with the reason):
//   identity   - certificate no. in TN RERA format, project name and promoter shown on the registry form,
//                the map list and the form agree on the certificate; usage is Residential with dwelling units > 0
//   duplicate  - RERA no. / project+developer name not already in Mappingg (pins, scraped rows incl. deleted,
//                submissions, pin history, trash: ../audit/exclusion.json) or earlier in this run
//   status     - listed as registered on the registry map, completion date still ahead
//   location   - GPS point declared to TN RERA, ≥ 4 decimals, the same on the map list and on the form,
//                inside the registry district (OpenStreetMap reverse lookup, 1 request/s), inside or ≤ 1 km from
//                the registry pincode's boundary when OpenStreetMap has one, not shared with another promoter
//   A point in degree-minute-second digits (e.g. 130604.9) is never converted: it stays "mismatch".
// Inserted rows are Pending Review: nothing reaches the public map until the team adds and publishes them.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { reraKey, nameKey, devKey, metres } from './keys.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const BATCH = Number((process.argv.find((a) => a.startsWith('--batch=')) || '--batch=1').slice(8));
const SIZE = 50;
const APPLY = process.argv.includes('--apply'), REVERT = process.argv.includes('--revert');
const TAG = `new500-tn-batch${BATCH}`;
const CACHE = path.resolve('migration/backup/scraped-enrichment-cache/new500/tn');
const OSM = path.resolve('migration/backup/scraped-enrichment-cache/osm-pincodes'); // shared with up-import.mjs
mkdirSync(OSM, { recursive: true });
const RUN = new Date().toISOString(), TODAY = RUN.slice(0, 10);
const UA = { 'User-Agent': 'mappingg-admin-location-check/1.0 (associattemarketing@gmail.com)' };

const url = new URL(process.env.DATABASE_URL); url.searchParams.delete('sslmode');
const db = new pg.Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false }, query_timeout: 120000 });

if (REVERT) {
  await db.connect();
  const r = await db.query(`DELETE FROM scraped_projects WHERE doc->>'added_by' = $1 AND doc->>'submission_id' IS NULL RETURNING id`, [TAG]);
  console.log(`Removed ${r.rowCount} rows of ${TAG} (rows already added to Projects are kept).`);
  await db.end(); process.exit(0);
}

const records = Object.values(JSON.parse(readFileSync(path.join(CACHE, 'records.json'), 'utf8')));
const ex = JSON.parse(readFileSync(path.join(ROOT, 'audit', 'exclusion.json'), 'utf8'));
const exPoints = ex.points;

// ---- OpenStreetMap (Nominatim, ≤ 1 request / second, cached) ----
const inRing = (x, y, ring) => { let ins = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins; } return ins; };
const polygons = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);
const inside = (lng, lat, g) => polygons(g).some((p) => inRing(lng, lat, p[0]) && !p.slice(1).some((h) => inRing(lng, lat, h)));
function kmToEdge(lng, lat, g) {
  const kx = 111.32 * Math.cos((lat * Math.PI) / 180), ky = 110.57; let best = Infinity;
  for (const p of polygons(g)) for (const ring of p) for (let i = 1; i < ring.length; i++) {
    const ax = (ring[i - 1][0] - lng) * kx, ay = (ring[i - 1][1] - lat) * ky, bx = (ring[i][0] - lng) * kx, by = (ring[i][1] - lat) * ky;
    const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}
async function osm(file, u) {
  const f = path.join(OSM, file);
  if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
  await new Promise((r) => setTimeout(r, 1100));
  const res = await fetch(u, { headers: UA });
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
  const j = await res.json();
  writeFileSync(f, JSON.stringify(j));
  return j;
}
const reverse = (lat, lng) => osm(`rev-${lat.toFixed(5)}_${lng.toFixed(5)}.json`, `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=17&addressdetails=1`);
async function pincodeBoundary(pin) {
  const j = await osm(`${pin}.json`, `https://nominatim.openstreetmap.org/search?postalcode=${pin}&countrycodes=in&format=json&polygon_geojson=1&limit=3`);
  if (j.pin || j.missing) return j; // cached in up-import.mjs's shape
  const hit = (Array.isArray(j) ? j : []).find((x) => x.type === 'postal_code' && /Polygon/.test(x.geojson?.type || ''));
  return hit ? { pin, osm: `${hit.osm_type}/${hit.osm_id}`, geojson: hit.geojson } : { pin, missing: true };
}

// ---- checks ----
const decimals = (s) => (String(s).split('.')[1] || '').length;
const promotersAt = new Map();
for (const r of records) if (r.gps_lat) { const k = `${(+r.gps_lat).toFixed(4)},${(+r.gps_lng).toFixed(4)}`; if (!promotersAt.has(k)) promotersAt.set(k, new Set()); promotersAt.get(k).add(devKey(r.promoter_name)); }
const DISTRICT = { chennai: /chennai/i, chengalpattu: /chengalpattu|chengalpet|kancheepuram|kanchipuram/i, kancheepuram: /kancheepuram|kanchipuram|chengalpattu/i, thiruvallur: /thiruvallur|tiruvallur|chennai/i, tiruvallur: /thiruvallur|tiruvallur|chennai/i };

async function locate(r) {
  const lat = Number(r.gps_lat), lng = Number(r.gps_lng);
  if (!r.gps_lat || !r.gps_lng || !Number.isFinite(lat) || !Number.isFinite(lng)) return { pin_check: 'no_coordinates', pin_reason: 'TN RERA form shows no GPS coordinates.' };
  const base = { lat, lng };
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return { ...base, lat: null, lng: null, pin_check: 'mismatch', pin_reason: `TN RERA point (${r.gps_lat}, ${r.gps_lng}) is written in degree-minute-second digits, not decimal degrees; not converted.` };
  if (lat < 8 || lat > 13.7 || lng < 76 || lng > 80.4) return { ...base, pin_check: 'mismatch', pin_reason: `TN RERA point (${lat}, ${lng}) is outside Tamil Nadu.` };
  if (decimals(r.gps_lat) < 4 || decimals(r.gps_lng) < 4) return { ...base, pin_check: 'approximate', pin_reason: 'TN RERA point is too coarse (fewer than 4 decimals).' };
  if (String(r.map_lat) !== String(r.gps_lat) || String(r.map_lng) !== String(r.gps_lng)) return { ...base, pin_check: 'approximate', pin_reason: `The registry map (${r.map_lat}, ${r.map_lng}) and the project form (${r.gps_lat}, ${r.gps_lng}) disagree.` };
  if ((promotersAt.get(`${lat.toFixed(4)},${lng.toFixed(4)}`)?.size || 0) > 1) return { ...base, pin_check: 'approximate', pin_reason: "Same point as another promoter's project — an area pin, not the site." };
  const rev = await reverse(lat, lng);
  const a = rev.address || {};
  const where = [a.state_district, a.county, a.city, a.town, a.state].filter(Boolean).join(', ');
  const want = DISTRICT[String(r.district || '').toLowerCase()] || new RegExp(String(r.district || '^$').replace(/[^a-z ]/gi, ''), 'i');
  if (!/tamil nadu/i.test(a.state || '') || !want.test(where)) return { ...base, pin_check: 'mismatch', osm: a, pin_reason: `TN RERA point is in ${where || 'an unknown place'} on OpenStreetMap, not ${r.district} district.` };
  let pinNote = 'OpenStreetMap has no boundary for the pincode, so a pincode-level check was not possible';
  if (/^\d{6}$/.test(r.pincode || '')) {
    const b = await pincodeBoundary(r.pincode);
    if (!b.missing) {
      const inPin = inside(lng, lat, b.geojson), edge = inPin ? 0 : kmToEdge(lng, lat, b.geojson);
      if (!inPin && edge > 1) return { ...base, pin_check: 'mismatch', osm: a, pin_reason: `TN RERA point is ${edge.toFixed(1)} km outside pincode ${r.pincode}.` };
      pinNote = `inside pincode ${r.pincode} (OpenStreetMap ${b.osm}${inPin ? '' : `, ${edge.toFixed(1)} km from its edge`})`;
    }
  }
  return { ...base, pin_check: 'verified', osm: a, pin_reason: `Official TN RERA GPS coordinates (declared by the promoter on Form A, same on the registry map); in ${r.district} district (OpenStreetMap reverse lookup); ${pinNote}; not shared with another promoter's project.` };
}

/**
 * Locality, from the registry's own address: the area named just before "Chennai" (", Velachery, Chennai"), else the
 * revenue village ("Kolapakkam Village"), else an OpenStreetMap area name at the verified point that the address also
 * names. (OpenStreetMap alone is not used: inside Chennai it mostly gives corporation zones and wards.)
 */
const LEAD = /^(?:(?:situated|located|lying)\s+(?:at|in)|h\.?\s*t\.?\s+of|of|at|in)\s+/i;
const title = (s) => s.trim().replace(LEAD, '').replace(LEAD, '').replace(/\s+vill?age$/i, '').replace(/\s+/g, ' ').toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
const NOT_AREA = /\d|\b(road|rd|street|st|salai|lane|avenue|main|cross|high|plot|door|no|block|survey|s\.?no|ward|division|zone|limit|limits|corporation|greater|taluk|district|floor|building)\b/i;
function localityOf(r, a) {
  for (const t of [r.project_details, r.map_text]) {
    const parts = String(t || '').split(/[,–-]/).map((s) => s.trim());
    const i = parts.findIndex((p) => /^(greater\s+)?chennai\b/i.test(p));
    for (let j = i - 1; i > 0 && j >= Math.max(0, i - 3); j--) {
      const p = parts[j].replace(/^(at|in)\s+/i, '');
      if (p && p.length >= 4 && /^[A-Za-z .]+$/.test(p) && !NOT_AREA.test(p)) return { locality: title(p.replace(/\.$/, '')), source: 'area named in the TN RERA address (before "Chennai")' };
    }
  }
  const v = `${r.project_details || ''} ${r.map_text || ''}`.match(/(?:of|at|,)\s*([A-Za-z][A-Za-z .]{2,30}?)\s+Vill?age\b/i);
  if (v && !NOT_AREA.test(v[1].replace(LEAD, ''))) return { locality: title(v[1]), source: 'revenue village named in the TN RERA address' };
  const text = `${r.project_details || ''} ${r.map_text || ''}`.toLowerCase().replace(/[^a-z ]/g, ' ');
  for (const k of ['suburb', 'neighbourhood', 'quarter', 'village', 'town']) {
    const n = a?.[k]; if (!n || /zone|ward/i.test(n)) continue;
    const words = n.toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter((w) => w.length > 3);
    if (words.length && words.every((w) => text.includes(w))) return { locality: n, source: `OpenStreetMap ${k} at the verified point, also named in the TN RERA address` };
  }
  return { locality: null, source: null };
}

const cr = (n) => (n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : `₹${(n / 1e5).toFixed(2)} L`);
const area = (sqm) => `${sqm.toLocaleString('en-IN')} sq m (${(sqm / 4046.8564).toFixed(2)} acres)`;

await db.connect();
const added = new Set((await db.query(`SELECT doc->'data'->>'rera_number' r FROM scraped_projects WHERE doc->>'added_by' LIKE 'new500-%'`)).rows.map((x) => reraKey(x.r)));
const accepted = [], rejected = [], duplicates = [], missing = [];
const seenRun = new Set();
const already = (r) => added.has(reraKey(r.certificate));

for (const r of records) {
  const why = [];
  if (r.error || !r.view2_ok) { rejected.push({ r, stage: 'extracted', reasons: [`registry pages not read: ${r.error || 'no Form A'}`] }); continue; }
  // identity
  if (!/^TNRERA\/\d{1,2}\/BLG\/\d{4}\/\d{4}$/.test(r.certificate)) why.push('certificate number not in TN RERA format');
  if (!r.project_name) why.push('no project name on the registry form');
  if (!r.promoter_name) why.push('no promoter name on the registry form');
  const mapName = (r.map_text.match(/Project Name:\s*([^|]+)/) || [])[1]?.trim();
  if (mapName && r.project_name && nameKey(mapName) !== nameKey(r.project_name)) why.push(`name differs: map "${mapName}" vs form "${r.project_name}"`);
  if (!/residential/i.test(r.usage || '')) why.push(`usage is "${r.usage || 'not shown'}", not residential`);
  if (!(r.dwelling_units > 0)) why.push('no dwelling units declared');
  if (why.length) { rejected.push({ r, stage: 'identity', reasons: why }); continue; }
  // duplicates
  const rk = reraKey(r.certificate), nk = `${nameKey(r.project_name)}|${devKey(r.promoter_name)}`;
  if (ex.rera[rk] && !already(r)) { duplicates.push({ r, match: 'RERA number', existing: ex.rera[rk].join('; ') }); continue; }
  if (ex.names[nk] && !already(r)) { duplicates.push({ r, match: 'project + developer name', existing: ex.names[nk].join('; ') }); continue; }
  if (seenRun.has(rk)) { duplicates.push({ r, match: 'same certificate twice in this run', existing: '' }); continue; }
  seenRun.add(rk);
  // status
  const completion = r.completion_date || r.completion_date_details;
  if (!completion) why.push('no completion date');
  else if (completion < TODAY) why.push(`completion date ${completion} has passed`);
  if (why.length) { rejected.push({ r, stage: 'status', reasons: why }); continue; }
  // location
  const loc = await locate(r);
  if (loc.pin_check !== 'verified') { rejected.push({ r, stage: 'location', reasons: [loc.pin_reason], loc }); continue; }
  const near = exPoints.filter(([la, ln]) => metres([loc.lat, loc.lng], [la, ln]) < 40);
  const nearOther = near.filter(([, , w]) => !w.includes(r.project_name));
  const { locality, source: localitySource } = localityOf(r, loc.osm);
  if (!locality) { rejected.push({ r, stage: 'location', reasons: ['locality not named both by the registry address and OpenStreetMap'], loc }); continue; }
  // The address and the point must describe the same place: the locality the registry names is on OpenStreetMap
  // within 3 km of the declared point (5 km for a revenue village, whose centre can be far from its edge).
  const places = await osm(`search-${nameKey(locality).replace(/ /g, '_')}_${nameKey(r.district)}.json`,
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(`${locality}, ${r.district}, Tamil Nadu`)}&countrycodes=in&format=json&limit=5`);
  const dists = (Array.isArray(places) ? places : []).map((p) => metres([loc.lat, loc.lng], [+p.lat, +p.lon]) / 1000);
  const nearest = dists.length ? Math.min(...dists) : null, limitKm = /village/i.test(localitySource) ? 5 : 3;
  if (nearest == null) { rejected.push({ r, stage: 'location', reasons: [`locality "${locality}" (from the registry address) not found on OpenStreetMap, so the point could not be cross-checked`], loc }); continue; }
  if (nearest > limitKm) { rejected.push({ r, stage: 'location', reasons: [`declared point is ${nearest.toFixed(1)} km from "${locality}" named in the registry address (limit ${limitKm} km)`], loc }); continue; }
  loc.pin_reason += ` The address's locality "${locality}" is ${nearest.toFixed(1)} km from the point on OpenStreetMap.`;
  // completeness (missing optional fields are reported, not invented)
  const miss = ['site_extent_sqm', 'total_project_cost', 'pincode', 'building_permit_no', 'planning_permission_no', 'promoter_website', 'total_blocks']
    .filter((k) => r[k] == null || r[k] === '');
  miss.push('configurations (BHK types are only in the registry PDF carpet-area statement, not read)');
  missing.push({ r, fields: miss });
  const score = Math.round(100 * [r.project_name, r.promoter_name, r.certificate, r.registration_date, completion, r.dwelling_units, r.site_extent_sqm,
    r.total_project_cost, r.pincode, locality, loc.pin_check === 'verified', r.planning_permission_no, r.building_permit_no, r.promoter_website, r.stage]
    .filter((v) => v != null && v !== '' && v !== false).length / 15);
  accepted.push({ r, loc, locality, localitySource, completion, score, nearOther });
}

const batch = accepted.filter((x) => !already(x.r)).slice(0, SIZE);
const inBatch = new Set(batch.map((x) => x.r.certificate));

// ---- rows ----
const rows = batch.map(({ r, loc, locality, localitySource, completion }) => {
  const key = `India - Tamil Nadu|${r.certificate}`;
  const id = 'scr_' + createHash('sha1').update(key).digest('hex').slice(0, 16);
  const original = {
    id, key, lat: loc.lat, lng: loc.lng, city: 'Chennai', state: 'Tamil Nadu', country: 'India', images: [],
    notes: 'From the official Tamil Nadu RERA registry (rera.tn.gov.in): "Projects on Map", the project-details page and Form A (project and promoter details), including the GPS point declared by the promoter.',
    status: 'Registered', status_category: 'Registered',
    address: r.project_details, pincode: r.pincode, district: r.district, locality,
    pin_check: loc.pin_check, pin_reason: loc.pin_reason, regulator: 'TN RERA', jurisdiction: 'India - Tamil Nadu',
    image_note: 'No project images in the official regulator listings.', portal_seq: null,
    source_url: 'https://rera.tn.gov.in/projects-map', project_url: r.details_url, rera_number: r.certificate, rera_prefix: 'TNRERA',
    verified_on: TODAY, project_name: r.project_name, project_type: 'Residential', secondary_id: r.details_url.split('/').pop(),
    verification: 'Verified', approval_date: r.planning_permission_date, developer_name: r.promoter_name,
    registration_date: r.registration_date, original_completion: completion, revised_completion: null, valid_up_to: null, extension: null,
  };
  const fields = Object.fromEntries(Object.entries({
    registry_promoter_name: r.promoter_name, registry_project_status: r.stage, project_sub_type: r.building_type,
    full_address: r.project_details, pincode: r.pincode, approving_authority: r.planning_authority,
    approved_plan_number: r.planning_permission_no, plan_approval_date: r.planning_permission_date,
    building_permit: r.building_permit_no ? `${r.building_permit_no}${r.building_permit_by ? ` (${r.building_permit_by})` : ''}${r.building_permit_date ? `, ${r.building_permit_date}` : ''}` : null,
    proposed_completion: completion, total_units: r.dwelling_units, towers: r.blocks_applied || null,
    land_area: r.site_extent_sqm ? area(r.site_extent_sqm) : null,
    project_cost: r.total_project_cost ? `${cr(r.total_project_cost)} (total project cost declared to RERA, not a sale price)` : null,
    developer_website: r.promoter_website, registry_latitude: loc.lat, registry_longitude: loc.lng,
  }).filter(([, v]) => v != null && v !== ''));
  const enrichment = {
    review_status: 'Pending Review', verification: 'Verified', enriched_at: RUN, enriched_by: 'tn-rera (official registry)',
    source_type: 'official_rera_registry', sources: [r.details_url, r.view2_url, r.view1_url].filter(Boolean), source_note: 'TN RERA project-details page + Form A',
    fields, updated_fields: Object.keys(fields), review_required: [],
    data_filled: { locality: { old: null, new: locality, source: localitySource } },
  };
  return { id, doc: { id, original, data: original, enrichment, imported_at: RUN, dataset_generated: RUN, deleted: false, added_by: TAG,
    location_source: { source: 'official_rera_registry', source_url: r.view2_url, checked_at: RUN } } };
});

// ---- reports ----
const counts = {
  batch: BATCH, read_from_registry: records.length,
  extracted: records.filter((r) => r.view2_ok).length,
  rera_matched: records.filter((r) => r.view2_ok && /^TNRERA\//.test(r.certificate)).length,
  duplicate_rejected: duplicates.length,
  identity_rejected: rejected.filter((x) => x.stage === 'identity' || x.stage === 'extracted').length,
  status_rejected: rejected.filter((x) => x.stage === 'status').length,
  location_rejected: rejected.filter((x) => x.stage === 'location').length,
  location_verified: accepted.length,
  passed_all_checks: accepted.length,
  in_this_batch: rows.length,
  near_an_existing_point_40m: batch.filter((x) => x.nearOther.length).length,
};
const outDir = path.join(ROOT, 'batches'); mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, `tn-batch${BATCH}.json`), JSON.stringify({
  generated: RUN, counts,
  accepted: batch.map(({ r, loc, locality, completion, score, nearOther }) => ({ certificate: r.certificate, project_name: r.project_name, developer: r.promoter_name, district: r.district, locality, pincode: r.pincode,
    lat: loc.lat, lng: loc.lng, pin_reason: loc.pin_reason, units: r.dwelling_units, land_sqm: r.site_extent_sqm, cost: r.total_project_cost, stage: r.stage, registration_date: r.registration_date, completion,
    building_type: r.building_type, website: r.promoter_website, rera_url: r.details_url, form_url: r.view2_url, promoter_url: r.view1_url, score, near_existing: nearOther.map((x) => x[2]) })),
  rejected: rejected.map(({ r, stage, reasons }) => ({ certificate: r.certificate, project_name: r.project_name, developer: r.promoter_name, stage, reasons, rera_url: r.details_url, lat: r.gps_lat, lng: r.gps_lng })),
  duplicates: duplicates.map(({ r, match, existing }) => ({ certificate: r.certificate, project_name: r.project_name, developer: r.promoter_name, match, existing, rera_url: r.details_url })),
  missing: missing.filter(({ r }) => inBatch.has(r.certificate)).map(({ r, fields }) => ({ certificate: r.certificate, project_name: r.project_name, missing: fields })),
}, null, 1));
console.log(JSON.stringify(counts, null, 1));

if (!APPLY) { console.log('Dry run — nothing written to the database. Use --apply.'); await db.end(); process.exit(0); }
let inserted = 0;
for (let i = 0; i < rows.length; i += 50) {
  const res = await db.query(`INSERT INTO scraped_projects (id, doc) SELECT e->>'id', e->'doc' FROM jsonb_array_elements($1::jsonb) e ON CONFLICT (id) DO NOTHING`, [JSON.stringify(rows.slice(i, i + 50))]);
  inserted += res.rowCount;
}
console.log(`Inserted ${inserted} rows tagged ${TAG} (Pending Review; nothing published).`);
await db.end();
