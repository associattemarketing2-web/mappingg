// One-off (30 Oct 2026): fill EMPTY project details on live Projects Intake records (and their map pins) from each
// project's official website — the "Developer project page" / website link already on the record.
//
//   npx tsx --env-file=.env migration/details-from-official-sites-2026-10-30.mts <facts.jsonl> <jobs.json>            (dry run)
//   npx tsx --env-file=.env migration/details-from-official-sites-2026-10-30.mts <facts.jsonl> <jobs.json> --apply    (backup, update)
//
// <facts.jsonl>: one line per official page, written by reading that page: { key, whole, d, u, acres, towers, floors,
// units, cfg, am, carpet:[min,max], mix:[{config,area}], poss:'YYYY-MM', per:{ "<pin number>": {…same keys} } }.
// Only what the page states is recorded; numbers the page contradicts elsewhere were left out.
// <jobs.json>: [{ key, page, projects:[{ kind, id }] }] — which records each page belongs to.
//
// Safety:
//   - A value is written only where the field is empty today; nothing already on a record is replaced.
//   - Records that are one phase / tower / wing of a larger project ("whole": false) never get project-wide counts
//     (acres, towers, floors, units, carpet range, possession) unless a per-record value is given for them.
//   - Project and its intake submission get the same values; the pin gets description / key USP / configuration /
//     carpet / possession only where the pin's own field is empty.
//   - Every live record touched is snapshotted first; every change is logged to
//     seo-doc/enrichment/live-project-enrichment/OFFICIAL-SITE-DETAILS-2026-10-30.csv

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getDb } from '../lib/mongodb';

const APPLY = process.argv.includes('--apply');
const [FACTS, JOBS] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!FACTS || !JOBS) throw new Error('pass <facts.jsonl> <jobs.json>');

type Mix = { config: string; area: string };
type F = { d?: string; u?: string; acres?: number; towers?: number; floors?: number; units?: number; cfg?: string[]; am?: string[]; carpet?: [number, number]; mix?: Mix[]; poss?: string };
type Fact = F & { key: string; whole: boolean; per?: Record<string, F> };

const facts: Fact[] = readFileSync(FACTS, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const jobs: { key: string; page: string; projects: { kind: string; id?: string }[] }[] = JSON.parse(readFileSync(JOBS, 'utf8'));

const AMENITIES = new Set(['Clubhouse', 'Swimming Pool', 'Gym', 'Kids Play Area', 'Jogging Track', 'Landscaped Garden', 'Indoor Games', 'Multipurpose Hall', 'Co-working Space', 'Sports Court', 'Yoga Deck', 'Senior Citizen Area', 'Pet Park', 'Amphitheatre', 'Party Lawn', 'Library', 'Mini Theatre', 'Spa / Sauna', 'Retail / Shops', '24x7 Security', 'CCTV', 'Power Backup', 'EV Charging', 'Rainwater Harvesting', 'Solar Power', 'Sewage Treatment Plant', 'Visitor Parking', 'Covered Parking', 'Lifts', 'Fire Safety']);
const CONFIGS = new Set(['Studio', '1 BHK', '1.5 BHK', '2 BHK', '2.5 BHK', '3 BHK', '3.5 BHK', '4 BHK', '5+ BHK', 'Villa', 'Row House', 'Penthouse', 'Duplex', 'Plot', 'Shop', 'Office', 'Showroom', 'Co-working', 'Warehouse', 'Land']);
for (const f of facts) {
  for (const a of f.am || []) if (!AMENITIES.has(a)) throw new Error(`${f.key}: unknown amenity ${a}`);
  for (const c of f.cfg || []) if (!CONFIGS.has(c)) throw new Error(`${f.key}: unknown configuration ${c}`);
  if (f.poss && !/^\d{4}-\d{2}$/.test(f.poss)) throw new Error(`${f.key}: bad possession ${f.poss}`);
}

const empty = (v: unknown) => v == null || v === '' || v === 0 || (Array.isArray(v) && v.length === 0);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const pinCfg = (cfg: string[]) => {
  const bhk = cfg.filter((c) => / BHK$/.test(c)).map((c) => c.replace(/ BHK$/, ''));
  const rest = cfg.filter((c) => !/ BHK$/.test(c));
  return [bhk.length ? `${bhk.join(' / ')} BHK` : '', ...rest].filter(Boolean).join(' / ');
};

const db = await getDb();
const projects = db.collection<any>('projects');
const subs = db.collection<any>('project_submissions');
const pins = db.collection<any>('pins');

type Change = { pin: number; name: string; target: 'project' | 'pin'; field: string; value: unknown; page: string };
const plans: { project: any; sub: any; pin: any; projSet: Record<string, unknown>; pinSet: Record<string, unknown> }[] = [];
const log: Change[] = [];

for (const fact of facts) {
  const job = jobs.find((j) => j.key === fact.key)!;
  for (const ref of job.projects.filter((p) => p.kind === 'intake' && p.id)) {
    const project = await projects.findOne({ id: ref.id, is_live: true });
    if (!project) continue;
    const sub = await subs.findOne({ id: project.submission_id });
    const pin = project.pin_id ? await pins.findOne({ id: project.pin_id }, { projection: { image: 0, brochure_image: 0 } }) : null;
    const own = (pin && fact.per?.[String(pin.number)]) || {};
    const whole = fact.whole;
    // Project-wide counts only for whole-project records; per-record values always apply.
    const v: F = { d: fact.d, u: fact.u, cfg: fact.cfg, am: fact.am, mix: fact.mix,
      ...(whole ? { acres: fact.acres, towers: fact.towers, floors: fact.floors, units: fact.units, carpet: fact.carpet, poss: fact.poss } : {}), ...own };

    const projSet: Record<string, unknown> = {};
    const want = (field: string, value: unknown) => {
      if (value == null || (Array.isArray(value) && !value.length)) return;
      if (!empty(project[field]) || (sub && !empty(sub[field]))) return;
      projSet[field] = value;
    };
    want('short_description', v.d);
    want('key_usps', v.u);
    want('land_area_acres', v.acres);
    want('towers', v.towers);
    want('floors', v.floors);
    want('total_units', v.units);
    want('configurations', v.cfg);
    want('amenities', v.am);
    want('possession_date_target', v.poss);
    want('unit_mix', v.mix?.map((m) => ({ config: m.config, area: m.area, price: '' })));
    if (v.carpet && empty(project.carpet_area_min) && empty(project.carpet_area_max) && (!sub || (empty(sub.carpet_area_min) && empty(sub.carpet_area_max)))) {
      projSet.carpet_area_min = v.carpet[0]; projSet.carpet_area_max = v.carpet[1];
      if (empty(project.area_unit)) projSet.area_unit = 'sq ft';
    }
    const details = Array.isArray(project.additional_details) ? project.additional_details : [];
    if (Object.keys(projSet).length && !details.some((x: any) => String(x?.value || '').includes(job.page))) {
      projSet.additional_details = [...details, { label: 'Details source (official project page)', value: job.page }];
    }

    const pinSet: Record<string, unknown> = {};
    if (pin) {
      if (v.d && empty(pin.description)) pinSet.description = v.d;
      if (v.u && empty(pin.key_usp)) pinSet.key_usp = v.u;
      if (v.cfg?.length && empty(pin.configuration)) pinSet.configuration = pinCfg(v.cfg);
      if (v.carpet && empty(pin.sqft)) pinSet.sqft = `${v.carpet[0].toLocaleString('en-IN')} – ${v.carpet[1].toLocaleString('en-IN')} Sq Ft (carpet)`;
      if (v.poss && empty(pin.possession_timeline)) pinSet.possession_timeline = monthLabel(v.poss);
    }
    if (!Object.keys(projSet).length && !Object.keys(pinSet).length) continue;
    plans.push({ project, sub, pin, projSet, pinSet });
    for (const [field, value] of Object.entries(projSet)) if (field !== 'additional_details') log.push({ pin: pin?.number, name: project.project_name, target: 'project', field, value, page: job.page });
    for (const [field, value] of Object.entries(pinSet)) log.push({ pin: pin?.number, name: project.project_name, target: 'pin', field, value, page: job.page });
  }
}

const byField: Record<string, number> = {};
for (const c of log) byField[`${c.target}.${c.field}`] = (byField[`${c.target}.${c.field}`] || 0) + 1;
for (const p of plans) console.log(`#${p.pin?.number} ${p.project.project_name}: ${[...Object.keys(p.projSet).filter((k) => k !== 'additional_details'), ...Object.keys(p.pinSet).map((k) => 'pin.' + k)].join(', ')}`);
console.log(`\n${plans.length} projects, ${log.length} field values`, JSON.stringify(byField, null, 1));
if (!APPLY) { console.log('Dry run. Pass --apply to write.'); process.exit(0); }

const dir = path.resolve(`migration/backup/pg-snapshot-${new Date().toISOString().replace(/[:.]/g, '-')}-before-official-details`);
mkdirSync(dir, { recursive: true });
writeFileSync(path.join(dir, 'before.json'), JSON.stringify({ projects: plans.map((p) => p.project), submissions: plans.map((p) => p.sub).filter(Boolean), pins: plans.map((p) => p.pin).filter(Boolean) }, null, 1));
console.log(`backup → ${path.relative(process.cwd(), dir)}/before.json`);

const nowTs = new Date().toISOString();
for (const p of plans) {
  if (Object.keys(p.projSet).length) {
    await projects.updateOne({ id: p.project.id }, { $set: { ...p.projSet, updated_at: nowTs } });
    if (p.sub) await subs.updateOne({ id: p.sub.id }, { $set: { ...p.projSet, updated_at: nowTs } });
  }
  if (p.pin && Object.keys(p.pinSet).length) await pins.updateOne({ id: p.pin.id }, { $set: { ...p.pinSet, updated_at: nowTs } });
}

const LOG = path.resolve('seo-doc/enrichment/live-project-enrichment/OFFICIAL-SITE-DETAILS-2026-10-30.csv');
mkdirSync(path.dirname(LOG), { recursive: true });
const cell = (x: unknown) => `"${(typeof x === 'string' ? x : JSON.stringify(x)).replace(/"/g, '""')}"`;
writeFileSync(LOG, ['pin_number,project,target,field,new_value,source_url,checked_on',
  ...log.map((c) => [c.pin, c.name, c.target, c.field, c.value, c.page, '2026-10-30'].map(cell).join(','))].join('\n') + '\n');
console.log(`log → ${path.relative(process.cwd(), LOG)} (${existsSync(LOG) ? log.length : 0} rows)`);
process.exit(0);
