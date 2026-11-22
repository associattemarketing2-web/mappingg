// One-off (19 Nov 2026): fill empty project details on live pins from the developer's official project page.
//
//   node --env-file=.env migration/enrich-official-2026-11-19.mjs <facts.jsonl> <img-dir>            (dry run)
//   node --env-file=.env migration/enrich-official-2026-11-19.mjs <facts.jsonl> <img-dir> --apply    (backup, write)
//
// <facts.jsonl>: one line per project, read by hand from the official page (same RERA no. on the page, or the
// developer's only project of that name):
//   { id: <pin id>, title: <pin title>, page: <official url>, d?: description, u?: "usp · usp", am?: [amenities],
//     cfg?: ["2 BHK", ...], price?: {min, max?, unit: "Lakh"|"Crore", basis?},
//     mix?: [{config, area, price}],      // BHK-wise rows as stated on the page (price "" when the page has none)
//     sqft?: {min, max}, poss?: "YYYY-MM", acres?, towers?, floors?, units?, whole?: false,
//     photos?: ["01", ...], pkey?: <dir under img-dir> }
//
// Rules (user: never remove or overwrite existing data, only add):
//   - A field is written only when it is empty on the project AND its intake submission (and on the pin for pin fields).
//   - unit_mix: if empty → official rows; if present, only EMPTY price/area cells of rows whose config matches are filled.
//   - Lists (amenities, additional_details, gallery) only grow. Hidden pins are skipped.
//   - Every changed record is snapshotted first; every change goes to a CSV log.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pg = require('pg');

const APPLY = process.argv.includes('--apply');
const [FACTS, IMG_DIR] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!FACTS || !IMG_DIR) throw new Error('pass <facts.jsonl> <img-dir>');
const TODAY = new Date().toISOString().slice(0, 10);
const TAG = process.argv.find((a) => a.startsWith('--tag='))?.slice(6) || 'official';

const AMENITIES = new Set(['Clubhouse', 'Swimming Pool', 'Gym', 'Kids Play Area', 'Jogging Track', 'Landscaped Garden', 'Indoor Games', 'Multipurpose Hall', 'Co-working Space', 'Sports Court', 'Yoga Deck', 'Senior Citizen Area', 'Pet Park', 'Amphitheatre', 'Party Lawn', 'Library', 'Mini Theatre', 'Spa / Sauna', 'Retail / Shops', '24x7 Security', 'CCTV', 'Power Backup', 'EV Charging', 'Rainwater Harvesting', 'Solar Power', 'Sewage Treatment Plant', 'Visitor Parking', 'Covered Parking', 'Lifts', 'Fire Safety']);
const facts = readFileSync(FACTS, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
for (const f of facts) {
  if (!f.id) throw new Error(`fact without pin id: ${f.title}`);
  for (const a of f.am || []) if (!AMENITIES.has(a)) throw new Error(`${f.title}: unknown amenity ${a}`);
  if (f.possRera && !/^\d{4}-\d{2}$/.test(f.possRera)) throw new Error(`${f.title}: bad RERA possession ${f.possRera}`);
  for (const r of f.rera || []) if (!/^(P\d{11}|P[RMCP]\d{13})$/.test(r)) throw new Error(`${f.title}: bad MahaRERA no ${r}`);
  if (f.poss && !/^\d{4}-\d{2}$/.test(f.poss)) throw new Error(`${f.title}: bad possession ${f.poss}`);
  if (f.price && !['Lakh', 'Crore'].includes(f.price.unit)) throw new Error(`${f.title}: bad price unit`);
  for (const p of f.photos || []) if (!existsSync(path.join(IMG_DIR, String(f.pkey), 'cand', `${p}.jpg`))) throw new Error(`${f.title}: missing photo ${p}`);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/, ''), ssl: { rejectUnauthorized: false }, max: 3 });
const q = (sql, params) => pool.query(sql, params);
const empty = (v) => v == null || v === '' || v === 0 || (Array.isArray(v) && v.length === 0);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (ym) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const fmt = (n) => Number(n).toLocaleString('en-IN');
const priceLabel = (pr) => {
  const u = pr.unit === 'Lakh' ? 'L' : 'Cr';
  return pr.max != null && +pr.max !== +pr.min ? `₹ ${+pr.min} – ${+pr.max} ${u}` : `₹ ${+pr.min} ${u} onwards`;
};
const cfgKey = (s) => String(s).toLowerCase().replace(/\s+/g, '').replace(/apartments?|flats?|homes?|residences?/g, '');

const { rows } = await q(`SELECT p.doc - 'image' - 'brochure_image' AS pin, pr.doc AS proj, s.doc AS sub
  FROM pins p LEFT JOIN projects pr ON pr.id = p.doc->>'intake_project_id' LEFT JOIN project_submissions s ON s.id = pr.doc->>'submission_id'
  WHERE p.doc->>'id' = ANY($1)`, [facts.map((f) => f.id)]);
const byId = new Map(rows.map((r) => [r.pin.id, r]));

const plans = []; const log = [];
for (const f of facts) {
  const r = byId.get(f.id);
  if (!r) { console.log(`skip ${f.title}: pin not found`); continue; }
  const { pin, proj, sub } = r;
  if (pin.hidden === true || pin.rejected === true) { console.log(`skip #${pin.number}: hidden`); continue; }
  if (f.title && f.title !== pin.title) { console.log(`skip #${pin.number}: title changed (${f.title} → ${pin.title})`); continue; }
  if (!proj) { console.log(`skip #${pin.number}: no intake record`); continue; }
  const whole = f.whole !== false;
  const projSet = {}; const pinSet = {};
  const want = (field, value) => {
    if (value == null || value === '' || (Array.isArray(value) && !value.length)) return;
    if (!empty(proj[field]) || (sub && !empty(sub[field]))) return;
    projSet[field] = value;
  };
  // description / USP / configuration
  if (f.d) { want('short_description', f.d); if (empty(pin.description)) pinSet.description = f.d; }
  const usp = f.u ? f.u.replace(/\s*·\s*/g, ' | ') : '';
  want('key_usps', usp); if (usp && empty(pin.key_usp)) pinSet.key_usp = usp;
  if (empty(pin.configuration)) want('configurations', f.cfg); if (f.cfg?.length && empty(pin.configuration)) pinSet.configuration = f.cfg.join(' / ');
  // amenities (grow only)
  if (f.am?.length) {
    const have = [...new Set([...(proj.amenities || []), ...((sub && sub.amenities) || [])])];
    const add = f.am.filter((a) => !have.includes(a));
    if (add.length) projSet.amenities = [...(proj.amenities || []), ...add];
  }
  // BHK-wise unit mix
  if (f.mix?.length) {
    const cur = Array.isArray(proj.unit_mix) ? proj.unit_mix : [];
    const subMix = sub && Array.isArray(sub.unit_mix) ? sub.unit_mix : [];
    if (!cur.length && !subMix.length) projSet.unit_mix = f.mix.map((m) => ({ config: m.config, area: m.area || '', price: m.price || '' }));
    else if (cur.length) {
      let changed = false;
      const next = cur.map((row) => {
        const m = f.mix.find((x) => cfgKey(x.config) === cfgKey(row.config)) || f.mix.find((x) => cfgKey(row.config).startsWith(cfgKey(x.config)));
        if (!m) return row;
        const out = { ...row };
        if (empty(row.price) && m.price) { out.price = m.price; changed = true; }
        if (empty(row.area) && m.area) { out.area = m.area; changed = true; }
        return out;
      });
      // official rows for configurations not on record yet
      const extra = f.mix.filter((m) => !cur.some((row) => cfgKey(row.config) === cfgKey(m.config) || cfgKey(row.config).startsWith(cfgKey(m.config))));
      if (extra.length) { next.push(...extra.map((m) => ({ config: m.config, area: m.area || '', price: m.price || '' }))); changed = true; }
      if (changed) projSet.unit_mix = next;
    }
  }
  if (f.sqft && empty(proj.carpet_area_min) && empty(proj.carpet_area_max) && (!sub || (empty(sub.carpet_area_min) && empty(sub.carpet_area_max)))) {
    projSet.carpet_area_min = f.sqft.min; projSet.carpet_area_max = f.sqft.max ?? f.sqft.min;
    if (empty(proj.area_unit)) projSet.area_unit = 'sq ft';
  }
  if (f.sqft && empty(pin.sqft)) pinSet.sqft = f.sqft.max && f.sqft.max !== f.sqft.min ? `${fmt(f.sqft.min)} – ${fmt(f.sqft.max)} sq ft${f.sqft.basis ? ' ' + f.sqft.basis : ''}` : `${fmt(f.sqft.min)} sq ft${f.sqft.basis ? ' ' + f.sqft.basis : ''}`;
  if (whole) { want('land_area_acres', f.acres); want('towers', f.towers); want('floors', f.floors); want('total_units', f.units); }
  // RERA no(s). shown on the official page / Google result for this project; RERA possession date as stated
  if (f.rera?.length) { want('rera_numbers', f.rera); if (empty(pin.rera_number)) pinSet.rera_number = f.rera.join(' '); }
  if (f.possRera) want('possession_date_rera', f.possRera);
  if (f.poss && empty(pin.possession_timeline)) { want('possession_date_target', f.poss); pinSet.possession_timeline = monthLabel(f.poss); }
  // a price already shown on the pin wins; the project price is only filled alongside an empty pin price
  if (f.price && empty(pin.price) && empty(proj.price_min) && empty(proj.price_max) && !proj.price_on_request && (!sub || (empty(sub.price_min) && empty(sub.price_max) && !sub.price_on_request))) {
    Object.assign(projSet, { currency: 'INR', price_min: f.price.min, price_max: f.price.max ?? null, price_unit: f.price.unit, price_on_request: false, price_label: priceLabel(f.price) });
  }
  if (projSet.price_label) pinSet.price = projSet.price_label;
  if (f.yt && empty(pin.youtube_video_url) && empty(proj.youtube_url)) { pinSet.youtube_video_url = f.yt; want('youtube_url', f.yt); }
  // official page link on the pin (custom field) when it has none
  if (f.page && !(pin.custom_fields || []).some((c) => String(c.value || '').includes(f.page)))
    pinSet.custom_fields = [...(pin.custom_fields || []), { id: 'enrich-official-project-page', label: 'Official project page', value: f.page, visible: true }];
  const details = Array.isArray(proj.additional_details) ? proj.additional_details : [];
  const addDetails = [];
  if (f.page && Object.keys(projSet).length && !details.some((d) => String(d.value || '').includes(f.page)))
    addDetails.push({ label: 'Details source (official project page)', value: `${f.page} (checked ${TODAY})` });
  if (projSet.price_label || projSet.unit_mix?.some((m) => m.price)) addDetails.push({ label: 'Price source (official)', value: `${f.price?.basis || 'as stated on the official project page'}, checked ${TODAY}` });
  // photos
  let photoPaths = [];
  if (f.photos?.length && empty(proj.gallery_urls) && (!sub || empty(sub.gallery_paths))) {
    const owner = sub ? sub.id : `proj-${proj.id}`;
    photoPaths = f.photos.slice(0, 10).map((p) => ({ file: path.join(IMG_DIR, String(f.pkey), 'cand', `${p}.jpg`), path: `${owner}/official-${String(pin.id).slice(0, 8)}-${p}.jpg` }));
    addDetails.push({ label: 'Photos source (official project page)', value: `${f.page} (checked by eye ${TODAY})` });
  }
  if (addDetails.length) projSet.additional_details = [...details, ...addDetails];
  if (!Object.keys(projSet).length && !Object.keys(pinSet).length && !photoPaths.length) { console.log(`#${pin.number} ${pin.title}: nothing empty to fill`); continue; }
  plans.push({ pin, proj, sub, projSet, pinSet, photoPaths, f, addDetails });
  for (const [k, v] of Object.entries(projSet)) if (k !== 'additional_details') log.push([pin.number, pin.title, 'project', k, v, f.page]);
  for (const [k, v] of Object.entries(pinSet)) if (k !== 'custom_fields') log.push([pin.number, pin.title, 'pin', k, v, f.page]);
  if (photoPaths.length) log.push([pin.number, pin.title, 'project', 'gallery', `${photoPaths.length} photos`, f.page]);
}

const byField = {};
for (const c of log) byField[`${c[2]}.${c[3]}`] = (byField[`${c[2]}.${c[3]}`] || 0) + 1;
for (const p of plans) console.log(`#${p.pin.number} ${p.pin.title}: ${[...Object.keys(p.projSet).filter((k) => k !== 'additional_details'), ...Object.keys(p.pinSet).map((k) => 'pin.' + k), p.photoPaths.length ? `${p.photoPaths.length} photos` : ''].filter(Boolean).join(', ')}`);
console.log(`\n${plans.length} projects, ${log.length} changes`, JSON.stringify(byField));
if (process.argv.includes('--show')) for (const p of plans) console.log(`\n#${p.pin.number}`, JSON.stringify({ ...p.projSet, additional_details: undefined }), JSON.stringify({ ...p.pinSet, custom_fields: undefined }));
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
    for (const ph of p.photoPaths) {
      const buf = readFileSync(ph.file);
      if (p.sub) await putFile('submission-media', ph.path, buf);
      await putFile('project-media', ph.path, buf);
    }
    if (p.sub) {
      const published = { ...(p.sub.published_media || {}) };
      for (const ph of p.photoPaths) published[ph.path] = publicUrl(ph.path);
      await q(`UPDATE project_submissions SET doc = doc || $2::jsonb WHERE id = $1`, [p.sub.id, JSON.stringify({ gallery_paths: p.photoPaths.map((x) => x.path), published_media: published })]);
    }
    projSet.gallery_urls = p.photoPaths.map((x) => publicUrl(x.path));
  }
  if (Object.keys(projSet).length) {
    await q(`UPDATE projects SET doc = doc || $2::jsonb WHERE id = $1`, [p.proj.id, JSON.stringify({ ...projSet, updated_at: nowTs })]);
    const subSet = { ...p.projSet }; delete subSet.gallery_urls;
    // the form keeps its own additional_details rows (they can differ from the project's): only append
    if (subSet.additional_details) subSet.additional_details = [...((p.sub && p.sub.additional_details) || []), ...p.addDetails];
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
