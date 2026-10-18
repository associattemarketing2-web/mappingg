// Batch builder: developers' OWN project pages (cache/devsites) + the public MahaRERA listing (cache/maharera/lookup)
// -> new Scraped-data rows for the target cities (never Bengaluru), with field-level evidence. Nothing is published.
//
//   node --env-file=.env Developer_Projects/Pune_Mumbai_Verified/scripts/collect-batch.mjs              dry run
//   node --env-file=.env Developer_Projects/Pune_Mumbai_Verified/scripts/collect-batch.mjs --apply      (owner approval needed)
//   node --env-file=.env Developer_Projects/Pune_Mumbai_Verified/scripts/collect-batch.mjs --revert     undo the last --apply
//
// A = complete under the ORIGINAL go-live rule (registry units, land, cost, completion...). B = genuine but pending:
//     shown in "Enriched — Review Pending" with the missing fields listed. C = rejected / duplicate (report only).
// Rules: exact registration number on the developer's own page; MahaRERA identity, district, pincode and map point from
// the official listing; a date shared by several registrations is kept only as project-level possession; points shared by
// different promoters are "approximate"; existing rows (also deleted ones) are never touched - deleted matches go to a
// restore-review list; live pins / Projects with the same RERA number, or a live pin with the same project name in the
// same city, are duplicates. Only new ids are inserted (ON CONFLICT DO NOTHING) - rerunning adds nothing twice.
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
const RUN = new Date().toISOString(), TODAY = RUN.slice(0, 10), BATCH = `collect-${TODAY}`;
const CACHE = path.join(ROOT, 'cache'), RUNS = path.join(CACHE, 'collect-runs'); mkdirSync(RUNS, { recursive: true });
const nk = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const brands = JSON.parse(readFileSync(path.join(ROOT, 'research', 'devsite-brands.json'), 'utf8')).hosts;

const url = new URL(process.env.DATABASE_URL); url.searchParams.delete('sslmode');
const db = new pg.Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false }, query_timeout: 180000 });
await db.connect();
if (REVERT) {
  const f = readdirSync(RUNS).filter((x) => x.startsWith('applied-')).sort().at(-1); if (!f) throw new Error('Nothing to revert');
  const run = JSON.parse(readFileSync(path.join(RUNS, f), 'utf8'));
  const r = await db.query(`DELETE FROM scraped_projects WHERE id = ANY($1) AND doc->>'added_by' LIKE $2`, [run.inserted, run.batch + '%']);
  for (const u of run.developers || []) await db.query('UPDATE developers SET doc = $2 WHERE id = $1', [u.id, u.before]);
  console.log(`Reverted ${f}: ${r.rowCount} rows removed, ${(run.developers || []).length} developer entries restored`); await db.end(); process.exit(0);
}

// ---------- official developer pages ----------
const CONFIG = ['1 BHK', '1.5 BHK', '2 BHK', '2.5 BHK', '3 BHK', '3.5 BHK', '4 BHK', '4.5 BHK', '5 BHK', '5.5 BHK', '6 BHK'];
const GENERIC = new Set('the and by at of in a an phase ph tower towers wing wings building bldg project projects plot plots sector residency residences residence homes home apartment apartments complex co chs society new no part cluster block mumbai pune thane nashik hyderabad west east north south road nagar i ii iii iv v vi vii viii ix x'.split(' '));
const words = (s) => nk(s).split(' ').filter((w) => w.length >= 3 && !GENERIC.has(w) && !/^\d+$/.test(w));
const pages = new Map(); for (const f of readdirSync(path.join(CACHE, 'pages'))) { const c = JSON.parse(readFileSync(path.join(CACHE, 'pages', f), 'utf8')); pages.set(c.url, c.html); }
const vis = (h) => String(h || '').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const cand = new Map();
for (const f of readdirSync(path.join(CACHE, 'devsites'))) {
  const site = JSON.parse(readFileSync(path.join(CACHE, 'devsites', f), 'utf8'));
  for (const p of site.pages) {
    if (p.rera.length > 4) continue; // listing pages
    const t = vis(pages.get(p.url));
    const dates = [...new Set(p.possession.map((x) => x.date))];
    for (const r of p.rera) {
      // Date per registration: one registration on the page, or the page names this registration next to the date.
      const single = p.rera.length === 1 && dates.length === 1;
      const perReg = dates.length >= 1 && dates.find((d) => new RegExp(`${r}[^.]{0,80}(valid|upto|up to|completion|possession)[^.]{0,30}(${d.slice(0, 4)}|/${d.slice(2, 4)}\\b)`, 'i').test(t));
      const c = { host: site.host, brand: brands[site.host] || null, url: p.url, title: p.title, description: p.description, rera_on_page: p.rera,
        configs: p.bhk.filter((b) => CONFIG.includes(b)), date: single ? dates[0] : perReg || null,
        project_level_date: !single && !perReg && dates.length === 1 ? dates[0] : null,
        possession_text: dates.length ? p.possession.find((x) => x.date === (single ? dates[0] : perReg || dates[0]))?.text : null,
        address: p.address[0] || null, map_points: p.map_points || [] };
      const score = (x) => (x.configs.length ? 2 : 0) + (x.date ? 2 : 0) - x.rera_on_page.length * 0.1;
      if (!cand.has(r) || score(c) > score(cand.get(r))) cand.set(r, c);
    }
  }
}

// ---------- everything already known ----------
const allRows = (await db.query(`SELECT id, doc->'original'->>'rera_number' rera, coalesce((doc->>'deleted')::boolean,false) del FROM scraped_projects`)).rows;
const scrapedByRera = new Map(allRows.filter((r) => r.rera).map((r) => [r.rera, r]));
const pins = (await db.query(`SELECT doc->>'number' num, doc->>'title' title, doc->>'rera_number' rera, (doc->>'lat')::float lat, (doc->>'lng')::float lng FROM pins WHERE NOT coalesce((doc->>'hidden')::boolean,false)`)).rows;
const pinByRera = new Map(); for (const p of pins) for (const r of String(p.rera || '').split(/[\s,;]+/).filter(Boolean)) pinByRera.set(r, p);
const projRera = new Set((await db.query(`SELECT jsonb_array_elements_text(coalesce(doc->'rera_numbers','[]'::jsonb)) r FROM projects`)).rows.map((x) => x.r));
const subRera = new Set((await db.query(`SELECT jsonb_array_elements_text(coalesce(doc->'rera_numbers','[]'::jsonb)) r FROM project_submissions`)).rows.map((x) => x.r));
const devRows = (await db.query(`SELECT doc->>'name' name, doc->'aliases' a FROM developers WHERE coalesce(doc->>'logo','') <> ''`)).rows;
const logoOf = new Map(); for (const d of devRows) for (const n of [d.name, ...(d.a || [])]) logoOf.set(nk(n), d.name);
const PIN_DIR = path.join(REPO, 'migration', 'backup', 'scraped-enrichment-cache', 'osm-pincodes'); mkdirSync(PIN_DIR, { recursive: true });
async function reverse(lat, lng) { // OpenStreetMap Nominatim, cached, <= 1 request / second
  const file = path.join(PIN_DIR, `rev-${lat.toFixed(5)}_${lng.toFixed(5)}.json`); if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  await new Promise((r) => setTimeout(r, 1100));
  const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=17&addressdetails=1`, { headers: { 'User-Agent': 'mappingg-admin-location-check/1.0 (associattemarketing@gmail.com)' } });
  if (!res.ok) return {}; const out = await res.json(); writeFileSync(file, JSON.stringify(out)); return out;
}
const km = (a, b, c, d) => 6371 * Math.hypot(((d - b) * Math.PI / 180) * Math.cos(((a + c) / 2) * Math.PI / 180), (c - a) * Math.PI / 180);
const ptKey = (lat, lng) => `${Number(lat).toFixed(4)},${Number(lng).toFixed(4)}`;
const promotersAt = new Map();
for (const r of (await db.query(`SELECT doc->'data'->>'lat' lat, doc->'data'->>'lng' lng, doc->'data'->>'developer_name' dev FROM scraped_projects WHERE doc->'data'->>'lat' IS NOT NULL`)).rows) {
  const k = ptKey(r.lat, r.lng); if (!promotersAt.has(k)) promotersAt.set(k, new Set()); promotersAt.get(k).add(nk(r.dev)); }

// ---------- MahaRERA listing answers ----------
const listing = new Map();
const LOOK = path.join(CACHE, 'maharera', 'lookup');
for (const f of existsSync(LOOK) ? readdirSync(LOOK) : []) for (const x of parsePage(readFileSync(path.join(LOOK, f), 'utf8'), f)) listing.set(x.reg_no, x);
const DIST = { 'Pune': 'Pune', 'Mumbai Suburban': 'Mumbai', 'Mumbai City': 'Mumbai', 'Thane': 'Thane', 'Raigarh': 'Raigad', 'Raigad': 'Raigad', 'Palghar': 'Palghar', 'Nashik': 'Nashik' };

const A = [], B = [], C = [], restore = [], inserts = [], aliasAdds = new Map();
for (const [rera, c] of cand) {
  const reject = (why) => C.push({ rera, page: c.url, brand: c.brand, why });
  if (scrapedByRera.has(rera)) { const s = scrapedByRera.get(rera); if (s.del) restore.push({ rera, id: s.id, page: c.url, brand: c.brand, why: 'deleted on 18 Oct; developer page still lists it - review before restoring' }); else reject('already in Scraped data'); continue; }
  if (pinByRera.has(rera)) { reject(`already on the live map (pin #${pinByRera.get(rera).num})`); continue; }
  if (projRera.has(rera) || subRera.has(rera)) { reject('already in Projects / review queue'); continue; }
  const telangana = /^P02\d{9}$/.test(rera);
  let o;
  if (telangana) {
    // Telangana RERA search needs a CAPTCHA: identity is the developer's own page only (registry check pending).
    if (!c.brand) { reject('Telangana number on a site not mapped to a developer brand'); continue; }
    // Only a project's own page: exactly one RERA number, not a location / BHK-category / listing page.
    const slug = decodeURIComponent(new URL(c.url).pathname).split('/').filter(Boolean).pop() || '';
    if (c.rera_on_page.length !== 1 || /\/(location|locations|city|category)\//i.test(c.url) || /(^|-)\d(\.5)?bhk$|bhk-flats|^projects?$/i.test(slug)) { reject("Telangana number on a page that is not one project's own page"); continue; }
    // Project name from the page URL (titles are marketing text), cut before descriptive words; to be checked by hand.
    const cut = slug.split('-'); const stop = cut.findIndex((w) => /^(apartments?|flats?|villas?|bungalows?|for|in|luxury|\d(\.5)?bhk|bhk|premium|gated)$/i.test(w));
    const regName = (stop > 0 ? cut.slice(0, stop) : cut).join(' ').replace(/\b[a-z]/g, (m) => m.toUpperCase());
    const pt = c.map_points.length === 1 ? c.map_points[0].split(',').map(Number) : null;
    o = { city: 'Hyderabad', district: null, state: 'Telangana', regulator: 'Telangana RERA', jurisdiction: 'India - Telangana', project_name: regName, developer_name: c.brand,
      pincode: (c.address || '').match(/\b5\d{5}\b/)?.[0] || null, locality: null, lat: pt?.[0] ?? null, lng: pt?.[1] ?? null,
      pin_check: pt ? 'unconfirmed' : 'no_coordinates', pin_reason: pt ? `Map point on the developer's project page (${c.url}); not cross-checked with the registry (Telangana RERA needs a CAPTCHA).` : 'No map point on the developer page; Telangana RERA needs a CAPTCHA.',
      verification: 'Developer-declared RERA number (registry check pending)', status: 'RERA number shown by the developer (not checked on Telangana RERA)', status_category: 'Registration not checked on the registry',
      source_url: c.url, project_url: null, portal_seq: null };
  } else {
    const l = listing.get(rera);
    if (!l) { reject(existsSync(path.join(LOOK, `${rera}.html`)) ? 'not found on the MahaRERA listing' : 'MahaRERA listing not looked up yet / did not answer'); continue; }
    const city = DIST[l.district];
    if (!city) { reject(`district ${l.district} is outside the target cities`); continue; }
    const lat = l.lat ? Number(l.lat) : null, lng = l.lng ? Number(l.lng) : null;
    let pin_check = 'unconfirmed', pin_reason = 'Official MahaRERA point (declared by the promoter); not yet checked against the pincode boundary.';
    if (lat == null) { pin_check = 'no_coordinates'; pin_reason = 'MahaRERA listing shows no map point.'; }
    else if (!(lat > 15.5 && lat < 22.1 && lng > 72.5 && lng < 80.9)) { pin_check = 'mismatch'; pin_reason = `MahaRERA point (${lat}, ${lng}) is outside Maharashtra.`; }
    else if ([...(promotersAt.get(ptKey(lat, lng)) || [])].some((p) => p !== nk(l.promoter))) { pin_check = 'approximate'; pin_reason = 'Same point as another promoter\'s project - an area pin, not the site.'; }
    else {
      const dev = c.map_points.map((s) => s.split(',').map(Number)).map(([a, b]) => km(lat, lng, a, b)).sort((x, y) => x - y)[0];
      if (dev != null && dev <= 0.25) { pin_check = 'verified'; pin_reason = `Official MahaRERA point is ${dev.toFixed(2)} km from the map point on the developer's own project page (${c.url}); two official sources agree.`; }
      else if (/^d{6}$/.test(l.pincode || '')) {
        // Same check as the earlier MahaRERA rows: OpenStreetMap's postcode at the point equals the registry pincode.
        const a = (await reverse(lat, lng)).address || {};
        if (String(a.postcode || '').replace(/s/g, '') === l.pincode && /maharashtra/i.test(a.state || '')) { pin_check = 'verified'; pin_reason = `Official MahaRERA point (declared by the promoter); OpenStreetMap postcode at the point is ${l.pincode}, same as the registry; not shared with another promoter's project.`; }
        else pin_reason = `Official MahaRERA point; OpenStreetMap gives postcode ${a.postcode || '(none)'} there, registry pincode ${l.pincode} - check by hand.`;
      }
    }
    o = { city, district: l.district, state: 'Maharashtra', regulator: 'MahaRERA', jurisdiction: 'India - Maharashtra', project_name: l.project_name, developer_name: l.promoter,
      pincode: l.pincode || null, locality: l.location || null, lat, lng, pin_check, pin_reason,
      verification: 'Partially Verified', status: 'Registered (MahaRERA listing)', status_category: 'Registered - current status not confirmed',
      source_url: `https://www.maharera.maharashtra.gov.in/projects-search-result?project_name=${rera}`, project_url: l.detail_url || null, portal_seq: l.portal_id ? Number(l.portal_id) : null,
      extension: l.has_extension_cert === 'Yes' ? 'Yes' : 'No', source_last_modified: l.last_modified || null };
    if (lat != null) { const k = ptKey(lat, lng); if (!promotersAt.has(k)) promotersAt.set(k, new Set()); promotersAt.get(k).add(nk(l.promoter)); }
  }
  // identity: a distinctive word of the registry name on the developer page (brand words do not count)
  const brandWords = new Set(words(`${c.brand || ''} ${o.developer_name} ${c.host.split('.')[0]}`));
  const pageWords = new Set(words(`${c.title} ${c.description} ${decodeURIComponent(c.url)}`));
  if (!telangana && !words(o.project_name).filter((w) => !brandWords.has(w)).some((w) => pageWords.has(w))) { reject(`registry name "${o.project_name}" not on the developer page "${c.title}"`); continue; }
  // a live pin with the same distinctive name in the same city = probable duplicate
  const dw = words(o.project_name).filter((w) => !brandWords.has(w));
  const twin = dw.length && pins.find((p) => dw.every((w) => nk(p.title).includes(w)) && (o.lat == null || p.lat == null || km(o.lat, o.lng, p.lat, p.lng) < 2));
  if (twin) { reject(`probably already live as pin #${twin.num} "${twin.title}" (no RERA no. on the pin)`); continue; }

  const key = `${o.jurisdiction}|${rera}`, id = 'scr_' + createHash('sha1').update(key).digest('hex').slice(0, 16);
  const original = { id, key, country: 'India', images: [], address: c.address || null, notes: `Discovered on the developer's own project page (${c.url}); ${telangana ? 'Telangana RERA registry not checked (CAPTCHA).' : 'identity, district, pincode and map point from the public MahaRERA listing.'}`,
    image_note: 'No project images collected.', rera_number: rera, rera_prefix: rera.slice(0, 2), valid_up_to: null, verified_on: TODAY, project_type: null, secondary_id: null,
    approval_date: null, registration_date: null, revised_completion: null, original_completion: null, nclt_proposed_completion: null, ...o };
  const fields = Object.fromEntries(Object.entries({
    configurations: c.configs.length ? c.configs.join(', ') : null, proposed_completion: c.date, project_level_possession: c.project_level_date,
    possession_text: c.possession_text, developer_project_page: c.url, rera_on_official_page: true, rera_numbers_on_page: c.rera_on_page.join(', '),
    developer_brand: c.brand, full_address: c.address,
  }).filter(([, v]) => v != null && v !== ''));
  // The brand's own site lists this registration number -> the promoter (legal / project company) gets the brand's logo
  // as an alias of the brand's existing directory entry. Telangana numbers are developer-declared, so no alias from them.
  if (!telangana && c.brand && !logoOf.get(nk(o.developer_name)) && logoOf.get(nk(c.brand)) === c.brand) {
    if (!aliasAdds.has(c.brand)) aliasAdds.set(c.brand, { names: new Set(), evidence: [] });
    aliasAdds.get(c.brand).names.add(o.developer_name); aliasAdds.get(c.brand).evidence.push(`${rera} on ${c.url}`);
    logoOf.set(nk(o.developer_name), c.brand);
  }
  const missing = ['total_units', 'land_area', 'project_cost', 'unit_mix', 'carpet_area'];
  if (!fields.configurations) missing.push('configurations'); if (!fields.proposed_completion) missing.push('proposed_completion');
  if (!['verified', 'manual'].includes(o.pin_check)) missing.push('verified_location'); if (!logoOf.get(nk(o.developer_name))) missing.push('developer_logo');
  const enrichment = { review_status: 'Pending Review', verification: telangana ? 'Developer website only (registry check pending)' : 'Developer website (official) + MahaRERA listing',
    enriched_at: RUN, enriched_by: BATCH, source_type: 'developer_official_site', sources: [c.url, o.source_url].filter((x, i, a) => x && a.indexOf(x) === i),
    source_note: `Facts from ${c.host} (the developer's own page shows ${rera}). Checked ${TODAY}.`, fields, updated_fields: Object.keys(fields),
    review_required: [], pending_fields: missing, pending_reason: 'Registry-only facts (units, land, cost) sit behind the registry CAPTCHA; other gaps listed.',
    field_status: { rera_number: telangana ? 'developer_declared' : 'officially_verified', identity: telangana ? 'developer_declared' : 'cross_checked',
      location: o.pin_check === 'verified' ? 'cross_checked' : o.lat != null ? 'approximate_location' : 'pending_manual_verification',
      configurations: fields.configurations ? 'developer_official_site' : 'pending_manual_verification', possession: fields.proposed_completion ? 'developer_official_site' : fields.project_level_possession ? 'project_level_only' : 'pending_manual_verification',
      logo: logoOf.get(nk(o.developer_name)) ? 'existing_directory_logo' : 'missing', last_checked: TODAY }, data_filled: {} };
  const rec = { rera, city: o.city, project: o.project_name, promoter: o.developer_name, brand: c.brand, page: c.url, pin: o.pin_check, bhk: fields.configurations || '', possession: fields.proposed_completion || '', logo: !!logoOf.get(nk(o.developer_name)), missing: missing.join(', ') };
  B.push(rec); // A needs registry units/land/cost - never available from these sources
  inserts.push({ id, doc: { id, original, data: { ...original }, enrichment, imported_at: RUN, dataset_generated: RUN, deleted: false, added_by: BATCH } });
}

// ---------- B2: records from crawled MahaRERA listing pages that no developer page mentions (identity + pin only) ----------
const B2 = [], insertsB2 = [];
const LIST_DIRS = ['516', '517', '518', '519', '521'].map((d) => path.join(CACHE, 'maharera', d)).filter((d) => existsSync(d));
for (const dir of LIST_DIRS) for (const f of readdirSync(dir)) for (const l of parsePage(readFileSync(path.join(dir, f), 'utf8'), f)) {
  const rera = l.reg_no, city = DIST[l.district];
  if (!city || cand.has(rera) || insertsB2.some((x) => x.id.endsWith(rera))) continue;
  if (scrapedByRera.has(rera)) { if (scrapedByRera.get(rera).del) restore.push({ rera, id: scrapedByRera.get(rera).id, why: 'deleted on 18 Oct; still on the MahaRERA listing (listing only, no new facts)' }); else C.push({ rera, why: 'already in Scraped data' }); continue; }
  if (pinByRera.has(rera) || projRera.has(rera) || subRera.has(rera)) { C.push({ rera, why: 'already on the live map / in Projects' }); continue; }
  const lat = l.lat ? Number(l.lat) : null, lng = l.lng ? Number(l.lng) : null;
  let pin_check = lat == null ? 'no_coordinates' : 'unconfirmed', pin_reason = lat == null ? 'MahaRERA listing shows no map point.' : 'Official MahaRERA point (declared by the promoter); not cross-checked.';
  if (lat != null && [...(promotersAt.get(ptKey(lat, lng)) || [])].some((p) => p !== nk(l.promoter))) { pin_check = 'approximate'; pin_reason = "Same point as another promoter's project - an area pin, not the site."; }
  else if (lat != null && /^d{6}$/.test(l.pincode || '')) { const a = (await reverse(lat, lng)).address || {}; if (String(a.postcode || '').replace(/s/g, '') === l.pincode && /maharashtra/i.test(a.state || '')) { pin_check = 'verified'; pin_reason = `Official MahaRERA point; OpenStreetMap postcode at the point is ${l.pincode}, same as the registry; not shared with another promoter's project.`; } }
  if (lat != null) { const k = ptKey(lat, lng); if (!promotersAt.has(k)) promotersAt.set(k, new Set()); promotersAt.get(k).add(nk(l.promoter)); }
  const key = `India - Maharashtra|${rera}`, id = 'scr_' + createHash('sha1').update(key).digest('hex').slice(0, 16);
  const original = { id, key, country: 'India', images: [], address: null, notes: 'From the public MahaRERA "Search Project" listing only; no project details collected (MahaRERA project page needs a CAPTCHA).',
    image_note: 'No project images collected.', rera_number: rera, rera_prefix: rera.slice(0, 2), valid_up_to: null, verified_on: TODAY, project_type: null, secondary_id: null, approval_date: null,
    registration_date: null, revised_completion: null, original_completion: null, nclt_proposed_completion: null, city, district: l.district, state: 'Maharashtra', regulator: 'MahaRERA',
    jurisdiction: 'India - Maharashtra', project_name: l.project_name, developer_name: l.promoter, pincode: l.pincode || null, locality: l.location || null, lat, lng, pin_check, pin_reason,
    verification: 'Partially Verified', status: 'Registered (MahaRERA listing)', status_category: 'Registered - current status not confirmed',
    source_url: `https://www.maharera.maharashtra.gov.in/projects-search-result?project_state=27&project_district=${path.basename(dir)}&page=${f.replace(/D/g, '')}`, project_url: l.detail_url || null,
    portal_seq: l.portal_id ? Number(l.portal_id) : null, extension: l.has_extension_cert === 'Yes' ? 'Yes' : 'No', source_last_modified: l.last_modified || null };
  B2.push({ rera, city, project: l.project_name, promoter: l.promoter, pin: pin_check, logo: !!logoOf.get(nk(l.promoter)) });
  insertsB2.push({ id, doc: { id, original, data: { ...original }, imported_at: RUN, dataset_generated: RUN, deleted: false, added_by: BATCH + '-listing' } });
}
const INCLUDE_B2 = process.argv.includes('--include-listing-only');
if (INCLUDE_B2) inserts.push(...insertsB2);
console.log(JSON.stringify({ B2_listing_only: B2.length, B2_by_city: B2.reduce((a, r) => ((a[r.city] = (a[r.city] || 0) + 1), a), {}), B2_pin_verified: B2.filter((r) => r.pin === 'verified').length, B2_with_logo: B2.filter((r) => r.logo).length, B2_included_in_apply: INCLUDE_B2 }));
const by = (l, k) => l.reduce((a, r) => ((a[r[k]] = (a[r[k]] || 0) + 1), a), {});
const cR = C.reduce((a, r) => { const k = r.why.replace(/".*?"/g, '…').replace(/#\d+/g, '#').replace(/district .* is/, 'district … is'); a[k] = (a[k] || 0) + 1; return a; }, {});
console.log(JSON.stringify({ candidates: cand.size, A_go_live: A.length, B_pending: B.length, B_by_city: by(B, 'city'), C_rejected: C.length, C_reasons: cR, restore_review: restore.length,
  B_pin_verified: B.filter((r) => r.pin === 'verified').length, B_with_bhk: B.filter((r) => r.bhk).length, B_with_possession: B.filter((r) => r.possession).length, B_with_logo: B.filter((r) => r.logo).length,
  B_developers: new Set(B.map((r) => nk(r.promoter))).size, alias_entries: aliasAdds.size, aliases: [...aliasAdds].map(([b, a]) => b + ": " + [...a.names].join(" | ")) }, null, 1));
writeFileSync(path.join(ROOT, `collect-batch-${TODAY}.json`), JSON.stringify({ run: RUN, A, B, B2, C, restore_review: restore }, null, 1));
if (!APPLY) { console.log(`Dry run - nothing written. Report: collect-batch-${TODAY}.json`); await db.end(); process.exit(0); }
// --freeze=<report.json>: write exactly the B records of an approved dry-run report (lookups may have added more since).
const FREEZE = process.argv.find((x) => x.startsWith('--freeze='))?.split('=')[1];
if (FREEZE) { const ok = new Set(JSON.parse(readFileSync(FREEZE, 'utf8')).B.map((r) => r.rera)); const before = inserts.length;
  for (let i = inserts.length - 1; i >= 0; i--) if (!ok.has(inserts[i].doc.original.rera_number)) inserts.splice(i, 1);
  for (const [b, a] of aliasAdds) { a.names = new Set([...a.names].filter((n) => JSON.parse(readFileSync(FREEZE, 'utf8')).B.some((r) => r.promoter === n))); if (!a.names.size) aliasAdds.delete(b); }
  console.log(); }
const devFull = (await db.query(`SELECT id, doc FROM developers WHERE doc->>'name' = ANY($1)`, [[...aliasAdds.keys()]])).rows;
const devUpdates = devFull.map((r) => { const add = [...aliasAdds.get(r.doc.name).names].filter((n) => !(r.doc.aliases || []).some((a) => nk(a) === nk(n)));
  return { id: r.id, before: r.doc, doc: { ...r.doc, aliases: [...(r.doc.aliases || []), ...add], updated_at: RUN } }; }).filter((u) => u.doc.aliases.length > (u.before.aliases || []).length);
writeFileSync(path.join(RUNS, `applied-${RUN.replace(/[:.]/g, '-')}.json`), JSON.stringify({ batch: BATCH, inserted: inserts.map((x) => x.id), developers: devUpdates.map((u) => ({ id: u.id, before: u.before })) }));
for (const u of devUpdates) await db.query('UPDATE developers SET doc = $2 WHERE id = $1', [u.id, u.doc]);
let n = 0; for (let i = 0; i < inserts.length; i += 100) n += (await db.query(`INSERT INTO scraped_projects (id, doc) SELECT e->>'id', e->'doc' FROM jsonb_array_elements($1::jsonb) e ON CONFLICT (id) DO NOTHING`, [JSON.stringify(inserts.slice(i, i + 100))])).rowCount;
console.log(`Inserted ${n} new rows (batch ${BATCH}). Revert with --revert.`); await db.end();
