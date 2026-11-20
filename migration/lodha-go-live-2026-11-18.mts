// One-off (18 Nov 2026): add / refresh every Lodha project from the Lodha inventory sheet and publish them.
//
//   node --env-file=.env --experimental-transform-types --import ./tests/register.mjs migration/lodha-go-live-2026-11-18.mts                 (dry run — prints the plan)
//   node --env-file=.env --experimental-transform-types --import ./tests/register.mjs migration/lodha-go-live-2026-11-18.mts --apply         (backup, write, publish)
//   add --include-held to also import the projects marked `hold` in the data file
//
// Data: migration/lodha-projects-2026-11-18.data.mts.
// - A project with `sub` updates that existing live submission (its photos, RERA numbers, map position, YouTube
//   link and slug are kept) and is re-published with its current media.
// - A new project with `near` is placed at that campus pin (nudged a little so pins don't overlap) and published.
// - A new project with no location is saved as an "in review" submission; add its Google Maps link in
//   Super admin → Projects Intake and publish it from there.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getDb } from '../lib/mongodb';
import { runPartnersDb, runPartnersRpc } from '../lib/partners-engine';
import { PROJECTS, type LodhaProject } from './lodha-projects-2026-11-18.data.mts';

const APPLY = process.argv.includes('--apply');
const INCLUDE_HELD = process.argv.includes('--include-held');
const SOURCE_LABEL = 'Details source';
const SOURCE_VALUE = 'Lodha inventory sheet, 18 Nov 2026';
const ACTOR = { authed: true, userEmail: 'script:lodha-go-live' };

/** "₹4.10 – 4.64 Cr", "₹88 Lac", "Plot ₹2.27 Cr+" → amounts in crore. Sold out / on request → none. */
function pricesCr(s: string): number[] {
  if (/sold|request/i.test(s)) return [];
  // the listed (agreement / all-in) figure, not both; maintenance add-ons are not the price
  const main = s.replace(/\(all-in[^)]*\)/gi, '').replace(/\+\s*₹?[\d.]+\s*lakh\s+maintenance/gi, '');
  const out: number[] = [];
  for (const m of main.matchAll(/(\d+(?:\.\d+)?)(?:\s*[–-]\s*(\d+(?:\.\d+)?))?\s*(Cr|Lac|Lakh)/gi)) {
    const k = /cr/i.test(m[3]) ? 1 : 0.01;
    out.push(+m[1] * k);
    if (m[2]) out.push(+m[2] * k);
  }
  return out;
}

/** Carpet sq ft numbers from the area cell, ignoring super-built-up figures in brackets and plot yards. */
function areas(s: string): number[] {
  const main = s.replace(/\([^)]*\)/g, '').replace(/\d+\s*sq\s*yd/gi, '').replace(/\+\s*[\d,]+\s*(sq ft\s*)?garden/gi, '');
  return [...main.matchAll(/(\d{1,2},\d{3}|\d{3,5})/g)].map((m) => +m[1].replace(',', '')).filter((n) => n >= 150 && n <= 20000);
}

function configs(p: LodhaProject): string[] {
  const set = new Set<string>();
  for (const [c] of p.units) {
    for (const m of c.matchAll(/(\d(?:\.5)?)\s*BHK/gi)) set.add(+m[1] >= 5 ? '5+ BHK' : `${m[1]} BHK`);
    if (/office/i.test(c)) set.add('Office Spaces');
    if (/doctor/i.test(c)) set.add('Doctors\' Enclave');
    if (/retail|shop/i.test(c)) set.add('Retail Shops');
    if (/plot/i.test(c) || p.type === 'Villa / Plot') set.add('Villas / Plots');
    if (/penthouse/i.test(c)) set.add('Penthouse');
  }
  return [...set];
}

function fields(p: LodhaProject): Record<string, unknown> {
  const priced = p.units.flatMap(([, , pr]) => pricesCr(pr));
  const carpets = p.units.flatMap(([, a]) => areas(a));
  const allSold = p.units.length > 0 && p.units.every(([, , pr]) => /sold/i.test(pr));
  const details: { label: string; value: string }[] = [
    ...(p.conn ? [{ label: 'Connectivity', value: p.conn }] : []),
    ...(p.pay ? [{ label: 'Payment plan', value: p.pay }] : []),
    ...(p.poss ? [{ label: 'Possession', value: p.poss }] : []),
    ...(p.extra || []).map(([label, value]) => ({ label, value })),
  ];
  return {
    project_name: p.name, developer_name: 'Lodha', project_type: p.type,
    construction_status: p.cs, sales_status: p.sales || (allSold ? 'Sold out' : null),
    country: 'India', state: p.state, city: p.city, locality: p.locality, address: p.address,
    currency: 'INR', price_unit: 'Crore',
    price_min: priced.length ? Math.round(Math.min(...priced) * 100) / 100 : null,
    price_max: priced.length > 1 && Math.max(...priced) !== Math.min(...priced) ? Math.round(Math.max(...priced) * 100) / 100 : null,
    price_on_request: !priced.length && !allSold,
    configurations: configs(p), area_unit: 'sq ft',
    carpet_area_min: carpets.length ? Math.min(...carpets) : null,
    carpet_area_max: carpets.length > 1 ? Math.max(...carpets) : null,
    possession_date_target: p.poss || null,
    short_description: p.desc,
    key_usps: p.usps.join(' • '),
    amenities: p.amen,
    unit_mix: p.units.map(([config, area, price]) => ({ config, area, price })),
    land_area_acres: p.land ?? null, towers: p.towers ?? null, floors: p.floors ?? null,
    _details: details,
  };
}

const db = await getDb();
const subs = db.collection<any>('project_submissions');
const projects = db.collection<any>('projects');
const pins = db.collection<any>('pins');

const list = PROJECTS.filter((p) => INCLUDE_HELD || !p.hold);
const held = PROJECTS.filter((p) => p.hold && !INCLUDE_HELD);

type Plan =
  | { kind: 'update'; p: LodhaProject; sub: any; patch: Record<string, unknown> }
  | { kind: 'create'; p: LodhaProject; doc: Record<string, unknown>; publish: boolean };
const plans: Plan[] = [];
const nudge = new Map<string, number>();

for (const p of list) {
  const { _details, ...f } = fields(p) as any;
  if (p.sub) {
    const sub = await subs.findOne({ id: p.sub });
    if (!sub) throw new Error(`${p.name}: submission ${p.sub} missing`);
    // Publishing rebuilds the live project from the submission, so never blank a value the live page shows
    // (some live projects carry RERA numbers / statuses their submission never had).
    const live = sub.published_project_id ? await projects.findOne({ id: sub.published_project_id }) : null;
    const isEmpty = (v: unknown) => v == null || v === '' || (Array.isArray(v) && !v.length);
    for (const k of Object.keys(f)) if (isEmpty(f[k]) && live && !isEmpty(live[k])) f[k] = live[k];
    if (isEmpty(sub.rera_numbers) && live && !isEmpty(live.rera_numbers)) f.rera_numbers = live.rera_numbers;
    const kept = (Array.isArray(sub.additional_details) ? sub.additional_details : [])
      .filter((d: any) => !(_details as any[]).some((n) => n.label === d.label) && d.label !== SOURCE_LABEL);
    plans.push({ kind: 'update', p, sub, patch: { ...f, additional_details: [..._details, ...kept, { label: SOURCE_LABEL, value: SOURCE_VALUE }], updated_at: new Date().toISOString() } });
    continue;
  }
  const dupe = await subs.findOne({ project_name: { $regex: new RegExp(`^${p.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } });
  if (dupe) throw new Error(`${p.name}: a submission with this name already exists (${dupe.id}) — link it with \`sub\``);
  let lat: number | null = null, lng: number | null = null;
  if (p.near) {
    const anchor = await pins.findOne({ id: p.near });
    if (!anchor) throw new Error(`${p.name}: anchor pin ${p.near} missing`);
    const n = (nudge.get(p.near) || 0) + 1; nudge.set(p.near, n);
    const a = (n * 2.4); // spiral ~120–300 m out so neighbours stay clickable
    lat = +(anchor.lat + Math.cos(a) * 0.0012 * Math.sqrt(n)).toFixed(7);
    lng = +(anchor.lng + Math.sin(a) * 0.0012 * Math.sqrt(n)).toFixed(7);
  }
  plans.push({
    kind: 'create', p, publish: lat != null,
    doc: {
      ...f, lat, lng, status: lat != null ? 'submitted' : 'in_review', source: 'admin',
      additional_details: [..._details, { label: SOURCE_LABEL, value: SOURCE_VALUE },
        ...(p.near ? [{ label: 'Map location', value: 'Placed beside a neighbouring Lodha project — fine-tune the pin in the Map Editor' }] : [])],
      builder_remarks: lat == null ? 'Imported from the Lodha sheet (18 Nov 2026). Add the Google Maps link, then publish.' : null,
    },
  });
}

const tag = (pl: Plan) => (pl.kind === 'update' ? 'UPDATE ' : pl.publish ? 'NEW+MAP' : 'NEW (no location → in review)');
for (const pl of plans) {
  const f: any = pl.kind === 'update' ? pl.patch : pl.doc;
  console.log(`${tag(pl).padEnd(30)} ${pl.p.name.padEnd(44)} ${pl.p.city.padEnd(10)} ${String(f.price_min ?? '-').padStart(6)}–${String(f.price_max ?? '').padEnd(6)} Cr  ${f.carpet_area_min ?? '-'}–${f.carpet_area_max ?? ''} sqft  units:${pl.p.units.length}  [${f.configurations.join(', ')}]`);
}
console.log(`\n${plans.filter((x) => x.kind === 'update').length} updates, ${plans.filter((x) => x.kind === 'create' && x.publish).length} new on the map, ${plans.filter((x) => x.kind === 'create' && !x.publish).length} new without location.`);
if (held.length) console.log(`Held back (pass --include-held to import): ${held.map((h) => `${h.name} — ${h.hold}`).join('; ')}`);
if (!APPLY) { console.log('\nDry run. Pass --apply to write and publish.'); process.exit(0); }

// ---- apply
const dir = path.resolve(`migration/backup/pg-snapshot-${new Date().toISOString().replace(/[:.]/g, '-')}-before-lodha-go-live`);
mkdirSync(dir, { recursive: true });
const beforeProjects = await projects.find({ submission_id: { $in: plans.filter((x) => x.kind === 'update').map((x: any) => x.sub.id) } }).toArray();
writeFileSync(path.join(dir, 'before.json'), JSON.stringify({ submissions: plans.filter((x) => x.kind === 'update').map((x: any) => x.sub), projects: beforeProjects }, null, 1));
console.log(`backup → ${path.relative(process.cwd(), dir)}/before.json`);

const results: string[] = [];
for (const pl of plans) {
  let id: string;
  let media: Record<string, unknown> | undefined;
  if (pl.kind === 'update') {
    id = pl.sub.id;
    await subs.updateOne({ id }, { $set: pl.patch });
    // Re-publish with the media already live so photos/brochure are kept.
    const live = pl.sub.published_project_id ? await projects.findOne({ id: pl.sub.published_project_id }) : null;
    media = live ? {
      cover_image_url: live.cover_image_url ?? null, gallery_urls: live.gallery_urls || [], brochure_url: live.brochure_url ?? null,
      rera_qr_url: live.rera_qr_url ?? null, floor_plan_urls: live.floor_plan_urls || [], payment_plan_url: live.payment_plan_url ?? null,
    } : undefined;
  } else {
    const r = await runPartnersDb({ table: 'project_submissions', action: 'insert', values: pl.doc, returning: true, single: true });
    if (r.error) { results.push(`${pl.p.name}: INSERT ERROR ${r.error.message}`); continue; }
    id = (r.data as any).id;
    if (!pl.publish) { results.push(`${pl.p.name}: saved for review (${id})`); continue; }
  }
  const r = await runPartnersRpc('admin_publish', { p_id: id, p_media: media }, ACTOR);
  results.push(`${pl.p.name}: ${r.error ? `PUBLISH ERROR ${r.error.message}` : (r.data as any).map_note}`);
}
console.log(results.join('\n'));
process.exit(0);
