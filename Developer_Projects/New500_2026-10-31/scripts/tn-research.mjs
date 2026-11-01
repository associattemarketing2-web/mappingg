// Chennai-region residential projects from the official Tamil Nadu RERA registry (rera.tn.gov.in).
//
//   node Developer_Projects/New500_2026-10-31/scripts/tn-research.mjs [--limit=70]   → <cache>/tn/records.json
//
// Source pages (all public, linked from the registry's own menus; robots.txt only disallows /uploads/ and PDFs):
//   1. "Projects on Map" (/projects-map) — the registry's map of projects registered this year: certificate no.,
//      project name / address text, the GPS point the promoter declared, and the project-details link.
//   2. /project-details/<id> — registration date, completion date, last-modified date, links to the two forms below.
//   3. Form A "Proposed Project Detail" (/public-view2/...) — name, usage, site extent, dwelling units, stage,
//      completion, district / pincode, planning permission, blocks / floors, GPS coordinates, project cost.
//   4. Form A "Promoter Detail" (/public-view1/...) — promoter firm name and website.
// Only the year the map page shows by default is read (its year filter needs a form post, which is not used).
// Nothing is guessed: a value the registry does not show stays null. One request at a time, 2.5 s apart; pages are
// cached (gzip) under migration/backup/scraped-enrichment-cache/new500/tn/pages so a rerun is offline.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import path from 'node:path';

const BASE = 'https://rera.tn.gov.in/';
const CACHE = path.resolve('migration/backup/scraped-enrichment-cache/new500/tn');
const PAGES = path.join(CACHE, 'pages');
mkdirSync(PAGES, { recursive: true });
const LIMIT = Number((process.argv.find((a) => a.startsWith('--limit=')) || '--limit=70').slice(8));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const fileOf = (name) => path.join(PAGES, `${name}.html.gz`);
async function page(name, url) {
  if (existsSync(fileOf(name))) return gunzipSync(readFileSync(fileOf(name))).toString('utf8');
  await sleep(2500);
  for (let t = 0; t < 3; t++) {
    try {
      const r = await fetch(new URL(url, BASE), { signal: AbortSignal.timeout(90000) });
      if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
      const html = await r.text();
      writeFileSync(fileOf(name), gzipSync(html));
      return html;
    } catch (e) { if (t === 2) throw new Error(`${url}: ${e.message}`); await sleep(6000 * (t + 1)); }
  }
}

const decode = (s) => String(s || '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;/g, "'").replace(/&quot;/g, '"').replace(/&ndash;|&#8211;/g, '–');
/** Page text as label / value lines (one per table cell, div or label). */
const lines = (html) => decode(String(html).replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>/gi, ' ')
  .replace(/<\/(td|th|tr|div|p|li|h\d|label|span|b|strong|a)>/gi, '\n').replace(/<[^>]+>/g, ' '))
  .split('\n').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
/** Value after the first "Label :" line (optionally only after `after`). */
function field(L, label, after) {
  let i = 0;
  if (after) { i = L.findIndex((x) => x.startsWith(after)); if (i < 0) return null; }
  for (; i < L.length; i++) {
    if (L[i].replace(/\s*:\s*$/, '').toLowerCase() === label.toLowerCase() && /:\s*$/.test(L[i])) {
      const v = (L[i + 1] || '').trim();
      return !v || v === '-' || /:\s*$/.test(v) ? null : v;
    }
  }
  return null;
}
const dmy = (s) => { const m = String(s || '').match(/(\d{2})[-/](\d{2})[-/](\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
const numOr = (s) => { const n = Number(String(s ?? '').replace(/,/g, '')); return s != null && String(s).trim() !== '' && Number.isFinite(n) ? n : null; };

// ---- 1. the map list ----
const mapHtml = await page('projects-map-2026', 'projects-map');
const at = mapHtml.indexOf('const data = ') + 13;
const data = JSON.parse(mapHtml.slice(at, mapHtml.indexOf('\n', at)).trim().replace(/;\s*$/, ''));
const B = (data.original || data).Building;
const list = B.name.map((n, i) => ({
  certificate: decode(B.file_no[i].replace(/<[^>]+>/g, '')).replace(/^[^A-Z]+/, '').trim(),
  details_url: BASE + (B.file_no[i].match(/project-details\/[0-9a-f-]+/) || [''])[0],
  map_text: decode(n.replace(/<br>/gi, ' | ').replace(/<[^>]+>/g, '')).trim(),
  map_lat: B.lat[i], map_lng: B.lng[i],
}));
// Residential buildings in the Chennai metropolitan region (Chennai, Chengalpattu, Kancheepuram, Thiruvallur districts).
const REGION = /chennai|chengalpattu|chengalpet|kancheepuram|kanchipuram|thiruvallur|tiruvallur/i;
const candidates = list.filter((x) => /dwelling|residential|flats?\b|apartment|villa/i.test(x.map_text) && !/dormitor|hostel/i.test(x.map_text) && REGION.test(x.map_text));
console.log(`map: ${list.length} buildings registered this year, ${candidates.length} residential in the Chennai region; reading ${Math.min(LIMIT, candidates.length)}`);

// ---- 2-4. each project ----
const OUT = path.join(CACHE, 'records.json');
const records = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
for (const c of candidates.slice(0, LIMIT)) {
  const id = c.details_url.split('/').pop();
  if (records[c.certificate]?.view2_ok) continue;
  try {
    const dh = await page(`details-${id}`, c.details_url);
    const DL = lines(dh);
    const v1 = (dh.match(/public-view1\/[a-z]+\/[a-z]+\/[0-9a-f-]+/) || [])[0];
    const v2 = (dh.match(/public-view2\/[a-z]+\/[a-z]+\/[0-9a-f-]+/) || [])[0];
    const after = (label) => { const i = DL.findIndex((x) => x === label); return i >= 0 ? DL[i + 1] : null; };
    const P = v2 ? lines(await page(`view2-${v2.split('/').pop()}`, v2)) : [];
    const Q = v1 ? lines(await page(`view1-${v1.split('/').pop()}`, v1)) : [];
    const gpsLat = field(P, 'Latitude', 'GPS Coordinates'), gpsLng = field(P, 'Longitude', 'GPS Coordinates');
    records[c.certificate] = {
      ...c,
      view1_url: v1 ? BASE + v1 : null, view2_url: v2 ? BASE + v2 : null, view2_ok: P.length > 0,
      registration_date: dmy(after('Project Registration Date')),
      completion_date_details: dmy(after('Project Completion Date')),
      last_modified: dmy(after('Last Modified')),
      project_name: field(P, 'Project Name'),
      project_details: field(P, 'Project Details'),
      building_type: field(P, 'Type of Building'),
      usage: field(P, 'Usage'),
      site_extent_sqm: numOr(field(P, 'Site Extent (Sq.m)')),
      dwelling_units: numOr(field(P, 'Total No. of Dwelling Units including all Phases/Villas')),
      stage: field(P, 'Stage of Construction'),
      completion_date: dmy(field(P, 'Project Completion Date')),
      city: (P.find((x) => /^City\/Town :/.test(x)) || '').replace(/^City\/Town :\s*/, '') || null,
      district: (P.find((x) => /^District :/.test(x)) || '').replace(/^District :\s*/, '') || field(P, 'District'),
      pincode: ((P.find((x) => /^Pincode :/.test(x)) || '').match(/\d{6}/) || [null])[0],
      survey_no: (P.find((x) => /^Survey No :/.test(x)) || '').replace(/^Survey No :\s*/, '') || null,
      approval_category: field(P, 'Category'),
      planning_authority: field(P, 'Planning Permission Issued By'),
      planning_permission_no: field(P, 'Planning Permission Approval / Renewal Letter No'),
      planning_permission_date: dmy(field(P, 'Planning Permission Approval / Renewal Date')),
      building_permit_by: field(P, 'Building License/Permit Issued By'),
      building_permit_no: field(P, 'Building License/Permit No'),
      building_permit_date: dmy(field(P, 'Building License/Permit Date')),
      registration_applied_for: after('Registration Applied For'),
      total_blocks: numOr(field(P, 'Total No. of Blocks in the Project')),
      blocks_applied: numOr(field(P, 'No.of Blocks Applied Now')),
      gps_lat: gpsLat, gps_lng: gpsLng,
      land_cost: numOr(field(P, 'Land Cost (Market Value)')),
      construction_cost: numOr(field(P, 'Construction Cost')),
      total_project_cost: numOr(field(P, 'Total Project Cost')),
      promoter_type: field(Q, 'Type of Promoter'),
      promoter_name: field(Q, 'Firm Name') || field(Q, 'Name') || field(Q, 'Promoter Name'),
      promoter_website: field(Q, 'Website Address'),
      fetched_at: new Date().toISOString(),
    };
    const r = records[c.certificate];
    console.log(`${c.certificate}  ${r.project_name || '(no name)'}  ${r.promoter_name || '(no promoter)'}  ${r.usage}  ${r.dwelling_units} units  ${r.gps_lat},${r.gps_lng}`);
  } catch (e) {
    records[c.certificate] = { ...c, error: e.message };
    console.log(`${c.certificate}  ERROR ${e.message}`);
  }
  writeFileSync(OUT, JSON.stringify(records, null, 1));
}
console.log(`records.json: ${Object.keys(records).length} projects`);
