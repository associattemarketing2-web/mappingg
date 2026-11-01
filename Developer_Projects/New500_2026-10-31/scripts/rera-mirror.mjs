// MahaRERA facts for the Mumbai / Pune Scraped-data rows from a public mirror of the registry (Aurum PropTech "Pulse"
// RERA pages: aurumproptech.in/pulse/rera/maharashtra/<district>/<slug>-<RERA no.>; robots.txt allows /pulse/rera).
// MahaRERA's own project page needs a CAPTCHA, so this is the registry data available without one. Owner's request
// (31 Oct 2026): "kahin se bhi info lo, sab data sahi chahiye".
//
//   node Developer_Projects/New500_2026-10-31/scripts/rera-mirror.mjs   → <cache>/rera-mirror/records.json
//
// Read per registration (only when the page's own RERA number equals ours): project name, promoter, registration date,
// proposed / revised completion, project status, type, address (district, taluka, village, pincode), land area,
// configurations with carpet areas and unit counts. One request every 2 s; pages cached (gzip).

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.resolve('migration/backup/scraped-enrichment-cache/new500/rera-mirror');
mkdirSync(path.join(DIR, 'pages'), { recursive: true });
const mh = JSON.parse(readFileSync(path.join(ROOT, 'batches', 'mh-devsite.json'), 'utf8'));
const rows = [...mh.live_ready, ...mh.pending];
const OUT = path.join(DIR, 'records.json');
const recs = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DISTRICTS = { Pune: ['pune'], Mumbai: ['mumbai-suburban', 'mumbai-city', 'mumbai', 'thane'] };

async function page(rera, city) {
  const f = path.join(DIR, 'pages', `${rera}.html.gz`);
  if (existsSync(f)) return gunzipSync(readFileSync(f)).toString('utf8');
  for (const d of DISTRICTS[city] || ['pune']) {
    await sleep(2000);
    const r = await fetch(`https://www.aurumproptech.in/pulse/rera/maharashtra/${d}/project-${rera}`, { signal: AbortSignal.timeout(60000) }).catch(() => null);
    if (r?.status === 200) { const h = await r.text(); if (h.includes(rera)) { writeFileSync(f, gzipSync(h)); return h; } }
  }
  writeFileSync(f, gzipSync(''));
  return '';
}

const text = (h) => h.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, ' ');
const after = (t, label, stop = 70) => { const m = t.match(new RegExp(`${label}\\s+(.{1,${stop}}?)(?=\\s+(?:[A-Z][a-z]+ ){0,3}[A-Z][a-z]+(?: No\\.| Date| Status| Type| Name)?\\s|$)`)); return m ? m[1].trim() : null; };
const json = (h, k) => (h.match(new RegExp(`"${k}":"([^"]*)"`)) || [])[1] || null;

for (const r of rows) {
  if (recs[r.rera]) continue;
  const h = await page(r.rera, r.city);
  if (!h) { recs[r.rera] = { rera: r.rera, found: false }; console.log(r.rera, 'not found'); writeFileSync(OUT, JSON.stringify(recs, null, 1)); continue; }
  const t = text(h);
  // configuration rows: "WING A - Apartment Type 2 BHK WING A - Carpet Area 60.5 ... Number of Apartment 20"
  const configs = [...new Set([...t.matchAll(/Apartment Type\s+(\d(?:\.\d)?\s*BHK|1 RK|Studio)/gi)].map((m) => m[1].replace(/\s+/g, ' ').toUpperCase().replace('BHK', 'BHK')))];
  const units = [...t.matchAll(/Number of Apartments?\s+(\d+)/gi)].reduce((s, m) => s + Number(m[1]), 0) || null;
  const carpets = [...t.matchAll(/Carpet Area(?: \(sq\.? ?m\.?\))?\s+([\d.]+)/gi)].map((m) => Number(m[1])).filter((n) => n > 10 && n < 2000);
  recs[r.rera] = {
    rera: r.rera, found: true, url: `https://www.aurumproptech.in/pulse/rera/maharashtra/${(DISTRICTS[r.city] || ['pune'])[0]}/project-${r.rera}`,
    project_name: json(h, 'projectname') || (t.match(/Project Name\s+(.{2,80}?)\s+(?:Project|RERA|Registration)/) || [])[1] || null,
    promoter: json(h, 'promotername') || (t.match(/Promoter Name\s+(.{2,100}?)\s+(?:Promoter|Designation|Contact|Partner|Director|Member)/) || [])[1] || null,
    registration_date: json(h, 'reraregistrationdate') || (t.match(/Registration Date\s+(\d{4}-\d{2}-\d{2})/) || [])[1] || null,
    proposed_completion: json(h, 'proposedcompletiondate') || (t.match(/Proposed Completion Date\s+(\d{4}-\d{2}-\d{2})/) || [])[1] || null,
    revised_completion: (t.match(/Revised (?:Proposed )?Completion Date\s+(\d{4}-\d{2}-\d{2})/) || [])[1] || null,
    status: (t.match(/Project Status\s+(Ongoing|Completed|New|Lapsed|Revoked|Deregistered|Abeyance|[A-Z][a-z]+)/) || [])[1] || json(h, 'projectstatus'),
    project_type: (t.match(/Project Type\s+([A-Za-z /]+?)\s+(?:Project|State|District|Acknowledgement)/) || [])[1] || null,
    district: (t.match(/District\s+([A-Za-z ]+?)\s+Taluka/) || [])[1] || null,
    taluka: (t.match(/Taluka\s+([A-Za-z ]+?)\s+Village/) || [])[1] || null,
    village: (t.match(/Village\s+(.{2,60}?)\s+Pincode/) || [])[1] || null,
    pincode: (t.match(/Pincode\s+(\d{6})/) || [])[1] || null,
    land_area_sqm: Number((t.match(/Land Area(?: \(sq\.? ?m\.?\))?\s+([\d.]+)/) || [])[1]) || null,
    configurations: configs, total_units: units, carpet_sqm_min: carpets.length ? Math.min(...carpets) : null, carpet_sqm_max: carpets.length ? Math.max(...carpets) : null,
  };
  const x = recs[r.rera];
  console.log(`${r.rera} ${x.project_name} | ${x.status} | completion ${x.proposed_completion}${x.revised_completion ? ' → ' + x.revised_completion : ''} | ${x.pincode} | ${x.configurations.join(',')} | units ${x.total_units}`);
  writeFileSync(OUT, JSON.stringify(recs, null, 1));
}
console.log(`records: ${Object.keys(recs).length}, found ${Object.values(recs).filter((x) => x.found).length}`);
