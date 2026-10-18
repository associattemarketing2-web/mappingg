// Project facts from the developer's OWN project page for scraped records whose registry page cannot be read
// (MahaRERA / Telangana RERA sit behind a CAPTCHA). The page is the one already confirmed to print the record's
// RERA number (enrichment.fields.developer_project_page, rera_on_official_page = true).
//
//   node --env-file=.env migration/enrichment/scraped/devpage-facts.mjs            dry run → DEVPAGE-FACTS.csv
//   node --env-file=.env migration/enrichment/scraped/devpage-facts.mjs --apply
//
// Only labelled facts are read from the page text (nav, header, footer, scripts removed):
//   towers / total units / land area (acres) / carpet area range (sq ft) / amenities (a fixed list) / description
//   (the page's own meta description) / possession date. A number the page does not state next to its label stays empty.
// A page that shows several RERA numbers (a multi-phase project) gives only project-level facts that are the same for
// every phase (amenities, description, land area) - never towers, units or carpet areas, which differ by phase.
// Written to enrichment.fields only where blank, with enrichment.field_sources[field] = { url, source: developer page }.
// The registry `original`, `data`, location and publish state are not touched; the row stays in Review Pending.
// Pages are read from migration/backup/scraped-enrichment-cache/devpages (fetched once, md5(url).html).

import { readFileSync, existsSync, writeFileSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import pg from 'pg';
import { parse } from 'node-html-parser';

const APPLY = process.argv.includes('--apply');
const DIR = path.resolve('migration/backup/scraped-enrichment-cache/devpages');
const OUTDIR = path.resolve('seo-doc/enrichment/scraped-project-enrichment');
const LOG = path.join(OUTDIR, 'PROJECT-CHANGE-LOG.csv');
const RUN = new Date().toISOString();

const url = new URL(process.env.DATABASE_URL);
url.searchParams.delete('sslmode');
const db = new pg.Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false }, query_timeout: 180000 });
await db.connect();
// --pages <file.json>: { record id: developer page URL } found later (a page Google Maps lists for the project, on the
// developer's own domain, checked to print the record's RERA number). Registered on the row first, then read like the rest.
const PAGES = process.argv.includes('--pages') ? JSON.parse(readFileSync(process.argv[process.argv.indexOf('--pages') + 1], 'utf8')) : {};
for (const [id, page] of Object.entries(PAGES)) {
  const { rows: [r] } = await db.query(`SELECT doc->'data' d, doc->'enrichment' e FROM scraped_projects WHERE id = $1`, [id]);
  const file = path.join(DIR, createHash('md5').update(page).digest('hex').slice(0, 16) + '.html');
  if (!r || r.e?.fields?.developer_project_page || !existsSync(file) || !readFileSync(file, 'utf8').includes(String(r.d.rera_number))) continue;
  const e = r.e || { review_status: 'Pending Review', enriched_at: RUN, source_type: 'developer_official_site', fields: {} };
  const fields = { ...e.fields, developer_project_page: page, rera_on_official_page: true, rera_numbers_on_page: r.d.rera_number };
  if (APPLY) await db.query(`UPDATE scraped_projects SET doc = jsonb_set(doc, '{enrichment}', $2::jsonb) WHERE id = $1`, [id, JSON.stringify({ ...e, fields })]);
}
const { rows } = await db.query(`SELECT id, doc->'data' d, doc->'enrichment' e FROM scraped_projects
  WHERE NOT coalesce((doc->>'deleted')::boolean, false) AND doc->'enrichment'->'fields'->>'developer_project_page' IS NOT NULL
    AND (doc->'enrichment'->'fields'->>'rera_on_official_page')::boolean IS TRUE`);

const AMENITIES = [
  ['Swimming Pool', /swimming pool|infinity pool|lap pool/], ['Gym', /\bgym(nasium)?\b|fitness cent/], ['Clubhouse', /club ?house/],
  ['Jogging Track', /jogging|walking track|running track/], ["Children's Play Area", /(kids|children'?s?) (play|zone|area)|toddler/],
  ['Yoga / Meditation', /\byoga\b|meditation/], ['Indoor Games', /indoor games|games room|billiards|pool table|table tennis/],
  ['Multipurpose Hall', /multi-?purpose (hall|court)|banquet|party hall|community hall/], ['Landscaped Garden', /landscaped|garden|park\b/],
  ['Sports Court', /badminton|tennis|basketball|squash|cricket|football|futsal|pickleball|half court|sports court/],
  ['Amphitheatre', /amphi ?theat/], ['Senior Citizen Area', /senior citizen|elders'? (area|corner|zone)/],
  ['Party Lawn', /party lawn|event lawn/], ['Rainwater Harvesting', /rain ?water harvesting/], ['Solar Power', /solar/],
  ['EV Charging', /\bev\b.{0,15}charging|electric vehicle charging/], ['CCTV', /\bcctv\b/], ['Power Backup', /power back ?-?up|dg back ?-?up/],
  ['Co-working Space', /co-?working|business lounge|work ?pod/], ['Library', /library|reading (room|lounge)/],
  ['Cycling Track', /cycling|cycle track/], ['Pet Park', /pet (park|zone|area)/], ['Mini Theatre', /mini (theatre|theater)|cinema|screening room/],
  ['Spa / Steam / Sauna', /\bspa\b|steam room|sauna|jacuzzi/], ['Supermarket / Shops', /convenience store|supermarket|retail (shops|plaza)/],
];
const num = (s) => Number(String(s).replace(/,/g, ''));

function facts(html, d, page) {
  const root = parse(html);
  const title = (root.querySelector('title')?.text || '').replace(/\s+/g, ' ').trim();
  const desc = (root.querySelector('meta[name="description"]')?.getAttribute('content') || root.querySelector('meta[property="og:description"]')?.getAttribute('content') || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  root.querySelectorAll('script,style,noscript,header,footer,nav,svg,form,iframe').forEach((n) => n.remove());
  ['[class*="footer"]', '[id*="footer"]', '[class*="menu"]', '[class*="navbar"]', '[class*="header"]', '[class*="similar"]', '[class*="related"]', '[class*="other-project"]']
    .forEach((s) => { try { root.querySelectorAll(s).forEach((n) => n.remove()); } catch { /* bad selector */ } });
  const text = root.text.replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  const low = text.toLowerCase();
  const reras = new Set((html.match(/\bP[RCM]?\d{11,13}\b|\bP\d{11}\b/g) || []).concat(html.match(/\bP0\d{10}\b/g) || []));
  const multi = reras.size > 1;
  const f = {}, ev = {};
  const take = (k, v, m) => { if (v != null && v !== '' && !(Array.isArray(v) && !v.length)) { f[k] = v; ev[k] = m; } };
  if (!multi) {
    // "G+26 Tower" / "26-storey tower" are floor counts, not tower counts; a bare "Towers 3" counts only as a label.
    let m = text.match(/(?<![+\d]\s?)(?<![+\d])\b(\d{1,2})\s+(?:iconic\s+|residential\s+|luxury\s+|high-?rise\s+)?towers\b/i)
      || text.match(/(?:no\.? of|number of|total)\s*towers\s*[:\-]?\s*(\d{1,2})\b|\btowers\s*[:\-]?\s*(\d{1,2})\s*(?=[A-Z][a-z]|$)/);
    const tw = m && num(m[1] ?? m[2]);
    if (tw > 0 && tw <= 20 && !/storey|stories|floors|\bG\s*\+/i.test(text.slice(Math.max(0, text.indexOf(m[0]) - 12), text.indexOf(m[0]) + m[0].length + 12))) take('towers', tw, m[0]);
    m = text.match(/(?:total|no\.? of|number of)\s*(?:units|apartments|flats|residences|homes)\s*[:\-]?\s*(\d[\d,]{0,5})/i)
      || text.match(/(\d[\d,]{1,5})\s*(?:\+\s*)?(?:premium\s+|luxury\s+|exclusive\s+|spacious\s+)?(?:units|apartments|residences|flats)\b(?!\s*(?:sold|delivered|booked))/i);
    if (m && num(m[1]) >= 4 && num(m[1]) <= 6000 && !/delivered|happy|families|customers|sold/i.test(text.slice(Math.max(0, text.indexOf(m[0]) - 40), text.indexOf(m[0]) + m[0].length + 20))) take('total_units', num(m[1]), m[0]);
    m = text.match(/(\d{3,4})\s*(?:sq\.?\s*ft\.?|sqft)?\s*(?:-|–|to)\s*(\d{3,4})\s*(?:sq\.?\s*ft|sqft)/i);
    if (m && num(m[1]) < num(m[2]) && num(m[1]) >= 200 && num(m[2]) <= 12000 && /carpet|rera|area|size/i.test(text.slice(Math.max(0, text.indexOf(m[0]) - 80), text.indexOf(m[0]) + 60))) take('carpet_area', `${m[1]} - ${m[2]} sq ft (developer website)`, m[0]);
  }
  let m = text.match(/(\d{1,3}(?:\.\d{1,2})?)\s*(?:\+\s*)?acres?\b/i);
  if (m && num(m[1]) > 0 && num(m[1]) <= 500) take('land_area', `${m[1]} acres (developer website${multi ? ', whole project' : ''})`, m[0]);
  const am = AMENITIES.filter(([, re]) => re.test(low)).map(([n]) => n);
  if (am.length >= 3) take('amenities', am, am.join(', '));
  // The page's own description, only when it is about this project (names it), not the company's site-wide blurb.
  const nameWords = String(d.project_name).toLowerCase().replace(/[^a-z ]+/g, ' ').split(' ')
    .filter((w) => w.length > 3 && !/^(phase|tower|towers|wing|sector|avenue|building|project|residences?)$/.test(w));
  if (desc.length >= 60 && !/cookie|javascript/i.test(desc) && nameWords.some((w) => desc.toLowerCase().includes(w))) take('project_description', desc, 'meta description');
  // BHK types: from the page's own title / description (about this project), else a labelled "Configuration".
  const head = `${title} ${desc}`;
  const bhkFrom = (s) => [...s.matchAll(/((?:\d(?:\.5)?\s*(?:,|&|and|\/|or)\s*)*\d(?:\.5)?)\s*-?\s*BHK/gi)]
    .flatMap((x) => x[1].split(/\s*(?:,|&|and|\/|or)\s*/i)).map(Number).filter((n) => n >= 1 && n <= 6);
  let bhk = nameWords.some((w) => head.toLowerCase().includes(w)) ? bhkFrom(head) : [];
  const lab = !bhk.length && text.match(/configurations?\s*[:\-]?\s*((?:\d(?:\.5)?\s*(?:,|&|and|\/)\s*)*\d(?:\.5)?\s*-?\s*BHK)/i);
  if (lab) bhk = bhkFrom(lab[1]);
  if (bhk.length) take('configurations', [...new Set(bhk)].sort((a, b) => a - b).map((n) => `${n} BHK`).join(', '), lab ? lab[0] : 'page title / description');
  // Possession date stated next to the word "possession" (one registration only: phases have their own dates).
  if (!multi) {
    const MON = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
    const pm = text.match(/possession[^.|]{0,40}?\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?[\s,'’-]*(20[2-3]\d)\b/i)
      || text.match(/possession[^.|]{0,30}?\b(20[2-3]\d)\b(?!\s*(?:sq|acre|units))/i);
    if (pm) {
      const val = pm.length === 3 && pm[2] ? `${pm[2]}-${MON[pm[1].toLowerCase().slice(0, 3)]}` : pm[1];
      const i = text.indexOf(pm[0]);
      take('proposed_completion', val, pm[0]);
      take('possession_text', text.slice(Math.max(0, i - 20), i + pm[0].length + 30).trim(), pm[0]);
    }
  }
  return { f, ev, multi, words: text.split(' ').length };
}

const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const report = [], plan = [];
for (const r of rows) {
  const page = r.e.fields.developer_project_page;
  const file = path.join(DIR, createHash('md5').update(page).digest('hex').slice(0, 16) + '.html');
  if (!existsSync(file)) continue;
  const html = readFileSync(file, 'utf8');
  if (!html.includes(String(r.d.rera_number))) { report.push([r.id, r.d.project_name, page, 'page no longer shows the RERA number - skipped', '']); continue; }
  const { f, ev, multi, words } = facts(html, r.d, page);
  const add = Object.fromEntries(Object.entries(f).filter(([k]) => r.e.fields[k] == null || r.e.fields[k] === '' || (Array.isArray(r.e.fields[k]) && !r.e.fields[k].length)));
  report.push([r.id, r.d.project_name, page, Object.keys(add).join(', ') || (words < 80 ? 'page text not readable (JavaScript only)' : 'nothing new'), Object.entries(add).map(([k, v]) => `${k}=${Array.isArray(v) ? v.join('/') : v} ‹${String(ev[k]).slice(0, 60)}›`).join(' | ') + (multi ? ' [multi-phase page]' : '')]);
  if (Object.keys(add).length) plan.push({ r, add, page });
}
writeFileSync(path.join(OUTDIR, 'DEVPAGE-FACTS.csv'), ['record_id,project_name,developer_page,fields_added,values', ...report.map((x) => x.map(q).join(','))].join('\n') + '\n');
const cnt = {}; plan.forEach((p) => Object.keys(p.add).forEach((k) => (cnt[k] = (cnt[k] || 0) + 1)));
console.log({ rows: rows.length, with_new_facts: plan.length, fields: cnt });
if (!APPLY) { console.log('Dry run - see DEVPAGE-FACTS.csv'); await db.end(); process.exit(0); }

let ok = 0;
for (const { r, add, page } of plan) {
  const e = r.e, fields = { ...e.fields, ...add };
  const field_sources = { ...(e.field_sources || {}), ...Object.fromEntries(Object.keys(add).map((k) => [k, { url: page, source: 'developer_official_site', at: RUN }])) };
  const res = await db.query(`UPDATE scraped_projects SET doc = jsonb_set(jsonb_set(doc, '{enrichment,fields}', $2::jsonb), '{enrichment,field_sources}', $3::jsonb)
    WHERE id = $1 AND doc->'enrichment'->'fields' = $4::jsonb`, [r.id, JSON.stringify(fields), JSON.stringify(field_sources), JSON.stringify(e.fields)]);
  const st = res.rowCount === 1 ? 'saved' : 'skipped_changed';
  if (st === 'saved') ok++;
  appendFileSync(LOG, Object.entries(add).map(([k, v]) => [r.id, r.d.project_name, `enrichment.${k}`, '', Array.isArray(v) ? v.join(', ') : v, page, 'developer_official_site', 'medium', RUN, st].map(q).join(',')).join('\n') + '\n');
}
console.log(`saved ${ok} / ${plan.length}`);
await db.end();
