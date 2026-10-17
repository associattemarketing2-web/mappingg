// Adds the Noida / Greater Noida projects read from UP RERA (up-research.mjs → <cache>/up/records.json) to Scraped data.
//
//   node --env-file=.env migration/enrichment/scraped/up-import.mjs            dry run (counts only)
//   node --env-file=.env migration/enrichment/scraped/up-import.mjs --apply
//
// Each project becomes a scraped_projects row like the other registries': `original` = what UP RERA shows,
// `data` = working copy, `enrichment` = the registry facts (Pending Review). Nothing is published.
// Location: the coordinates the promoter declared to UP RERA ("View on map"), marked "verified" only when
//   - inside Gautam Buddha Nagar and given to ≥ 4 decimals,
//   - inside the boundary of the project's own pincode (OpenStreetMap; ≤ 1 km outside counts as inside),
//   - not the same point as a project of a different promoter;
// otherwise the row keeps the point but stays "approximate" / "unconfirmed" with the reason (not ready to go live).
// Only new rows are inserted; existing UP RERA rows are left as they are.

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import pg from 'pg';

const APPLY = process.argv.includes('--apply');
const CACHE = path.resolve('migration/backup/scraped-enrichment-cache');
const PIN_DIR = path.join(CACHE, 'osm-pincodes');
const OUTDIR = path.resolve('seo-doc/enrichment/scraped-project-enrichment');
const RUN = new Date().toISOString();
const TODAY = RUN.slice(0, 10);
const BOUNDS = { minLat: 27.95, maxLat: 28.75, minLng: 77.2, maxLng: 77.9 }; // Gautam Buddha Nagar district
mkdirSync(PIN_DIR, { recursive: true });
const records = Object.values(JSON.parse(readFileSync(path.join(CACHE, 'up', 'records.json'), 'utf8')));
const decimals = (n) => (String(n).split('.')[1] || '').length;
const csv = (v) => `"${String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;

// ---- geometry + OpenStreetMap pincode boundaries (same rules as locate-ready.mjs) ----------------
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
async function pincodeBoundary(pin) {
  const file = path.join(PIN_DIR, `${pin}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  await new Promise((r) => setTimeout(r, 1100)); // Nominatim policy: ≤ 1 request / second
  const res = await fetch(`https://nominatim.openstreetmap.org/search?postalcode=${pin}&countrycodes=in&format=json&polygon_geojson=1&limit=3`,
    { headers: { 'User-Agent': 'mappingg-admin-location-check/1.0 (associattemarketing@gmail.com)' } });
  if (!res.ok) throw new Error(`Nominatim ${pin}: HTTP ${res.status}`);
  const hit = (await res.json()).find((x) => x.type === 'postal_code' && /Polygon/.test(x.geojson?.type || '')) || null;
  const out = hit ? { pin, osm: `${hit.osm_type}/${hit.osm_id}`, geojson: hit.geojson } : { pin, missing: true };
  writeFileSync(file, JSON.stringify(out));
  return out;
}

// "Sector-150", "Sector 22D", "Sec. 1" → "150", "22D", "1" (Noida / Greater Noida / Yamuna Expressway sectors).
const sectorOf = (s) => { const m = String(s || '').match(/\bsec(?:tor)?\.?\s*-?\s*(\d{1,3}\s*[A-Z]?)\b/i); return m ? m[1].replace(/\s+/g, '').toUpperCase() : null; };
async function reverse(lat, lng) {
  const file = path.join(PIN_DIR, `rev-${lat.toFixed(5)}_${lng.toFixed(5)}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  await new Promise((r) => setTimeout(r, 1100));
  const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=17&addressdetails=1`,
    { headers: { 'User-Agent': 'mappingg-admin-location-check/1.0 (associattemarketing@gmail.com)' } });
  if (!res.ok) throw new Error(`Nominatim reverse: HTTP ${res.status}`);
  const out = await res.json();
  writeFileSync(file, JSON.stringify(out));
  return out;
}

// ---- build rows ------------------------------------------------------------------------------
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const ptKey = (r) => `${Number(r.lat).toFixed(4)},${Number(r.lng).toFixed(4)}`;
const promotersAt = new Map();
for (const r of records) if (r.lat) { const k = ptKey(r); if (!promotersAt.has(k)) promotersAt.set(k, new Set()); promotersAt.get(k).add(norm(r.developer_name)); }

async function locate(r) {
  if (!r.lat || !r.lng) return { pin_check: 'no_coordinates', pin_reason: 'UP RERA shows no map location for this project.' };
  const base = { lat: r.lat, lng: r.lng };
  if (r.lat < BOUNDS.minLat || r.lat > BOUNDS.maxLat || r.lng < BOUNDS.minLng || r.lng > BOUNDS.maxLng) return { ...base, pin_check: 'mismatch', pin_reason: `UP RERA point (${r.lat}, ${r.lng}) is outside Gautam Buddha Nagar.` };
  if (decimals(r.lat) < 4 || decimals(r.lng) < 4) return { ...base, pin_check: 'approximate', pin_reason: 'UP RERA point is too coarse (fewer than 4 decimals).' };
  if ((promotersAt.get(ptKey(r))?.size || 0) > 1) return { ...base, pin_check: 'approximate', pin_reason: `Same point (${ptKey(r)}) as another promoter's project — an area pin, not the site.` };
  // The point must really be in Gautam Buddha Nagar (catches points entered in Faridabad / Delhi / Palwal).
  const rev = await reverse(r.lat, r.lng);
  const a = rev.address || {};
  const where = [a.state_district, a.county, a.city, a.town, a.state].filter(Boolean).join(', ');
  if (!/gautam\s*budd?h/i.test(where) || !/uttar pradesh/i.test(a.state || '')) return { ...base, pin_check: 'mismatch', pin_reason: `UP RERA point (${r.lat}, ${r.lng}) is in ${where || 'an unknown place'} on OpenStreetMap, not Gautam Buddha Nagar.` };
  // With a registry pincode that OpenStreetMap has a boundary for, the point must also be inside it.
  if (/^\d{6}$/.test(r.pincode || '')) {
    const b = await pincodeBoundary(r.pincode);
    if (!b.missing) {
      const inPin = inside(r.lng, r.lat, b.geojson), edge = inPin ? 0 : kmToEdge(r.lng, r.lat, b.geojson);
      if (!inPin && edge > 1) return { ...base, pin_check: 'mismatch', pin_reason: `UP RERA point is ${edge.toFixed(1)} km outside pincode ${r.pincode}.` };
      return { ...base, pin_check: 'verified', pin_reason: `Official UP RERA coordinates (declared by the promoter); inside pincode ${r.pincode} (OpenStreetMap ${b.osm}${inPin ? '' : `, ${edge.toFixed(1)} km from its edge`}); in Gautam Buddha Nagar; not shared with another promoter's project.` };
    }
  }
  // OpenStreetMap's postcode at the point, only when it is a Gautam Buddha Nagar one (201xxx / 203xxx).
  const pc = /^20[13]\d{3}$/.test(a.postcode || '') ? a.postcode : null;
  return { ...base, pin_check: 'verified', derived_pincode: pc,
    pin_reason: `Official UP RERA coordinates (declared by the promoter), checked: in Gautam Buddha Nagar district (OpenStreetMap reverse lookup${pc ? `, postcode ${pc}` : ''}), not shared with another promoter's project. UP RERA gives ${r.pincode ? 'a pincode without an OpenStreetMap boundary' : 'no pincode'}, so a sector / pincode-level check was not possible.` };
}

const rows = [];
for (const r of records) {
  const key = `India - Uttar Pradesh|${r.rera_number}`;
  const id = 'scr_' + createHash('sha1').update(key).digest('hex').slice(0, 16);
  const loc = await locate(r);
  const original = {
    id, key, lat: loc.lat ?? null, lng: loc.lng ?? null, city: 'Noida', state: 'Uttar Pradesh', country: 'India', images: [],
    notes: 'From the official UP RERA registry (up-rera.in): Registered Projects list, project summary and project detail pages, and the registry\'s own "View on map" location.',
    status: r.qpr_default ? 'Registered - promoter in default on QPR (UP RERA flag)' : 'Registered',
    status_category: r.qpr_default ? 'Registered - default on QPR' : 'Registered',
    address: r.full_address, pincode: r.pincode, district: 'Gautam Buddha Nagar', locality: r.locality || r.full_address,
    pin_check: loc.pin_check, pin_reason: loc.pin_reason, regulator: 'UP RERA', jurisdiction: 'India - Uttar Pradesh',
    image_note: 'No project images in the official regulator listings.', portal_seq: null,
    source_url: 'https://www.up-rera.in/projects', project_url: r.summary_url, rera_number: r.rera_number, rera_prefix: 'UPRERAPRJ',
    verified_on: TODAY, project_name: r.project_name, project_type: r.project_category || null, secondary_id: r.registry_form_id,
    verification: 'Verified', approval_date: r.plan_approval_date, developer_name: r.developer_name,
    registration_date: r.registration_date, original_completion: r.original_completion,
    revised_completion: r.proposed_completion !== r.original_completion ? r.proposed_completion : null, valid_up_to: null, extension: null,
  };
  const fields = Object.fromEntries(Object.entries({
    registry_promoter_name: r.developer_name, registry_project_status: r.project_type, project_sub_type: r.project_category,
    full_address: r.full_address, pincode: r.pincode, tehsil: r.tehsil, approving_authority: r.approving_authority,
    approved_plan_number: r.approved_plan_number, plan_approval_date: r.plan_approval_date,
    project_start_date: r.project_start_date, proposed_completion: r.proposed_completion,
    configurations: r.configurations, total_units: r.total_units, towers: r.towers,
    unit_mix: r.unit_mix.length ? r.unit_mix.map((u) => ({ type: u.type, units: u.units,
      ...(u.carpet_sqm_min ? { carpet_sqm_per_unit: u.carpet_sqm_min === u.carpet_sqm_max ? u.carpet_sqm_min : `${u.carpet_sqm_min}–${u.carpet_sqm_max}`,
        carpet_sqft_per_unit: u.carpet_sqft_min === u.carpet_sqft_max ? u.carpet_sqft_min : `${u.carpet_sqft_min}–${u.carpet_sqft_max}` } : {}) })) : null,
    carpet_area: (() => { const c = r.unit_mix.filter((u) => u.carpet_sqft_min); if (!c.length) return null; const lo = Math.min(...c.map((u) => u.carpet_sqft_min)), hi = Math.max(...c.map((u) => u.carpet_sqft_max)); return `${lo.toLocaleString('en-IN')}–${hi.toLocaleString('en-IN')} sq ft carpet (RERA)`; })(),
    land_area: r.land_area, amenities: r.amenities.length ? r.amenities : null,
    registry_latitude: r.lat, registry_longitude: r.lng,
  }).filter(([, v]) => v != null && v !== ''));
  const enrichment = {
    review_status: 'Pending Review', verification: 'Verified', enriched_at: RUN, enriched_by: 'up-rera (official registry)',
    source_type: 'official_rera_registry', sources: [r.summary_url, r.map_url].filter(Boolean), source_note: 'UP RERA project summary + project detail pages',
    fields, updated_fields: Object.keys(fields), review_required: [],
    // A pincode UP RERA does not show is taken from OpenStreetMap at the verified RERA point — working copy only, never `original`.
    data_filled: loc.derived_pincode && !r.pincode ? { pincode: { old: null, new: loc.derived_pincode, source: 'OpenStreetMap reverse lookup at the UP RERA point' } } : {},
  };
  const data = { ...original, ...(loc.derived_pincode && !r.pincode ? { pincode: loc.derived_pincode } : {}) };
  rows.push({ id, doc: { id, original, data, enrichment, imported_at: RUN, dataset_generated: RUN, deleted: false,
    location_source: loc.pin_check === 'verified' ? { source: 'official_rera_registry', source_url: r.map_url, checked_at: RUN } : null } });
}

// ---- report / write --------------------------------------------------------------------------
const count = (f) => rows.filter(f).length;
const ready = (x) => { const d = x.doc.data, f = x.doc.enrichment.fields; return d.pin_check === 'verified' && f.configurations && (f.total_units > 0) && f.proposed_completion >= TODAY && f.land_area && d.pincode && !/default on QPR/i.test(d.status_category); };
console.log(JSON.stringify({ records: rows.length, verified_location: count((x) => x.doc.data.pin_check === 'verified'), with_units: count((x) => x.doc.enrichment.fields.total_units),
  completion_ahead: count((x) => (x.doc.enrichment.fields.proposed_completion || '') >= TODAY), ready_to_go_live: count(ready),
  pin_check: rows.reduce((a, x) => ({ ...a, [x.doc.data.pin_check]: (a[x.doc.data.pin_check] || 0) + 1 }), {}) }, null, 1));
writeFileSync(path.join(OUTDIR, 'NOIDA-UP-RERA.csv'), ['record_id,rera_number,project_name,promoter,pincode,lat,lng,location_check,location_reason,configurations,total_units,towers,land_area,completion,source_url',
  ...rows.map(({ doc: { original: o, enrichment: { fields: f } } }) => [o.id, o.rera_number, o.project_name, o.developer_name, o.pincode, o.lat, o.lng, o.pin_check, o.pin_reason, f.configurations, f.total_units, f.towers, f.land_area, f.proposed_completion, o.project_url].map(csv).join(','))].join('\n') + '\n');
if (!APPLY) { console.log('Dry run — nothing written. Use --apply.'); process.exit(0); }

const url = new URL(process.env.DATABASE_URL);
url.searchParams.delete('sslmode');
const db = new pg.Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false }, query_timeout: 120000 });
await db.connect();
let inserted = 0;
for (let i = 0; i < rows.length; i += 100) {
  const chunk = rows.slice(i, i + 100);
  const res = await db.query(`INSERT INTO scraped_projects (id, doc) SELECT e->>'id', e->'doc' FROM jsonb_array_elements($1::jsonb) e ON CONFLICT (id) DO NOTHING`, [JSON.stringify(chunk)]);
  inserted += res.rowCount;
}
await db.end();
appendFileSync(path.join(OUTDIR, 'PROJECT-CHANGE-LOG.csv'), rows.map(({ doc: { original: o } }) => [o.id, o.project_name, 'row', '', 'inserted from UP RERA', o.project_url, 'official_rera_registry', 'high', RUN, 'inserted'].map(csv).join(',')).join('\n') + '\n');
console.log(`Inserted ${inserted} new rows (existing ones left as they are).`);
