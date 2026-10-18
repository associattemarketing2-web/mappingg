// Address, latitude/longitude, location check and RERA facts on the map card of every live project that came
// from scraped data, plus blank card fields (configuration, possession, type) filled from the registry facts.
//
//   node --env-file=.env migration/enrichment/scraped/live-details.mjs [--apply | --revert]
//
// Sources, nothing guessed:
//   - address: the RERA full address; where the registry shows none (MahaRERA listing, some UP RERA rows) the
//     OpenStreetMap reverse lookup of the pin's point, labelled "Address (map area, OpenStreetMap)";
//   - location check: OSM postcode / district at the pin's point compared with the RERA pincode and city, and
//     whether another developer's live pin sits on exactly the same point (a placeholder, not a site);
//   - configuration / possession / type: only when the card field is blank, from the RERA configuration list and
//     proposed completion (or the developer's own project page that prints the RERA number, see DEV_PAGES).
// Pin titles and locations are never changed. Card fields added here have ids starting "loc-" or "rera-".
// The OSM answers are read from <cache>/live-details/osm-cache.json (Nominatim, 1 request/second).

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const DIR = path.resolve('migration/backup/scraped-enrichment-cache/live-details');
const mode = process.argv.includes('--apply') ? 'apply' : process.argv.includes('--revert') ? 'revert' : 'dry';
const url = new URL(process.env.DATABASE_URL); url.searchParams.delete('sslmode');
const db = new pg.Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false }, query_timeout: 300000 });
await db.connect();

if (mode === 'revert') {
  const last = readdirSync(DIR).filter((f) => /^before-.*\.json$/.test(f)).sort().pop();
  const b = JSON.parse(readFileSync(path.join(DIR, last), 'utf8'));
  await db.query('BEGIN');
  for (const p of b.pins) await db.query(`UPDATE pins SET doc = doc || $2::jsonb WHERE id = $1`, [p.id, JSON.stringify(p.fields)]);
  for (const p of b.projects) await db.query(`UPDATE projects SET doc = doc || $2::jsonb WHERE id = $1`, [p.id, JSON.stringify(p.fields)]);
  await db.query('COMMIT');
  console.log(`reverted from ${last}: ${b.pins.length} pins, ${b.projects.length} projects`);
  await db.end(); process.exit(0);
}

// Developer project pages that print the pin's MahaRERA number (checked 18 Oct 2026).
const RAYMOND_SION = { page: 'https://raymondrealty.in/residential-property/the-address-by-gs-sion', configuration: '2 / 3 / 4 BHK' };
const DEV_PAGES = { PR1170002503008: RAYMOND_SION, PR1170002503009: RAYMOND_SION, PR1170002503010: RAYMOND_SION, PR1170002503011: RAYMOND_SION, PR1170002503012: RAYMOND_SION };

const osm = JSON.parse(readFileSync(path.join(DIR, 'osm-cache.json'), 'utf8'));
const key = (lat, lng) => `${(+lat).toFixed(6)},${(+lng).toFixed(6)}`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monYear = (iso) => (/^\d{4}-\d{2}/.test(iso || '') ? `${MONTHS[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}` : null);
const dmy = (iso) => (/^\d{4}-\d{2}-\d{2}/.test(iso || '') ? `${+iso.slice(8, 10)} ${MONTHS[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}` : null);

/** "3BHK+3T, Type 20H - 3BHK, 2 BEDROOM + 2 TOILET, Studio" → "2 / 3 BHK + Studio". Null when nothing is clear. */
export function configFromRera(s) {
  if (!s) return null;
  const t = String(s);
  if (/^\s*(residential\s+)?plots?\s*$/i.test(t)) return 'Plot';
  const n = new Set();
  for (const m of t.matchAll(/(\d(?:\.5)?)\s*(?:BHK|B\s*H\s*K|BED(?:ROOM)?S?\b|B\s*\+\s*\d\s*T|BR\b)/gi)) n.add(Number(m[1]));
  // "1 ,2,3 BHK", "3 and 4 BHK"
  for (const m of t.matchAll(/((?:\d\s*(?:,|and|&|\/)\s*)+\d)\s*BHK/gi)) m[1].split(/,|and|&|\//).forEach((x) => { const v = Number(x.trim()); if (v) n.add(v); });
  const extra = [];
  if (/studio/i.test(t)) extra.push('Studio');
  if (/penthouse|\bPENT\b/i.test(t)) extra.push('Penthouse');
  if (/villa(?!ment)/i.test(t)) extra.push('Villa');
  if (/villament/i.test(t)) extra.push('Villament');
  if (/row\s*house|townhouse/i.test(t)) extra.push('Row House');
  const nums = [...n].filter((v) => v > 0 && v < 10).sort((a, b) => a - b);
  if (!nums.length && !extra.length) return /commercial|shop|office/i.test(t) ? 'Commercial' : null;
  return [nums.length ? `${nums.join(' / ')} BHK` : null, ...extra].filter(Boolean).join(' + ');
}

const { rows } = await db.query(`SELECT sp.id sid, sp.doc->'data' d, sp.doc->'enrichment'->'fields' f,
    pr.id prid, pr.doc->>'address' paddr, pr.doc->'additional_details' padd,
    p.id pid, (p.doc->>'lat')::float lat, (p.doc->>'lng')::float lng, p.doc->>'developer' dev, p.doc->>'number' num, p.doc->>'title' title,
    p.doc->'custom_fields' cf, p.doc->>'configuration' config, p.doc->>'possession_timeline' poss, p.doc->>'type' type, p.doc->>'status' status
  FROM scraped_projects sp JOIN project_submissions sub ON sub.id = sp.doc->>'submission_id'
  JOIN projects pr ON pr.id = sub.doc->>'published_project_id' JOIN pins p ON p.id = pr.doc->>'pin_id'
  WHERE NOT coalesce((sp.doc->>'deleted')::boolean,false)`);

// Same point used by different developers' live pins = a placeholder point.
const atPoint = new Map();
for (const r of rows) { const k = key(r.lat, r.lng); atPoint.set(k, [...(atPoint.get(k) || []), r]); }

const report = [], pinUpd = [], prUpd = [], before = { pins: [], projects: [] };
const cityWords = { Bengaluru: /bengaluru|bangalore/i, Noida: /noida|gautam buddha nagar|greater noida/i, Gurugram: /gurugram|gurgaon/i,
  Mumbai: /mumbai/i, Pune: /pune/i, Thane: /thane/i };

for (const r of rows) {
  const d = r.d || {}, f = r.f || {};
  const o = osm[key(r.lat, r.lng)];
  const a = o?.address || {};
  const reraPin = String(d.pincode || f.pincode || '').replace(/\s/g, '') || null;
  const osmPin = (a.postcode || '').replace(/\s/g, '') || null;
  const osmArea = [a.state_district, a.county, a.city, a.town, a.state].filter(Boolean).join(' ');
  const inCity = cityWords[d.city] ? cityWords[d.city].test(osmArea + ' ' + (o?.display_name || '')) : null;
  const sharers = (atPoint.get(key(r.lat, r.lng)) || []).filter((x) => x.pid !== r.pid && x.dev !== r.dev);
  let check;
  if (!o || o.error) check = { result: 'not checked', note: 'OpenStreetMap had no answer for this point' };
  else if (sharers.length) check = { result: 'shared point', note: `Same point as ${sharers.map((x) => `#${x.num} ${x.title}`).join(', ')} (another developer) — a placeholder, not the site` };
  else if (inCity === false) check = { result: 'outside city', note: `Point is in ${osmArea || 'an area'} per OpenStreetMap, not ${d.city}` };
  else if (reraPin && osmPin && reraPin !== osmPin) check = { result: 'pincode differs', note: `RERA pincode ${reraPin}, OpenStreetMap postcode at the point ${osmPin} (neighbouring pincodes are common at boundaries)` };
  else check = { result: 'ok', note: `${d.pin_reason || 'Registry point'} OpenStreetMap at the point: ${[a.suburb || a.neighbourhood || a.village || a.city_district, a.city || a.town || a.county, osmPin].filter(Boolean).join(', ')}.` };

  const reraAddr = f.full_address || (r.paddr && !/^\s*\d{6}\s*$/.test(r.paddr) ? r.paddr : null) || d.address || null;
  const osmAddr = o && !o.error ? [a.road, a.neighbourhood || a.suburb || a.quarter, a.village || a.city_district, a.city || a.town || a.county, a.state_district && a.state_district !== (a.city || a.town) ? a.state_district : null, a.state, osmPin].filter(Boolean).filter((v, i, arr) => arr.indexOf(v) === i).join(', ') : null;
  const address = reraAddr ? { label: 'Address (RERA)', value: reraAddr.replace(/\s+/g, ' ').trim() } : osmAddr ? { label: 'Address (map area, OpenStreetMap)', value: osmAddr } : null;

  const add = [];
  if (address) add.push({ id: 'loc-address', label: address.label, value: address.value, visible: true });
  add.push({ id: 'loc-latlng', label: 'Latitude, Longitude', value: `${(+r.lat).toFixed(6)}, ${(+r.lng).toFixed(6)}`, visible: true });
  add.push({ id: 'loc-check', label: 'Location check', value: `${check.result}: ${check.note}`, visible: false });
  if (dmy(d.registration_date)) add.push({ id: 'rera-registered', label: 'RERA registration date', value: dmy(d.registration_date), visible: true });
  if (monYear(f.proposed_completion)) add.push({ id: 'rera-completion', label: 'RERA completion date', value: monYear(f.proposed_completion), visible: true });
  if (f.total_units > 0) add.push({ id: 'rera-units', label: 'Total units (RERA)', value: String(f.total_units), visible: true });
  else if (f.total_plots > 0) add.push({ id: 'rera-units', label: 'Total plots (RERA)', value: String(f.total_plots), visible: true });
  if (f.land_area) add.push({ id: 'rera-land', label: 'Land area (RERA)', value: String(f.land_area), visible: true });
  const dev = DEV_PAGES[d.rera_number];
  if (dev) add.push({ id: 'rera-devpage', label: 'Developer project page (shows this RERA no.)', value: dev.page, visible: true });

  const cf = [...(Array.isArray(r.cf) ? r.cf : []).filter((c) => !/^(loc|rera)-/.test(c?.id || '')), ...add];
  const patch = { custom_fields: cf }; const filled = [];
  if (!r.config) { const c = configFromRera(f.configurations) || dev?.configuration || null; if (c) { patch.configuration = c; filled.push(`configuration: ${c}`); } }
  if (!r.poss && r.status !== 'upcoming' && monYear(f.proposed_completion)) { patch.possession_timeline = monYear(f.proposed_completion); filled.push(`possession: ${patch.possession_timeline}`); }
  if (!r.type) {
    const c = patch.configuration || r.config || '';
    const t = /^plot/i.test(c) ? 'Plotted Development' : /BHK|Studio|Villa|Row House/.test(c) ? 'Residential/Group Housing' : /^Commercial$/.test(c) ? 'Commercial' : null;
    if (t) { patch.type = t; filled.push(`type: ${t}`); }
  }
  pinUpd.push({ id: r.pid, patch });
  before.pins.push({ id: r.pid, fields: { custom_fields: r.cf ?? [], ...(patch.configuration ? { configuration: r.config ?? '' } : {}), ...(patch.possession_timeline ? { possession_timeline: r.poss ?? '' } : {}), ...(patch.type ? { type: r.type ?? '' } : {}) } });

  // Project page: a real address instead of a bare pincode, plus the coordinates and the check.
  const padd = (Array.isArray(r.padd) ? r.padd : []).filter((x) => !/^(Latitude, Longitude|Address source|Location check \(OpenStreetMap\))$/.test(x.label));
  padd.push({ label: 'Latitude, Longitude', value: `${(+r.lat).toFixed(6)}, ${(+r.lng).toFixed(6)}` });
  padd.push({ label: 'Location check (OpenStreetMap)', value: `${check.result}: ${check.note}` });
  const prPatch = { additional_details: padd };
  if ((!r.paddr || /^\s*\d{6}\s*$/.test(r.paddr)) && address) { prPatch.address = address.value; padd.push({ label: 'Address source', value: address.label.includes('OpenStreetMap') ? 'OpenStreetMap reverse lookup of the RERA map point (the registry listing shows no address)' : 'RERA' }); }
  prUpd.push({ id: r.prid, patch: prPatch });
  before.projects.push({ id: r.prid, fields: { additional_details: r.padd ?? [], ...(prPatch.address ? { address: r.paddr ?? '' } : {}) } });

  report.push({ pin: r.num, title: r.title, developer: r.dev, city: d.city, regulator: d.regulator, rera: d.rera_number, lat: r.lat, lng: r.lng,
    location_check: check.result, location_note: check.note, rera_pincode: reraPin, osm_postcode: osmPin, address_label: address?.label || 'none', address: address?.value || '',
    filled: filled.join('; '), still_blank: ['configuration', 'possession', 'type'].filter((k) => !(k === 'configuration' ? (r.config || patch.configuration) : k === 'possession' ? (r.poss || patch.possession_timeline || r.status === 'upcoming') : (r.type || patch.type))).join(', ') });
}

const by = (k) => report.reduce((m, x) => ((m[x[k]] = (m[x[k]] || 0) + 1), m), {});
console.log('live pins', report.length, '| location check', by('location_check'), '| address', by('address_label'));
console.log('filled:', report.filter((x) => x.filled).length, 'pins;', 'still blank:', by('still_blank'));
const csv = (rows) => [Object.keys(rows[0]).join(','), ...rows.map((x) => Object.values(x).map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
const OUT = path.resolve('seo-doc/enrichment/scraped-project-enrichment/LIVE-LOCATION-DETAILS.csv');
writeFileSync(OUT, csv(report));
console.log('report →', path.relative(process.cwd(), OUT));
if (mode === 'dry') { console.log('dry run — pass --apply to write'); await db.end(); process.exit(0); }

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
writeFileSync(path.join(DIR, `before-${stamp}.json`), JSON.stringify(before));
await db.query('BEGIN');
for (const u of pinUpd) await db.query(`UPDATE pins SET doc = doc || $2::jsonb WHERE id = $1`, [u.id, JSON.stringify({ ...u.patch, updated_at: new Date().toISOString() })]);
for (const u of prUpd) await db.query(`UPDATE projects SET doc = doc || $2::jsonb WHERE id = $1`, [u.id, JSON.stringify(u.patch)]);
await db.query('COMMIT');
console.log(`updated ${pinUpd.length} pins, ${prUpd.length} projects (backup before-${stamp}.json)`);
await db.end();
