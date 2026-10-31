// New Mumbai / Pune projects from developers' OWN websites, under the go-live rule the owner approved on 18 Oct 2026
// for MahaRERA (whose project pages need a CAPTCHA): the developer's project page must show the RERA number, the BHK
// types and a possession date; the location must be verified; the developer logo must be in the directory.
//
//   node --env-file=.env Developer_Projects/New500_2026-10-31/scripts/mh-devsite.mjs                 dry run → batches/mh-devsite.json
//   node --env-file=.env Developer_Projects/New500_2026-10-31/scripts/mh-devsite.mjs --apply --batch=1   insert ≤ 50 live-ready rows
//   node --env-file=.env Developer_Projects/New500_2026-10-31/scripts/mh-devsite.mjs --revert --batch=1
//
// Input: developer sites already crawled by Pune_Mumbai_Verified/scripts/dev-crawl.js (cache/devsites + cache/pages).
// Every fact is re-read from the page HTML here; nothing is guessed:
//   RERA number  - MahaRERA format, on a page that names at most 3 registrations (a project page, not a listing)
//   city         - from the registration number's district code (codes learnt from rows already in Mappingg)
//   name         - the page title's project part, which must share a word with the page URL
//   BHK          - "2 & 3 BHK" in the page title / meta description / first heading
//   possession   - a date written in a possession / completion sentence (day-month-year, month-year); a year alone is not used
//   point        - the Google-map embed / link on the page; dropped when the same point is on another project's page
//   locality     - "... in <Locality>, Pune|Mumbai" in the title / description / heading
// Location is "verified" only when the point is in the right district (OpenStreetMap reverse lookup) and within 3 km of
// the locality the page names (OpenStreetMap search). Duplicates: RERA number anywhere in Mappingg (../audit/exclusion.json,
// deleted rows included), or a live pin with the same distinctive name within 2 km.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { reraKey, metres } from './keys.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '..');
const SRC = path.resolve(ROOT, '..', 'Pune_Mumbai_Verified');
const BATCH = Number((process.argv.find((a) => a.startsWith('--batch=')) || '--batch=1').slice(8));
const APPLY = process.argv.includes('--apply'), REVERT = process.argv.includes('--revert');
const TAG = `new500-mh-batch${BATCH}`, SIZE = 50;
const RUN = new Date().toISOString(), TODAY = RUN.slice(0, 10);
const OSM = path.resolve('migration/backup/scraped-enrichment-cache/osm-pincodes'); mkdirSync(OSM, { recursive: true });
const UA = { 'User-Agent': 'mappingg-admin-location-check/1.0 (associattemarketing@gmail.com)' };

const url = new URL(process.env.DATABASE_URL); url.searchParams.delete('sslmode');
const db = new pg.Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false }, query_timeout: 180000 });
await db.connect();
if (REVERT) {
  const r = await db.query(`DELETE FROM scraped_projects WHERE doc->>'added_by' = $1 AND doc->>'submission_id' IS NULL RETURNING id`, [TAG]);
  console.log(`Removed ${r.rowCount} rows of ${TAG} (rows already added to Projects are kept).`); await db.end(); process.exit(0);
}

// ---- what Mappingg already has ----
const ex = JSON.parse(readFileSync(path.join(ROOT, 'audit', 'exclusion.json'), 'utf8'));
const scraped = (await db.query(`SELECT doc->'data'->>'rera_number' r, doc->'data'->>'city' c FROM scraped_projects WHERE doc->'data'->>'regulator' = 'MahaRERA'`)).rows;
const pins = (await db.query(`SELECT doc->>'number' num, doc->>'title' title, (doc->>'lat')::float lat, (doc->>'lng')::float lng FROM pins`)).rows;
const logoKeys = new Map();
for (const d of (await db.query(`SELECT doc->>'name' name, doc->'aliases' a FROM developers WHERE coalesce(doc->>'logo','') <> ''`)).rows) for (const k of [d.name, ...(d.a || [])]) logoKeys.set(nk(k), d.name);
function nk(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }

// District code of a registration number → city, learnt from MahaRERA rows already in Mappingg.
const codeOf = (r) => (/^P5\d{10}$/.test(r) ? r.slice(0, 5) : /^P[RMCP]\d{13}$/.test(r) ? r.slice(2, 6) : null);
const codeCity = new Map();
for (const { r, c } of scraped) { const k = codeOf(r); if (!k || !c) continue; codeCity.set(k, codeCity.has(k) && codeCity.get(k) !== c ? 'mixed' : c); }
const cityOf = (r) => { const c = codeCity.get(codeOf(r)); return c === 'Pune' || c === 'Mumbai' ? c : null; };

// ---- developer pages ----
const brands = JSON.parse(readFileSync(path.join(SRC, 'research', 'devsite-brands.json'), 'utf8')).hosts;
const html = new Map();
for (const f of readdirSync(path.join(SRC, 'cache', 'pages'))) { const c = JSON.parse(readFileSync(path.join(SRC, 'cache', 'pages', f), 'utf8')); if (c.html) html.set(c.url, c.html); }
const dec = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&#0?39;|&rsquo;|&#8217;/g, "'").replace(/&nbsp;/g, ' ').replace(/&ndash;|&#8211;/g, '–').replace(/&#038;/g, '&');
const vis = (h) => dec(String(h || '').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
const meta = (h, n) => dec((String(h).match(new RegExp(`<meta[^>]+(?:name|property)=["']${n}["'][^>]*content=["']([^"']*)`, 'i')) || [])[1] || '');
const tag = (h, t) => vis((String(h).match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)<\\/${t}>`, 'i')) || [])[1] || '').trim();
const RERA = /\b(P[RMCP]\d{13}|P5\d{10})\b/g;

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
/** Dates written in a possession / completion sentence: "31/12/2028", "December 2029", "Dec'29", "December 31, 2029", "31st Dec 2030". */
function possessionDates(text) {
  const out = [];
  for (const m of text.matchAll(/\b(possession|completion date|completion|handover|hand over)\b[^.?!|]{0,90}/gi)) {
    const s = m[0];
    let d = s.match(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](20\d{2})\b/);
    if (d && +d[2] <= 12) { out.push({ date: `${d[3]}-${String(d[2]).padStart(2, '0')}-${String(d[1]).padStart(2, '0')}`, text: s.trim() }); continue; }
    d = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*(?:(\d{1,2})(?:st|nd|rd|th)?,?\s*)?['’]?\s*(20\d{2}|\d{2})\b/i);
    if (d) { const y = d[3].length === 2 ? `20${d[3]}` : d[3]; out.push({ date: `${y}-${String(MONTHS[d[1].toLowerCase().slice(0, 3)]).padStart(2, '0')}${d[2] ? `-${String(d[2]).padStart(2, '0')}` : ''}`, text: s.trim() }); continue; }
    d = s.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*,?\s*(20\d{2})\b/i);
    if (d) out.push({ date: `${d[3]}-${String(MONTHS[d[2].toLowerCase().slice(0, 3)]).padStart(2, '0')}-${String(d[1]).padStart(2, '0')}`, text: s.trim() });
  }
  return out;
}
/** Map points on the page: Google-map embed (!3d lat !2d lng), ?q= / ll= / @lat,lng links, LatLng(lat, lng). */
function mapPoints(h) {
  const pts = [];
  for (const m of String(h).matchAll(/!2d(-?\d+\.\d+)!3d(-?\d+\.\d+)/g)) pts.push([+m[2], +m[1]]);
  for (const m of String(h).matchAll(/(?:[?&](?:q|ll|query|destination)=|@|LatLng\(\s*)(1[89]\.\d{4,})\s*,\s*(7[23]\.\d{4,})/g)) pts.push([+m[1], +m[2]]);
  return pts.filter(([la, ln]) => la > 17.5 && la < 20.5 && ln > 72.5 && ln < 74.5);
}
const BHK = ['1 BHK', '1.5 BHK', '2 BHK', '2.5 BHK', '3 BHK', '3.5 BHK', '4 BHK', '4.5 BHK', '5 BHK', '5.5 BHK', '6 BHK'];
function bhkOf(s) {
  const out = new Set();
  for (const m of String(s).matchAll(/((?:\d(?:\.5)?\s*(?:,|&|and|\/|\+|-|or)?\s*)+)\s*BHK/gi)) for (const n of m[1].match(/\d(?:\.5)?/g) || []) if (BHK.includes(`${n} BHK`)) out.add(`${n} BHK`);
  return [...out].sort();
}
const GENERIC = new Set('the and by at of in a an for sale price prices floor plans plan flats flat apartments apartment homes home residential project projects luxury new launch bhk mumbai pune west east north south road nagar near'.split(' '));
const words = (s) => nk(s).split(' ').filter((w) => w.length >= 3 && !GENERIC.has(w) && !/^\d+$/.test(w));

const NOT_RESIDENTIAL = /commercial|leasing|pre-leased|office[- ]space|shops|showroom|business[- ]square/i;
// A page title that describes the offer instead of naming the project.
const GENERIC_NAME = /bed residences|penthouse for sale|^smart$|plots in|^commercial|^office/i;
// Developers whose site is not in devsite-brands.json, by the name of their entry in the developer directory.
const HOST_BRAND = { 'kalpataru.com': 'Kalpataru', 'ektaworld.com': 'Ekta World', 'lntrealty.com': 'L&T Realty Developers Limited' };
// Names read by hand from the project page (its title only describes the offer); the URL names the project too.
const NAME_FIX = {
  'https://krisala.com/41-luxovert-2-bhk-3-bhk-and-4-bhk-flats-in-tathawade-pune/': '41 Luxovert',
  'https://krisala.com/41-zillenia-phase-2-punawale/': '41 Zillenia Phase 2',
  'https://www.ektaworld.com/ekta-victoria-bandra-west.html': 'Ekta Victoria',
  'https://naiknavare.com/avasa-meadows-fully-serviced-na-plots-in-talegaon-pune': 'Avasa Meadows',
};
const cand = new Map(); // rera → best page
const pointUse = new Map(); // "lat,lng" → set of page project names
for (const f of readdirSync(path.join(SRC, 'cache', 'devsites'))) {
  const site = JSON.parse(readFileSync(path.join(SRC, 'cache', 'devsites', f), 'utf8'));
  for (const p of site.pages) {
    const h = html.get(p.url); if (!h) continue;
    const text = vis(h), rera = [...new Set(text.match(RERA) || [])];
    if (!rera.length || rera.length > 3) continue;
    const title = dec(tag(h, 'title')), desc = meta(h, 'description') || meta(h, 'og:description'), h1 = tag(h, 'h1');
    // residential, still being built: commercial / leasing pages and the developer's "completed" section are left out
    if (NOT_RESIDENTIAL.test(`${p.url} ${title}`) || /\/completed\//i.test(p.url)) continue;
    const slug = decodeURIComponent(new URL(p.url).pathname).split('/').filter(Boolean).pop() || '';
    const brand = brands[site.host] || HOST_BRAND[site.host] || null;
    // project name: the title part that shares a word with the URL (brand words removed)
    const brandW = new Set(words(`${brand || ''} ${site.host.split('.')[0]}`));
    const slugW = words(slug.replace(/[-_]/g, ' ')).filter((w) => !brandW.has(w));
    const part = title.split(/\s+[|–-]\s+|:\s+/).map((s) => s.trim()).find((s) => words(s).some((w) => slugW.includes(w)));
    let name = part ? part.replace(/\b(\d(\.\d)?\s*(&|,|and)?\s*)+BHK.*$/i, '').replace(/\b(flats?|apartments?|homes?)\s+(for sale\s+)?in\b.*$/i, '').replace(/\s+(in|at)\s+[A-Z][\w .]+$/, '')
      .split(/\s*,\s*|\s+-\s+|-\s+\d/)[0].replace(/\s+(in|at)\s+[A-Z][\w .]+$/, '').replace(/\s+(Pune|Mumbai)$/i, '').replace(/^\[official\]\s*/i, '').trim() : null;
    if (NAME_FIX[p.url]) name = NAME_FIX[p.url];
    else if (name && GENERIC_NAME.test(name)) name = null;
    const locM = `${title} | ${desc} | ${h1}`.match(/\b(?:in|at)\s+([A-Z][A-Za-z.]+(?:\s+[A-Z][A-Za-z.]+){0,3}?)\s*,?\s*(?:\((?:East|West)\)|East|West)?\s*,?\s*(?:Pune|Mumbai|Navi Mumbai|Thane)\b/);
    // not a locality: a compass word alone, or a phrase that repeats the project's own name ("Joyville Celestia Hadapsar Annexe")
    if (locM && (/^(east|west|north|south)$/i.test(locM[1]) || (name && words(locM[1]).length > 1 && words(locM[1]).some((w) => words(name).includes(w))))) locM[1] = '';
    const pts = mapPoints(h), dates = possessionDates(text);
    const pin = (text.match(/\b(4[01]\d)\s?(\d{3})\b/) || []).slice(1).join('') || null;
    for (const r of rera) {
      const c = { rera: r, host: site.host, brand, url: p.url, title, name, rera_on_page: rera,
        bhk: bhkOf(`${title} ${desc} ${h1}`), locality: locM && locM[1] ? locM[1].trim() : null, pincode: pin, points: pts,
        // a date counts for this registration if it is the only registration on the page, or the sentence names it
        dates: rera.length === 1 ? dates : dates.filter((d) => d.text.includes(r)) };
      const score = (x) => (x.bhk.length ? 2 : 0) + (x.dates.length ? 2 : 0) + (x.points.length ? 1 : 0) + (x.name ? 1 : 0) - x.rera_on_page.length * 0.1;
      if (!cand.has(r) || score(c) > score(cand.get(r))) cand.set(r, c);
    }
    if (name) for (const [la, ln] of pts) { const k = `${la.toFixed(4)},${ln.toFixed(4)}`; if (!pointUse.has(k)) pointUse.set(k, new Set()); pointUse.get(k).add(nk(name)); }
  }
}

// ---- OpenStreetMap checks (≤ 1 request / second, cached) ----
async function osm(file, u) {
  const f = path.join(OSM, file);
  if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
  await new Promise((r) => setTimeout(r, 1100));
  const res = await fetch(u, { headers: UA }); if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
  const j = await res.json(); writeFileSync(f, JSON.stringify(j)); return j;
}
const DISTRICT = { Pune: /\bpune\b/i, Mumbai: /mumbai/i };
const CITY_PIN = { Pune: /^41[0-2]\d{3}$/, Mumbai: /^400\d{3}$/ };

// ---- validate ----
const out = { live_ready: [], pending: [], rejected: [], duplicates: [] };
for (const c of cand.values()) {
  const city = cityOf(c.rera);
  if (!city) { out.rejected.push({ ...c, reason: 'registration number is not from a Pune or Mumbai district' }); continue; }
  c.city = city;
  if (ex.rera[reraKey(c.rera)]) { out.duplicates.push({ ...c, match: 'RERA number', existing: ex.rera[reraKey(c.rera)].join('; ') }); continue; }
  if (!c.name) { out.rejected.push({ ...c, reason: 'project name not found in the page title' }); continue; }
  const dw = words(c.name).filter((w) => !words(c.brand || '').includes(w));
  const pt = c.points.find(([la, ln]) => (pointUse.get(`${la.toFixed(4)},${ln.toFixed(4)}`)?.size || 0) === 1) || null;
  const twin = dw.length && pins.find((p) => p.title && dw.every((w) => nk(p.title).includes(w)) && (pt == null || p.lat == null || metres(pt, [p.lat, p.lng]) < 2000));
  if (twin) { out.duplicates.push({ ...c, match: 'live pin with the same name nearby', existing: `pin #${twin.num} ${twin.title}` }); continue; }
  const gaps = [];
  if (!c.bhk.length) gaps.push('no BHK types on the page');
  const future = c.dates.map((d) => d.date).filter((d) => d >= TODAY.slice(0, d.length)).sort();
  if (!c.dates.length) gaps.push('no possession date on the page'); else if (!future.length) gaps.push(`possession ${c.dates[0].date} has passed`);
  const logo = logoKeys.get(nk(c.brand)) || null; if (!logo) gaps.push('developer logo not in the directory');
  let loc = { pin_check: 'no_coordinates', pin_reason: 'No map point on the developer page.' };
  if (!c.points.length) gaps.push('no map point on the page');
  else if (!pt) { gaps.push('map point is shared with another project page (template map)'); loc = { pin_check: 'approximate', pin_reason: 'The developer page map point is also used for another project.' }; }
  else {
    const rev = await osm(`rev-${pt[0].toFixed(5)}_${pt[1].toFixed(5)}.json`, `https://nominatim.openstreetmap.org/reverse?lat=${pt[0]}&lon=${pt[1]}&format=json&zoom=17&addressdetails=1`);
    const a = rev.address || {}, where = [a.state_district, a.county, a.city, a.town, a.state].filter(Boolean).join(', ');
    if (!DISTRICT[city].test(where)) { gaps.push(`map point is in ${where || 'an unknown place'}, not ${city}`); loc = { lat: pt[0], lng: pt[1], pin_check: 'mismatch', pin_reason: `Developer page point is in ${where} on OpenStreetMap, not ${city}.` }; }
    else if (!c.locality) { gaps.push('page names no locality to cross-check the point'); loc = { lat: pt[0], lng: pt[1], pin_check: 'unconfirmed', pin_reason: 'Point in the right city, but the page names no locality to check it against.' }; }
    else {
      const places = await osm(`search-mh-${nk(c.locality).replace(/ /g, '_')}_${city}.json`, `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(`${c.locality}, ${city}, Maharashtra`)}&countrycodes=in&format=json&limit=5`);
      const near = (Array.isArray(places) ? places : []).map((p) => metres(pt, [+p.lat, +p.lon]) / 1000);
      const km = near.length ? Math.min(...near) : null;
      if (km == null || km > 3) { gaps.push(km == null ? `locality "${c.locality}" not on OpenStreetMap` : `map point is ${km.toFixed(1)} km from "${c.locality}"`); loc = { lat: pt[0], lng: pt[1], pin_check: 'approximate', pin_reason: km == null ? `Locality "${c.locality}" not found on OpenStreetMap.` : `Point is ${km.toFixed(1)} km from "${c.locality}" named on the page.` }; }
      else loc = { lat: pt[0], lng: pt[1], pin_check: 'verified', osm: a, pin_reason: `Map point on the developer's own project page (${c.url}); in ${city} (OpenStreetMap reverse lookup); ${km.toFixed(1)} km from "${c.locality}" named on the page; not used for any other project.` };
    }
  }
  let pincode = c.pincode && CITY_PIN[city].test(c.pincode) ? c.pincode : null, pinSrc = pincode ? 'developer page' : null;
  if (!pincode && loc.pin_check === 'verified' && CITY_PIN[city].test(loc.osm?.postcode || '')) { pincode = loc.osm.postcode; pinSrc = 'OpenStreetMap at the verified point'; }
  if (!pincode) gaps.push('no pincode');
  const rec = { ...c, city, logo, loc, pincode, pin_source: pinSrc, possession: future[0] || c.dates[0]?.date || null, possession_text: (c.dates.find((d) => d.date === future[0]) || c.dates[0])?.text || null, gaps };
  (gaps.length ? out.pending : out.live_ready).push(rec);
}

const counts = { candidates: cand.size, pune_mumbai: cand.size - out.rejected.filter((x) => /not from a Pune/.test(x.reason)).length,
  duplicates: out.duplicates.length, rejected: out.rejected.length, pending: out.pending.length, live_ready: out.live_ready.length,
  live_ready_by_city: out.live_ready.reduce((m, x) => ((m[x.city] = (m[x.city] || 0) + 1), m), {}),
  pending_gaps: out.pending.flatMap((x) => x.gaps.map((g) => g.replace(/\d+(\.\d+)? km/, 'N km').replace(/"[^"]+"/, '"…"').replace(/in .*?, not/, 'in …, not').replace(/possession \S+ has/, 'possession … has'))).reduce((m, g) => ((m[g] = (m[g] || 0) + 1), m), {}) };
mkdirSync(path.join(ROOT, 'batches'), { recursive: true });
const slim = (x) => ({ rera: x.rera, city: x.city, project_name: x.name, developer: x.brand, locality: x.locality, pincode: x.pincode, lat: x.loc?.lat ?? null, lng: x.loc?.lng ?? null,
  pin_check: x.loc?.pin_check, pin_reason: x.loc?.pin_reason, bhk: (x.bhk || []).join(', '), possession: x.possession, possession_text: x.possession_text, page: x.url, gaps: (x.gaps || []).join('; '), match: x.match, existing: x.existing, reason: x.reason });
writeFileSync(path.join(ROOT, 'batches', 'mh-devsite.json'), JSON.stringify({ generated: RUN, counts, live_ready: out.live_ready.map(slim), pending: out.pending.map(slim), duplicates: out.duplicates.map(slim), rejected: out.rejected.map(slim) }, null, 1));
console.log(JSON.stringify(counts, null, 1));

if (!APPLY) { console.log('Dry run — nothing written.'); await db.end(); process.exit(0); }
const done = new Set((await db.query(`SELECT doc->'data'->>'rera_number' r FROM scraped_projects WHERE doc->>'added_by' LIKE 'new500-mh-%'`)).rows.map((x) => x.r));
// --all: every genuine new project (live-ready and pending), for the team to check and complete by hand.
const ALL = process.argv.includes('--all');
const batch = ALL ? [...out.live_ready, ...out.pending].filter((x) => !done.has(x.rera)) : out.live_ready.filter((x) => !done.has(x.rera)).slice(0, SIZE);
const rows = batch.map((x) => {
  const key = `India - Maharashtra|${x.rera}`, id = 'scr_' + createHash('sha1').update(key).digest('hex').slice(0, 16);
  const original = { id, key, lat: x.loc.lat ?? null, lng: x.loc.lng ?? null, city: x.city, state: 'Maharashtra', country: 'India', images: [],
    notes: `From the developer's own project page (${x.url}), which shows MahaRERA registration ${x.rera}. MahaRERA's project page needs a CAPTCHA, so registry-only facts (units, land, cost) are pending.`,
    status: 'Registered', status_category: 'Registered', address: null, pincode: x.pincode, district: x.city === 'Pune' ? 'Pune' : null, locality: x.locality,
    pin_check: x.loc.pin_check, pin_reason: x.loc.pin_reason, regulator: 'MahaRERA', jurisdiction: 'India - Maharashtra',
    image_note: 'No project images collected.', portal_seq: null, source_url: x.url, project_url: x.url, rera_number: x.rera, rera_prefix: x.rera.slice(0, 2),
    verified_on: TODAY, project_name: x.name, project_type: 'Residential', secondary_id: null, verification: 'Developer website (official)',
    approval_date: null, developer_name: x.logo || x.brand, registration_date: null, original_completion: null, revised_completion: null, valid_up_to: null, extension: null };
  const future = x.possession && x.possession >= TODAY.slice(0, x.possession.length) ? x.possession : null;
  const fields = Object.fromEntries(Object.entries({ configurations: x.bhk.join(', '), proposed_completion: future, possession_text: x.possession_text, developer_project_page: x.url,
    rera_on_official_page: true, rera_numbers_on_page: x.rera_on_page.join(', '), developer_brand: x.brand, pincode: x.pincode }).filter(([, v]) => v != null && v !== ''));
  const enrichment = { review_status: 'Pending Review', verification: 'Developer website (official)', enriched_at: RUN, enriched_by: TAG, source_type: 'developer_official_site',
    sources: [x.url], source_note: `Facts from ${x.host} (the developer's own page shows ${x.rera}). Checked ${TODAY}.${x.gaps.length ? ` To check by hand: ${x.gaps.join('; ')}.` : ''}`, fields, updated_fields: Object.keys(fields),
    review_required: [], pending_fields: [...x.gaps, 'total_units', 'land_area', 'project_cost'], pending_reason: 'Registry-only facts sit behind the MahaRERA CAPTCHA; other gaps are what the developer page does not show.',
    field_sources: { proposed_completion: { source: 'developer_official_site', url: x.url }, configurations: { source: 'developer_official_site', url: x.url } },
    data_filled: x.pin_source && x.pin_source !== 'developer page' ? { pincode: { old: null, new: x.pincode, source: x.pin_source } } : {} };
  return { id, doc: { id, original, data: { ...original }, enrichment, imported_at: RUN, dataset_generated: RUN, deleted: false, added_by: TAG,
    location_source: { source: 'developer_official_site', source_url: x.url, checked_at: RUN } } };
});
let inserted = 0;
for (let i = 0; i < rows.length; i += 50) inserted += (await db.query(`INSERT INTO scraped_projects (id, doc) SELECT e->>'id', e->'doc' FROM jsonb_array_elements($1::jsonb) e ON CONFLICT (id) DO NOTHING`, [JSON.stringify(rows.slice(i, i + 50))])).rowCount;
console.log(`Inserted ${inserted} rows tagged ${TAG} (Pending Review; nothing published).`);
await db.end();
