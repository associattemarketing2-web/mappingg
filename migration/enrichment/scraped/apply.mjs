// Enrich scraped_projects rows from the official registry pages saved by ka-research.mjs / hr-research.mjs.
//
//   Dry run:  node --env-file=.env migration/enrichment/scraped/apply.mjs
//   Write:    node --env-file=.env migration/enrichment/scraped/apply.mjs --apply [--limit N]
//
// What it writes, per row (scraped_projects only — never pins, projects, submissions or leads):
//   doc.enrichment  { review_status: 'Pending Review', fields, sources, review_required, ... }
//                   The extra facts (description, configurations, carpet areas, amenities, ...) live here;
//                   the row's registry `original` and its id/key/source fields are never changed.
//   doc.data        Only fields that are BLANK in the working copy are filled (address, pincode,
//                   original completion date, developer). A value that differs from a non-blank field
//                   is not written; it goes to review_required instead.
// Nothing is published: pin_check, lat/lng, submission links and deleted flags are untouched, so an
// enriched row can only reach Projects/the map the same way as before (a person adds it).
//
// Safety: rows are re-read just before writing and the update only applies if the row's `data` and
// `enrichment` are unchanged since that read; every written row is read back and compared.
// A row counts as enriched only if the read-back matches. Rows already enriched are skipped.
// Logs: seo-doc/enrichment/scraped-project-enrichment/PROJECT-CHANGE-LOG.csv (appended),
//       REVIEW-PENDING.csv and ENRICHMENT-SUMMARY.md (regenerated from the database after a run).

import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import pg from 'pg';
import { parseKa, parseHr } from './parsers.mjs';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const LIMIT = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : Infinity;
const CACHE = path.resolve('migration/backup/scraped-enrichment-cache');
const OUTDIR = path.resolve('seo-doc/enrichment/scraped-project-enrichment');
const LOG = path.join(OUTDIR, 'PROJECT-CHANGE-LOG.csv');
const COLS = ['record_id', 'project_name', 'field_name', 'old_value', 'new_value', 'source_url', 'source_type', 'confidence', 'enriched_at', 'save_status'];
const RUN = new Date().toISOString();
mkdirSync(OUTDIR, { recursive: true });

const url = new URL(process.env.DATABASE_URL);
const mode = url.searchParams.get('sslmode');
url.searchParams.delete('sslmode');
const db = new pg.Client(mode === 'disable' ? { connectionString: process.env.DATABASE_URL } : { connectionString: url.toString(), ssl: mode ? true : { rejectUnauthorized: false }, query_timeout: 600000 });
await db.connect();

// ---- helpers -------------------------------------------------------------------------------
const SQFT = 10.7639;
const r1 = (n) => Math.round(n * 10) / 10;
const ft = (sqm) => Math.round(sqm * SQFT).toLocaleString('en-IN');
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort()) : x));
const blank = (v) => v == null || String(v).trim() === '';
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
// Same project name: equal, or one contains the other ("Sovereign Park (Phase-I)" vs "SOVEREIGN PARK").
// Only used together with an exact registration-number match.
const sameName = (a, b) => { const x = norm(a), y = norm(b); return !!x && !!y && (x === y || (Math.min(x.length, y.length) >= 4 && (x.includes(y) || y.includes(x)))); };
const KA_INDEX = existsSync(path.join(CACHE, 'ka-index.json')) ? JSON.parse(readFileSync(path.join(CACHE, 'ka-index.json'), 'utf8')) : {};
const pageCells = (file) => (existsSync(file) ? gunzipSync(readFileSync(file)).toString('utf8').split('\n') : null);
const csv = (v) => { const s = v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v); return `"${s.replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`; };
const crore = (inr) => (inr >= 1e7 ? `₹${(inr / 1e7).toLocaleString('en-IN', { maximumFractionDigits: 2 })} Cr` : `₹${(inr / 1e5).toLocaleString('en-IN', { maximumFractionDigits: 2 })} Lakh`);

/** "2 BHK, 3 BHK" from a unit mix whose types look like configurations. */
function configurations(mix) {
  const types = [...new Set(mix.map((u) => u.type.replace(/\s+/g, ' ').trim()))];
  return types.length ? types.join(', ') : null;
}

// ---- build the enrichment for one row --------------------------------------------------------
// Returns { fields, fills, review, sources, source_type, verification } or { skip: reason }.
function buildKa(doc) {
  const o = doc.original, reg = o.rera_number;
  if (!reg) return { skip: 'no registration number on the registry list' };
  const file = path.join(CACHE, 'ka-pages', `${reg.replace(/\//g, '_')}.txt.gz`);
  const t = pageCells(file);
  if (!t) return { skip: 'registry detail page not available (not in the official Bengaluru Urban list or fetch failed)' };
  const p = parseKa(t);
  if (!p.ok) return { skip: `registry page not parsed: ${p.reason}` };
  if (p.reg_no !== reg) return { skip: `registry page shows ${p.reg_no}, not ${reg}` };
  if (!sameName(p.registry_project_name, o.project_name)) return { skip: `registry name "${p.registry_project_name}" differs from "${o.project_name}"`, review: true };
  const detailId = KA_INDEX[reg];
  const source = 'https://rera.karnataka.gov.in/projectDetails';
  const f = {};
  if (p.address) f.full_address = `${p.address}`.replace(/\s+,/g, ',');
  if (p.taluk) f.taluk = p.taluk;
  if (p.pincode) f.pincode = p.pincode;
  if (p.latitude != null) { f.registry_latitude = p.latitude; f.registry_longitude = p.longitude; }
  if (p.project_description) f.project_description = p.project_description;
  if (p.project_sub_type) f.project_sub_type = p.project_sub_type;
  if (p.project_status) f.registry_project_status = p.project_status;
  const isPlots = /plot/i.test(p.project_type || o.project_type || '');
  // Some pages add a summary row ("FLATS", 216) equal to the sum of the other rows; drop it.
  // The carpet figure is the total for the type (total ÷ units = per-unit average, checked against the
  // unit-wise list on new pages). An average under 15 sq m means it was entered per unit; keep only
  // averages between 15 and 1,500 sq m, otherwise no carpet area is saved for that type.
  const mix = p.unit_mix
    .filter((u, _, all) => !(all.length > 1 && u.count === all.reduce((s, x) => s + (x === u ? 0 : x.count), 0)))
    .map((u) => { const a = u.avg_carpet_sqm != null && u.avg_carpet_sqm < 15 && u.carpet_sqm >= 15 ? u.carpet_sqm : u.avg_carpet_sqm; return { ...u, avg_carpet_sqm: a != null && a >= 15 && a <= 1500 ? a : null }; });
  if (!isPlots && mix.length) {
    f.configurations = configurations(mix);
    f.unit_mix = mix.map((u) => ({ type: u.type, units: u.count, avg_carpet_sqm: u.avg_carpet_sqm, avg_carpet_sqft: u.avg_carpet_sqm ? Math.round(u.avg_carpet_sqm * SQFT) : null }));
    const parts = mix.filter((u) => u.avg_carpet_sqm).map((u) => `${u.type}: avg ${u.avg_carpet_sqm} sq m (${ft(u.avg_carpet_sqm)} sq ft) × ${u.count} units`);
    if (parts.length) f.carpet_area = `Carpet area (RERA): ${parts.join('; ')}`;
  }
  if (isPlots && p.plot_sizes.length) {
    const a = p.plot_sizes.map((x) => x.area_sqm), plots = p.plot_sizes.reduce((s, x) => s + x.count, 0);
    f.configurations = 'Residential plots';
    f.plot_sizes = `${plots} plots, ${r1(Math.min(...a))}–${r1(Math.max(...a))} sq m (${ft(Math.min(...a))}–${ft(Math.max(...a))} sq ft) each (plot area)`;
  }
  if (p.total_units) f.total_units = p.total_units;
  if (p.total_plots) f.total_plots = p.total_plots;
  if (p.towers) f.towers = p.towers;
  if (p.land_area_sqm) f.land_area = `${p.land_area_sqm.toLocaleString('en-IN')} sq m (${r1(p.land_area_sqm / 4046.86)} acres)`;
  if (p.total_carpet_sqm) f.total_carpet_area = `${p.total_carpet_sqm.toLocaleString('en-IN')} sq m (${ft(p.total_carpet_sqm)} sq ft) carpet, all units`;
  if (p.amenities.length) f.amenities = p.amenities;
  if (p.start_date) f.project_start_date = p.start_date;
  if (p.proposed_completion) f.proposed_completion = p.proposed_completion;
  if (p.approving_authority) f.approving_authority = p.approving_authority;
  if (p.approved_plan_number) f.approved_plan_number = p.approved_plan_number;
  if (p.plan_approval_date) f.plan_approval_date = p.plan_approval_date;
  if (p.project_cost_inr) f.project_cost = `${crore(p.project_cost_inr)} (total project cost declared to RERA, not a sale price)`;
  if (p.water_source) f.water_source = p.water_source;
  if (p.promoter_website) f.developer_website = p.promoter_website;
  if (p.promoter_name) f.registry_promoter_name = p.promoter_name;
  return { fields: f, parsed: p, source, source_note: `RERA Karnataka → View Project Details (detail id ${detailId}) for ${reg}`, source_type: 'official_rera_registry', verification: 'Verified — official RERA Karnataka project details, exact registration-number match' };
}

function buildHr(doc) {
  const o = doc.original;
  const id = (String(o.project_url || '').match(/searchprojectDetail\/(\d+)$/) || [])[1];
  if (!id) return { skip: 'no official project link on the registry list' };
  const detail = pageCells(path.join(CACHE, 'hr-pages', `${id}-detail.txt.gz`));
  if (!detail) return { skip: 'registry detail page not available (fetch failed)' };
  const form = pageCells(path.join(CACHE, 'hr-pages', `${id}-form.txt.gz`));
  const p = parseHr(detail, form);
  if (!p.ok) return { skip: 'registry page not parsed' };
  if (p.reg_no && p.reg_no !== o.rera_number) return { skip: `registry page shows ${p.reg_no}, not ${o.rera_number}`, review: true };
  if (!p.reg_no) return { skip: 'registration number not shown on the registry page' };
  if (p.registry_project_name && !sameName(p.registry_project_name, o.project_name)) return { skip: `registry name "${p.registry_project_name}" differs from "${o.project_name}"`, review: true };
  if (p.form_project_name && !sameName(p.form_project_name, o.project_name)) return { skip: `application form names "${p.form_project_name}", not "${o.project_name}"`, review: true };
  const f = {};
  const addr = p.form_address || p.address;
  if (addr) f.full_address = addr;
  const pin = (addr || '').match(/\b(12\d{4})\b/);
  if (pin) f.pincode = pin[1];
  if (p.tehsil) f.tehsil = p.tehsil;
  if (p.registry_status) f.registry_project_status = p.registry_status;
  if (p.unit_mix?.length) {
    const units = p.unit_mix.reduce((s, u) => s + u.count, 0);
    f.total_units = units;
    // Promoters fill "Carpet area" either per unit or as the total for the row. Per unit is certain when
    // the total reading would be < 15 sq m a unit; total is certain above 1,000 sq m for several units.
    // Anything in between is ambiguous, so no carpet area is saved for that project.
    const per = p.unit_mix.map((u) => (u.count <= 1 || u.carpet_sqm / u.count < 15 ? u.carpet_sqm : u.carpet_sqm > 1000 ? u.carpet_sqm / u.count : null));
    if (per.every((x) => x != null && x > 0)) {
      const lo = Math.min(...per), hi = Math.max(...per);
      f.carpet_area = `Carpet area (RERA application): ${lo === hi ? `${r1(lo)} sq m (${ft(lo)} sq ft)` : `${r1(lo)}–${r1(hi)} sq m (${ft(lo)}–${ft(hi)} sq ft)`} per unit, ${units} apartments/shops`;
      f.unit_mix = p.unit_mix.map((u, i) => ({ type: u.type, units: u.count, carpet_sqm_per_unit: r1(per[i]), carpet_sqft_per_unit: Math.round(per[i] * SQFT), towers: u.towers }));
    }
  }
  if (p.plot_sizes?.length) {
    const a = p.plot_sizes.map((x) => x.area_sqm), plots = p.plot_sizes.reduce((s, x) => s + x.count, 0);
    f.total_plots = plots;
    f.plot_sizes = `${plots} plots, ${r1(Math.min(...a))}–${r1(Math.max(...a))} sq m (${ft(Math.min(...a))}–${ft(Math.max(...a))} sq ft) each (plot area)`;
  }
  if (f.carpet_area && f.plot_sizes) f.configurations = 'Plots and apartments/shops';
  else if (f.plot_sizes) f.configurations = 'Plots';
  // The form's square-metre figure is only shown when it agrees with the acreage (some forms put acres there).
  const sqmOk = p.land_area_acres && p.land_area_sqm && Math.abs(p.land_area_sqm / (p.land_area_acres * 4046.86) - 1) < 0.1;
  if (p.land_area_acres) f.land_area = `${p.land_area_acres} acres${sqmOk ? ` (${p.land_area_sqm.toLocaleString('en-IN')} sq m)` : ''}`;
  if (p.license) f.dtcp_license = p.license;
  if (p.project_cost_inr) f.project_cost = `${crore(p.project_cost_inr)} (estimated project cost declared to RERA, not a sale price)`;
  if (p.layout_plan_approval_date) f.layout_plan_approval_date = p.layout_plan_approval_date;
  if (p.building_plan_approval_date) f.building_plan_approval_date = p.building_plan_approval_date;
  if (p.start_date) f.project_start_date = p.start_date;
  if (p.proposed_completion) f.proposed_completion = p.proposed_completion;
  if (p.promoter_website) f.developer_website = p.promoter_website;
  if (p.promoter_name) f.registry_promoter_name = p.promoter_name;
  return { fields: f, parsed: p, source: `https://haryanarera.gov.in/view_project/searchprojectDetail/${id}`, form_source: form ? `https://haryanarera.gov.in/view_project/project_preview_open/${id}` : null, source_type: 'official_rera_registry', verification: 'Verified — official HARERA project page and registration application (Form REP-I), exact registration-number match' };
}

// Facts that make a record genuinely richer (identity/admin fields alone don't count).
const MEANINGFUL = ['full_address', 'pincode', 'project_description', 'configurations', 'carpet_area', 'plot_sizes', 'total_units', 'total_plots', 'amenities', 'land_area', 'proposed_completion', 'developer_website'];
// Working-copy fields filled from the enrichment when blank.
const FILLS = [['address', 'full_address'], ['pincode', 'pincode'], ['original_completion', 'proposed_completion'], ['developer_name', 'registry_promoter_name']];

function plan(row) {
  const doc = row.doc, o = doc.original || {}, d = doc.data || {};
  if (doc.deleted) return { skip: 'deleted record' };
  if (doc.enrichment) return { skip: 'already enriched', already: true };
  if (o.regulator === 'MahaRERA') return { skip: 'MahaRERA project pages need a CAPTCHA/login; not read automatically' };
  const b = o.regulator === 'RERA Karnataka' ? buildKa(doc) : o.regulator === 'HARERA Gurugram' ? buildHr(doc) : { skip: `unsupported regulator ${o.regulator}` };
  if (b.skip) return b;
  const meaningful = MEANINGFUL.filter((k) => !blank(b.fields[k]) && !(Array.isArray(b.fields[k]) && !b.fields[k].length));
  if (meaningful.length < 3) return { skip: `too little reliable information on the registry page (${meaningful.length} useful fields)` };
  const fills = {}, review = [];
  for (const [dk, fk] of FILLS) {
    const v = b.fields[fk];
    if (blank(v)) continue;
    if (blank(d[dk])) fills[dk] = v;
    else if (norm(d[dk]) !== norm(v) && dk !== 'developer_name' && dk !== 'address') review.push({ field: dk, current: d[dk], registry: v, reason: dk === 'original_completion' ? 'registry detail shows a different completion date (often an extension); not overwritten' : 'registry detail differs from the current value; not overwritten' });
  }
  // Registry identity cross-checks.
  if (b.fields.registry_promoter_name && norm(b.fields.registry_promoter_name) !== norm(d.developer_name || o.developer_name))
    review.push({ field: 'developer_name', current: d.developer_name || o.developer_name, registry: b.fields.registry_promoter_name, reason: 'promoter name on the detail page differs from the registry list' });
  return { ...b, fills, review };
}

// ---- run -----------------------------------------------------------------------------------
const { rows } = await db.query(`SELECT id, doc FROM scraped_projects ORDER BY id`);
console.log(`${rows.length} scraped rows read (${APPLY ? 'APPLY' : 'dry run'})`);
if (APPLY && !existsSync(LOG)) writeFileSync(LOG, COLS.join(',') + '\n');

const stats = { total: rows.length, processed: 0, enriched: 0, skipped: 0, already: 0, failed: 0, fields: 0, data_fills: 0, review_rows: 0, skip_reasons: {} };
let writes = 0;
for (const row of rows) {
  const p = plan(row);
  if (p.already) { stats.already++; continue; }
  stats.processed++;
  const name = row.doc.data?.project_name || row.doc.original?.project_name || '';
  if (p.skip) {
    stats.skipped++;
    const k = p.skip.replace(/".*?"/g, '…').replace(/\(\d+ useful fields\)/, '').replace(/ shows .*$/, ' shows a different number');
    stats.skip_reasons[k] = (stats.skip_reasons[k] || 0) + 1;
    continue;
  }
  if (writes >= LIMIT) continue;
  const enrichment = {
    review_status: 'Pending Review',
    verification: p.verification,
    enriched_at: RUN,
    enriched_by: 'scraped-enrichment (official registry)',
    source_type: p.source_type,
    sources: [...new Set([p.source, p.form_source, row.doc.original?.project_url].filter(Boolean))],
    source_note: p.source_note || null,
    fields: p.fields,
    updated_fields: Object.keys(p.fields),
    data_filled: Object.fromEntries(Object.entries(p.fills).map(([k, v]) => [k, { old: row.doc.data?.[k] ?? null, new: v }])),
    review_required: p.review,
  };
  if (!APPLY) { writes++; stats.enriched++; stats.fields += enrichment.updated_fields.length; stats.data_fills += Object.keys(p.fills).length; if (p.review.length) stats.review_rows++; continue; }

  // Optimistic write: only if data and enrichment are unchanged since we read the row.
  const data = { ...(row.doc.data || {}), ...p.fills };
  const res = await db.query(
    `UPDATE scraped_projects SET doc = doc || jsonb_build_object('enrichment', $2::jsonb, 'data', $3::jsonb)
     WHERE id = $1 AND doc->'data' = $4::jsonb AND doc->'enrichment' IS NULL`,
    [row.id, JSON.stringify(enrichment), JSON.stringify(data), JSON.stringify(row.doc.data || {})]);
  // Read back and compare.
  const back = (await db.query(`SELECT doc FROM scraped_projects WHERE id = $1`, [row.id])).rows[0]?.doc;
  // jsonb does not keep key order, so compare canonical (key-sorted) JSON.
  const ok = res.rowCount === 1 && back && canon(back.enrichment) === canon(enrichment) && canon(back.data) === canon(data)
    && canon(back.original) === canon(row.doc.original) && back.id === row.doc.id;
  const status = ok ? 'saved_verified' : res.rowCount === 1 ? 'saved_mismatch' : 'not_saved_row_changed';
  if (ok) { stats.enriched++; stats.fields += enrichment.updated_fields.length; stats.data_fills += Object.keys(p.fills).length; if (p.review.length) stats.review_rows++; }
  else stats.failed++;
  writes++;
  const lines = [];
  const src = p.source + (p.source_note ? ` (${p.source_note})` : '');
  for (const [k, v] of Object.entries(p.fields)) lines.push([row.id, name, `enrichment.${k}`, '', v, k === 'carpet_area' || k === 'land_area' || k === 'proposed_completion' || k === 'project_start_date' ? (p.form_source || src) : src, p.source_type, 'high', RUN, status]);
  for (const [k, v] of Object.entries(p.fills)) lines.push([row.id, name, `data.${k}`, row.doc.data?.[k] ?? '', v, src, p.source_type, 'high', RUN, status]);
  for (const r of p.review) lines.push([row.id, name, `data.${r.field}`, r.current, r.registry, src, p.source_type, 'conflict', RUN, 'review_required']);
  appendFileSync(LOG, lines.map((l) => l.map(csv).join(',')).join('\n') + '\n');
  if (writes % 200 === 0) console.log(`${writes} written (${stats.enriched} verified, ${stats.failed} failed) ${new Date().toISOString()}`);
}
console.log(JSON.stringify(stats, null, 1));

// ---- reports, regenerated from the database --------------------------------------------------
if (APPLY) {
  const all = (await db.query(`SELECT id, doc FROM scraped_projects ORDER BY id`)).rows;
  const enr = all.filter((r) => r.doc.enrichment?.review_status);
  const lines = [['record_id', 'project_name', 'developer', 'city', 'locality', 'rera_number', 'fields_added', 'data_fields_filled', 'review_required', 'source_urls', 'verification_status', 'enrichment_date', 'review_status'].join(',')];
  for (const { id, doc } of enr) {
    const e = doc.enrichment, d = doc.data || {};
    lines.push([id, d.project_name, d.developer_name, d.city, d.locality, d.rera_number, e.updated_fields.join('; '), Object.keys(e.data_filled || {}).join('; '),
      (e.review_required || []).map((r) => r.field).join('; '), e.sources.join(' '), e.verification, e.enriched_at, e.review_status].map(csv).join(','));
  }
  writeFileSync(path.join(OUTDIR, 'REVIEW-PENDING.csv'), lines.join('\n') + '\n');
  const by = (f) => enr.reduce((m, r) => ((m[f(r)] = (m[f(r)] || 0) + 1), m), {});
  const fieldCount = {};
  for (const r of enr) for (const k of r.doc.enrichment.updated_fields) fieldCount[k] = (fieldCount[k] || 0) + 1;
  const totalFields = enr.reduce((s, r) => s + r.doc.enrichment.updated_fields.length, 0);
  const totalFills = enr.reduce((s, r) => s + Object.keys(r.doc.enrichment.data_filled || {}).length, 0);
  const reviewReq = enr.filter((r) => r.doc.enrichment.review_required?.length).length;
  const regs = by((r) => r.doc.original.regulator);
  const md = `# Scraped project enrichment — summary

Generated ${new Date().toISOString()} from the production \`scraped_projects\` table (read back after writing).

**Nothing was published.** Enriched rows keep their registry \`original\`, id, key and source fields, their
location check (\`pin_check\`) and their Projects links. No row in \`pins\`, \`projects\`, \`project_submissions\`
or leads was read for writing or changed. Enriched rows are listed in Super admin → Scraped data →
**Enriched — Review Pending**.

## Counts

| | Records |
|---|---|
| Total scraped records | ${all.length.toLocaleString()} |
| Processed in this run | ${stats.processed.toLocaleString()} |
| Successfully enriched (saved and verified by read-back), all runs | **${enr.length.toLocaleString()}** |
| Enriched in this run | ${stats.enriched.toLocaleString()} |
| Skipped in this run | ${stats.skipped.toLocaleString()} |
| Write failed / row changed during the run | ${stats.failed.toLocaleString()} |
| Pending review (Enriched — Review Pending tab) | **${enr.filter((r) => r.doc.enrichment.review_status === 'Pending Review').length.toLocaleString()}** |
| Enriched records with a value needing review (conflict, not overwritten) | ${reviewReq.toLocaleString()} |

| Saved values | Count |
|---|---|
| Enrichment fields saved (\`doc.enrichment.fields\`) | ${totalFields.toLocaleString()} |
| Blank working-copy fields filled (\`doc.data\`) | ${totalFills.toLocaleString()} |
| **Total fields saved** | **${(totalFields + totalFills).toLocaleString()}** |

### Enriched by regulator

${Object.entries(regs).map(([k, v]) => `- ${k}: ${v.toLocaleString()}`).join('\n')}

### Fields added (records)

| Field | Records |
|---|---|
${Object.entries(fieldCount).sort((a, b) => b[1] - a[1]).map(([k, v]) => `| ${k} | ${v.toLocaleString()} |`).join('\n')}

### Skipped in this run, by reason

| Reason | Records |
|---|---|
${Object.entries(stats.skip_reasons).sort((a, b) => b[1] - a[1]).map(([k, v]) => `| ${k} | ${v.toLocaleString()} |`).join('\n')}

## Sources and rules

- **RERA Karnataka:** the official "View Project Details" page for the exact registration number (rera.karnataka.gov.in).
- **HARERA Gurugram:** the official project page and the promoter's registration application, Form REP-I Parts A–C (haryanarera.gov.in). Part G (the promoter's earlier projects) is never used.
- **MahaRERA:** project pages on the new MahaRERA portal require a CAPTCHA and login, so they were not read; MahaRERA rows are skipped.
- A record is enriched only if the registry page shows the same registration number **and** the same project name, and at least 3 useful facts were found. Values are copied as declared to the regulator; nothing is estimated.
- Prices are not published by the regulators and were not added. "Project cost" is the cost declared to RERA, not a sale price.
- Carpet areas are RERA carpet areas (sq m, with sq ft conversions). Karnataka figures are per-type averages (total carpet ÷ units).
- Coordinates from the Karnataka registry are kept as \`registry_latitude/longitude\` in the enrichment only; the record's location and its "location verified" check are unchanged.
- Working-copy (\`data\`) fields are only filled when blank. Where the registry differs from an existing value, the value is not changed and the record lists it under "review required".

## Files

- \`PROJECT-CHANGE-LOG.csv\` — one line per saved value: record id, field, old and new value, source, confidence, date, save status.
- \`REVIEW-PENDING.csv\` — the Enriched — Review Pending list.
- Raw registry pages (evidence): \`migration/backup/scraped-enrichment-cache/\` (local, git-ignored).
- Backup taken before writing: \`migration/backup/pg-snapshot-*-before-enrichment/scraped_projects.json\` (local, git-ignored).
`;
  writeFileSync(path.join(OUTDIR, 'ENRICHMENT-SUMMARY.md'), md);
  console.log(`Reports written to ${path.relative(process.cwd(), OUTDIR)}`);
}
await db.end();
