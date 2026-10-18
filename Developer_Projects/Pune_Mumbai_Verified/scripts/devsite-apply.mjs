// Pune + Mumbai: puts facts from developers' OWN project pages on MahaRERA rows of Scraped data (approved rule, 18 Oct 2026).
//
//   node --env-file=.env Developer_Projects/Pune_Mumbai_Verified/scripts/devsite-apply.mjs            dry run (report only)
//   node --env-file=.env Developer_Projects/Pune_Mumbai_Verified/scripts/devsite-apply.mjs --apply
//   node --env-file=.env Developer_Projects/Pune_Mumbai_Verified/scripts/devsite-apply.mjs --revert   undo the last --apply
//
// Input: cache/devsites/<host>.json (dev-crawl.js). For every project page on a developer's site that shows 1-4 MahaRERA numbers:
//   1. registry row: the existing scraped_projects row with that number (reused), else the official MahaRERA listing
//      ("Search Project" by registration no., public, no CAPTCHA) -> a NEW row, only for Pune / Mumbai Suburban / Mumbai City;
//   2. location (new rows): the promoter-declared registry point, "verified" only if inside the district, inside the
//      pincode's OpenStreetMap boundary (<= 1 km), >= 4 decimals and not the same point as another promoter's project;
//   3. identity: the registry project name must share a distinctive word with the developer page; the promoter gets the
//      brand's logo (alias) because the brand's own site shows that RERA number;
//   4. enrichment (Pending Review, source_type developer_official_site): BHK from the page title/description, possession
//      date + the exact sentence, page URL, address. Units / land / cost -> pending_fields. Nothing is invented.
// Rows that already have an enrichment are never touched. `original` is never changed. Nothing is published.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(ROOT, '..', '..');
const { parsePage } = require(path.join(REPO, 'Developer_Projects', 'Sources', 'scripts', 'parse.js'));
const APPLY = process.argv.includes('--apply'), REVERT = process.argv.includes('--revert');
// --no-lookup: only existing rows. --max-lookups=N: at most N MahaRERA listing look-ups (default 60), 1 retry each,
// stop after 5 unanswered in a row - the registry is slow and must not be hammered.
const NO_LOOKUP = process.argv.includes('--no-lookup');
const MAX_LOOKUPS = Number((process.argv.find((a) => a.startsWith('--max-lookups=')) || '=60').split('=')[1]);
let lookups = 0, unanswered = 0;
const RUN = new Date().toISOString(), TODAY = RUN.slice(0, 10);
const CACHE = path.join(ROOT, 'cache'); const LOOK = path.join(CACHE, 'maharera', 'lookup'); const RUNS = path.join(CACHE, 'devsite-runs');
const PIN_DIR = path.join(REPO, 'migration', 'backup', 'scraped-enrichment-cache', 'osm-pincodes');
[LOOK, RUNS, PIN_DIR].forEach((d) => mkdirSync(d, { recursive: true }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nk = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const plan = JSON.parse(readFileSync(path.join(ROOT, 'research', 'devsite-brands.json'), 'utf8'));

const url = new URL(process.env.DATABASE_URL); url.searchParams.delete('sslmode');
const db = new pg.Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false }, query_timeout: 180000 });
await db.connect();

if (REVERT) {
  const f = readdirSync(RUNS).filter((x) => x.startsWith('applied-')).sort().at(-1); if (!f) throw new Error('Nothing to revert');
  const run = JSON.parse(readFileSync(path.join(RUNS, f), 'utf8'));
  await db.query('BEGIN');
  await db.query('DELETE FROM scraped_projects WHERE id = ANY($1)', [run.inserted]);
  for (const u of run.updated) await db.query('UPDATE scraped_projects SET doc = $2 WHERE id = $1', [u.id, u.before]);
  for (const u of run.developers) await db.query('UPDATE developers SET doc = $2 WHERE id = $1', [u.id, u.before]);
  await db.query('COMMIT'); await db.end();
  console.log(`Reverted ${f}: ${run.inserted.length} rows removed, ${run.updated.length} rows restored, ${run.developers.length} developer entries restored`); process.exit(0);
}

// ---------- developer-site facts ----------
const CONFIG = ['1 BHK', '1.5 BHK', '2 BHK', '2.5 BHK', '3 BHK', '3.5 BHK', '4 BHK', '4.5 BHK', '5 BHK', '5.5 BHK', '6 BHK'];
const GENERIC = new Set('the and by at of in a an phase ph tower towers wing wings building bldg project projects plot plots sector residency residences residence homes home apartment apartments complex co chs society new no part cluster block mumbai pune west east north south road nagar i ii iii iv v vi vii viii ix x 1 2 3 4 5 6 7 8 9 10 11 12 a b c d e f g h'.split(' '));
const words = (s) => nk(s).split(' ').filter((w) => w.length >= 3 && !GENERIC.has(w));
const cand = new Map(); // rera -> best page facts
const siteStats = {};
for (const f of readdirSync(path.join(CACHE, 'devsites'))) {
  const site = JSON.parse(readFileSync(path.join(CACHE, 'devsites', f), 'utf8'));
  const brand = plan.hosts[site.host]; siteStats[site.host] = { brand: brand || '(not in plan)', pages: site.pages.length, numbers: 0 };
  if (!brand) continue;
  for (const p of site.pages) {
    if (p.rera.length > 4) continue; // listing pages
    // A page with several RERA numbers: the date only counts for all of them when the sentence states ONE date and either
    // names no phase / tower / wing / building, or says "Phase 1 and Phase 2" on a page with exactly 2 numbers.
    // Otherwise the date belongs to one phase and stays pending for the others (e.g. "Phase 1 is December 2027").
    const DATE_TOKENS = /\b\d{1,2}[/.-]\d{1,2}[/.-](?:20)?\d{2}\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s,'-]+(?:20)?[2-4]\d\b/gi;
    const oneDate = (t) => new Set((t.match(DATE_TOKENS) || []).map((x) => x.toLowerCase())).size === 1;
    const namesPhase = (t) => /\b(phase|tower|wing|building|bldg|cluster|plot)\s*[-:]?\s*[a-z0-9]{1,3}\b/i.test(t);
    const bothPhases = (t) => /\bphase\s*(1|i)\b[^.]*\b(and|&)\s*phase\s*(2|ii)\b/i.test(t) && !/\bphase\s*([3-9]|iii|iv|v)\b/i.test(t);
    const usable = p.possession.filter((x) => p.rera.length === 1
      || (oneDate(x.text) && (!namesPhase(x.text) || (p.rera.length === 2 && bothPhases(x.text)))));
    const dates = [...new Set(usable.map((x) => x.date))];
    const c = { host: site.host, brand, url: p.url, title: p.title, description: p.description, rera_on_page: p.rera,
      configs: p.bhk.filter((b) => CONFIG.includes(b)), date: dates.length === 1 ? dates[0] : null, dates,
      possession_text: dates.length === 1 ? usable.find((x) => x.date === dates[0]).text : null, address: p.address[0] || null };
    for (const r of p.rera) {
      siteStats[site.host].numbers++;
      const old = cand.get(r), score = (x) => (x.configs.length ? 2 : 0) + (x.date ? 2 : 0) - x.rera_on_page.length * 0.1;
      if (!old || score(c) > score(old)) cand.set(r, c);
    }
  }
}

// ---------- registry rows ----------
const existing = new Map();
for (const r of (await db.query(`SELECT id, doc FROM scraped_projects WHERE doc->'original'->>'regulator' = 'MahaRERA'`)).rows) existing.set(r.doc.original.rera_number, r);
const DISTRICTS = { 'Pune': 'Pune', 'Mumbai Suburban': 'Mumbai', 'Mumbai City': 'Mumbai' };

async function lookup(rera) {
  const file = path.join(LOOK, `${rera}.html`);
  if (existsSync(file)) { const h = readFileSync(file, 'utf8'); return parsePage(h, file).find((x) => x.reg_no === rera) || null; }
  if (NO_LOOKUP) return undefined;
  if (lookups >= MAX_LOOKUPS || unanswered >= 5) throw Object.assign(new Error('look-up limit reached'), { stop: true });
  lookups++;
  for (let i = 1; i <= 2; i++) {
    try {
      const res = await fetch(`https://www.maharera.maharashtra.gov.in/projects-search-result?project_name=${rera}`, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130' }, signal: AbortSignal.timeout(60000) });
      if (res.status === 403 || res.status === 429) throw Object.assign(new Error(`HTTP ${res.status}`), { stop: true });
      const h = await res.text();
      if (h.includes('Showing Final')) { unanswered = 0; writeFileSync(file, h); await sleep(3000); return parsePage(h, file).find((x) => x.reg_no === rera) || null; }
    } catch (e) { if (e.stop) throw e; }
    await sleep(6000 * i);
  }
  unanswered++;
  return undefined; // registry did not answer
}

// ---------- location check for new rows (same rules as up-import.mjs) ----------
const inRing = (x, y, ring) => { let ins = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins; } return ins; };
const polys = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);
const inside = (lng, lat, g) => polys(g).some((p) => inRing(lng, lat, p[0]) && !p.slice(1).some((h) => inRing(lng, lat, h)));
function kmToEdge(lng, lat, g) { const kx = 111.32 * Math.cos((lat * Math.PI) / 180), ky = 110.57; let best = Infinity;
  for (const p of polys(g)) for (const ring of p) for (let i = 1; i < ring.length; i++) { const ax = (ring[i - 1][0] - lng) * kx, ay = (ring[i - 1][1] - lat) * ky, bx = (ring[i][0] - lng) * kx, by = (ring[i][1] - lat) * ky; const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1))); best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy)); }
  return best; }
const UA_OSM = { 'User-Agent': 'mappingg-admin-location-check/1.0 (associattemarketing@gmail.com)' };
async function pincodeBoundary(pin) {
  const file = path.join(PIN_DIR, `${pin}.json`); if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  await sleep(1100);
  const res = await fetch(`https://nominatim.openstreetmap.org/search?postalcode=${pin}&countrycodes=in&format=json&polygon_geojson=1&limit=3`, { headers: UA_OSM });
  if (!res.ok) throw new Error(`Nominatim ${pin}: HTTP ${res.status}`);
  const hit = (await res.json()).find((x) => x.type === 'postal_code' && /Polygon/.test(x.geojson?.type || '')) || null;
  const out = hit ? { pin, osm: `${hit.osm_type}/${hit.osm_id}`, geojson: hit.geojson } : { pin, missing: true };
  writeFileSync(file, JSON.stringify(out)); return out;
}
async function reverse(lat, lng) {
  const file = path.join(PIN_DIR, `rev-${lat.toFixed(5)}_${lng.toFixed(5)}.json`); if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  await sleep(1100);
  const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=17&addressdetails=1`, { headers: UA_OSM });
  if (!res.ok) throw new Error(`Nominatim reverse: HTTP ${res.status}`);
  const out = await res.json(); writeFileSync(file, JSON.stringify(out)); return out;
}
const ptKey = (lat, lng) => `${Number(lat).toFixed(4)},${Number(lng).toFixed(4)}`;
const promotersAt = new Map();
for (const r of existing.values()) { const d = r.doc.data; if (d.lat != null) { const k = ptKey(d.lat, d.lng); if (!promotersAt.has(k)) promotersAt.set(k, new Set()); promotersAt.get(k).add(nk(d.developer_name)); } }
const decimals = (n) => (String(n).split('.')[1] || '').length;
async function locate(r, districtLabel) {
  const lat = Number(r.lat), lng = Number(r.lng);
  if (!r.lat || !r.lng || !Number.isFinite(lat)) return { pin_check: 'no_coordinates', pin_reason: 'MahaRERA listing shows no map point.' };
  const base = { lat, lng };
  if (decimals(r.lat) < 4 || decimals(r.lng) < 4) return { ...base, pin_check: 'approximate', pin_reason: 'MahaRERA point is too coarse (fewer than 4 decimals).' };
  const others = [...(promotersAt.get(ptKey(lat, lng)) || [])].filter((p) => p !== nk(r.promoter));
  if (others.length) return { ...base, pin_check: 'approximate', pin_reason: `Same point (${ptKey(lat, lng)}) as another promoter's project - an area pin, not the site.` };
  const a = (await reverse(lat, lng)).address || {};
  const where = [a.state_district, a.county, a.city, a.state].filter(Boolean).join(', ');
  const want = districtLabel === 'Pune' ? /pune/i : /mumbai/i;
  if (!want.test(where) || !/maharashtra/i.test(a.state || '')) return { ...base, pin_check: 'mismatch', pin_reason: `MahaRERA point is in ${where || 'an unknown place'} on OpenStreetMap, not ${districtLabel}.` };
  if (/^\d{6}$/.test(r.pincode || '')) {
    const b = await pincodeBoundary(r.pincode);
    if (!b.missing) {
      const inPin = inside(lng, lat, b.geojson), edge = inPin ? 0 : kmToEdge(lng, lat, b.geojson);
      if (!inPin && edge > 1) return { ...base, pin_check: 'mismatch', pin_reason: `MahaRERA point is ${edge.toFixed(1)} km outside pincode ${r.pincode}.` };
      return { ...base, pin_check: 'verified', pin_reason: `Official MahaRERA point (declared by the promoter); inside pincode ${r.pincode} (OpenStreetMap ${b.osm}${inPin ? '' : `, ${edge.toFixed(1)} km from its edge`}); in ${districtLabel}; not shared with another promoter's project.` };
    }
  }
  // No pincode boundary in OpenStreetMap: the postcode OpenStreetMap gives at the point must equal the registry pincode.
  if (/^d{6}$/.test(r.pincode || '') && String(a.postcode || '').replace(/s/g, '') === r.pincode) return { ...base, pin_check: 'verified', pin_reason: `Official MahaRERA point (declared by the promoter); OpenStreetMap postcode at the point is ${r.pincode}, same as the registry; in ${districtLabel}; not shared with another promoter's project.` };
  return { ...base, pin_check: 'unconfirmed', pin_reason: `In ${districtLabel} on OpenStreetMap, but OpenStreetMap gives postcode ${a.postcode || '(none)'} at the point and has no boundary for pincode ${r.pincode || '(none)'} - check by hand.` };
}

// ---------- logo entries ----------
const devRows = (await db.query('SELECT id, doc FROM developers')).rows;
const devByName = new Map(devRows.map((r) => [nk(r.doc.name), r]));
const logoOf = new Map(); for (const r of devRows) if (r.doc.logo) for (const n of [r.doc.name, ...(r.doc.aliases || [])]) logoOf.set(nk(n), r.doc.name);

// ---------- build ----------
const out = [], inserts = [], updates = [], aliasAdds = new Map(), skipped = [];
let stop = false;
const ordered = [...cand].sort((a, b) => (existing.has(b[0]) ? 1 : 0) - (existing.has(a[0]) ? 1 : 0) || (b[1].date ? 1 : 0) - (a[1].date ? 1 : 0));
for (const [rera, c] of ordered) {
  const row = existing.get(rera);
  let d, isNew = false, listing = null;
  if (row) { d = row.doc.data; if (!DISTRICTS[d.district] && !['Pune', 'Mumbai'].includes(d.city)) { skipped.push({ rera, why: `existing row is ${d.city}` }); continue; } }
  else {
    if (!c.configs.length || !c.date) { skipped.push({ rera, why: 'not in Scraped data; developer page lacks BHK or possession date (not looked up)' }); continue; }
    if (stop) { skipped.push({ rera, why: 'registry lookup stopped' }); continue; }
    try { listing = await lookup(rera); } catch (e) { stop = true; skipped.push({ rera, why: `registry: ${e.message}` }); continue; }
    if (listing === undefined) { skipped.push({ rera, why: 'MahaRERA listing did not answer' }); continue; }
    if (!listing) { skipped.push({ rera, why: 'not found on MahaRERA listing' }); continue; }
    if (!DISTRICTS[listing.district]) { skipped.push({ rera, why: `district ${listing.district} (not Pune / Mumbai)` }); continue; }
    isNew = true;
  }
  const regName = row ? d.project_name : listing.project_name, promoter = row ? d.developer_name : listing.promoter;
  const pageWords = new Set(words(`${c.title} ${c.description} ${decodeURIComponent(c.url)}`));
  // Brand / promoter words ("lodha", "rustomjee") are on every page of that site, so they do not count as a name match.
  const brandWords = new Set(words(`${c.brand} ${promoter} ${c.host.split('.')[0]}`));
  const nameOk = words(regName).filter((w) => !brandWords.has(w)).some((w) => pageWords.has(w));
  const rec = { rera, project: regName, promoter, brand: c.brand, page: c.url, configs: c.configs.join(', '), possession: c.date, possession_dates: c.dates.join(' / '), name_match: nameOk, new_row: isNew };
  if (!nameOk) { skipped.push({ rera, why: `registry name "${regName}" not on the developer page (${c.title})` }); out.push({ ...rec, result: 'skipped: name mismatch' }); continue; }
  if (row?.doc.enrichment) { out.push({ ...rec, result: 'skipped: already enriched' }); continue; }

  // identity -> logo
  const brandRow = devByName.get(nk(c.brand));
  const logoBrand = logoOf.get(nk(promoter));
  if (brandRow?.doc.logo && !logoBrand) { if (!aliasAdds.has(brandRow.id)) aliasAdds.set(brandRow.id, { row: brandRow, names: new Set(), evidence: [] }); aliasAdds.get(brandRow.id).names.add(promoter); aliasAdds.get(brandRow.id).evidence.push(`${rera} on ${c.url}`); }
  else if (logoBrand && nk(logoBrand) !== nk(c.brand)) rec.logo_note = `promoter already uses the logo of "${logoBrand}"`;

  let data, original, id;
  if (isNew) {
    const district = listing.district, city = DISTRICTS[district];
    const loc = await locate(listing, city);
    const key = `India - Maharashtra|${rera}`; id = 'scr_' + createHash('sha1').update(key).digest('hex').slice(0, 16);
    original = { id, key, lat: loc.lat ?? null, lng: loc.lng ?? null, city, state: 'Maharashtra', country: 'India', images: [],
      notes: 'From the official MahaRERA "Search Project" listing (registration no., project, promoter, district, taluka, pincode, map point), looked up by registration number. Registration/completion dates and address are not shown on the listing.',
      status: 'Registered (MahaRERA listing)', status_category: 'Registered - current status not confirmed', address: null, pincode: listing.pincode || null,
      district, locality: listing.location || null, extension: listing.has_extension_cert === 'Yes' ? 'Yes' : 'No', pin_check: loc.pin_check, pin_reason: loc.pin_reason,
      regulator: 'MahaRERA', image_note: 'No project images in the official regulator listings.', portal_seq: listing.portal_id ? Number(listing.portal_id) : null,
      source_url: `https://www.maharera.maharashtra.gov.in/projects-search-result?project_name=${rera}`, project_url: listing.detail_url || null,
      rera_number: rera, rera_prefix: rera.slice(0, 2), valid_up_to: null, verified_on: TODAY, jurisdiction: 'India - Maharashtra', project_name: listing.project_name,
      project_type: null, secondary_id: null, verification: 'Partially Verified', approval_date: null, developer_name: listing.promoter,
      registration_date: null, revised_completion: null, original_completion: null, source_last_modified: listing.last_modified || null, nclt_proposed_completion: null };
    data = { ...original };
    rec.pin_check = loc.pin_check; rec.pin_reason = loc.pin_reason;
    if (loc.lat != null) { const k = ptKey(loc.lat, loc.lng); if (!promotersAt.has(k)) promotersAt.set(k, new Set()); promotersAt.get(k).add(nk(listing.promoter)); }
  } else { id = row.id; data = { ...d }; rec.pin_check = d.pin_check; }

  const fields = Object.fromEntries(Object.entries({
    configurations: c.configs.length ? c.configs.join(', ') : null, proposed_completion: c.date, possession_text: c.possession_text,
    developer_project_page: c.url, rera_on_official_page: true, rera_numbers_on_page: c.rera_on_page.join(', '),
    developer_brand: c.brand, full_address: c.address,
  }).filter(([, v]) => v != null && v !== ''));
  const data_filled = {};
  if (c.address && !data.address) { data.address = c.address; data_filled.address = { old: null, new: c.address, source: c.url }; }
  const enrichment = { review_status: 'Pending Review', verification: 'Developer website (official) + MahaRERA listing', enriched_at: RUN, enriched_by: 'pune-mumbai devsite-apply',
    source_type: 'developer_official_site', sources: [c.url, data.source_url].filter(Boolean),
    source_note: `Facts from ${c.host} (the developer's own project page, which shows ${rera}); registry identity and map point from the MahaRERA listing. Checked ${TODAY}.`,
    fields, updated_fields: Object.keys(fields), review_required: [], pending_fields: ['total_units', 'land_area', 'project_cost', 'unit_mix', 'carpet_area'],
    pending_reason: 'Only on the MahaRERA project page, which needs a CAPTCHA/login - not collected.', data_filled };
  rec.result = isNew ? 'new row + enrichment' : 'enrichment on existing row';
  out.push(rec);
  if (isNew) inserts.push({ id, doc: { id, original, data, enrichment, imported_at: RUN, dataset_generated: RUN, deleted: false, added_by: 'devsite-apply' } });
  else updates.push({ id, before: row.doc, doc: { ...row.doc, data, enrichment } });
}

// ---------- readiness (same rule as lib/scraped.ts readyGaps for developer-site rows) ----------
const logoAfter = new Set(logoOf.keys()); for (const a of aliasAdds.values()) for (const n of a.names) logoAfter.add(nk(n));
const ready = (doc) => { const d = doc.data, f = doc.enrichment.fields;
  return !!f.configurations && !!f.proposed_completion && f.proposed_completion >= TODAY && ['verified', 'manual'].includes(d.pin_check) && logoAfter.has(nk(d.developer_name))
    && !!d.pincode && !!d.project_name && !!d.developer_name && !!d.rera_number && !!d.locality && !/Lapsed|Withdrawn|Revoked|Transferred|Superseded|Dereg|default on QPR/i.test(d.status_category || ''); };
const all = [...inserts, ...updates];
for (const o of out) { const x = all.find((y) => y.doc.data.rera_number === o.rera); if (x) o.go_live_ready = ready(x.doc) ? 'YES' : 'no'; }
const by = (c) => all.filter((x) => x.doc.data.city === c);
console.table(siteStats);
console.log(JSON.stringify({ candidates: cand.size, new_rows: inserts.length, enriched_existing: updates.length, alias_entries: aliasAdds.size,
  ready_total: all.filter((x) => ready(x.doc)).length, ready_pune: by('Pune').filter((x) => ready(x.doc)).length, ready_mumbai: by('Mumbai').filter((x) => ready(x.doc)).length,
  skipped: skipped.length, skipped_reasons: skipped.reduce((a, s) => { const k = s.why.replace(/".*"|\(.*\)/g, '…'); a[k] = (a[k] || 0) + 1; return a; }, {}) }, null, 1));
writeFileSync(path.join(ROOT, `devsite-report-${TODAY}.json`), JSON.stringify({ run: RUN, records: out, skipped, aliases: [...aliasAdds.values()].map((a) => ({ entry: a.row.doc.name, names: [...a.names], evidence: a.evidence })) }, null, 1));
if (!APPLY) { console.log('Dry run - nothing written. Report:', `devsite-report-${TODAY}.json`); await db.end(); process.exit(0); }

const stamp = RUN.replace(/[:.]/g, '-');
const devUpdates = [...aliasAdds.values()].map((a) => ({ id: a.row.id, before: a.row.doc, doc: { ...a.row.doc, aliases: [...(a.row.doc.aliases || []), ...a.names], updated_at: RUN } }));
writeFileSync(path.join(RUNS, `applied-${stamp}.json`), JSON.stringify({ inserted: inserts.map((x) => x.id), updated: updates.map((u) => ({ id: u.id, before: u.before })), developers: devUpdates.map((u) => ({ id: u.id, before: u.before })) }));
await db.query('BEGIN');
let ins = 0;
for (let i = 0; i < inserts.length; i += 100) ins += (await db.query(`INSERT INTO scraped_projects (id, doc) SELECT e->>'id', e->'doc' FROM jsonb_array_elements($1::jsonb) e ON CONFLICT (id) DO NOTHING`, [JSON.stringify(inserts.slice(i, i + 100))])).rowCount;
let upd = 0;
for (const u of updates) upd += (await db.query(`UPDATE scraped_projects SET doc = $2 WHERE id = $1 AND doc->'enrichment' IS NULL`, [u.id, u.doc])).rowCount;
for (const u of devUpdates) await db.query('UPDATE developers SET doc = $2 WHERE id = $1', [u.id, u.doc]);
await db.query('COMMIT'); await db.end();
console.log(`Saved: ${ins} new rows, ${upd} rows enriched, ${devUpdates.length} developer entries got promoter aliases. Revert with --revert.`);
