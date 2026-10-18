// Location check of every LIVE map pin that came from Scraped data (scraped record → submission → project → pin),
// against Google Maps (answers cached by google-places-fetch.mjs --ids). Other pins are never read for writing.
//
//   node --env-file=.env migration/enrichment/scraped/live-pin-check.mjs            dry run → LIVE-PIN-CHECK.csv
//   node --env-file=.env migration/enrichment/scraped/live-pin-check.mjs --apply    move the wrong pins
//   node --env-file=.env migration/enrichment/scraped/live-pin-check.mjs --revert   put the last --apply back
//
// For each pin, the Google place of the project is the one whose name has every distinctive word of the project name
// (or, for long registry names, the project's own last word plus the developer), that is a building / housing place
// (not a shop, office, hall or the developer's office), and — when several — the one in the record's pincode, then the
// one closest to the pin. Result per pin:
//   ok        the place is within 400 m of the pin (the project is where the pin is);
//   moved     the place is farther AND it is in the record's pincode (or ≤ 5 km from where that pincode's verified
//             projects are, or in the record's city with the developer's name) AND no other developer's project / other
//             live pin matched the same place → pin, project and scraped record get the place's point;
//   review    a place with the name was found but failed a check above (listed with the reason, pin unchanged);
//   not found Google has no place with the project's name (pin unchanged).
// Every change is backed up first (migration/backup/live-pin-check/before-<run>.json) and logged.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const APPLY = process.argv.includes('--apply'), REVERT = process.argv.includes('--revert');
const CACHE = path.resolve('migration/backup/scraped-enrichment-cache/google-places');
const BK = path.resolve('migration/backup/live-pin-check');
const OUTDIR = path.resolve('seo-doc/enrichment/scraped-project-enrichment');
const LOG = path.join(OUTDIR, 'PROJECT-CHANGE-LOG.csv');
const RUN = new Date().toISOString();
const OK_KM = 0.4, CENTRE_KM = 5, SNAP_KM = 0.06;
mkdirSync(BK, { recursive: true });

const url = new URL(process.env.DATABASE_URL);
url.searchParams.delete('sslmode');
const db = new pg.Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false }, query_timeout: 180000 });
await db.connect();

if (REVERT) {
  const f = readdirSync(BK).filter((x) => x.startsWith('before-')).sort().at(-1);
  if (!f) throw new Error('Nothing to revert');
  const b = JSON.parse(readFileSync(path.join(BK, f), 'utf8'));
  await db.query('BEGIN');
  for (const x of b) {
    await db.query(`UPDATE pins SET doc = doc || jsonb_build_object('lat', $2::float, 'lng', $3::float) WHERE id = $1`, [x.pin_id, x.pin.lat, x.pin.lng]);
    await db.query(`UPDATE projects SET doc = doc || jsonb_build_object('lat', $2::float, 'lng', $3::float) WHERE id = $1`, [x.pid, x.project.lat, x.project.lng]);
    await db.query(`UPDATE scraped_projects SET doc = jsonb_set(doc, '{data}', $2::jsonb) - 'live_pin_check' WHERE id = $1`, [x.sid, JSON.stringify(x.data)]);
  }
  await db.query('COMMIT');
  console.log(`Reverted ${f}: ${b.length} pins put back`);
  await db.end(); process.exit(0);
}

const { rows } = await db.query(`SELECT s.id sid, s.doc->'data' d, p.id pid, p.doc->>'lat' plat, p.doc->>'lng' plng, pn.id pin_id, pn.doc->>'title' title, pn.doc->>'number' num,
    (pn.doc->>'lat')::float lat, (pn.doc->>'lng')::float lng
  FROM scraped_projects s JOIN project_submissions sub ON sub.id = s.doc->>'submission_id' JOIN projects p ON p.id = sub.doc->>'published_project_id'
  JOIN pins pn ON pn.id = p.doc->>'pin_id'
  WHERE NOT coalesce((s.doc->>'deleted')::boolean, false) AND coalesce((p.doc->>'is_live')::boolean, false) AND NOT coalesce((pn.doc->>'hidden')::boolean, false)`);
// Where each pincode's projects are: mean of verified scraped points with that pincode.
const cent = new Map();
for (const r of (await db.query(`SELECT doc->'data'->>'pincode' pin, (doc->'data'->>'lat')::float lat, (doc->'data'->>'lng')::float lng FROM scraped_projects
  WHERE doc->'data'->>'pin_check' IN ('verified','manual') AND doc->'data'->>'lat' IS NOT NULL AND coalesce(doc->'data'->>'pincode','') <> ''`)).rows) {
  const c = cent.get(r.pin) || { lat: 0, lng: 0, n: 0 }; c.lat += r.lat; c.lng += r.lng; c.n++; cent.set(r.pin, c);
}

const STOP = new Set(['phase', 'ph', 'tower', 'towers', 'wing', 'block', 'blk', 'the', 'by', 'at', 'of', 'and', 'in', 'a', 'b', 'c', 'd', 'e', 'f', 'i', 'ii', 'iii', 'iv', 'v',
  'project', 'residential', 'apartment', 'apartments', 'apts', 'flats', 'homes', 'residency', 'residences', 'layout', 'plot', 'plots', 'no', 'sector', 'part', 'stage', 'extension', 'ext', 'new', 'to', 'w', 'wings', 'towers', 'project']);
const BIZ = /\b(private|pvt|limited|ltd|llp|m\/s|developers?|builders?|constructions?|infra(structure)?|projects?|properties|realty|estates?|ventures?|co|company|india|housing|promoters?|group|enterprises?|realtors?)\b/gi;
const words = (s) => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
const core = (name) => [...new Set(words(String(name || '').replace(/\b(sector|avenue)\b\s*\w*\d\w*/gi, ' ').replace(/\s+by\s+.*$/i, '').replace(/\(.*?\)/g, ' '))
  .filter((w) => !STOP.has(w) && !/\d/.test(w) && w.length > 1))];
const brand = (dev) => words(String(dev || '').replace(BIZ, ' ')).filter((w) => w.length > 2 && !STOP.has(w));
const lev1 = (a, b) => {
  if (a === b) return true; if (Math.abs(a.length - b.length) > 1 || a.length < 6) return false;
  let i = 0, j = 0, e = 0;
  while (i < a.length && j < b.length) { if (a[i] === b[j]) { i++; j++; continue; } if (++e > 1) return false; if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; } }
  return e + (a.length - i) + (b.length - j) <= 1;
};
const has = (list, w) => list.some((x) => lev1(x, w));
const km = (a, b, c, d) => { const R = 6371, r = Math.PI / 180, x = Math.sin((c - a) * r / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin((d - b) * r / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };
const BAD_TYPE = /restaurant|cafe|store|shop|movie|theater|corporate_office|real_estate_agency|bank|atm|hospital|school|lodging|hotel|car_|gas_station|place_of_worship|^locality$|^sublocality|^political$|^route$|^postal_code$|administrative_area/;
const BAD_NAME = /architect|interior|sales office|site office|project office|sales gallery|marketing|lounge|enquiry|booking|\bpg\b|hostel|paying guest|wellbeing|wellness|\bcross\s*$|junction|circle\s*$|experience cent|gallery|head office|corporate|convention|\bhall\b|temple|mandir|church|school|college|(builders|developers|constructions|realtors)\s*$/i;
const postal = (p) => (p.addressComponents || []).find((c) => (c.types || []).includes('postal_code'))?.longText || (p.formattedAddress?.match(/\b(\d{6})\b/) || [])[1] || null;

const res = [];
for (const r of rows) {
  const d = r.d, f = path.join(CACHE, `${r.sid}.json`);
  const base = { r, status: 'not found', why: 'not searched yet', place: null };
  if (!existsSync(f)) { res.push(base); continue; }
  const places = new Map();
  for (const a of JSON.parse(readFileSync(f, 'utf8')).answers) for (const p of a.places) if (!places.has(p.id)) places.set(p.id, p);
  const want = core(d.project_name), br = brand(d.developer_name), pin = d.pincode ? String(d.pincode).trim() : null;
  const c = pin && cent.get(pin), centre = c && c.n >= 2 ? [c.lat / c.n, c.lng / c.n] : null;
  const cityWords = words(d.city === 'Kalyan_Dombivli' ? 'Kalyan Dombivli' : d.city).filter((w) => w.length > 3);
  const cands = [];
  let why = want.length ? 'Google has no place with the project name' : 'project name has no distinctive word';
  for (const p of places.values()) {
    const pw = words(p.displayName?.text), aw = words(p.formattedAddress), types = p.types || [];
    const hit = want.filter((w) => has(pw, w));
    const full = want.length && hit.length === want.length;
    const partial = hit.length >= 2 && has(pw, want.at(-1)) && br.some((w) => pw.includes(w) || aw.includes(w));
    if (!full && !partial) continue;
    if (BAD_NAME.test(p.displayName?.text || '')) { why = `only an office / hall named like the project (${p.displayName?.text})`; continue; }
    if (types.some((t) => BAD_TYPE.test(t)) && !types.some((t) => /apartment|condominium|housing|residential|premise/.test(t))) { why = `only a ${types[0]} named like the project`; continue; }
    if (want.length === 1 && !br.some((w) => pw.includes(w) || aw.includes(w)) && postal(p) !== pin) { why = `one-word name "${p.displayName?.text}" without the developer or the pincode`; continue; }
    // Another project's name in the place name ("STHIRA by Signifa Simhadri", "VJ Centro" for "VJ Town Centre"):
    // a distinctive word that is not the project's, the developer's, the area's or a generic property word.
    const GENERIC = /^(luxury|premium|apartment|apartments|apartmentss|flats?|villas?|villa|plots?|layout|township|residences?|residency|homes?|official|bhk|tower|towers|building|by|phase|block|wing|project|projects|properties|bangalore|bengaluru|pune|mumbai|thane|noida|greater|gurgaon|gurugram|hyderabad|new|launch|gated|community|enclave|city|the|and|in|at|of)$/;
    const area = new Set([...words(d.locality), ...words(d.city), ...aw]);
    const extra = pw.filter((w) => w.length > 2 && !/\d/.test(w) && !GENERIC.test(w) && !has(want, w) && !br.includes(w) && !area.has(w));
    // Different phase / tower number on both names ("Canvas & Cove 2.0" vs "Canvas & Cove Phase 1") = sister phase.
    const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };
    // Building designators: "Phase III", "Tower 4N", "Block A", "Wing 5", "2.0", a trailing number ("Equinox 6").
    // Both names have some and none is shared → a different building of the same project.
    const desig = (s) => {
      const t = String(s).toLowerCase().replace(/[–—]/g, '-'), out = new Set();
      for (const m of t.matchAll(/\b(?:phase|ph|tower|towers|block|wing|w)\s*[-:.#]?\s*(\d+[a-z]?|[ivx]+|[a-z]\d?)\b/g)) out.add(ROMAN[m[1]] != null ? String(ROMAN[m[1]]) : m[1].replace(/^(\d+)\.0$/, '$1'));
      const tail = t.match(/\b(\d+)(?:\.0)?[a-z]?\s*$/); if (tail) out.add(tail[1]);
      for (const m of t.matchAll(/\b(\d)\.0\b/g)) out.add(m[1]);
      return out;
    };
    const da = desig(d.project_name), db2 = desig(p.displayName?.text);
    const sameBuilding = !da.size || !db2.size || [...da].some((x) => db2.has(x) || db2.has(x.replace(/[a-z]$/, '')));
    const exact = full && !extra.length && sameBuilding;
    if (!full && extra.length) { why = `Google place "${p.displayName?.text}" names another project (${extra.join(' ')})`; continue; }
    if (want.length === 1 && extra.length) { why = `one-word name; Google place "${p.displayName?.text}" also names ${extra.join(' ')}`; continue; }
    const code = postal(p), dist = km(r.lat, r.lng, p.location.latitude, p.location.longitude);
    const dCentre = centre ? km(centre[0], centre[1], p.location.latitude, p.location.longitude) : null;
    // Registry pincodes are often the neighbouring one: a place with exactly the project's full (2+ word) name and no
    // other project's name, within 3 km of the pin, is the project itself even when Google's pincode differs.
    const where = code && pin && code === pin ? 'pincode' : dCentre != null && dCentre <= CENTRE_KM ? 'near pincode area'
      : full && !extra.length && want.length >= 2 && dist <= 3 ? `exact name ${dist.toFixed(1)} km from the pin (Google pincode ${code || '-'}, record ${pin || '-'})`
      : !pin && cityWords.some((w) => aw.includes(w)) && br.some((w) => pw.includes(w) || aw.includes(w)) ? 'city + developer' : null;
    // A one-word project name moves a pin only with the developer's name on the place AND the record's pincode.
    const oneWordOk = want.length > 1 || (br.some((w) => pw.includes(w) || aw.includes(w)) && code === pin);
    // Only a place with the project's FULL name moves a pin: a partial match is often a sibling building in the same
    // township ("Brigade Meadows Wisteria" for "Azalea at Brigade Meadows"); it can still confirm a pin that is close.
    cands.push({ p, code, dist, dCentre, where: oneWordOk && full ? where : null, exact, home: types.some((t) => /apartment|condominium|housing|premise/.test(t)) });
  }
  if (!cands.length) { res.push({ ...base, why }); continue; }
  // Any same-name place near the pin confirms it; else the best-placed one (pincode, housing type, nearest).
  const near = cands.filter((x) => x.dist <= OK_KM).sort((a, b) => a.dist - b.dist)[0];
  if (near) {
    // Close is not enough when zoomed in: a pin more than 60 m from the place with the project's exact name is put
    // on that place. A pin near a place with only part of the name (township / sister building) is left as it is.
    const exactNear = cands.filter((x) => x.exact && x.dist <= OK_KM).sort((a, b) => a.dist - b.dist)[0];
    if (exactNear && exactNear.dist > SNAP_KM) { res.push({ r, status: 'moved', why: `pin is ${(exactNear.dist * 1000).toFixed(0)} m from Google place "${exactNear.p.displayName?.text}" (${exactNear.p.formattedAddress}); place matches by exact name`, place: exactNear }); continue; }
    res.push({ r, status: exactNear ? 'ok' : 'ok (partial name)', why: `Google place "${(exactNear || near).p.displayName?.text}" is ${((exactNear || near).dist * 1000).toFixed(0)} m from the pin`, place: exactNear || near });
    continue;
  }
  const rank = (x) => (x.where === 'pincode' ? 4 : x.where ? 2 : 0) + (x.home ? 1 : 0);
  const best = cands.sort((a, b) => rank(b) - rank(a) || a.dist - b.dist)[0];
  if (!best.where) { res.push({ r, status: 'review', why: `Google place "${best.p.displayName?.text}" is ${best.dist.toFixed(1)} km away but in pincode ${best.code || '-'} (record ${pin || '-'})${best.dCentre != null ? `, ${best.dCentre.toFixed(1)} km from that pincode's area` : ''}`, place: best }); continue; }
  res.push({ r, status: 'moved', why: `pin is ${best.dist.toFixed(1)} km from Google place "${best.p.displayName?.text}" (${best.p.formattedAddress}); place matches by ${best.where}`, place: best });
}
// A place claimed by pins of different developers, or by two different live pins, is not one project's site.
const byPlace = new Map();
res.filter((x) => x.status === 'moved').forEach((x) => byPlace.set(x.place.p.id, [...(byPlace.get(x.place.p.id) || []), x]));
const okPlace = new Map(); res.filter((x) => x.status === 'ok').forEach((x) => okPlace.set(x.place.p.id, x));
for (const [id, list] of byPlace) {
  const other = okPlace.get(id);
  const devs = new Set(list.map((x) => brand(x.r.d.developer_name).join(' ')));
  if (devs.size > 1 || (other && brand(other.r.d.developer_name).join(' ') !== [...devs][0])) {
    list.forEach((x) => { x.status = 'review'; x.why = `same Google place as another developer's live pin (${[...list, other].filter(Boolean).map((y) => y.r.title).join(' / ')})`; });
  }
}

const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
writeFileSync(path.join(OUTDIR, 'LIVE-PIN-CHECK.csv'), ['pin_number,pin_title,city,status,detail,pin_lat,pin_lng,google_lat,google_lng,google_maps',
  ...res.map((x) => [x.r.num, x.r.title, x.r.d.city, x.status, x.why, x.r.lat, x.r.lng, x.place?.p.location.latitude ?? '', x.place?.p.location.longitude ?? '', x.place?.p.googleMapsUri ?? ''].map(q).join(','))].join('\n') + '\n');
const tally = res.reduce((a, x) => ((a[x.status] = (a[x.status] || 0) + 1), a), {});
console.log({ live_scraped_pins: rows.length, ...tally });
if (!APPLY) { console.log('Dry run - see LIVE-PIN-CHECK.csv'); await db.end(); process.exit(0); }

// --only 425,794: apply just these pin numbers (moves checked by eye; the rest of the dry run is left as is).
const ONLY = process.argv.includes('--only') ? new Set(process.argv[process.argv.indexOf('--only') + 1].split(',').map(Number)) : null;
const moves = res.filter((x) => x.status === 'moved' && (!ONLY || ONLY.has(Number(x.r.num))));
writeFileSync(path.join(BK, `before-${RUN.replace(/[:.]/g, '-')}.json`), JSON.stringify(moves.map((x) => ({ sid: x.r.sid, pid: x.r.pid, pin_id: x.r.pin_id,
  pin: { lat: x.r.lat, lng: x.r.lng }, project: { lat: x.r.plat, lng: x.r.plng }, data: x.r.d }))));
let n = 0;
for (const x of moves) {
  const { latitude: lat, longitude: lng } = x.place.p.location;
  await db.query('BEGIN');
  await db.query(`UPDATE pins SET doc = doc || jsonb_build_object('lat', $2::float, 'lng', $3::float, 'updated_at', $4::text) WHERE id = $1`, [x.r.pin_id, lat, lng, RUN]);
  await db.query(`UPDATE projects SET doc = doc || jsonb_build_object('lat', $2::float, 'lng', $3::float) WHERE id = $1`, [x.r.pid, lat, lng]);
  const data = { ...x.r.d, lat, lng, pin_check: 'verified', pin_reason: `Moved to Google Maps place "${x.place.p.displayName?.text}" (${x.place.p.formattedAddress}); ${x.why}.` };
  await db.query(`UPDATE scraped_projects SET doc = doc || jsonb_build_object('data', $2::jsonb, 'live_pin_check', $3::jsonb) WHERE id = $1`,
    [x.r.sid, JSON.stringify(data), JSON.stringify({ moved_at: RUN, from: { lat: x.r.lat, lng: x.r.lng }, to: { lat, lng }, place_id: x.place.p.id, google_maps: x.place.p.googleMapsUri })]);
  await db.query('COMMIT');
  n++;
  appendFileSync(LOG, [x.r.sid, x.r.d.project_name, 'pin.lat,lng (live map)', `${x.r.lat},${x.r.lng}`, `${lat},${lng}`, x.place.p.googleMapsUri, 'google_maps_places', 'high', RUN, 'saved'].map(q).join(',') + '\n');
}
console.log(`Moved ${n} pins. Undo with --revert.`);
await db.end();
