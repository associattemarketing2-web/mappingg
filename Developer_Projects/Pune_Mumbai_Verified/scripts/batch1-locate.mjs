// Location check for the collect-2026-10-18 rows (dry run unless --apply; --revert undoes the last --apply).
// 1. No registry point, ONE map point (Google Maps embed) on the developer's own project page, and OpenStreetMap puts that
//    point in the right district and (where the registry gives one) the same pincode -> data.lat/lng set from the page,
//    pin_check "verified"; a missing pincode / locality is filled from OpenStreetMap at the point (data_filled notes it).
// 2. Registry point and developer-page point more than 250 m apart -> review_required "location" (conflict shown to the
//    reviewer; the record cannot go live until someone checks it).
// The same point on several developer pages for projects in other places (an office pin) is never used.
// `original` is never changed.
import pg from 'pg'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '..');
const RUNS = path.join(ROOT, 'cache', 'locate-runs'); fs.mkdirSync(RUNS, { recursive: true });
const APPLY = process.argv.includes('--apply'), REVERT = process.argv.includes('--revert'), RUN = new Date().toISOString();
const url = new URL(process.env.DATABASE_URL); url.searchParams.delete('sslmode');
const db = new pg.Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } }); await db.connect();
if (REVERT) { const f = fs.readdirSync(RUNS).filter((x) => x.startsWith('applied-')).sort().at(-1); const run = JSON.parse(fs.readFileSync(path.join(RUNS, f), 'utf8'));
  for (const u of run) await db.query('UPDATE scraped_projects SET doc = $2 WHERE id = $1', [u.id, u.before]); console.log(`Reverted ${f}: ${run.length} rows`); await db.end(); process.exit(0); }

const audit = JSON.parse(fs.readFileSync(path.join(ROOT, 'cache', 'batch1-location-audit.json'), 'utf8'));
const checked = new Map(JSON.parse(fs.readFileSync(path.join(ROOT, 'cache', 'batch1-devpin-check.json'), 'utf8')).map((r) => [r.rera, r]));
const PIN_DIR = path.resolve(ROOT, '..', '..', 'migration', 'backup', 'scraped-enrichment-cache', 'osm-pincodes');
const rev = (lat, lng) => { const f = path.join(PIN_DIR, `rev-${lat.toFixed(5)}_${lng.toFixed(5)}.json`); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {}; };
const docs = new Map((await db.query(`SELECT id, doc FROM scraped_projects WHERE doc->>'added_by' LIKE 'collect-2026-10-18%'`)).rows.map((r) => [r.id, r.doc]));
const changes = [];
for (const a of audit) {
  const before = docs.get(a.id); if (!before) continue; const doc = JSON.parse(JSON.stringify(before)), d = doc.data, e = doc.enrichment, page = e.fields.developer_project_page;
  const c = checked.get(a.rera); let what = null;
  if (c && c.districtOk && c.pinOk !== false) {
    const o = rev(c.lat, c.lng).address || {};
    doc.location_source = { source: 'developer_website', source_url: page, how: 'Google Maps embed on the project page', checked_at: RUN, old: { lat: d.lat ?? null, lng: d.lng ?? null, pin_check: d.pin_check, pin_reason: d.pin_reason } };
    d.lat = c.lat; d.lng = c.lng; d.pin_check = 'verified';
    d.pin_reason = `Map point on the developer's own project page (${page}); OpenStreetMap places it in ${c.osm}${c.registry_pincode ? `, pincode ${c.osm_postcode} = registry pincode` : ''}. ${d.regulator === 'MahaRERA' ? 'MahaRERA shows no map point.' : 'Telangana RERA (CAPTCHA) not checked.'}`;
    e.data_filled ||= {};
    if (!d.pincode && /^\d{6}$/.test(c.osm_postcode)) { e.data_filled.pincode = { old: null, new: c.osm_postcode, source: 'OpenStreetMap reverse lookup at the developer-page point' }; d.pincode = c.osm_postcode; }
    const loc = o.suburb || o.neighbourhood || o.village || o.town || o.city_district;
    if (!d.locality && loc) { e.data_filled.locality = { old: null, new: loc, source: 'OpenStreetMap reverse lookup at the developer-page point' }; d.locality = loc; }
    if (!d.district && (o.state_district || o.county)) { e.data_filled.district = { old: null, new: o.state_district || o.county, source: 'OpenStreetMap reverse lookup at the developer-page point' }; d.district = o.state_district || o.county; }
    e.field_status = { ...(e.field_status || {}), location: 'cross_checked', last_checked: RUN.slice(0, 10) };
    e.pending_fields = (e.pending_fields || []).filter((x) => x !== 'verified_location');
    what = 'location verified from developer page';
  } else if (a.dist_km != null && a.dist_km > 0.25 && !(e.review_required || []).some((r) => r.field === 'location')) {
    const near = a.pts.map((p) => ({ p, km: 6371 * Math.hypot(((p[1] - d.lng) * Math.PI / 180) * Math.cos(((p[0] + d.lat) / 2) * Math.PI / 180), (p[0] - d.lat) * Math.PI / 180) })).sort((x, y) => x.km - y.km)[0];
    e.review_required = [...(e.review_required || []), { field: 'location', current: `MahaRERA point ${d.lat}, ${d.lng}`, registry: `developer page point ${near.p.join(', ')}`, note: `${a.dist_km} km apart - check which is the site (${page}).` }];
    e.field_status = { ...(e.field_status || {}), location: 'conflicting_sources', last_checked: RUN.slice(0, 10) };
    what = `location conflict flagged (${a.dist_km} km)`;
  } else if (c) {
    e.field_status = { ...(e.field_status || {}), location: 'rejected_developer_pin', last_checked: RUN.slice(0, 10) };
    d.pin_reason = `${d.pin_reason || ''} Developer-page map point (${c.lat}, ${c.lng}) not used: OpenStreetMap puts it in ${c.osm} (pincode ${c.osm_postcode || '?'}), not the project's area.`.trim();
    what = 'developer pin rejected (wrong place / office pin)';
  }
  if (what) changes.push({ id: a.id, rera: a.rera, city: a.city, project: a.project, what, before, after: doc });
}
const by = changes.reduce((x, c) => ((x[c.what.replace(/\(.*\)/, '').trim()] = (x[c.what.replace(/\(.*\)/, '').trim()] || 0) + 1), x), {});
console.log(by);
if (!APPLY) { console.log('Dry run - nothing written.'); await db.end(); process.exit(0); }
fs.writeFileSync(path.join(RUNS, `applied-${RUN.replace(/[:.]/g, '-')}.json`), JSON.stringify(changes.map((c) => ({ id: c.id, before: c.before }))));
for (const c of changes) await db.query('UPDATE scraped_projects SET doc = $2 WHERE id = $1', [c.id, c.after]);
console.log(`Saved ${changes.length} rows. Revert with --revert.`); await db.end();
