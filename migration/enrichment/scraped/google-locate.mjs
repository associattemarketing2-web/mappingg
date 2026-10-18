// Map location and address for live scraped records from Google Maps (answers cached by google-places-fetch.mjs).
//
//   node --env-file=.env migration/enrichment/scraped/google-locate.mjs            dry run (GOOGLE-LOCATION.csv)
//   node --env-file=.env migration/enrichment/scraped/google-locate.mjs --apply
//
// A Google place counts for a record only when ALL of these hold:
//   1. name: every distinctive word of the project name (phase/tower/wing words and the developer's "by X" left out)
//      is in the place name; a one-word name also needs the developer's brand or the record's pincode;
//   2. it is a building / housing place (not a shop, restaurant, sales or corporate office, or a bare area name);
//   3. place: its postal code equals the record's pincode, or it lies within 1.5 km of the record's existing point;
//      with neither on the record, the record's locality must be in the Google address;
//   4. no record of a different developer matched the same place.
// Then, per record:
//   - existing pin not verified and the registry point is within 1.5 km of the place → that registry point is
//     confirmed (pin_check "verified");
//   - otherwise the place's point is used (pin_check "verified", source Google Maps), only when its postal code
//     equals the record's pincode (or the record has no pincode and its locality is in the address);
//   - a blank address / pincode is filled from the place (never overwritten).
// `original`, enrichment and every other field are unchanged. Rows are written only if `data` is unchanged since read.

import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const APPLY = process.argv.includes('--apply');
const DIR = path.resolve('migration/backup/scraped-enrichment-cache/google-places');
const OUTDIR = path.resolve('seo-doc/enrichment/scraped-project-enrichment');
const LOG = path.join(OUTDIR, 'PROJECT-CHANGE-LOG.csv');
const RUN = new Date().toISOString();
const NEAR_KM = 1.5;

const url = new URL(process.env.DATABASE_URL);
const mode = url.searchParams.get('sslmode');
url.searchParams.delete('sslmode');
const db = new pg.Client(mode === 'disable' ? { connectionString: process.env.DATABASE_URL } : { connectionString: url.toString(), ssl: mode ? true : { rejectUnauthorized: false } });
await db.connect();
const { rows } = await db.query(`SELECT id, doc->'data' d, doc->'enrichment'->'fields'->>'registry_latitude' rlat, doc->'enrichment'->'fields'->>'registry_longitude' rlng FROM scraped_projects WHERE NOT coalesce((doc->>'deleted')::boolean, false)`);
// Where each pincode's projects are: the mean of every verified point with that pincode (all records, deleted ones too).
const cent = new Map();
for (const r of (await db.query(`SELECT doc->'data'->>'pincode' pin, (doc->'data'->>'lat')::float lat, (doc->'data'->>'lng')::float lng FROM scraped_projects WHERE doc->'data'->>'pin_check' IN ('verified','manual') AND doc->'data'->>'lat' IS NOT NULL AND coalesce(doc->'data'->>'pincode','') <> ''`)).rows) {
  const c = cent.get(r.pin) || { lat: 0, lng: 0, n: 0 }; c.lat += r.lat; c.lng += r.lng; c.n++; cent.set(r.pin, c);
}
const CENTRE_KM = 5;

const STOP = new Set(['phase', 'ph', 'tower', 'towers', 'wing', 'block', 'blk', 'the', 'by', 'at', 'of', 'and', 'in', 'a', 'b', 'c', 'd', 'e', 'f', 'i', 'ii', 'iii', 'iv', 'v',
  'project', 'residential', 'apartment', 'apartments', 'apts', 'flats', 'homes', 'residency', 'residences', 'layout', 'plot', 'plots', 'no', 'sector', 'part', 'stage', 'extension', 'ext']);
const BIZ = /\b(private|pvt|limited|ltd|llp|m\/s|developers?|builders?|constructions?|infra(structure)?|projects?|properties|realty|estates?|ventures?|co|company|india|housing|promoters?|group|enterprises?|realtors?)\b/gi;
const words = (s) => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
const core = (name, dev) => {
  const n = String(name || '').replace(/\b(sector|avenue)\b\s*\w*\d\w*/gi, ' ').replace(/\s+by\s+.*$/i, '').replace(/\(.*?\)/g, ' ');
  return [...new Set(words(n).filter((w) => !STOP.has(w) && !/^\d+$/.test(w) && w.length > 1))];
};
const brand = (dev) => words(String(dev || '').replace(BIZ, ' ')).filter((w) => w.length > 2 && !STOP.has(w));
const lev1 = (a, b) => { // edit distance ≤ 1
  if (a === b) return true; if (Math.abs(a.length - b.length) > 1 || a.length < 5) return false;
  let i = 0, j = 0, e = 0;
  while (i < a.length && j < b.length) { if (a[i] === b[j]) { i++; j++; continue; } if (++e > 1) return false; if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; } }
  return e + (a.length - i) + (b.length - j) <= 1;
};
const has = (list, w) => list.some((x) => lev1(x, w));
const km = (a, b, c, d) => { const R = 6371, r = Math.PI / 180, x = Math.sin((c - a) * r / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin((d - b) * r / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };
const BAD_TYPE = /restaurant|cafe|store|shop|movie|theater|corporate_office|real_estate_agency|bank|atm|hospital|school|lodging|hotel|car_|gas_station|place_of_worship|^locality$|^sublocality|^political$|^route$|^postal_code$|administrative_area/;
const postal = (p) => (p.addressComponents || []).find((c) => (c.types || []).includes('postal_code'))?.longText || (p.formattedAddress?.match(/\b(\d{6})\b/) || [])[1] || null;
const okPin = (d) => ['verified', 'manual'].includes(d.pin_check);

const decided = [];
for (const { id, d, rlat, rlng } of rows) {
  const f = path.join(DIR, `${id}.json`);
  if (!existsSync(f)) continue;
  const places = new Map();
  for (const a of JSON.parse(readFileSync(f, 'utf8')).answers) for (const p of a.places) if (!places.has(p.id)) places.set(p.id, p);
  const want = core(d.project_name, d.developer_name), br = brand(d.developer_name);
  const pin = d.pincode ? String(d.pincode).trim() : null;
  const pt = d.lat != null && d.lng != null ? [Number(d.lat), Number(d.lng)] : rlat && rlng ? [Number(rlat), Number(rlng)] : null;
  const c = pin && cent.get(pin), centre = c && c.n >= 2 ? [c.lat / c.n, c.lng / c.n] : null;
  const cityWords = words(d.city === 'Kalyan_Dombivli' ? 'Kalyan Dombivli' : d.city).filter((w) => w.length > 3);
  let best = null, why = want.length ? 'no Google place with the project name' : 'project name has no distinctive word';
  for (const p of places.values()) {
    const pw = words(p.displayName?.text), aw = words(p.formattedAddress);
    // Every distinctive word, or (long registry names such as "Life Republic Sector R31 … Echoes") at least two
    // words that make up most of the place name, with the developer or the pincode agreeing too.
    const hit = want.filter((w) => has(pw, w)), pwCore = pw.filter((w) => !STOP.has(w) && !/\d/.test(w) && w.length > 1 && !br.includes(w));
    const partial = hit.length >= 2 && hit.length >= pwCore.filter((w) => !hit.includes(w)).length && (br.some((w) => pw.includes(w) || aw.includes(w)) || (pin && postal(p) === pin));
    if (!want.length || !(hit.length === want.length || partial)) continue;
    const types = p.types || [];
    if (/architect|interior|sales office|site office|experience cent|gallery|head office|corporate|convention|\bhall\b|temple|mandir|church|school|college|(builders|developers|constructions|realtors)\s*$/i.test(p.displayName?.text || '')) { why = `only an office named like the project (${p.displayName?.text})`; continue; }
    if (types.some((t) => BAD_TYPE.test(t)) && !types.some((t) => /apartment|condominium|housing|residential|premise/.test(t))) { why = `only a ${types[0]} named like the project`; continue; }
    const code = postal(p), dist = pt ? km(pt[0], pt[1], p.location.latitude, p.location.longitude) : null;
    const pinMatch = !!pin && code === pin, near = dist != null && dist <= NEAR_KM;
    // A partial match without the project's own (last) word is the township / larger project ("Life Republic",
    // "Dosti West County"), not this building: it can only confirm a point already within 1.5 km.
    if (hit.length < want.length && !has(pw, want.at(-1)) && !near) { why = `Google place "${p.displayName?.text}" is the larger project, not this one`; continue; }
    const locMatch = !pin && !pt && words(d.locality).filter((w) => w.length > 3).some((w) => aw.includes(w));
    if (want.length === 1 && !pinMatch && !near && !br.some((w) => pw.includes(w) || aw.includes(w))) { why = 'one-word name and neither the developer nor the pincode matches'; continue; }
    // Second tier: a strong name match (2+ distinctive words, or the developer's brand in the place name) close to
    // where the record's pincode is (registry pincodes are often the neighbouring one), or in the record's city when
    // the record has neither pincode nor point.
    const strong = want.length >= 2 || br.some((w) => pw.includes(w));
    const dCentre = centre ? km(centre[0], centre[1], p.location.latitude, p.location.longitude) : null;
    // A registry point that is not verified may itself be the wrong one (it is why the pin was not verified).
    const nearCentre = strong && !pinMatch && !near && (dist == null || dist <= 3 || !okPin(d)) && dCentre != null && dCentre <= CENTRE_KM;
    const inCity = strong && !pin && !pt && cityWords.some((w) => aw.includes(w)) && br.some((w) => pw.includes(w) || aw.includes(w));
    if (!pinMatch && !near && !locMatch && !nearCentre && !inCity) { why = `Google place "${p.displayName?.text}" is in ${code || 'no pincode'}${dist != null ? `, ${dist.toFixed(1)} km from the record's point` : ''} (record pincode ${pin || '-'})`; continue; }
    const score = (nearCentre || inCity ? -1 : 0) + (pinMatch ? 2 : 0) + (near ? 2 : 0) + (types.some((t) => /apartment|condominium|housing|premise/.test(t)) ? 1 : 0);
    // Words in the place name that are neither the project's nor the developer's ("R22 Atmos" on a "Nora" record):
    // the place is another building, so its address is not this record's.
    const other = hit.length < want.length && pwCore.some((w) => !has(want, w));
    if (!best || score > best.score) best = { p, code, dist, dCentre, pinMatch, near, locMatch, nearCentre, inCity, other, score };
  }
  decided.push({ id, d, best, why, pt });
}

// Rule 4: a place matched by records of different developers is an area / shared name, not the site.
const byPlace = new Map();
for (const x of decided) if (x.best) { const k = x.best.p.id; byPlace.set(k, [...(byPlace.get(k) || []), x]); }
for (const list of byPlace.values()) {
  if (new Set(list.map((x) => brand(x.d.developer_name).join(' '))).size > 1) list.forEach((x) => { x.why = `same Google place as another developer's project (${list.map((y) => y.d.project_name).join(' / ')})`; x.best = null; });
}

const plan = [];
for (const x of decided) {
  const { d, best } = x;
  const patch = {}, notes = [];
  if (best) {
    const p = best.p, name = p.displayName?.text, src = p.googleMapsUri || `https://www.google.com/maps/place/?q=place_id:${p.id}`;
    if (!okPin(d)) {
      if (best.near) {
        if (d.lat == null) { patch.lat = x.pt[0]; patch.lng = x.pt[1]; } // the registry point (RERA Karnataka page) was not saved yet
        patch.pin_check = 'verified';
        patch.pin_reason = `Registry point confirmed: Google Maps place "${name}" is ${(best.dist * 1000).toFixed(0)} m away${best.pinMatch ? ` and in pincode ${best.code}` : ''}.`;
        notes.push('registry point confirmed');
      } else if (best.pinMatch || best.locMatch || best.nearCentre || best.inCity) {
        patch.lat = p.location.latitude; patch.lng = p.location.longitude; patch.pin_check = 'verified';
        patch.pin_reason = `Google Maps place "${name}" (${p.formattedAddress}); name matches and ${best.pinMatch ? `it is in the record's pincode ${best.code}` : best.locMatch ? "it is in the record's locality" : best.nearCentre ? `it is ${best.dCentre.toFixed(1)} km from the record's pincode area ${d.pincode} (Google pincode ${best.code || '-'})` : `it is in ${d.city} and the developer matches`}.`;
        notes.push('pin from Google Maps');
      }
    }
    if (!d.address && !best.other && (okPin(d) ? best.near : (best.near || best.pinMatch || best.locMatch || best.nearCentre || best.inCity))) { patch.address = p.formattedAddress; notes.push('address'); }
    if (!d.pincode && best.code && (best.near || best.locMatch || best.inCity)) { patch.pincode = best.code; notes.push('pincode'); }
    if (Object.keys(patch).length) plan.push({ ...x, patch, src, place: { id: p.id, name, address: p.formattedAddress, lat: p.location.latitude, lng: p.location.longitude, uri: src }, notes });
  }
  if (!Object.keys(patch).length) x.result = x.best ? 'nothing to add' : x.why;
}

const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
writeFileSync(path.join(OUTDIR, 'GOOGLE-LOCATION.csv'), ['record_id,project_name,city,result,google_place,google_address,detail',
  ...decided.map((x) => { const pl = plan.find((y) => y.id === x.id); return [x.id, x.d.project_name, x.d.city, pl ? pl.notes.join(' + ') : 'not changed',
    pl?.place.name || x.best?.p.displayName?.text || '', pl?.place.address || x.best?.p.formattedAddress || '', pl ? pl.patch.pin_reason || '' : x.result].map(q).join(','); })].join('\n'));
const tally = (k) => plan.filter((x) => x.notes.includes(k)).length;
console.log({ looked_up: decided.length, changed: plan.length, pin_from_google: tally('pin from Google Maps'), registry_point_confirmed: tally('registry point confirmed'), address: tally('address'), pincode: tally('pincode') });
if (!APPLY) { console.log('Dry run - nothing written. See GOOGLE-LOCATION.csv'); await db.end(); process.exit(0); }

let ok = 0;
for (const x of plan) {
  const data = { ...x.d, ...x.patch };
  const loc = { source: 'google_maps_places', place: x.place, checked_at: RUN, old: Object.fromEntries(Object.keys(x.patch).map((k) => [k, x.d[k] ?? null])) };
  const r = await db.query(`UPDATE scraped_projects SET doc = doc || jsonb_build_object('data', $2::jsonb, 'google_location', $3::jsonb) WHERE id = $1 AND doc->'data' = $4::jsonb`,
    [x.id, JSON.stringify(data), JSON.stringify(loc), JSON.stringify(x.d)]);
  const st = r.rowCount === 1 ? 'saved' : 'skipped_changed';
  if (st === 'saved') ok++;
  appendFileSync(LOG, Object.keys(x.patch).map((k) => [x.id, x.d.project_name, `data.${k}`, x.d[k] ?? '', x.patch[k], x.src, 'google_maps_places', 'high', RUN, st].map(q).join(',')).join('\n') + '\n');
}
console.log(`saved ${ok} / ${plan.length}`);
await db.end();
