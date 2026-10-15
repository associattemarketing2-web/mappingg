// Map location for the "Added data — Check & go live" records (complete registry data, ids in
// migration/backup/scraped-enrichment-cache/ready-ids.json).
//
//   node --env-file=.env migration/enrichment/scraped/locate-ready.mjs [--apply]
//
// The location is the developer's own declaration to the regulator: the latitude/longitude on the official
// RERA Karnataka project page (doc.enrichment.fields.registry_latitude/longitude). Nothing is geocoded or
// guessed. It is saved to the working copy (data.lat/lng, pin_check "verified") only when every check passes:
//   1. inside the Bengaluru Urban / Rural area and given to at least 4 decimals;
//   2. inside the boundary of the record's own pincode (OpenStreetMap postal-code boundary; ≤ 1 km outside
//      counts as inside, boundaries are approximate);
//   3. not the same point as a project of a different promoter (an area pin, not the site).
// Records that fail stay without a location and are listed with the reason. `original`, enrichment and every
// other field are unchanged; only rows that still have no coordinates are written. Dry run by default.

import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const APPLY = process.argv.includes('--apply');
const CACHE = path.resolve('migration/backup/scraped-enrichment-cache');
const PIN_DIR = path.join(CACHE, 'osm-pincodes');
const OUTDIR = path.resolve('seo-doc/enrichment/scraped-project-enrichment');
const LOG = path.join(OUTDIR, 'PROJECT-CHANGE-LOG.csv');
const RUN = new Date().toISOString();
const BOUNDS = { minLat: 12.6, maxLat: 13.6, minLng: 77.1, maxLng: 78.0 }; // Bengaluru Urban + Rural districts
const TOLERANCE_KM = 1;
mkdirSync(PIN_DIR, { recursive: true });

const url = new URL(process.env.DATABASE_URL);
const mode = url.searchParams.get('sslmode');
url.searchParams.delete('sslmode');
const db = new pg.Client(mode === 'disable' ? { connectionString: process.env.DATABASE_URL } : { connectionString: url.toString(), ssl: mode ? true : { rejectUnauthorized: false }, query_timeout: 120000 });
await db.connect();
const canon = (v) => JSON.stringify(v ?? null, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort()) : x));
const csv = (v) => { const s = v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v); return `"${s.replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`; };
const decimals = (n) => (String(n).split('.')[1] || '').length;

// ---- geometry ------------------------------------------------------------------------------
const inRing = (x, y, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const polygons = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);
const inside = (lng, lat, g) => polygons(g).some((p) => inRing(lng, lat, p[0]) && !p.slice(1).some((h) => inRing(lng, lat, h)));
// Distance (km) from a point to the boundary, on a local flat projection (fine at this scale).
function kmToEdge(lng, lat, g) {
  const kx = 111.32 * Math.cos((lat * Math.PI) / 180), ky = 110.57;
  let best = Infinity;
  for (const p of polygons(g)) for (const ring of p) for (let i = 1; i < ring.length; i++) {
    const ax = (ring[i - 1][0] - lng) * kx, ay = (ring[i - 1][1] - lat) * ky, bx = (ring[i][0] - lng) * kx, by = (ring[i][1] - lat) * ky;
    const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

// ---- OpenStreetMap postal-code boundaries (cached; Nominatim policy: ≤ 1 request / second) ----------------
async function pincodeBoundary(pin) {
  const file = path.join(PIN_DIR, `${pin}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  await new Promise((r) => setTimeout(r, 1100));
  const res = await fetch(`https://nominatim.openstreetmap.org/search?postalcode=${pin}&countrycodes=in&format=json&polygon_geojson=1&limit=3`,
    { headers: { 'User-Agent': 'mappingg-admin-location-check/1.0 (associattemarketing@gmail.com)' } });
  if (!res.ok) throw new Error(`Nominatim ${pin}: HTTP ${res.status}`);
  const hit = (await res.json()).find((x) => x.type === 'postal_code' && /Polygon/.test(x.geojson?.type || '')) || null;
  const out = hit ? { pin, osm: `${hit.osm_type}/${hit.osm_id}`, geojson: hit.geojson, fetched_at: new Date().toISOString() } : { pin, missing: true, fetched_at: new Date().toISOString() };
  writeFileSync(file, JSON.stringify(out));
  return out;
}

// ---- plan ----------------------------------------------------------------------------------
const ids = JSON.parse(readFileSync(path.join(CACHE, 'ready-ids.json'), 'utf8'));
const { rows } = await db.query(`SELECT id, doc FROM scraped_projects WHERE id = ANY($1::text[]) ORDER BY id`, [ids]);
// Every Karnataka registry point with its promoter, to find points shared by different promoters.
const { rows: all } = await db.query(`SELECT id, doc->'enrichment'->'fields'->>'registry_latitude' AS lat, doc->'enrichment'->'fields'->>'registry_longitude' AS lng,
  coalesce(doc->'enrichment'->'fields'->>'registry_promoter_name', doc->'data'->>'developer_name') AS dev FROM scraped_projects WHERE doc->'enrichment'->'fields' ? 'registry_latitude'`);
const key = (lat, lng) => `${Number(lat).toFixed(4)},${Number(lng).toFixed(4)}`;
const devsAt = new Map();
for (const r of all) { const k = key(r.lat, r.lng); if (!devsAt.has(k)) devsAt.set(k, new Set()); devsAt.get(k).add(String(r.dev || '').toLowerCase().replace(/[^a-z0-9]/g, '')); }

const res = { records: rows.length, verified: 0, written: 0, failed_write: 0, already_located: 0, not_located: {}, list: [] };
const fail = (row, reason) => { const k = reason.replace(/ \(.*\)$/, '').replace(/[\d.]+ km/, 'N km').replace(/pincode \d+/, 'pincode X'); res.not_located[k] = (res.not_located[k] || 0) + 1; res.list.push({ id: row.id, name: row.doc.data?.project_name, reason }); };
const plans = [];
for (const row of rows) {
  const d = row.doc.data || {}, f = row.doc.enrichment?.fields || {};
  if (d.lat != null && d.lng != null) { res.already_located++; continue; }
  const lat = Number(f.registry_latitude), lng = Number(f.registry_longitude);
  if (f.registry_latitude == null || !Number.isFinite(lat) || !Number.isFinite(lng)) { fail(row, 'no coordinates on the registry page'); continue; }
  if (lat < BOUNDS.minLat || lat > BOUNDS.maxLat || lng < BOUNDS.minLng || lng > BOUNDS.maxLng) { fail(row, `registry point outside Bengaluru (${lat}, ${lng})`); continue; }
  if (decimals(f.registry_latitude) < 4 || decimals(f.registry_longitude) < 4) { fail(row, `registry point too coarse (${f.registry_latitude}, ${f.registry_longitude})`); continue; }
  if ((devsAt.get(key(lat, lng))?.size || 0) > 1) { fail(row, `same point as another promoter's project (${key(lat, lng)})`); continue; }
  const pin = String(d.pincode || f.pincode || '').trim();
  if (!/^\d{6}$/.test(pin)) { fail(row, 'no valid pincode'); continue; }
  const b = await pincodeBoundary(pin);
  if (b.missing) { fail(row, `pincode ${pin} has no boundary on OpenStreetMap`); continue; }
  const inPin = inside(lng, lat, b.geojson), edge = inPin ? 0 : kmToEdge(lng, lat, b.geojson);
  if (!inPin && edge > TOLERANCE_KM) { fail(row, `registry point is ${edge.toFixed(1)} km outside pincode ${pin}`); continue; }
  res.verified++;
  plans.push({ row, lat, lng, pin, osm: b.osm, reason: `Official RERA Karnataka coordinates (declared by the promoter); inside pincode ${pin} (OpenStreetMap boundary${inPin ? '' : `, ${edge.toFixed(1)} km from its edge`}); not shared with another promoter's project.` });
}

if (APPLY && plans.length) {
  const dir = path.resolve(`migration/backup/pg-snapshot-${RUN.replace(/[:.]/g, '-')}-before-locate-ready`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'scraped_projects.json'), JSON.stringify(rows));
  console.log(`Backup: ${dir}`);
}
for (const p of plans) {
  if (!APPLY) continue;
  const { row } = p, before = row.doc.data || {};
  const data = { ...before, lat: p.lat, lng: p.lng, pin_check: 'verified', pin_reason: p.reason };
  const source = { source: 'official_rera_registry', source_url: row.doc.enrichment.sources?.[0] || null, source_note: row.doc.enrichment.source_note || null,
    pincode_boundary: `https://www.openstreetmap.org/${p.osm}`, checked_at: RUN, old: { lat: before.lat ?? null, lng: before.lng ?? null, pin_check: before.pin_check ?? null, pin_reason: before.pin_reason ?? null } };
  // Only if the working copy is unchanged since we read it.
  await db.query(`UPDATE scraped_projects SET doc = doc || jsonb_build_object('data', $2::jsonb, 'location_source', $3::jsonb) WHERE id = $1 AND doc->'data' = $4::jsonb`,
    [row.id, JSON.stringify(data), JSON.stringify(source), JSON.stringify(before)]);
  const back = (await db.query(`SELECT doc FROM scraped_projects WHERE id = $1`, [row.id])).rows[0]?.doc;
  const ok = !!back && canon(back.data) === canon(data) && canon(back.original) === canon(row.doc.original) && canon(back.enrichment) === canon(row.doc.enrichment);
  ok ? res.written++ : res.failed_write++;
  const st = ok ? 'saved_verified' : 'not_saved_row_changed', name = before.project_name || '', src = `${source.source_url} (${source.source_note || ''}); pincode boundary ${source.pincode_boundary}`;
  appendFileSync(LOG, [
    [row.id, name, 'data.lat', before.lat ?? '', p.lat, src, 'official_rera_registry', 'high', RUN, st],
    [row.id, name, 'data.lng', before.lng ?? '', p.lng, src, 'official_rera_registry', 'high', RUN, st],
    [row.id, name, 'data.pin_check', before.pin_check ?? '', 'verified', src, 'official_rera_registry', 'high', RUN, st],
  ].map((l) => l.map(csv).join(',')).join('\n') + '\n');
}
await db.end();
writeFileSync(path.join(OUTDIR, 'LOCATION-NOT-VERIFIED.csv'), ['record_id,project_name,reason', ...res.list.map((x) => [x.id, x.name, x.reason].map(csv).join(','))].join('\n') + '\n');
console.log(JSON.stringify({ ...res, list: undefined, mode: APPLY ? 'apply' : 'dry run' }, null, 1));
