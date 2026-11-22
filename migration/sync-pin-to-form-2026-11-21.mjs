// One-off (21 Nov 2026): copy values that are already on the live map pin (or already on the project) into the
// empty fields of its intake form, so "Edit all details" shows what the map shows. Add-only: nothing filled is changed.
//
//   node --env-file=.env migration/sync-pin-to-form-2026-11-21.mjs            (dry run, writes the CSV preview)
//   node --env-file=.env migration/sync-pin-to-form-2026-11-21.mjs --apply    (backup, write)
//   node --env-file=.env migration/sync-pin-to-form-2026-11-21.mjs --revert=<backup dir>
//
// Sources, all already on our own records (no outside data):
//   google_maps_link ← pin coordinates (checked against Google Maps on 19 Nov)
//   state            ← city (Pune/Mumbai → Maharashtra, …)
//   price            ← pin price text, only clean "₹ X Cr/L onwards" or "₹ X – Y Cr/L" shapes
//   carpet area      ← pin sqft text, only when it says "carpet"
//   configurations, rera_numbers, key_usps, youtube_url, launch_date, project_type, developer, locality ← pin
//   construction_status ← pin status "upcoming" only; sales_status "Sold Out" ← pin status "sold"
//   cover_image_path ← first gallery photo already on the form (pin photos are developer logos, not used)

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pg = require('pg');

const APPLY = process.argv.includes('--apply');
const REVERT = process.argv.find((a) => a.startsWith('--revert='))?.slice(9);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/, ''), ssl: { rejectUnauthorized: false }, max: 3 });
const q = (sql, params) => pool.query(sql, params);

if (REVERT) {
  const before = JSON.parse(readFileSync(path.join(REVERT, 'before.json'), 'utf8'));
  for (const s of before.submissions) await q(`UPDATE project_submissions SET doc = $2::jsonb WHERE id = $1`, [s.id, JSON.stringify(s)]);
  for (const p of before.projects) await q(`UPDATE projects SET doc = $2::jsonb WHERE id = $1`, [p.id, JSON.stringify(p)]);
  console.log(`reverted ${before.submissions.length} submissions, ${before.projects.length} projects`);
  await pool.end(); process.exit(0);
}

const empty = (v) => v == null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const STATE = { pune: 'Maharashtra', mumbai: 'Maharashtra', 'navi mumbai': 'Maharashtra', thane: 'Maharashtra', bengaluru: 'Karnataka', bangalore: 'Karnataka',
  hyderabad: 'Telangana', chennai: 'Tamil Nadu', noida: 'Uttar Pradesh', 'greater noida': 'Uttar Pradesh', gurugram: 'Haryana', gurgaon: 'Haryana', dubai: 'Dubai' };
const TYPES = ['Residential', 'Commercial', 'Mixed-Use', 'Plotted Development', 'Land Parcel'];

function parsePrice(s) {
  const t = String(s || '').replace(/\*/g, '').replace(/\s+/g, ' ').trim();
  const U = (u) => (/^c/i.test(u) ? 'Crore' : /^l/i.test(u) ? 'Lakh' : null);
  const unit = '(Cr|CR|Crore|Crores|L|Lakh|Lakhs|Lac|Lacs|lakh|lakhs|lacs)';
  let m = t.match(new RegExp(`^₹ ?([\\d.]+) ?${unit}( onwards| Onwards)?$`));
  if (m) return { price_min: +m[1], price_unit: U(m[2]) };
  m = t.match(new RegExp(`^₹ ?([\\d.]+) ?${unit}? ?[–-] ?₹? ?([\\d.]+) ?${unit}$`));
  if (m) {
    const u1 = U(m[2] || m[4]); const u2 = U(m[4]);
    if (u1 === u2) return +m[1] < +m[3] ? { price_min: +m[1], price_max: +m[3], price_unit: u2 } : null;
    if (u1 === 'Lakh' && u2 === 'Crore') return { price_min: +(m[1] / 100).toFixed(4), price_max: +m[3], price_unit: 'Crore' };
  }
  return null;
}
function parseCarpet(s) {
  const t = String(s || '');
  if (!/carpet/i.test(t) || /exclusive|\+/i.test(t)) return null;
  const n = (t.match(/\d[\d,]*(\.\d+)?/g) || []).map((x) => +x.replace(/,/g, '')).filter((x) => x >= 100 && x <= 100000);
  if (n.length === 1) return { carpet_area_min: n[0] };
  if (n.length === 2 && n[0] <= n[1]) return { carpet_area_min: n[0], carpet_area_max: n[1] };
  return null;
}
function parseConfig(s) {
  const t = String(s || ''); const out = new Set();
  if (/\d\s*(-|–|to)\s*\d+(\.\d)?\s*BHK/i.test(t)) return null; // a range like "1-3 BHK": leave it
  const nums = [...t.matchAll(/(\d+(?:\.\d)?)(?=(?:(?:\s*(?:\/|,|&|\band\b|\bor\b)\s*)+\d+(?:\.\d)?)*\s*BHK)/gi)].map((m) => m[1]);
  if (nums.length !== (t.match(/\d+(?:\.\d)?/g) || []).length || /jodi/i.test(t)) return null; // anything not understood: leave it
  for (const x of nums) {
    if (x === '1' || x === '1.5' || x === '2' || x === '2.5' || x === '3' || x === '3.5' || x === '4') out.add(`${x} BHK`);
    else if (+x >= 5) out.add('5+ BHK');
    else return null; // something we don't understand: leave it
  }
  for (const [re, v] of [[/\bstudio\b/i, 'Studio'], [/\bvillas?\b/i, 'Villa'], [/row ?houses?/i, 'Row House'], [/penthouses?/i, 'Penthouse'], [/duplex/i, 'Duplex'],
    [/\bplots?\b|\bplotted\b/i, 'Plot'], [/\bshops?\b|\bretail\b/i, 'Shop'], [/\boffices?\b/i, 'Office'], [/showrooms?/i, 'Showroom']]) if (re.test(t)) out.add(v);
  return out.size ? [...out] : null;
}
const RERA_RE = /^(P\d{11}|P[RMCP]\d{13}|PRM\/KA\/RERA\/\d{4}\/\d{3}\/P[RL]\/\d{5,}|UPRERAPRJ\d{5,}(\/\d{2}\/\d{4})?|GGM\/\d{3,4}\/\d{3}\/\d{4}\/\d{2,3}|RC\/REP\/HARERA\/GGM\/\d+\/\d+\/\d{4}\/\d+)$/;
function parseRera(s) {
  const parts = String(s || '').split(/[\s,|;]+|\s\/\s/).map((x) => x.trim()).filter(Boolean);
  const ok = parts.filter((x) => RERA_RE.test(x));
  return ok.length ? [...new Set(ok)] : null;
}
function parseMonth(s) {
  const m = String(s || '').trim().match(/^([A-Za-z]+)\.? (\d{4})$/);
  if (!m) return null;
  const k = m[1].toLowerCase();
  const mo = MON[k] || MON[k.slice(0, 3)];
  return mo ? `${m[2]}-${String(mo).padStart(2, '0')}` : null;
}
const ytOk = (u) => /^https?:\/\/(www\.|m\.)?(youtube\.com\/(watch\?v=|shorts\/|embed\/|live\/)|youtu\.be\/)[\w-]{6,}/.test(String(u || '').trim());

const { rows } = await q(`SELECT p.doc - 'image' - 'brochure_image' AS pin, pr.doc AS proj, s.doc AS sub
  FROM pins p JOIN projects pr ON pr.id = p.doc->>'intake_project_id' JOIN project_submissions s ON s.id = pr.doc->>'submission_id'
  WHERE coalesce(p.doc->>'hidden','false') <> 'true'`);

const plans = []; const log = [];
for (const { pin, proj, sub } of rows) {
  const set = {}; const pset = {};
  const add = (k, v, src) => {
    if (v == null || empty(v) || !empty(sub[k])) return;
    set[k] = v; if (empty(proj[k])) pset[k] = v;
    log.push([pin.number, pin.id, pin.title, k, Array.isArray(v) ? v.join(' | ') : v, src]);
  };
  if (sub.lat != null && sub.lng != null) add('google_maps_link', `https://www.google.com/maps?q=${sub.lat},${sub.lng}`, 'pin coordinates');
  add('state', STATE[String(sub.city || '').toLowerCase().trim()], 'city');
  if (empty(sub.price_min) && !sub.price_on_request) {
    const pr = parsePrice(pin.price);
    if (pr) { for (const [k, v] of Object.entries(pr)) add(k, v, `pin price "${pin.price}"`); add('currency', 'INR', 'pin price ₹'); }
    else if (/price on request/i.test(pin.price || '')) { set.price_on_request = true; log.push([pin.number, pin.id, pin.title, 'price_on_request', true, `pin price "${pin.price}"`]); }
  }
  if (empty(sub.carpet_area_min)) { const c = parseCarpet(pin.sqft); if (c) { for (const [k, v] of Object.entries(c)) add(k, v, `pin sqft "${pin.sqft}"`); add('area_unit', 'sq ft', 'pin sqft'); } }
  add('configurations', parseConfig(pin.configuration), `pin "${pin.configuration}"`);
  add('rera_numbers', parseRera(pin.rera_number), `pin "${pin.rera_number}"`);
  if (pin.key_usp) add('key_usps', String(pin.key_usp).split(/\s*[·•\n]\s*/).filter(Boolean).slice(0, 3).join('\n'), 'pin key USP');
  if (ytOk(pin.youtube_video_url)) add('youtube_url', pin.youtube_video_url.trim(), 'pin YouTube');
  add('launch_date', parseMonth(pin.launch_date), `pin "${pin.launch_date}"`);
  if (TYPES.includes(pin.type)) add('project_type', pin.type, 'pin type');
  if (pin.developer) add('developer_name', String(pin.developer).trim(), 'pin developer');
  const loc = String(pin.location || '').split(',')[0].trim();
  if (loc && loc.toLowerCase() !== String(sub.city || '').toLowerCase()) add('locality', loc, `pin location "${pin.location}"`);
  if (pin.status === 'upcoming') add('construction_status', 'Upcoming', 'pin status');
  if (pin.status === 'sold') add('sales_status', 'Sold Out', 'pin status');
  if (empty(sub.cover_image_path) && (sub.gallery_paths || []).length) {
    const p0 = sub.gallery_paths[0];
    add('cover_image_path', p0, 'first gallery photo');
    if (empty(proj.cover_image_url) && sub.published_media?.[p0]) pset.cover_image_url = sub.published_media[p0];
  }
  if (Object.keys(set).length) plans.push({ pin, proj, sub, set, pset });
}

const byField = {}; for (const r of log) byField[r[3]] = (byField[r[3]] || 0) + 1;
console.log(`${plans.length} forms get values:`, byField);
const csv = (rs) => rs.map((r) => r.map((x) => `"${String(x ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
const LOG = `seo-doc/enrichment/live-project-enrichment/PIN-TO-FORM-SYNC-2026-11-21${APPLY ? '' : '-preview'}.csv`;
writeFileSync(LOG, csv([['pin_no', 'pin_id', 'title', 'field', 'value', 'source'], ...log]));
console.log(`log → ${LOG}`);
if (!APPLY) { console.log('Dry run. Pass --apply to write.'); await pool.end(); process.exit(0); }

const dir = path.resolve(`migration/backup/pg-snapshot-${new Date().toISOString().replace(/[:.]/g, '-')}-before-pin-to-form-sync`);
mkdirSync(dir, { recursive: true });
writeFileSync(path.join(dir, 'before.json'), JSON.stringify({ submissions: plans.map((p) => p.sub), projects: plans.map((p) => p.proj) }));
console.log(`backup → ${path.relative(process.cwd(), dir)}`);
for (const p of plans) {
  await q(`UPDATE project_submissions SET doc = doc || $2::jsonb WHERE id = $1`, [p.sub.id, JSON.stringify(p.set)]);
  if (Object.keys(p.pset).length) await q(`UPDATE projects SET doc = doc || $2::jsonb WHERE id = $1`, [p.proj.id, JSON.stringify(p.pset)]);
}
// verify: no previously filled field changed
const { rows: after } = await q(`SELECT doc FROM project_submissions WHERE id = ANY($1)`, [plans.map((p) => p.sub.id)]);
const am = new Map(after.map((r) => [r.doc.id, r.doc])); let bad = 0;
for (const p of plans) for (const [k, v] of Object.entries(p.sub)) if (!empty(v) && JSON.stringify(am.get(p.sub.id)[k]) !== JSON.stringify(v)) { bad++; console.log('CHANGED', p.sub.id, k); }
console.log(`applied to ${plans.length} forms; existing values changed: ${bad}`);
await pool.end();
