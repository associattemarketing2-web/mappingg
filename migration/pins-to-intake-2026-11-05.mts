// One-off (5 Nov 2026): give every live map pin that has no Projects Intake record one, so it can hold a photo
// gallery, amenities, unit mix etc. like the intake projects (the user approved converting the 222 old pins).
//
//   npx tsx --env-file=.env migration/pins-to-intake-2026-11-05.mts            (dry run)
//   npx tsx --env-file=.env migration/pins-to-intake-2026-11-05.mts --apply    (backup, write)
//
// Same result as clicking "Edit all details" on the pin and publishing, except the pin itself is not rewritten:
//   - submission: prefilled by the app's own pinToSubmission() (lib/pin-to-intake.ts), source 'map_pin',
//     source_pin_id = the pin, status 'published'; values the form can't hold exactly go to additional_details.
//   - project: the same fields admin_publish writes (lib/partners-engine.ts), is_live true, pin_id = the pin.
//   - pin: only intake_project_id is added. Title, location, price, photo … everything on the pin stays as it is.
// A later "Edit all details" opens this submission; publishing it keeps pin values (keepPinValues).

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { pinToSubmission } from '../lib/pin-to-intake';

const APPLY = process.argv.includes('--apply');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL!.replace(/[?&]sslmode=[^&]*/, ''), ssl: { rejectUnauthorized: false }, max: 3 });
const q = (sql: string, params?: unknown[]) => pool.query(sql, params);

const slugify = (s: string) => String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'project';
const UNIT: Record<string, string> = { Crore: 'Cr', Lakh: 'L', Million: 'M', Thousand: 'K' };
function formatPrice(s: any): string {
  if (s.price_on_request) return 'Price on request';
  const u = UNIT[s.price_unit] || s.price_unit || '';
  const a = s.price_min, b = s.price_max;
  if (a == null && b == null) return '';
  if (a != null && b != null && +a !== +b) return `₹ ${+a} – ${+b} ${u}`.trim();
  return `₹ ${+(a ?? b)} ${u}${b == null ? ' onwards' : ''}`.trim();
}

const { rows: pins } = await q(`SELECT doc - 'image' - 'brochure_image' AS pin FROM pins
  WHERE coalesce(doc->>'intake_project_id','') = '' AND coalesce(doc->>'hidden','false') <> 'true'
    AND coalesce(doc->>'rejected','false') <> 'true' AND coalesce(doc->>'pending_review','false') <> 'true'
  ORDER BY (doc->>'number')::int`);
const { rows: slugRows } = await q(`SELECT doc->>'slug' s FROM projects`);
const slugs = new Set(slugRows.map((r: any) => r.s));
const { rows: linked } = await q(`SELECT doc->>'source_pin_id' p FROM project_submissions WHERE doc->>'source_pin_id' IS NOT NULL`);
const alreadyLinked = new Set(linked.map((r: any) => r.p));

const plans: any[] = [];
for (const { pin } of pins) {
  if (alreadyLinked.has(pin.id)) { console.log(`skip #${pin.number} ${pin.title}: an intake submission already points at it`); continue; }
  if (/your real estate advisory/i.test(pin.title || '')) { console.log(`skip #${pin.number} ${pin.title}: office pin, not a project`); continue; }
  const { fields, kept } = pinToSubmission(pin);
  let slug = slugify(`${fields.project_name}-${fields.city || ''}`); let i = 1;
  while (slugs.has(slug)) slug = `${slugify(`${fields.project_name}-${fields.city || ''}`)}-${++i}`;
  slugs.add(slug);
  plans.push({ pin, fields, kept, slug, subId: randomUUID(), projId: randomUUID() });
}
for (const p of plans) console.log(`#${p.pin.number} ${p.pin.title} → ${p.fields.city || '?'} / ${p.fields.locality || '?'}${p.kept.length ? ` (kept: ${p.kept.map((k: any) => k.label).join(', ')})` : ''}`);
console.log(`\n${plans.length} pins to convert`);
if (!APPLY) { console.log('Dry run. Pass --apply to write.'); await pool.end(); process.exit(0); }

const dir = path.resolve(`migration/backup/pg-snapshot-${new Date().toISOString().replace(/[:.]/g, '-')}-before-pins-to-intake`);
mkdirSync(dir, { recursive: true });
writeFileSync(path.join(dir, 'before.json'), JSON.stringify({ pins: plans.map((p) => p.pin), created: plans.map((p) => ({ pin_id: p.pin.id, submission_id: p.subId, project_id: p.projId })) }, null, 1));
console.log(`backup → ${path.relative(process.cwd(), dir)}/before.json  (to undo: delete the listed submissions/projects and unset pins.intake_project_id)`);

const now = new Date().toISOString();
for (const p of plans) {
  const { rows: [c] } = await q(`UPDATE counters SET doc = jsonb_set(doc, '{value}', to_jsonb((doc->>'value')::int + 1)) WHERE id = 'submission_ref' RETURNING (doc->>'value')::int AS v`);
  const f = p.fields;
  const sub = {
    _id: p.subId, id: p.subId, ref_code: `MAP-SUB-${String(c.v).padStart(5, '0')}`, ...f,
    source: 'map_pin', source_pin_id: p.pin.id, status: 'published', published_project_id: p.projId, published_at: now,
    slug: p.slug, flags: {}, has_unpublished_changes: false, additional_details: p.kept,
    created_at: now, updated_at: now,
  };
  const project = {
    _id: p.projId, id: p.projId, submission_id: p.subId, pin_id: p.pin.id, slug: p.slug, is_live: true, featured: !!f.featured,
    project_name: f.project_name, project_type: f.project_type, developer_name: f.developer_name,
    construction_status: f.construction_status, sales_status: f.sales_status,
    country: f.country, state: null, city: f.city, locality: f.locality, address: f.address, lat: f.lat ?? null, lng: f.lng ?? null,
    currency: f.currency || null, price_min: f.price_min ?? null, price_max: f.price_max ?? null, price_unit: f.price_unit || null,
    price_on_request: !!f.price_on_request, price_label: formatPrice(f),
    configurations: f.configurations || [], area_unit: f.area_unit || null, carpet_area_min: f.carpet_area_min ?? null, carpet_area_max: f.carpet_area_max ?? null,
    launch_date: f.launch_date, possession_date_rera: null, possession_date_target: f.possession_date_target,
    rera_numbers: f.rera_numbers || [], rera_verified_on: null,
    short_description: f.short_description, key_usps: f.key_usps, amenities: [],
    land_area_acres: null, towers: null, floors: null, total_units: null, youtube_url: f.youtube_url,
    cover_image_url: null, gallery_urls: [], brochure_url: null, rera_qr_url: null, unit_mix: [], floor_plan_urls: [], payment_plan_url: null, tour_360_url: null,
    additional_details: p.kept, published_at: now, updated_at: now,
  };
  await q(`INSERT INTO project_submissions (id, doc) VALUES ($1, $2::jsonb)`, [p.subId, JSON.stringify(sub)]);
  await q(`INSERT INTO projects (id, doc) VALUES ($1, $2::jsonb)`, [p.projId, JSON.stringify(project)]);
  await q(`INSERT INTO submission_events (id, doc) VALUES ($1, $2::jsonb)`, [randomUUID(), JSON.stringify({ submission_id: p.subId, action: 'published', actor: 'system', details: { note: 'Created from existing map pin (all pin values kept)' }, created_at: now })]);
  await q(`UPDATE pins SET doc = doc || $2::jsonb WHERE id = $1`, [p.pin.id, JSON.stringify({ intake_project_id: p.projId })]);
}
console.log(`converted ${plans.length} pins`);
await pool.end();
