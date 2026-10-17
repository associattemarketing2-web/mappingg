// Noida / Greater Noida (Gautam Buddha Nagar) projects from the official UP RERA registry (up-rera.in).
//
//   node migration/enrichment/scraped/up-research.mjs            → <cache>/up/records.json
//
// For every residential / mixed project registered in Gautam Buddha Nagar:
//   1. the "Registered Projects" list (promoter, project, registration no., type, district, start / end, reg. date);
//   2. the project summary page (address, pincode, declared completion, promoter);
//   3. the project detail page (towers / floors / BHK type / units / carpet area, land (khasra) area,
//      building permit no. & date, competent authority, revised completion date, development works);
//   4. the project's location as declared to UP RERA (the registry's own "View on map" service).
// Nothing is guessed: a value the registry does not show stays empty. Pages are cached (gzip) so a rerun
// is offline. Three requests at a time, to be gentle with the registry.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import path from 'node:path';

const BASE = 'https://www.up-rera.in/';
const CACHE = path.resolve('migration/backup/scraped-enrichment-cache/up');
const PAGES = path.join(CACHE, 'pages');
mkdirSync(PAGES, { recursive: true });
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- tiny cookie-jar fetch (UP RERA keeps the selected project in the session) ----------------
function session() {
  const jar = new Map();
  const keep = (r) => { for (const c of r.headers.getSetCookie?.() || []) { const kv = c.split(';')[0]; const i = kv.indexOf('='); jar.set(kv.slice(0, i), kv.slice(i + 1)); } };
  return async (url, opts = {}) => {
    for (let t = 0; t < 4; t++) {
      try {
        const r = await fetch(new URL(url, BASE), { ...opts, redirect: opts.redirect || 'follow', signal: AbortSignal.timeout(90000),
          headers: { 'user-agent': UA, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), ...(opts.headers || {}) } });
        keep(r);
        if (r.status >= 500) throw new Error(`HTTP ${r.status}`);
        return { status: r.status, url: r.url, location: r.headers.get('location'), text: await r.text() };
      } catch (e) { if (t === 3) throw e; await sleep(4000 * (t + 1)); }
    }
  };
}
const cached = (name, html) => { if (html != null) writeFileSync(path.join(PAGES, name), gzipSync(html)); const f = path.join(PAGES, name); return existsSync(f) ? gunzipSync(readFileSync(f)).toString('utf8') : null; };

const clean = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;?/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
const dmy = (s) => { const m = String(s || '').match(/(\d{2})-(\d{2})-(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };

// ---- 1. the list ----------------------------------------------------------------------------
async function listPage() {
  const have = cached('list.html.gz');
  if (have) return have;
  const get = session();
  const home = await get('');
  const form = {};
  for (const m of home.text.matchAll(/<input type="hidden" name="([^"]+)" id="[^"]*" value="([^"]*)"/g)) form[m[1]] = m[2].replace(/&amp;/g, '&');
  form.__EVENTTARGET = 'ctl00$ContentPlaceHolder1$lnkRegisteredProjects'; form.__EVENTARGUMENT = '';
  await get('', { method: 'POST', body: new URLSearchParams(form), headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' });
  const list = await get('projects', { headers: { referer: BASE } });
  return cached('list.html.gz', list.text);
}

// ---- 2-4. one project ---------------------------------------------------------------------------
async function project(row) {
  const key = row.rera.replace(/[^A-Za-z0-9]/g, '_');
  let sum = cached(`${key}-summary.html.gz`), det = cached(`${key}-detail.html.gz`), map = cached(`${key}-map.json.gz`);
  if (!sum || !det) {
    const get = session();
    const s = await get(row.href, { headers: { referer: `${BASE}projects` } });
    sum = cached(`${key}-summary.html.gz`, s.text);
    const d = await get('viewprojects', { headers: { referer: new URL(row.href, BASE).href } });
    det = cached(`${key}-detail.html.gz`, d.text);
  }
  const formId = (sum.match(/mapview_project\.aspx\?form=(\d+)/) || [])[1];
  if (!map && formId) {
    const get = session();
    const r = await get('WebService1.asmx/ProjectOnMAp_distinct', { method: 'POST', body: `{prjid: '${formId}'}`, headers: { 'content-type': 'application/json; charset=utf-8' } });
    map = cached(`${key}-map.json.gz`, r.text);
  }
  return parse(row, sum, det, map, formId);
}

function spans(html) {
  const out = {};
  for (const m of html.matchAll(/<span id="ctl00_ContentPlaceHolder1_([^"]+)"[^>]*>([\s\S]{0,400}?)<\/span>/g)) {
    const v = clean(m[2]); if (!v) continue;
    const grid = m[1].match(/^(.+?)_ctl(\d+)_(.+)$/);
    if (grid) { ((out[grid[1]] ||= {})[grid[2]] ||= {})[grid[3]] = v; } else if (!(m[1] in out)) out[m[1]] = v;
  }
  return out;
}
const rowsOf = (g) => Object.values(g || {});
const selected = (html, name) => clean((html.match(new RegExp(`name="ctl00\\$ContentPlaceHolder1\\$${name}"[\\s\\S]*?<option selected="selected" value="[^"]*">([^<]*)`)) || [])[1]);
const field = (html, label) => { // summary page: "<label>Label</label> … <span>value</span>"
  const i = html.indexOf(label); if (i < 0) return null;
  const m = html.slice(i, i + 900).match(/<span[^>]*>([\s\S]*?)<\/span>/); return m ? clean(m[1]) : null;
};

const AMENITY_WORDS = [['swimming pool', 'Swimming Pool'], ['gym', 'Gym'], ['club ?house', 'Club House'], ['rain ?water harvesting', 'Rain Water Harvesting'],
  ['dg set|power back ?up|diesel generator', 'Power Backup'], ['cctv', 'CCTV'], ['\\blifts?\\b|elevator', 'Lifts'], ['jogging track', 'Jogging Track'],
  ['children.{0,10}play|kids.{0,10}play|tot.?lot', "Children's Play Area"], ['sewage treatment|\\bstp\\b', 'Sewage Treatment Plant'],
  ['solar', 'Solar Panels'], ['fire ?fighting|sprinkler', 'Fire Fighting System'], ['amphithea', 'Amphitheatre'], ['basket ?ball', 'Basketball Court']];

function parse(row, sum, det, mapJson, formId) {
  const S = spans(det);
  // Units by type, from the floor-wise plan details.
  const plan = rowsOf(S.grd_PlanDetails_ForAdmin).filter((r) => r.lblfloorType && Number(r.lblnoOfFlats) > 0);
  const byType = new Map();
  for (const r of plan) {
    const t = r.lblfloorType.replace(/\s+/g, ' ').trim();
    const g = byType.get(t) || { type: t, units: 0, carpet: [] };
    // Some old registrations put the type's TOTAL carpet in the per-unit column — such values are not per-unit, so not used.
    const cap = /villa|penthouse|duplex|bungalow/i.test(t) ? 1500 : 650; // a flat's carpet above ~7,000 sq ft is an entry error
    g.units += Number(r.lblnoOfFlats); const c = Number(r.lblCarpetArea); if (c >= 15 && c <= cap) g.carpet.push(c);
    byType.set(t, g);
  }
  const unit_mix = [...byType.values()].map((g) => {
    const lo = g.carpet.length ? Math.min(...g.carpet) : null, hi = g.carpet.length ? Math.max(...g.carpet) : null;
    return { type: g.type, units: g.units, carpet_sqm_min: lo, carpet_sqm_max: hi,
      carpet_sqft_min: lo && Math.round(lo * 10.7639), carpet_sqft_max: hi && Math.round(hi * 10.7639) };
  }).sort((a, b) => b.units - a.units);
  const towers = new Set(plan.map((r) => r.lblblock.trim().toUpperCase())).size;
  // Land: the area of this phase when the registry states it, else the whole plot (all phases).
  const works = [...det.matchAll(/name="ctl00\$ContentPlaceHolder1\$grddevlopmentworks\$ctl\d+\$txtworkdetails"[^>]*>([^<]*)/g)].map((m) => clean(m[1]))
    .concat([...det.matchAll(/name="ctl00\$ContentPlaceHolder1\$grddevlopmentworks\$ctl\d+\$txtworkdetails"[^>]*value="([^"]*)"/g)].map((m) => clean(m[1])));
  const worksText = works.join(' \n ');
  const phaseArea = (worksText.match(/(?:current|this)\s+phase[^=]{0,80}?(?:plot|land)?\s*area\s*=?\s*([\d,]+(?:\.\d+)?)\s*(?:sq\.?\s*m|square\s*met)/i) || [])[1];
  const khasra = rowsOf(S.grdKhasra).reduce((a, r) => a + (Number(String(r.lblArea).replace(/,/g, '')) || 0), 0)
    || rowsOf(S.grdLadDetail).reduce((a, r) => a + (Number(String(r.lblKhasraArea1).replace(/,/g, '')) || 0), 0);
  const landSqm = phaseArea ? Number(phaseArea.replace(/,/g, '')) : khasra || null;
  const permit = rowsOf(S.grdPermitDetails)[0] || {};
  const address = S.projetaddress || field(sum, 'Project Address');
  const pincode = (String(address || '').match(/\b(2\d{5})\b/) || [])[1] || null;
  let lat = null, lng = null;
  try { const d = JSON.parse(JSON.parse(mapJson).d)[0]; lat = Number(d.lat); lng = Number(d.long); if (!lat || !lng) lat = lng = null; } catch { /* no map */ }
  const amenities = AMENITY_WORDS.filter(([re]) => new RegExp(re, 'i').test(worksText)).map(([, n]) => n);
  const completion = dmy(permit.lblRevisedEndDateShow) || dmy(field(sum, 'Declared Date Of Completion')) || row.end;
  const name = clean(row.project.replace(/\((Default on QPR)\)/i, ''));
  return {
    rera_number: row.rera, project_name: (S.lblProjectName || field(det, 'lblProjectName') || name), list_name: row.project,
    qpr_default: /Default on QPR/i.test(row.project), developer_name: row.promoter, project_category: S.lblProjectCategory || row.type,
    project_type: S.lblProjectType || null, district: 'Gautam Buddha Nagar', tehsil: selected(det, 'ddlTehsil') || null,
    approving_authority: selected(det, 'ddlAuthority') || null, locality: S.lblvill_locality || null, full_address: address || null, pincode,
    registration_date: row.reg, project_start_date: row.start, original_completion: row.end, proposed_completion: completion,
    approved_plan_number: permit.lblPermitNumber || null, plan_approval_date: dmy(permit.lblPermitDate),
    unit_mix, configurations: unit_mix.map((u) => u.type).join(', ') || null, total_units: unit_mix.reduce((a, u) => a + u.units, 0) || null,
    towers: towers || null, land_area_sqm: landSqm, land_area: landSqm ? `${(landSqm / 4046.8564).toFixed(2)} acres (${Math.round(landSqm).toLocaleString('en-IN')} sq m${phaseArea ? ', this phase' : ''})` : null,
    amenities, development_works: works.filter((w) => w && !/^not applicable$/i.test(w)).slice(0, 25),
    lat, lng, registry_form_id: formId || null,
    summary_url: new URL(row.href, BASE).href, map_url: formId ? `${BASE}mapview_project.aspx?form=${formId}` : null,
  };
}

// ---- run ----------------------------------------------------------------------------------------
const list = await listPage();
const rows = [];
for (const tr of list.match(/<tr[\s\S]*?<\/tr>/g) || []) {
  const td = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => clean(m[1]));
  const href = (tr.match(/href="(Projectsummary[^"]+)"/) || [])[1];
  if (td.length < 9 || !href || !/Gautam Buddha Nagar/i.test(td[5]) || !/Residential|Mixed/i.test(td[4])) continue;
  rows.push({ promoter: td[1], project: td[2], rera: td[3], type: td[4], start: dmy(td[6]), end: dmy(td[7]), reg: dmy(td[8]), href: href.replace(/&amp;/g, '&') });
}
console.log(`list: ${rows.length} residential / mixed projects in Gautam Buddha Nagar`);
const out = existsSync(path.join(CACHE, 'records.json')) ? JSON.parse(readFileSync(path.join(CACHE, 'records.json'), 'utf8')) : {};
let done = 0, failed = 0;
const queue = rows.filter((r) => !out[r.rera]).slice(0, Number(process.env.LIMIT) || Infinity); // LIMIT=5 for a trial run
await Promise.all(Array.from({ length: 3 }, async () => {
  for (let r; (r = queue.shift());) {
    try { out[r.rera] = await project(r); } catch (e) { failed++; console.log(`✗ ${r.rera} ${r.project}: ${e.message}`); }
    if (++done % 25 === 0) { writeFileSync(path.join(CACHE, 'records.json'), JSON.stringify(out)); console.log(`${done}/${rows.length}`); }
    await sleep(400);
  }
}));
writeFileSync(path.join(CACHE, 'records.json'), JSON.stringify(out));
const v = Object.values(out);
console.log(`done: ${v.length} records, ${failed} failed; with coordinates ${v.filter((x) => x.lat).length}, with unit mix ${v.filter((x) => x.unit_mix.length).length}, completion ahead ${v.filter((x) => x.proposed_completion >= new Date().toISOString().slice(0, 10)).length}`);
