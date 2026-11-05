// One-off (5 Nov 2026): fill empty details on live pins #400–#500 and their Projects Intake records.
//
//   node --env-file=.env migration/enrich-pins-400-500-2026-11-05.mjs <facts.jsonl> <img-dir>            (dry run)
//   node --env-file=.env migration/enrich-pins-400-500-2026-11-05.mjs <facts.jsonl> <img-dir> --apply    (backup, write)
//
// Two sources, both official:
//   1. The RERA data already stored on each record (additional_details "Unit mix (RERA)", land area, completion).
//      From it we fill the structured unit mix, carpet range, configurations and a plain factual description.
//   2. <facts.jsonl>: one line per project whose developer's own project page was found and matched (same RERA
//      number, or the developer's only project of that name). Read by hand: description, USPs, amenities, counts,
//      starting price as stated on the page, and photo picks checked by eye (renders/sample flats of that project
//      only; no logos, plans, maps, stock photos or other projects). Photos: <img-dir>/<key>/cand/<NN>.jpg.
//
// Safety (user rule: never remove or overwrite existing data, only add):
//   - A field is written only when it is empty on the project AND on its intake submission (and on the pin for pin
//     fields). Lists (amenities, additional_details) only gain new entries.
//   - Records for one phase / tower ("whole": false) never get project-wide counts.
//   - Hidden pins are skipped. Every record that changes is snapshotted first; every change is logged to CSV.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pg = require('pg');

const APPLY = process.argv.includes('--apply');
const [FACTS, IMG_DIR] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!FACTS || !IMG_DIR) throw new Error('pass <facts.jsonl> <img-dir>');
const TODAY = new Date().toISOString().slice(0, 10);
// --range=1-918 widens the run beyond the original #400–#500; pass "-" as <facts.jsonl> for a RERA-only run.
const RANGE = (process.argv.find((a) => a.startsWith('--range='))?.slice(8) || '400-500').split('-').map(Number);
const TAG = `pins-${RANGE[0]}-${RANGE[1]}`;

// Descriptions this script generated from RERA data in earlier runs (from its own change logs). Only these may later
// be replaced by a developer's official description; any other existing text is never touched.
const OUR_TEXT = new Set();
{
  const LOGDIR = path.resolve('seo-doc/enrichment/live-project-enrichment');
  for (const name of (existsSync(LOGDIR) ? (await import('node:fs')).readdirSync(LOGDIR) : []).filter((n) => /^PINS-.*\.csv$/.test(n))) {
    for (const line of readFileSync(path.join(LOGDIR, name), 'utf8').split('\n')) {
      const m = line.match(/^"[^"]*","(?:[^"]|"")*","(?:project|pin)","(?:short_description|description)","((?:[^"]|"")*)","RERA data on record"/);
      if (m) OUR_TEXT.add(m[1].replace(/""/g, '"').trim());
    }
  }
}
console.error(`known generated descriptions: ${OUR_TEXT.size}`);
const facts = new Map(FACTS === '-' ? [] : readFileSync(FACTS, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((f) => [f.id || f.n, f]));
// Pins can be renumbered while work is in progress: facts carry the pin id (and title) and are matched on those.

const AMENITIES = new Set(['Clubhouse', 'Swimming Pool', 'Gym', 'Kids Play Area', 'Jogging Track', 'Landscaped Garden', 'Indoor Games', 'Multipurpose Hall', 'Co-working Space', 'Sports Court', 'Yoga Deck', 'Senior Citizen Area', 'Pet Park', 'Amphitheatre', 'Party Lawn', 'Library', 'Mini Theatre', 'Spa / Sauna', 'Retail / Shops', '24x7 Security', 'CCTV', 'Power Backup', 'EV Charging', 'Rainwater Harvesting', 'Solar Power', 'Sewage Treatment Plant', 'Visitor Parking', 'Covered Parking', 'Lifts', 'Fire Safety']);
for (const f of facts.values()) {
  for (const a of f.am || []) if (!AMENITIES.has(a)) throw new Error(`#${f.n}: unknown amenity ${a}`);
  if (f.poss && !/^\d{4}-\d{2}$/.test(f.poss)) throw new Error(`#${f.n}: bad possession ${f.poss}`);
  for (const p of f.photos || []) if (!existsSync(path.join(IMG_DIR, String(f.pkey || f.n), 'cand', `${p}.jpg`))) throw new Error(`#${f.n}: missing photo ${p}`);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/, ''), ssl: { rejectUnauthorized: false }, max: 3 });
const q = (sql, params) => pool.query(sql, params);

const empty = (v) => v == null || v === '' || v === 0 || (Array.isArray(v) && v.length === 0);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (ym) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const fmt = (n) => Number(n).toLocaleString('en-IN');
const detail = (p, prefix) => (p.additional_details || []).find((d) => String(d.label || '').startsWith(prefix))?.value || '';
const tidy = (s) => {
  const t = String(s || '').replace(/^M\/[sS]\.?\s*/, '').replace(/\s+/g, ' ').trim().replace(/\.$/, '');
  if (t !== t.toUpperCase()) return t;
  const small = new Set(['OF', 'AND', 'BY', 'AT', 'IN', 'ON']);
  const title = (w) => w.charAt(0) + w.slice(1).toLowerCase();
  return t.split(' ').map((w, i) => (small.has(w) ? (i ? w.toLowerCase() : title(w)) : w === 'THE' ? 'The' : w.length <= 3 && /^[A-Z&']+$/.test(w) ? w : title(w))).join(' ');
};
const priceLabel = (pr) => {
  const u = pr.unit === 'Lakh' ? 'L' : 'Cr';
  return pr.max != null && +pr.max !== +pr.min ? `₹ ${+pr.min} – ${+pr.max} ${u}` : `₹ ${+pr.min} ${u} onwards`;
};
const MUMBAI_AREA = { '400053': 'Andheri West', '400080': 'Mulund West', '400057': 'Vile Parle East', '400104': 'Goregaon West', '400054': 'Santacruz West', '400068': 'Dahisar', '400091': 'Borivali West' };

// "2 BHK: 71 units, avg 72.1 sq m (776 sq ft) carpet; 3 BHK: …" → rows
function reraMix(p) {
  const txt = detail(p, 'Unit mix (RERA)');
  return txt.split(';').map((s) => s.trim()).map((s) => s.match(/^(.+?):\s*(\d+) units, avg ([\d.]+) sq m \(([\d,]+) sq ft\) carpet/))
    .filter(Boolean).map((m) => ({ config: m[1].trim().replace(/^Sutdio$/i, 'Studio'), units: Number(m[2]), sqft: Number(m[4].replace(/,/g, '')) }));
}
const residential = (r) => !/ews|commercial|club|shop|office/i.test(r.config);
function bhkOf(config) {
  const c = config.toLowerCase();
  if (/studio|sutdio/.test(c)) return 'Studio';
  const m = c.match(/(\d(?:\.5)?)\s*bhk/);
  if (!m) return null;
  return Number(m[1]) >= 5 ? '5+ BHK' : `${m[1]} BHK`;
}

function reraDescription(p, pin) {
  const name = tidy(p.project_name);
  const dev = tidy(detail(p, 'Promoter legal name') || p.developer_name);
  const rera = (p.rera_numbers || [])[0] || '';
  if (p.city === 'Mumbai') {
    const pinc = String(p.address || '').match(/\b(4\d{5})\b/)?.[1];
    const area = MUMBAI_AREA[pinc] ? `${MUMBAI_AREA[pinc]}, Mumbai` : 'Mumbai';
    return `${name} is a MahaRERA-registered residential project (${rera}) by ${dev} in ${area}${pinc ? ` (PIN ${pinc})` : ''}.`;
  }
  const village = String(p.address || '').match(/([A-Za-z][A-Za-z .]+?)\s+Village/i)?.[1]?.split(/\s+of\s+/i).pop().trim().replace(/^(of|at|situated at)\s+/i, '');
  const city = tidy(p.city || 'Bengaluru');
  const where = [...new Set([village && tidy(village), tidy(p.locality), city].filter(Boolean).map((s) => s.trim()))]
    .filter((s, i, a) => !a.some((o, j) => j !== i && o.toLowerCase() === s.toLowerCase() && j < i)).join(', ');
  const src = detail(p, 'Source (official registry)') + ' ' + rera;
  const registry = /karnataka|PRM\/KA/i.test(src) ? 'Karnataka RERA' : /maharera|maharashtra|\bP[RMC]?\d{8,}/i.test(src) ? 'MahaRERA' : /up-?rera|uprera/i.test(src) ? 'UP RERA'
    : /haryana|hrera|RC\/REP/i.test(src) ? 'HARERA' : /telangana|P0\d{4}/i.test(src) ? 'Telangana RERA' : /tnrera|tamil|TN\/\d/i.test(src) ? 'TN RERA' : 'RERA';
  const sub = detail(p, 'Project sub-type (RERA)').toLowerCase();
  const kind = /plot/.test(sub) || /plot/i.test((p.configurations || []).join(' ')) && !reraMix(p).length ? 'plotted development'
    : /villa/.test(sub) ? 'villa project' : /row/.test(sub) ? 'row-house project' : /apartment/.test(sub) || reraMix(p).length ? 'residential apartment project'
    : /commercial|office|retail|shop|it park|tech park|mall/i.test(`${p.project_type} ${p.project_name}`) ? (/mixed/i.test(p.project_type) ? 'mixed-use project' : 'commercial project')
    : /land|plot/i.test(p.project_type || '') ? 'land / plotted project' : /mixed/i.test(p.project_type || '') ? 'mixed-use project' : 'residential project';
  const acres = detail(p, 'Land area (RERA)').match(/\(([\d.]+) acres?\)/)?.[1];
  const mix = reraMix(p).filter(residential);
  const units = mix.reduce((a, r) => a + r.units, 0);
  const done = detail(p, 'Proposed completion (RERA)');
  const parts = [`${name} is a ${kind}${dev ? ` by ${dev}` : ''} at ${where}${rera ? `, registered with ${registry} (${rera})` : ''}.`];
  const plots = detail(p, 'Plot sizes (RERA)');
  if (plots) parts.push(`RERA lists ${plots.replace(/ each \(plot area\)$/, ' each')}${acres ? ` on ${acres} acres` : ''}.`);
  else if (mix.length) {
    const byCfg = mix.map((r) => `${r.config} (${r.units}, about ${fmt(r.sqft)} sq ft carpet)`).slice(0, 4).join(', ');
    parts.push(`RERA lists ${fmt(units)} homes${acres ? ` on ${acres} acre${acres === '1' ? '' : 's'}` : ''}: ${byCfg}${mix.length > 4 ? ' and more' : ''}.`);
  } else if (acres) parts.push(`The registered land area is ${acres} acres.`);
  if (/^\d{4}-\d{2}/.test(done)) parts.push(`Completion is proposed for ${monthLabel(done.slice(0, 7))}.`);
  return parts.join(' ');
}

const { rows } = await q(`SELECT p.doc - 'image' - 'brochure_image' AS pin, pr.doc AS proj, s.doc AS sub
  FROM pins p JOIN projects pr ON pr.id = p.doc->>'intake_project_id' LEFT JOIN project_submissions s ON s.id = pr.doc->>'submission_id'
  WHERE (p.doc->>'number')::int BETWEEN $1 AND $2 AND coalesce(pr.doc->>'is_live','') = 'true'
    AND coalesce(p.doc->>'pending_review','false') <> 'true' ORDER BY (p.doc->>'number')::int`, RANGE);

// RERA amenity wording → the app's amenity list.
const RERA_AM = [[/club ?house/i, 'Clubhouse'], [/swimming|kids pool/i, 'Swimming Pool'], [/\bgym/i, 'Gym'], [/children|kids play/i, 'Kids Play Area'],
  [/jogging/i, 'Jogging Track'], [/\bparks?\b|landscap|garden/i, 'Landscaped Garden'], [/indoor sports|indoor games|billiards|tt room|cards room|squash/i, 'Indoor Games'],
  [/community hall|party hall|multipurpose/i, 'Multipurpose Hall'], [/outdoor sports|basketball|badminton|tennis|court/i, 'Sports Court'],
  [/yoga|meditation/i, 'Yoga Deck'], [/senior citizen/i, 'Senior Citizen Area'], [/amphitheat/i, 'Amphitheatre'], [/cctv/i, 'CCTV'],
  [/power backup|dg yard/i, 'Power Backup'], [/rain ?water/i, 'Rainwater Harvesting'], [/solar/i, 'Solar Power'], [/sewage|\bstp\b/i, 'Sewage Treatment Plant'],
  [/\blifts?\b/i, 'Lifts'], [/fire fighting|fire safety/i, 'Fire Safety'], [/security room/i, '24x7 Security']];
const reraAmenities = (p) => [...new Set(detail(p, 'Amenities (RERA)').split(',').map((s) => s.trim()).flatMap((s) => RERA_AM.filter(([re]) => re.test(s)).map(([, a]) => a)))];

const plans = []; const log = [];
for (const { pin, proj, sub } of rows) {
  if (pin.hidden === true || pin.rejected === true) { console.log(`skip #${pin.number}: hidden`); continue; }
  let f = facts.get(pin.id) || facts.get(Number(pin.number)) || {};
  if (f.n != null && !f.id) { console.log(`skip facts for #${pin.number}: fact has no pin id (numbers may have changed)`); f = {}; }
  if (f.title && f.title !== pin.title) { console.log(`skip facts for #${pin.number}: title mismatch (${f.title} vs ${pin.title})`); f = {}; }
  const whole = f.whole !== false;
  const projSet = {}; const pinSet = {};
  const want = (field, value) => {
    if (value == null || value === '' || (Array.isArray(value) && !value.length)) return;
    if (!empty(proj[field]) || (sub && !empty(sub[field]))) return;
    projSet[field] = value;
  };
  // --- RERA layer
  const mix = reraMix(proj);
  const resMix = mix.filter(residential);
  want('unit_mix', mix.map((r) => ({ config: r.config, area: `${fmt(r.sqft)} sq ft carpet (RERA avg, ${r.units} units)`, price: '' })));
  if (resMix.length && empty(proj.carpet_area_min) && empty(proj.carpet_area_max) && (!sub || (empty(sub.carpet_area_min) && empty(sub.carpet_area_max)))) {
    const a = Math.min(...resMix.map((r) => r.sqft)), b = Math.max(...resMix.map((r) => r.sqft));
    projSet.carpet_area_min = a; projSet.carpet_area_max = b;
    if (empty(proj.area_unit)) projSet.area_unit = 'sq ft';
    if (empty(pin.sqft)) pinSet.sqft = a === b ? `${fmt(a)} sq ft carpet` : `${fmt(a)} – ${fmt(b)} sq ft carpet`;
  }
  const cfg = [...new Set([...(f.cfg || []), ...resMix.map((r) => bhkOf(r.config)).filter(Boolean)])];
  want('configurations', cfg);
  // --- description / USP
  const desc = f.d || reraDescription(proj, pin);
  const usp = f.u ? f.u.replace(/\s*·\s*/g, ' | ') : '';
  // Our own generated RERA sentence (written by this script earlier) gives way to the developer's official text.
  const ours = (v) => v === reraDescription(proj, pin) || OUR_TEXT.has(String(v || '').trim());
  if (f.d && ours(proj.short_description) && (!sub || empty(sub.short_description) || ours(sub.short_description))) projSet.short_description = desc;
  else want('short_description', desc);
  want('key_usps', usp);
  if (empty(pin.description) || (f.d && ours(pin.description))) pinSet.description = desc;
  if (usp && empty(pin.key_usp)) pinSet.key_usp = usp;
  if (cfg.length && empty(pin.configuration)) pinSet.configuration = cfg.join(' / ');
  // --- official page facts
  const amWant = [...new Set([...(f.am || []), ...reraAmenities(proj)])];
  if (amWant.length) {
    const have = [...new Set([...(proj.amenities || []), ...((sub && sub.amenities) || [])])];
    const add = amWant.filter((a) => !have.includes(a));
    if (add.length) projSet.amenities = [...(proj.amenities || []), ...add];
  }
  if (!f.poss && empty(pin.possession_timeline)) {
    const ym = String(proj.possession_date_target || proj.possession_date_rera || detail(proj, 'Proposed completion (RERA)')).slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(ym)) pinSet.possession_timeline = monthLabel(ym);
  }
  if (whole) { want('land_area_acres', f.acres); want('towers', f.towers); want('floors', f.floors); want('total_units', f.units); }
  if (f.poss) { want('possession_date_target', f.poss); if (empty(pin.possession_timeline)) pinSet.possession_timeline = monthLabel(f.poss); }
  if (f.price && empty(proj.price_min) && empty(proj.price_max) && !proj.price_on_request && (!sub || (empty(sub.price_min) && empty(sub.price_max) && !sub.price_on_request))) {
    Object.assign(projSet, { currency: 'INR', price_min: f.price.min, price_max: f.price.max ?? null, price_unit: f.price.unit, price_on_request: false, price_label: priceLabel(f.price) });
    if (empty(pin.price)) pinSet.price = priceLabel(f.price);
  }
  const details = Array.isArray(proj.additional_details) ? proj.additional_details : [];
  const addDetails = [];
  if (f.page && Object.keys(projSet).some((k) => !['unit_mix', 'carpet_area_min', 'carpet_area_max', 'area_unit'].includes(k)) && !details.some((d) => String(d.value || '').includes(f.page)))
    addDetails.push({ label: 'Details source (official project page)', value: `${f.page} (checked ${TODAY})` });
  if (projSet.price_label) addDetails.push({ label: 'Price source (official)', value: `${f.price.basis || `"${projSet.price_label}" as stated on the official page`}, checked ${TODAY}` });
  // --- photos
  let photoPaths = [];
  if (f.photos?.length && empty(proj.gallery_urls) && (!sub || empty(sub.gallery_paths))) {
    if (!sub) console.log(`#${pin.number}: no submission, photos skipped`);
    else {
      photoPaths = f.photos.slice(0, 10).map((p) => ({ file: path.join(IMG_DIR, String(f.pkey || f.n), 'cand', `${p}.jpg`), path: `${sub.id}/official-pin${pin.number}-${p}.jpg` }));
      addDetails.push({ label: 'Photos source (official project page)', value: `${f.page} (checked by eye ${TODAY})` });
    }
  }
  if (addDetails.length) projSet.additional_details = [...details, ...addDetails];
  if (!Object.keys(projSet).length && !Object.keys(pinSet).length && !photoPaths.length) continue;
  plans.push({ pin, proj, sub, projSet, pinSet, photoPaths, f });
  for (const [k, v] of Object.entries(projSet)) if (k !== 'additional_details') log.push([pin.number, proj.project_name, 'project', k, v, f.page || 'RERA data on record']);
  for (const [k, v] of Object.entries(pinSet)) log.push([pin.number, proj.project_name, 'pin', k, v, f.page || 'RERA data on record']);
  if (photoPaths.length) log.push([pin.number, proj.project_name, 'project', 'gallery', `${photoPaths.length} photos`, f.page]);
}

const byField = {};
for (const c of log) byField[`${c[2]}.${c[3]}`] = (byField[`${c[2]}.${c[3]}`] || 0) + 1;
for (const p of plans) console.log(`#${p.pin.number} ${p.proj.project_name}: ${[...Object.keys(p.projSet).filter((k) => k !== 'additional_details'), ...Object.keys(p.pinSet).map((k) => 'pin.' + k), p.photoPaths.length ? `${p.photoPaths.length} photos` : ''].filter(Boolean).join(', ')}`);
console.log(`\n${plans.length} projects, ${log.length} changes`, JSON.stringify(byField, null, 1));
if (process.argv.includes('--show')) for (const p of plans) console.log(`\n#${p.pin.number}`, JSON.stringify({ ...p.projSet, additional_details: undefined }, null, 1), JSON.stringify(p.pinSet, null, 1));
if (!APPLY) { console.log('Dry run. Pass --apply to write.'); await pool.end(); process.exit(0); }

const dir = path.resolve(`migration/backup/pg-snapshot-${new Date().toISOString().replace(/[:.]/g, '-')}-before-${TAG}`);
mkdirSync(dir, { recursive: true });
writeFileSync(path.join(dir, 'before.json'), JSON.stringify({ projects: plans.map((p) => p.proj), submissions: plans.map((p) => p.sub).filter(Boolean), pins: plans.map((p) => p.pin) }, null, 1));
console.log(`backup → ${path.relative(process.cwd(), dir)}/before.json`);

const publicUrl = (p) => `/api/partners/storage?bucket=project-media&path=${encodeURIComponent(p)}&public=1`;
async function putFile(bucket, p, buf) {
  const filename = `${bucket}/${p}`;
  await q(`DELETE FROM partners_media WHERE filename = $1`, [filename]);
  await q(`INSERT INTO partners_media (filename, content_type, metadata, data) VALUES ($1, $2, $3::jsonb, $4)`, [filename, 'image/jpeg', JSON.stringify({ bucket, path: p }), buf]);
}
const nowTs = new Date().toISOString();
for (const p of plans) {
  const projSet = { ...p.projSet };
  if (p.photoPaths.length) {
    const published = { ...(p.sub.published_media || {}) };
    for (const ph of p.photoPaths) {
      const buf = readFileSync(ph.file);
      await putFile('submission-media', ph.path, buf);
      await putFile('project-media', ph.path, buf);
      published[ph.path] = publicUrl(ph.path);
    }
    await q(`UPDATE project_submissions SET doc = doc || $2::jsonb WHERE id = $1`, [p.sub.id, JSON.stringify({ gallery_paths: p.photoPaths.map((x) => x.path), published_media: published })]);
    projSet.gallery_urls = p.photoPaths.map((x) => publicUrl(x.path));
  }
  if (Object.keys(projSet).length) {
    await q(`UPDATE projects SET doc = doc || $2::jsonb WHERE id = $1`, [p.proj.id, JSON.stringify({ ...projSet, updated_at: nowTs })]);
    const subSet = { ...p.projSet }; delete subSet.gallery_urls;
    if (p.sub && Object.keys(subSet).length) await q(`UPDATE project_submissions SET doc = doc || $2::jsonb WHERE id = $1`, [p.sub.id, JSON.stringify({ ...subSet, updated_at: nowTs })]);
  }
  if (Object.keys(p.pinSet).length) await q(`UPDATE pins SET doc = doc || $2::jsonb WHERE id = $1`, [p.pin.id, JSON.stringify({ ...p.pinSet, updated_at: nowTs })]);
}

const LOG = path.resolve(`seo-doc/enrichment/live-project-enrichment/${TAG.toUpperCase()}-${TODAY}-${Date.now()}.csv`);
mkdirSync(path.dirname(LOG), { recursive: true });
const cell = (x) => `"${(typeof x === 'string' ? x : JSON.stringify(x)).replace(/"/g, '""')}"`;
writeFileSync(LOG, ['pin_number,project,target,field,new_value,source,checked_on', ...log.map((c) => [...c, TODAY].map(cell).join(','))].join('\n') + '\n');
console.log(`log → ${path.relative(process.cwd(), LOG)} (${log.length} rows)`);
await pool.end();
