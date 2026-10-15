import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { query } from './pg';
import { usingMongo } from './mongodb';
import { directory, normDev } from './developers';

// "Scraped data" for Projects Intake: projects collected from official RERA
// registries (MahaRERA, Haryana RERA - Gurugram, RERA Karnataka), cleaned in
// Developer_Projects/ and shipped as data/scraped/scraped_projects.json.gz.
//
// Each row keeps two copies of the project:
//   original - exactly what the registry showed (refreshed on every import)
//   data     - the working copy the team edits
// A re-import refreshes `original` everywhere and `data` only on rows nobody
// has edited or enriched. `enrichment` holds facts read from the official
// registry project pages (migration/enrichment/scraped/apply.mjs), waiting for
// review; it never puts a row on the map. Deleting is soft (`deleted: true`) so a refresh never brings a
// deleted row back and it can be restored.

type Doc = Record<string, any>;
const DATASET = path.join(process.cwd(), 'data', 'scraped', 'scraped_projects.json.gz');

/** Fields the team may edit (everything else is registry data, read-only). */
export const EDITABLE = [
  'project_name', 'developer_name', 'project_type', 'locality', 'district', 'city', 'address', 'pincode', 'lat', 'lng',
  'rera_number', 'status', 'registration_date', 'approval_date', 'original_completion', 'revised_completion', 'notes',
] as const;

/** Pin checks that may go to Projects: passed the location checks, or set by hand. */
export const PIN_OK = new Set(['verified', 'manual']);

let ready: Promise<void> | null = null;
function ensureTable(): Promise<void> {
  if (usingMongo()) return Promise.reject(new Error('Scraped data needs the Postgres database.'));
  ready ??= query(`CREATE TABLE IF NOT EXISTS "scraped_projects" (id text PRIMARY KEY, doc jsonb NOT NULL DEFAULT '{}'::jsonb)`)
    .then(() => undefined).catch((e) => { ready = null; throw e; });
  return ready;
}

async function loadDataset(): Promise<{ generated: string; research_date: string; pin_rules: string; records: Doc[] }> {
  return JSON.parse(gunzipSync(await readFile(DATASET)).toString('utf8'));
}

/** Copy the registry records into the table (new rows added, unedited rows refreshed). */
export async function importDataset(): Promise<{ total: number; added: number; refreshed: number; generated: string }> {
  await ensureTable();
  const ds = await loadDataset();
  const now = new Date().toISOString();
  let added = 0, refreshed = 0;
  for (let i = 0; i < ds.records.length; i += 500) {
    const chunk = ds.records.slice(i, i + 500).map((r) => ({ id: r.id, original: r }));
    const res = await query<{ inserted: boolean }>(`
      INSERT INTO scraped_projects (id, doc)
      SELECT e->>'id', jsonb_build_object('id', e->>'id', 'original', e->'original', 'data', e->'original',
             'imported_at', $2::text, 'dataset_generated', $3::text, 'deleted', false)
      FROM jsonb_array_elements($1::jsonb) e
      ON CONFLICT (id) DO UPDATE SET doc = scraped_projects.doc
        || jsonb_build_object('original', EXCLUDED.doc->'original', 'imported_at', $2::text, 'dataset_generated', $3::text)
        || CASE WHEN coalesce(scraped_projects.doc->>'edited_at', '') = '' AND scraped_projects.doc->'enrichment' IS NULL
             THEN jsonb_build_object('data', EXCLUDED.doc->'original') ELSE '{}'::jsonb END
      RETURNING (xmax = 0) AS inserted`, [JSON.stringify(chunk), now, ds.generated]);
    for (const row of res.rows) row.inserted ? added++ : refreshed++;
  }
  return { total: ds.records.length, added, refreshed, generated: ds.generated };
}

/** What the dataset file holds, without importing it. */
export async function datasetInfo(): Promise<{ count: number; generated: string; research_date: string; pin_rules: string }> {
  const ds = await loadDataset();
  return { count: ds.records.length, generated: ds.generated, research_date: ds.research_date, pin_rules: ds.pin_rules };
}

const LIST_FIELDS = ['city', 'project_name', 'developer_name', 'rera_number', 'locality', 'district', 'pincode', 'lat', 'lng', 'pin_check',
  'status', 'status_category', 'registration_date', 'verification', 'project_type', 'source_url', 'portal_seq'];

/** Every row (slim) + the developer-directory logo for its developer + Projects status. */
export async function listScraped(): Promise<{ rows: Doc[]; imported_at: string | null; dataset_generated: string | null }> {
  await ensureTable();
  const res = await query<{ id: string; doc: Doc }>(`SELECT id, jsonb_build_object(
      'data', doc->'data', 'pin_check', doc->'original'->>'pin_check', 'deleted', coalesce((doc->>'deleted')::boolean, false),
      'edited_at', doc->>'edited_at', 'submission_id', doc->>'submission_id', 'added_at', doc->>'added_at',
      'imported_at', doc->>'imported_at', 'dataset_generated', doc->>'dataset_generated',
      'enrichment_status', doc->'enrichment'->>'review_status', 'enriched_at', doc->'enrichment'->>'enriched_at',
      'enriched_fields', jsonb_array_length(coalesce(doc->'enrichment'->'updated_fields', '[]'::jsonb)),
      'enrichment_review', jsonb_array_length(coalesce(doc->'enrichment'->'review_required', '[]'::jsonb)),
      -- just the facts readyGaps() looks at
      'ready_e', CASE WHEN doc->'enrichment' IS NULL THEN NULL ELSE jsonb_build_object('review_required', doc->'enrichment'->'review_required',
        'fields', jsonb_strip_nulls(jsonb_build_object('configurations', doc->'enrichment'->'fields'->'configurations',
          'total_units', doc->'enrichment'->'fields'->'total_units', 'total_plots', doc->'enrichment'->'fields'->'total_plots',
          'proposed_completion', doc->'enrichment'->'fields'->'proposed_completion', 'project_cost', doc->'enrichment'->'fields'->'project_cost',
          'land_area', doc->'enrichment'->'fields'->'land_area', 'pincode', doc->'enrichment'->'fields'->'pincode',
          'registry_project_status', doc->'enrichment'->'fields'->'registry_project_status'))) END) AS doc FROM scraped_projects`);
  const subIds = res.rows.map((r) => r.doc.submission_id).filter(Boolean);
  const subs = new Map<string, Doc>();
  if (subIds.length) {
    const s = await query<{ id: string; status: string; project: string | null }>(
      `SELECT id, doc->>'status' AS status, doc->>'published_project_id' AS project FROM project_submissions WHERE id = ANY($1::text[])`, [subIds]);
    s.rows.forEach((r) => subs.set(r.id, r));
  }
  // Published project -> live? + its map pin number.
  const live = new Set<string>(), pinNo = new Map<string, number | null>();
  const projIds = [...subs.values()].map((s) => s.project).filter(Boolean);
  if (projIds.length) {
    const pr = await query<{ id: string; live: boolean; pin_id: string | null }>(
      `SELECT id, coalesce((doc->>'is_live')::boolean, false) AS live, doc->>'pin_id' AS pin_id FROM projects WHERE id = ANY($1::text[])`, [projIds]);
    pr.rows.forEach((r) => { if (r.live) live.add(r.id); });
    const pinIds = pr.rows.map((r) => r.pin_id).filter(Boolean) as string[];
    const pins = pinIds.length ? (await query<{ id: string; num: string | null; hidden: boolean }>(
      `SELECT id, doc->>'number' AS num, coalesce((doc->>'hidden')::boolean, false) AS hidden FROM pins WHERE id = ANY($1::text[])`, [pinIds])).rows : [];
    const byPin = new Map(pins.map((p) => [p.id, p]));
    pr.rows.forEach((r) => { const p = r.pin_id ? byPin.get(r.pin_id) : null; pinNo.set(r.id, p && !p.hidden && p.num != null ? Number(p.num) : null); });
  }
  const logos = new Map<string, string>();
  try { for (const d of await directory()) if (d.logo) logos.set(normDev(d.name), d.logo); } catch { /* directory unavailable: no logos */ }

  let imported_at: string | null = null, dataset_generated: string | null = null;
  const rows = res.rows.map(({ id, doc }) => {
    const d = doc.data || {};
    if (doc.imported_at && (!imported_at || doc.imported_at > imported_at)) imported_at = doc.imported_at;
    if (doc.dataset_generated) dataset_generated = doc.dataset_generated;
    const sub = doc.submission_id ? subs.get(doc.submission_id) : null;
    const row: Doc = { id, deleted: doc.deleted, edited: !!doc.edited_at, added_at: doc.added_at || null, submission_id: doc.submission_id || null,
      project_state: !doc.submission_id ? null : !sub ? 'removed' : sub.project && live.has(sub.project) ? 'live' : sub.status,
      pin_number: sub?.project ? pinNo.get(sub.project) ?? null : null,
      logo: logos.get(normDev(d.developer_name)) || null,
      enrichment_status: doc.enrichment_status || null, enriched_at: doc.enriched_at || null,
      enriched_fields: doc.enriched_fields || 0, enrichment_review: doc.enrichment_review || 0 };
    for (const k of LIST_FIELDS) row[k] = d[k] ?? null;
    row.pin_check = d.pin_check || doc.pin_check || null;
    if (doc.ready_e) row.ready_gaps = readyGaps(d, doc.ready_e);
    return row;
  });
  return { rows, imported_at, dataset_generated };
}

/** The registry facts of every enriched row, for the "Added data" tab (coordinates and description left out). */
export async function listEnriched(): Promise<Doc[]> {
  await ensureTable();
  const res = await query<{ id: string; e: Doc }>(`SELECT id, jsonb_build_object(
      'fields', (doc->'enrichment'->'fields') - 'registry_latitude' - 'registry_longitude' - 'project_description',
      'review_required', coalesce(doc->'enrichment'->'review_required', '[]'::jsonb),
      'source', doc->'enrichment'->'sources'->0, 'regulator', doc->'original'->>'regulator',
      'data_filled', (SELECT coalesce(jsonb_agg(k), '[]'::jsonb) FROM jsonb_object_keys(coalesce(doc->'enrichment'->'data_filled', '{}'::jsonb)) k)) AS e
    FROM scraped_projects WHERE doc->'enrichment' IS NOT NULL AND NOT coalesce((doc->>'deleted')::boolean, false)`);
  return res.rows.map(({ id, e }) => ({ id, ...e }));
}

// Project form options (public/partners/shared/fields.js) the registry values are matched to exactly.
const CONFIG_OPTIONS = ['Studio', '1 BHK', '1.5 BHK', '2 BHK', '2.5 BHK', '3 BHK', '3.5 BHK', '4 BHK', '5+ BHK', 'Villa', 'Row House', 'Penthouse', 'Duplex', 'Plot', 'Shop', 'Office', 'Showroom', 'Warehouse', 'Land'];
const AMENITY_OPTIONS: Record<string, string> = { 'swimming pool': 'Swimming Pool', gym: 'Gym', 'power backup': 'Power Backup', 'cctv surveillance': 'CCTV', cctv: 'CCTV',
  'club house': 'Clubhouse', clubhouse: 'Clubhouse', 'rain water harvesting': 'Rainwater Harvesting', 'rainwater harvesting': 'Rainwater Harvesting', lifts: 'Lifts', lift: 'Lifts' };
const unitMixText = (mix: Doc[]) => mix.map((u) => {
  const sqft = u.avg_carpet_sqft ?? u.carpet_sqft_per_unit, sqm = u.avg_carpet_sqm ?? u.carpet_sqm_per_unit;
  return `${u.type}: ${u.units} units${sqm ? `, ${u.avg_carpet_sqm ? 'avg ' : ''}${sqm} sq m (${Number(sqft).toLocaleString('en-IN')} sq ft) carpet` : ''}`;
}).join('; ');

/**
 * Registry facts of an enriched row for a new Projects submission: only values the registry states
 * (configurations that match a form option exactly, units, towers, acres, amenities that match an option),
 * everything else as labelled "additional details". Carpet averages are not turned into a min/max range.
 */
export function enrichmentForProject(e: Doc | undefined): { patch: Doc; details: { label: string; value: string }[] } {
  const f: Doc = e?.fields || {};
  const patch: Doc = {};
  if (!e) return { patch, details: [] };
  // "3BHK + 3T" → "3 BHK", "6 BHK" → "5+ BHK", "Residential plots" → "Plot"; anything else is left to the unit mix.
  const configs = String(f.configurations || '').split(',').map((s) => s.trim()
    .replace(/^(\d(?:\.5)?)\s*BHK\b.*$/i, (_m, n) => (Number(n) >= 5 ? '5+ BHK' : `${n} BHK`)).replace(/^(residential\s+)?plots?$/i, 'Plot'))
    .map((s) => CONFIG_OPTIONS.find((o) => o.toLowerCase() === s.toLowerCase())).filter(Boolean);
  if (configs.length) patch.configurations = [...new Set(configs)];
  if (Number.isFinite(f.total_units) && f.total_units > 0) patch.total_units = f.total_units;
  if (Number.isFinite(f.towers) && f.towers > 0) patch.towers = f.towers;
  const acres = String(f.land_area || '').match(/([\d,]+(?:\.\d+)?)\s*acres/i);
  if (acres) patch.land_area_acres = Number(acres[1].replace(/,/g, ''));
  const amen = (Array.isArray(f.amenities) ? f.amenities : []).map((a: string) => AMENITY_OPTIONS[String(a).toLowerCase().trim()]).filter(Boolean);
  if (amen.length) patch.amenities = [...new Set(amen)];
  const rows: [string, unknown][] = [
    ['Project cost (declared to RERA, not a sale price)', f.project_cost && String(f.project_cost).replace(/\s*\(.*\)$/, '')],
    ['Unit mix (RERA)', Array.isArray(f.unit_mix) && f.unit_mix.length ? unitMixText(f.unit_mix) : ''],
    ['Carpet area (RERA)', Array.isArray(f.unit_mix) && f.unit_mix.some((u: Doc) => u.avg_carpet_sqm ?? u.carpet_sqm_per_unit) ? '' : f.carpet_area],
    ['Total carpet area (RERA)', f.total_carpet_area],
    ['Land area (RERA)', f.land_area], ['Plot sizes (RERA)', Array.isArray(f.plot_sizes) ? f.plot_sizes.join(', ') : f.plot_sizes],
    ['Total plots (RERA)', f.total_plots], ['Project sub-type (RERA)', f.project_sub_type],
    ['Amenities (RERA)', Array.isArray(f.amenities) ? f.amenities.join(', ') : f.amenities],
    ['Project start date (RERA)', f.project_start_date], ['Proposed completion (RERA)', f.proposed_completion],
    ['Plan approved by', f.approving_authority], ['Approved plan no.', f.approved_plan_number], ['Plan approval date', f.plan_approval_date],
    ['DTCP licence', f.dtcp_license], ['Layout plan approval', f.layout_plan_approval_date], ['Building plan approval', f.building_plan_approval_date],
    ['Water source (RERA)', f.water_source], ['Developer website (as declared to RERA)', f.developer_website],
    ['Registry project status (project page)', f.registry_project_status], ['Full address (RERA)', f.full_address],
  ];
  const details = rows.filter(([, v]) => v != null && String(v).trim() !== '').map(([label, v]) => ({ label, value: String(v) }));
  return { patch, details };
}

const CLOSED = /Lapsed|Withdrawn|Revoked|Transferred|Superseded/i;
/**
 * Why an enriched row is not complete enough to go live ([] = complete): every key fact present and taken
 * from the registry, no conflict with the list, a configuration the project form knows, a completion date
 * still ahead, and a registration that is not closed. Logo and location are shown separately in the admin.
 */
export function readyGaps(d: Doc, e: Doc | undefined, today = new Date().toISOString().slice(0, 10)): string[] {
  if (!e) return ['Not enriched'];
  const f: Doc = e.fields || {}, g: string[] = [];
  if ((e.review_required || []).length) g.push('Registry differs from the list (conflict)');
  if (!enrichmentForProject(e).patch.configurations) g.push('No configuration matching the project form');
  if (f.total_units == null && f.total_plots == null) g.push('No unit / plot count');
  if (!f.proposed_completion) g.push('No proposed completion date');
  else if (f.proposed_completion < today) g.push('Proposed completion date has passed');
  if (!f.project_cost) g.push('No project cost');
  if (!f.land_area) g.push('No land area');
  if (!(d.pincode || f.pincode)) g.push('No pincode');
  if (!d.project_name || !d.developer_name || !d.rera_number || !d.locality) g.push('Name, developer, RERA no. or locality missing');
  if (CLOSED.test(d.status_category || '') || f.registry_project_status === 'Completed') g.push('Registration closed or project completed');
  return g;
}

/** One row with both copies, for the editor. */
export async function getScraped(id: string): Promise<Doc | null> {
  await ensureTable();
  const res = await query<{ doc: Doc }>(`SELECT doc FROM scraped_projects WHERE id = $1`, [id]);
  return res.rows[0]?.doc ?? null;
}

const num = (v: unknown) => (v === '' || v == null ? null : Number(v));
/** Save edits to the working copy. Moving the pin by hand marks it "manual". */
export async function updateScraped(id: string, patch: Doc, by?: string | null): Promise<Doc> {
  const doc = await getScraped(id);
  if (!doc) throw new Error('Record not found');
  const data = { ...(doc.data || {}) };
  for (const k of EDITABLE) {
    if (!(k in patch)) continue;
    let v = patch[k];
    if (k === 'lat' || k === 'lng') {
      v = num(v);
      if (v != null && (!Number.isFinite(v) || Math.abs(v) > (k === 'lat' ? 90 : 180))) throw new Error(`Invalid ${k === 'lat' ? 'latitude' : 'longitude'}`);
    } else if (/date|completion/.test(k)) {
      v = String(v ?? '').trim();
      if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`${k.replace(/_/g, ' ')} must be YYYY-MM-DD`);
      v = v || null;
    } else v = v == null ? null : String(v).trim() || null;
    data[k] = v;
  }
  const o = doc.original || {};
  if (data.lat !== o.lat || data.lng !== o.lng) {
    const has = data.lat != null && data.lng != null;
    data.pin_check = has ? 'manual' : 'no_coordinates';
    data.pin_reason = has ? `Location set by hand${by ? ` by ${by}` : ''} on ${new Date().toISOString().slice(0, 10)}.` : 'No coordinates.';
  } else { data.pin_check = o.pin_check; data.pin_reason = o.pin_reason; }
  const next = { ...doc, data, edited_at: new Date().toISOString(), edited_by: by || null };
  await query(`UPDATE scraped_projects SET doc = $2::jsonb WHERE id = $1`, [id, JSON.stringify(next)]);
  return next;
}

/** Undo all edits: the working copy becomes the registry original again. */
export async function resetScraped(id: string): Promise<void> {
  await ensureTable();
  await query(`UPDATE scraped_projects SET doc = (doc - 'edited_at' - 'edited_by') || jsonb_build_object('data', doc->'original') WHERE id = $1`, [id]);
}

export async function setDeleted(ids: string[], deleted: boolean): Promise<number> {
  await ensureTable();
  const res = await query(`UPDATE scraped_projects SET doc = doc || jsonb_build_object('deleted', $2::boolean, 'deleted_at', $3::text) WHERE id = ANY($1::text[])`,
    [ids, deleted, deleted ? new Date().toISOString() : null]);
  return res.rowCount ?? 0;
}

/** Rows for "Add to Projects": the working copies + whether they were added already. */
export async function rowsForAdd(ids: string[]): Promise<Doc[]> {
  await ensureTable();
  const res = await query<{ doc: Doc }>(`SELECT doc FROM scraped_projects WHERE id = ANY($1::text[])`, [ids]);
  return res.rows.map((r) => r.doc);
}

export async function markAdded(id: string, submissionId: string): Promise<void> {
  await query(`UPDATE scraped_projects SET doc = doc || jsonb_build_object('submission_id', $2::text, 'added_at', $3::text) WHERE id = $1`,
    [id, submissionId, new Date().toISOString()]);
}
