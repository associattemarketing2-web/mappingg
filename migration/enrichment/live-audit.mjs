// READ-ONLY audit of the live map projects (pins that are public on the live map).
//
//   node --env-file=.env --import ./tests/register.mjs migration/enrichment/live-audit.mjs
//
// Reads through the app's own data layer (lib/mongodb getDb → lib/mongo-compat), the same path the
// live map uses. Writes nothing to the database. Outputs (seo-doc/enrichment/live-project-enrichment/):
//   live-baseline.json        every live project's current field values (no images, no owner ids) — the "before"
//   PROJECT-SUMMARY.csv       one row per live project: missing / invalid fields, status "Not yet researched"
//   live-audit-state.json     counts + duplicate pin numbers
// Scraped registry records are NOT read or touched.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getDb } from '../../lib/mongodb.ts';
import { localitiesOf } from '../../lib/locality.ts';
import { projectSlug } from '../../lib/seo/slug.ts';
import { isPropertyProject } from '../../lib/seo/project-filter.ts';

const OUT = path.resolve('seo-doc/enrichment/live-project-enrichment');
const on = (v) => v === true || v === 'true';
const filled = (v) => v != null && String(v).trim() !== '' && !/^(n\/?a|na|-|—|tbd|null|undefined)$/i.test(String(v).trim());
const isMahaRera = (v) => /^(P\d{11}|P[RCM]\d{13})$/.test(String(v || '').toUpperCase().replace(/\s+/g, ''));
const isOtherRera = (v) => /^(PRM\/KA\/RERA\/|RC\/REP\/HARERA|GGM\/|HRERA|P02\d+|TS\d|DLD)/i.test(String(v || '').trim());
const customOf = (p, re) => (Array.isArray(p.custom_fields) ? p.custom_fields.find((c) => re.test(c?.label || '') && filled(c?.value))?.value : undefined);

// The enrichable fields that exist in the current schema (pins + custom fields).
const FIELDS = {
  developer: (p) => filled(p.developer),
  locality: (p) => filled(p.location),
  coordinates: (p) => Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)) && Number(p.lat) !== 0,
  property_type: (p) => filled(p.type),
  status: (p) => filled(p.status),
  rera_number: (p) => filled(p.rera_number) || filled(customOf(p, /rera/i)),
  configuration: (p) => filled(p.configuration),
  carpet_area: (p) => filled(p.sqft) || filled(p.size),
  price: (p) => filled(p.price) && /\d/.test(p.price),
  possession: (p) => filled(p.possession_timeline),
  description: (p) => filled(p.description) && String(p.description).trim().length >= 80,
  highlights: (p) => filled(p.key_usp),
  amenities: (p) => filled(p.whats_available),
  address: (p) => filled(customOf(p, /address/i)),
  official_website: (p) => filled(customOf(p, /website|official/i)),
  brochure: (p) => filled(p.brochure_url) || filled(p.brochure_image),
  video: (p) => filled(p.youtube_video_url) && /^https?:\/\//.test(p.youtube_video_url),
};

function invalids(p, city) {
  const out = [];
  if (filled(p.rera_number) && !isMahaRera(p.rera_number) && !isOtherRera(p.rera_number)) out.push(`rera_number "${p.rera_number}" is not a registration number`);
  if (filled(p.price) && !/\d/.test(p.price)) out.push(`price "${p.price}" is not a price`);
  if (filled(p.youtube_video_url) && !/^https?:\/\//.test(p.youtube_video_url)) out.push(`video "${p.youtube_video_url}" is not a link`);
  if (/(^|\D)19\d\d(\D|$)/.test(String(p.possession_timeline || ''))) out.push(`possession "${p.possession_timeline}" looks like a typo'd year`);
  if (!filled(p.title)) out.push('title is empty');
  return out;
}

const db = await getDb();
const all = await db.collection('pins').find({}, { projection: { image: 0, brochure_image: 0 } }).toArray();
const live = all.filter((p) => !on(p.hidden) && !on(p.pending_review) && !on(p.rejected));
const byNumber = new Map();
for (const p of live) byNumber.set(Number(p.number), [...(byNumber.get(Number(p.number)) || []), p]);
const dupNumbers = [...byNumber].filter(([, v]) => v.length > 1).map(([n, v]) => ({ number: n, pins: v.map((p) => ({ id: p.id, title: p.title || '(no title)', created_at: p.created_at })) }));

const KEEP = ['id', 'number', 'title', 'developer', 'location', 'lat', 'lng', 'type', 'status', 'rera_number', 'configuration', 'sqft', 'size', 'price',
  'possession_timeline', 'launch_date', 'description', 'key_usp', 'whats_available', 'brochure_url', 'youtube_video_url', 'custom_fields', 'field_visibility', 'created_at', 'updated_at'];
const baseline = live.map((p) => Object.fromEntries(KEEP.filter((k) => k in p).map((k) => [k, p[k]])));

const cell = (v) => `"${String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
const rows = live
  .sort((a, b) => Number(a.number) - Number(b.number) || String(a.id).localeCompare(String(b.id)))
  .map((p) => {
    const missing = Object.entries(FIELDS).filter(([, f]) => !f(p)).map(([k]) => k);
    const bad = invalids(p);
    const project = isPropertyProject(p);
    return {
      database_id: p.id, pin_number: p.number, project_name: p.title || '(no title)',
      public_url: `/projects/${projectSlug(p.title, localitiesOf(p.location)[0] || '', Number(p.number))}`,
      shared_pin_number: (byNumber.get(Number(p.number)) || []).length > 1 ? 'yes' : '',
      kind: project ? 'property project' : 'office / land marker',
      fields_originally_missing: missing.join(' '), missing_count: missing.length,
      invalid_values: bad.join(' | '),
      fields_researched: '', fields_added: '', fields_corrected: '', fields_not_found: '', fields_manual_review: '',
      changes_applied: 0, overall_status: 'Not yet researched',
    };
  });
const COLS = Object.keys(rows[0]);

await mkdir(OUT, { recursive: true });
await writeFile(path.join(OUT, 'live-baseline.json'), JSON.stringify({ read_at: new Date().toISOString(), count: baseline.length, projects: baseline }, null, 1));
await writeFile(path.join(OUT, 'PROJECT-SUMMARY.csv'), [COLS.join(','), ...rows.map((r) => COLS.map((c) => cell(r[c])).join(','))].join('\n') + '\n');
const fieldMissing = Object.fromEntries(Object.keys(FIELDS).map((k) => [k, rows.filter((r) => r.fields_originally_missing.split(' ').includes(k)).length]));
const state = {
  read_at: new Date().toISOString(),
  pins_in_table: all.length, live_projects: live.length, not_live: all.length - live.length,
  property_projects: rows.filter((r) => r.kind === 'property project').length, markers: rows.filter((r) => r.kind !== 'property project').length,
  unique_pin_numbers: byNumber.size, duplicate_pin_numbers: dupNumbers,
  projects_with_invalid_values: rows.filter((r) => r.invalid_values).length,
  field_missing_counts: fieldMissing, enrichable_fields: Object.keys(FIELDS),
  avg_missing: +(rows.reduce((s, r) => s + r.missing_count, 0) / rows.length).toFixed(2),
};
await writeFile(path.join(OUT, 'live-audit-state.json'), JSON.stringify(state, null, 2) + '\n');
console.log(JSON.stringify(state, null, 2));
process.exit(0);
