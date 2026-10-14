// READ-ONLY inventory + preliminary classification of every project record.
//
//   node --env-file=.env --import ./tests/register.mjs migration/enrichment/inventory.mjs
//
// Covers ALL rows of `scraped_projects` (registry dataset) and ALL rows of `pins` (live map),
// plus the intake chain that links them (project_submissions → projects → pins).
// Writes nothing to the database. Outputs (seo-doc/enrichment/):
//   record-inventory.csv                    one row per record, both sets
//   duplicate-candidates.csv                duplicate / sibling / cross-set groups
//   genuine-projects.csv                    classes A + B
//   invalid-and-placeholder-records.csv     classes D + E
//   manual-review.csv                       class F + anything flagged for a decision
//   inventory-state.json                    counts, for the summary and for resuming later stages
// Reports contain registry/project fields only — no lead, account or contact data.
//
// Classification here is PRELIMINARY and rule-based (Stage B, first pass). Every row carries the
// rule that classified it; research (Stage C) can only move a row with recorded evidence.

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { localitiesOf } from '../../lib/locality.ts';
import { projectSlug } from '../../lib/seo/slug.ts';
import { cityFrom } from '../../lib/seo/city.ts';
import { isPropertyProject } from '../../lib/seo/project-filter.ts';

const OUT = path.resolve('seo-doc/enrichment');
const DATE = new Date().toISOString().slice(0, 10);

function poolConfig(cs) {
  const url = new URL(cs);
  const mode = url.searchParams.get('sslmode');
  if (mode === 'disable') return { connectionString: cs };
  url.searchParams.delete('sslmode');
  return { connectionString: url.toString(), ssl: mode ? true : { rejectUnauthorized: false } };
}
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is required (--env-file=.env).'); process.exit(1); }
const pool = new pg.Pool(poolConfig(process.env.DATABASE_URL));
const q = (s, p) => pool.query(s, p).then((r) => r.rows);

// ---- helpers ------------------------------------------------------------------------------
const ref = (prefix, id) => `${prefix}-${createHash('sha1').update(String(id)).digest('hex').slice(0, 10)}`;
const normReg = (s) => String(s || '').toUpperCase().replace(/\s+/g, '');
const normName = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const filled = (v) => v != null && String(v).trim() !== '' && !/^(n\/?a|-|—|null|undefined)$/i.test(String(v).trim());
const on = (v) => v === true || v === 'true';
const isMahaRera = (v) => /^(P\d{11}|P[RCM]\d{13})$/.test(normReg(v));
const regTokens = (v) => String(v || '').toUpperCase().split(/[\s,;|]+/).map((t) => t.replace(/[^A-Z0-9/]/g, '')).filter((t) => t.length >= 9);
const cell = (v) => `"${String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
const csv = (rows, cols) => [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n') + '\n';

// Registry statuses that mean "no valid registration to list" (identity can still be genuine).
const NOT_LISTABLE = /^(Rejected|Withdrawn|Revoked|Deregistered|Lapsed|Superseded)/;
const PLACEHOLDER_NAME = /^(test( project)?|dummy|sample|unknown|tbd|na|n\/a)?$/i;

// ---- load ------------------------------------------------------------------------------------
const scraped = (await q(`SELECT id, doc FROM scraped_projects`)).map(({ id, doc }) => ({ id, doc, o: doc.original || {}, d: doc.data || {} }));
const pins = (await q(`SELECT id, doc FROM pins`)).map(({ id, doc }) => ({ id, p: doc }));
const subs = new Map((await q(`SELECT id, doc->>'published_project_id' project, doc->>'status' status FROM project_submissions`)).map((r) => [r.id, r]));
const projects = new Map((await q(`SELECT id, doc->>'pin_id' pin_id, coalesce((doc->>'is_live')::boolean,false) live FROM projects`)).map((r) => [r.id, r]));
// Lead / favourite references are COUNTED only (no personal data is read into the reports).
const leadRefs = new Map((await q(`SELECT doc->>'pin_id' pin, count(*)::int n FROM leads WHERE doc ? 'pin_id' GROUP BY 1`)).map((r) => [r.pin, r.n]));
const favRefs = new Map();
for (const r of await q(`SELECT doc->'favorites' f, doc->'compare_pins' c FROM users`)) {
  for (const id of [...(Array.isArray(r.f) ? r.f : []), ...(Array.isArray(r.c) ? r.c : [])]) favRefs.set(String(id), (favRefs.get(String(id)) || 0) + 1);
}
// Earlier research (pilot + batch 1), keyed by pin number.
const research = new Map();
for (const f of ['pilot-2026-10-14.json', 'batch1-2026-10-14.json']) {
  try {
    const j = JSON.parse(await readFile(path.join(OUT, f), 'utf8'));
    for (const p of j.projects || []) research.set(Number(p.number), { file: f, outcome: p.outcome || p.identity, reason: p.outcome_reason || p.identity_evidence || '' });
  } catch { /* not present */ }
}

// ---- index ------------------------------------------------------------------------------------
const scrapedByReg = new Map();
for (const s of scraped) if (s.o.rera_number) scrapedByReg.set(normReg(s.o.rera_number), s);
const pinsByNumber = new Map();
for (const x of pins) pinsByNumber.set(Number(x.p.number), [...(pinsByNumber.get(Number(x.p.number)) || []), x]);
const pinById = new Map(pins.map((x) => [x.id, x]));
// scraped → live pin, by the intake chain
const pinOfScraped = (s) => {
  const sub = s.doc.submission_id ? subs.get(s.doc.submission_id) : null;
  const proj = sub?.project ? projects.get(sub.project) : null;
  return proj?.pin_id ? pinById.get(proj.pin_id) || null : null;
};
// pin → scraped rows, by exact registration number
const scrapedOfPin = (x) => {
  const toks = [...regTokens(x.p.rera_number), ...(Array.isArray(x.p.custom_fields) ? x.p.custom_fields.filter((c) => /rera/i.test(c?.label || '')).flatMap((c) => regTokens(c.value)) : [])];
  return [...new Set(toks)].map((t) => scrapedByReg.get(normReg(t))).filter(Boolean);
};

// ---- scraped records ------------------------------------------------------------------------
const SCRAPED_FIELDS = ['project_name', 'developer_name', 'rera_number', 'project_type', 'locality', 'district', 'city', 'address', 'pincode', 'lat', 'lng', 'status', 'registration_date', 'original_completion', 'revised_completion'];
const nameGroups = new Map();
for (const s of scraped) {
  const k = `${normName(s.o.project_name)}|${normName(s.o.developer_name)}|${s.o.city}`;
  nameGroups.set(k, [...(nameGroups.get(k) || []), s]);
}
const inventory = [];
const dupRows = [];
for (const s of scraped) {
  const o = s.o, d = s.d;
  const linkedPin = pinOfScraped(s);
  const regPins = pins.filter((x) => scrapedOfPin(x).includes(s));
  const live = [...new Set([linkedPin, ...regPins].filter(Boolean))];
  const group = nameGroups.get(`${normName(o.project_name)}|${normName(o.developer_name)}|${o.city}`);
  const missing = SCRAPED_FIELDS.filter((f) => !filled(d[f] ?? o[f]));
  let cls, rule;
  if (!filled(o.project_name) || PLACEHOLDER_NAME.test(String(o.project_name).trim())) { cls = 'D'; rule = 'registry row with an empty or test/unknown project name'; }
  else if (/^Rejected/.test(o.status_category || '')) { cls = 'E'; rule = 'registry rejected the application; no registration was issued'; }
  else if (o.verification === 'Verified' && filled(o.rera_number)) { cls = 'A'; rule = `official ${o.regulator} record with registration number, project, promoter and status`; }
  else if (filled(o.rera_number)) { cls = 'A'; rule = `official ${o.regulator} listing (registration number, project, promoter); dates not on the listing`; }
  else { cls = 'B'; rule = `${o.regulator} entry without a registration number (status: ${o.status_category})`; }
  const flags = [];
  if (NOT_LISTABLE.test(o.status_category || '')) flags.push(`not listable: ${o.status_category}`);
  if (group.length > 1) flags.push(`same name + developer + city as ${group.length - 1} other row(s): possible phases`);
  if (o.pin_check === 'mismatch') flags.push('registry location conflicts with its stated locality');
  if (s.doc.edited_at) flags.push('working copy edited by the team');
  if (live.length) flags.push(`on the live map as pin ${live.map((x) => '#' + x.p.number).join(', ')}`);
  inventory.push({
    audit_ref: ref('S', s.id), record_type: 'scraped', db_id: s.id, pin_number: '', public_url: '',
    project_name: d.project_name ?? o.project_name, developer: d.developer_name ?? o.developer_name, registration: o.rera_number || '',
    regulator: o.regulator, registry_status: o.status_category, verification: o.verification, project_type: d.project_type ?? o.project_type ?? '',
    city: o.city, locality: d.locality ?? o.locality ?? '', pincode: d.pincode ?? o.pincode ?? '', lat: d.lat ?? o.lat ?? '', lng: d.lng ?? o.lng ?? '', pin_check: d.pin_check || o.pin_check || '',
    completion: d.revised_completion || d.original_completion || o.revised_completion || o.original_completion || '',
    price: '', configuration: '', source_url: o.project_url || o.source_url || '', imported_at: s.doc.imported_at || '',
    publication: s.doc.submission_id ? 'sent to Projects' : 'not published', linked_live: live.map((x) => '#' + x.p.number).join(' '),
    leads: '', favorites: '', missing_fields: missing.length, missing: missing.join(' '), class: cls, rule, flags: flags.join(' | '),
  });
}
// sibling groups (same name + developer + city)
for (const [k, group] of nameGroups) {
  if (group.length < 2) continue;
  const regs = group.map((s) => s.o.rera_number || '(none)');
  dupRows.push({
    group: ref('G', k), kind: 'same name + developer + city (registry)', records: group.map((s) => ref('S', s.id)).join(' '), db_ids: group.map((s) => s.id).join(' '),
    names: [...new Set(group.map((s) => s.o.project_name))].join(' / '), registrations: regs.join(' '),
    statuses: group.map((s) => s.o.status_category).join(' | '), live_urls: '', references: '',
    evidence: 'identical normalised project name, promoter and city', conflicts: new Set(regs).size === group.length ? 'different registration numbers' : 'shared registration',
    proposed_canonical: '', recommended_action: new Set(regs).size === group.length ? 'keep all: separate registrations are usually phases/wings; link as one development after review' : 'review: same registration on several rows',
    confidence: 'medium', review_status: 'needs review',
  });
}

// ---- live pins ---------------------------------------------------------------------------------
const titleCount = new Map();
for (const x of pins) { const t = normName(x.p.title); if (t) titleCount.set(t, (titleCount.get(t) || 0) + 1); }
for (const x of pins) {
  const p = x.p;
  const n = Number(p.number);
  const loc = localitiesOf(p.location)[0] || '';
  const url = Number.isFinite(n) ? `/projects/${projectSlug(p.title, loc, n)}` : '';
  const reg = scrapedOfPin(x);
  const r = research.get(n);
  const sameNumber = (pinsByNumber.get(n) || []).length > 1;
  const city = cityFrom(p.location, Number(p.lat), Number(p.lng));
  const flags = [];
  if (sameNumber) flags.push(`pin number #${n} is shared by ${(pinsByNumber.get(n) || []).length} pins (URL conflict)`);
  if ((titleCount.get(normName(p.title)) || 0) > 1) flags.push('another pin has the same title');
  if (on(p.hidden) || on(p.pending_review) || on(p.rejected)) flags.push('not public');
  if (filled(p.rera_number) && !isMahaRera(p.rera_number) && ['pune', 'mumbai', 'nashik'].includes(city)) flags.push(`stored RERA value is not a MahaRERA project number ("${p.rera_number}")`);
  if (r) flags.push(`researched: ${r.file} → ${r.outcome}`);
  const regName = reg[0]?.o.project_name || '';
  const nameMatch = reg.length && normName(regName).split(' ').some((w) => w.length > 3 && normName(p.title).includes(w));
  let cls, rule;
  // Registry evidence is checked first: a registered project with a working title is not a placeholder.
  if (reg.length && nameMatch) { cls = 'A'; rule = `registration found in the official ${reg[0].o.regulator} dataset under a matching name ("${regName}")`; }
  else if (reg.length) { cls = 'F'; rule = `registration is in the official dataset under a different name ("${regName}")`; }
  else if (!filled(p.title) || /\b(new (launch|project)|new commer?cial)\b/i.test(p.title) || /^\w+ properties$/i.test(String(p.title).trim())) { cls = 'D'; rule = 'live pin with an empty or placeholder title (unnamed / upcoming launch, or a developer name used as the title)'; }
  else if (!isPropertyProject(p)) { cls = 'E'; rule = 'office / land marker, not a property project (kept on the map, excluded from /projects)'; }
  else if (r && r.outcome === 'verified') { cls = 'A'; rule = `verified on MahaRERA in ${r.file}`; }
  else if (r && /conflict/.test(r.outcome)) { cls = 'F'; rule = r.reason; }
  else if (r) { cls = 'B'; rule = `${r.outcome} in ${r.file}`; }
  else if (filled(p.rera_number) && (isMahaRera(p.rera_number) || /\/RERA\//.test(p.rera_number))) { cls = 'B'; rule = 'stores a registration-format number not yet matched to a registry record'; }
  else { cls = 'G'; rule = 'identity research not completed'; }
  if (sameNumber && cls !== 'D') flags.push('decision needed: renumber (see DUPLICATES-REMEDIATION)');
  inventory.push({
    audit_ref: ref('P', x.id), record_type: 'live_pin', db_id: x.id, pin_number: p.number, public_url: url,
    project_name: p.title || '', developer: p.developer || '', registration: p.rera_number || '', regulator: reg[0]?.o.regulator || '',
    registry_status: reg[0]?.o.status_category || '', verification: '', project_type: p.type || '', city, locality: loc, pincode: '',
    lat: p.lat ?? '', lng: p.lng ?? '', pin_check: '', completion: p.possession_timeline || '', price: p.price || '', configuration: p.configuration || '',
    source_url: '', imported_at: p.created_at || '', publication: on(p.hidden) ? 'hidden' : on(p.pending_review) ? 'pending review' : 'live',
    linked_live: reg.map((s) => ref('S', s.id)).join(' '), leads: leadRefs.get(x.id) || 0, favorites: favRefs.get(x.id) || 0,
    missing_fields: ['developer', 'location', 'configuration', 'price', 'possession_timeline', 'rera_number', 'description', 'sqft'].filter((f) => !filled(p[f])).length,
    missing: ['developer', 'location', 'configuration', 'price', 'possession_timeline', 'rera_number', 'description', 'sqft'].filter((f) => !filled(p[f])).join(' '),
    class: cls, rule, flags: flags.join(' | '),
  });
}
// pin-level duplicate groups: same number, same registration, same title
const pinGroups = new Map();
for (const x of pins) {
  pinGroups.set(`num:${x.p.number}`, [...(pinGroups.get(`num:${x.p.number}`) || []), x]);
  for (const t of regTokens(x.p.rera_number)) pinGroups.set(`reg:${t}`, [...(pinGroups.get(`reg:${t}`) || []), x]);
}
for (const [k, g] of pinGroups) {
  if (g.length < 2) continue;
  const byNum = k.startsWith('num:');
  dupRows.push({
    group: ref('G', k), kind: byNum ? 'live pins sharing one pin number' : 'live pins sharing one registration', records: g.map((x) => ref('P', x.id)).join(' '),
    db_ids: g.map((x) => x.id).join(' '), names: g.map((x) => `#${x.p.number} ${x.p.title || '(no title)'}`).join(' / '), registrations: g.map((x) => x.p.rera_number || '').join(' '),
    statuses: g.map((x) => x.p.status).join(' | '), live_urls: g.map((x) => `/projects/${projectSlug(x.p.title, localitiesOf(x.p.location)[0] || '', Number(x.p.number))}`).join(' '),
    references: g.map((x) => `#${x.p.number}: leads ${leadRefs.get(x.id) || 0}, favourites ${favRefs.get(x.id) || 0}`).join('; '),
    evidence: byNum ? 'same pin number → only one is reachable by URL' : 'same registration number on two pins',
    conflicts: byNum ? 'different projects on one URL' : 'positions or types differ', proposed_canonical: '',
    recommended_action: byNum ? 'renumber the unreachable pin + permanent redirect (see DUPLICATES-REMEDIATION)' : 'review: one project on two pins, or two components of one registration',
    confidence: 'high', review_status: 'needs decision',
  });
}

// ---- write -------------------------------------------------------------------------------------
await mkdir(OUT, { recursive: true });
inventory.sort((a, b) => a.record_type.localeCompare(b.record_type) || String(a.city).localeCompare(String(b.city)) || String(a.audit_ref).localeCompare(String(b.audit_ref)));
const COLS = Object.keys(inventory[0]);
await writeFile(path.join(OUT, 'record-inventory.csv'), csv(inventory, COLS));
const DCOLS = Object.keys(dupRows[0]);
await writeFile(path.join(OUT, 'duplicate-candidates.csv'), csv(dupRows, DCOLS));
await writeFile(path.join(OUT, 'genuine-projects.csv'), csv(inventory.filter((r) => r.class === 'A' || r.class === 'B'), COLS));
await writeFile(path.join(OUT, 'invalid-and-placeholder-records.csv'), csv(inventory.filter((r) => r.class === 'D' || r.class === 'E'), COLS));
await writeFile(path.join(OUT, 'manual-review.csv'), csv(inventory.filter((r) => r.class === 'F' || /decision needed|conflict|not a MahaRERA|mismatch/.test(r.flags)), COLS));

const tally = (rows, key) => rows.reduce((a, r) => (a[r[key]] = (a[r[key]] || 0) + 1, a), {});
const S = inventory.filter((r) => r.record_type === 'scraped'), P = inventory.filter((r) => r.record_type === 'live_pin');
const state = {
  generated_at: new Date().toISOString(), date: DATE,
  counts: { scraped: S.length, scraped_unique_registrations: new Set(S.map((r) => normReg(r.registration)).filter(Boolean)).size, live_pins: P.length, pins_unique_numbers: new Set(P.map((r) => r.pin_number)).size, intake_projects: projects.size, submissions: subs.size },
  scraped_by_class: tally(S, 'class'), pins_by_class: tally(P, 'class'),
  scraped_by_city: tally(S, 'city'), scraped_by_regulator: tally(S, 'regulator'), scraped_by_status: tally(S, 'registry_status'),
  scraped_not_listable: S.filter((r) => /not listable/.test(r.flags)).length,
  scraped_linked_to_live: S.filter((r) => r.linked_live).length, pins_linked_to_registry: P.filter((r) => r.linked_live).length,
  scraped_with_coordinates: S.filter((r) => r.lat !== '' && r.lng !== '' && r.lat != null).length,
  duplicate_groups: tally(dupRows, 'kind'),
  avg_missing_fields: { scraped: +(S.reduce((s, r) => s + r.missing_fields, 0) / S.length).toFixed(2), pins: +(P.reduce((s, r) => s + r.missing_fields, 0) / P.length).toFixed(2) },
  coverage_check: { inventory_rows: inventory.length, expected: scraped.length + pins.length, unique_db_ids: new Set(inventory.map((r) => r.record_type + r.db_id)).size, unique_audit_refs: new Set(inventory.map((r) => r.audit_ref)).size },
};
await writeFile(path.join(OUT, 'inventory-state.json'), JSON.stringify(state, null, 2) + '\n');
console.log(JSON.stringify(state, null, 2));
await pool.end();
