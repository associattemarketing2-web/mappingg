// Turns a research run (research-maharera.mjs output) into review files. Read-only.
//
//   node migration/enrichment/report.mjs <research.json> <snapshot pins.json> <out-prefix> [--exclude 75,116,239,243]
//
// Writes <out-prefix>.json (per project: existing vs proposed, sources, confidence, status)
// and <out-prefix>.csv, and prints a summary. Only identity / registration fields are
// researched here; price, possession, carpet area and amenities are reported as
// "not researched" (MahaRERA's search page doesn't carry them and portals aren't reliable enough).

import { readFileSync, writeFileSync } from 'node:fs';

const [resFile, snapFile, prefix, ...rest] = process.argv.slice(2);
const exclude = new Set(String(rest[rest.indexOf('--exclude') + 1] || '').split(',').filter(Boolean).map(Number));
const { results } = JSON.parse(readFileSync(resFile, 'utf8'));
const pins = JSON.parse(readFileSync(snapFile, 'utf8'));
const isMahaRera = (v) => /^(P\d{11}|P[RCM]\d{13})$/.test(String(v || '').replace(/\s/g, '').toUpperCase());
const titleCounts = new Map();
for (const p of pins) { const t = String(p.title || '').toLowerCase().trim(); titleCounts.set(t, (titleCounts.get(t) || 0) + 1); }

const rows = results.filter((r) => !exclude.has(Number(r.number))).map((r) => {
  const pin = pins.find((p) => p.id === r.pin_id) || {};
  const existing = String(r.existing_rera || '').trim();
  const dupTitle = (titleCounts.get(String(r.title).toLowerCase().trim()) || 0) > 1;
  const placeholder = /\b(new (launch|project|commercial)|commer?cial ?\d*$|^\w+ properties$|project$)/i.test(r.title);
  const flags = [...r.flags];
  if (dupTitle) flags.push('another pin has the same title');
  if (placeholder) flags.push('title looks like a placeholder, not a registered project name');
  if (r.searches.some((s) => s.error)) flags.push('a MahaRERA request failed — retry');

  let proposal = null;
  if (r.identity === 'existing_rera_confirmed') proposal = { field: 'rera_number', existing, proposed: existing, action: 'none', note: 'existing value confirmed on MahaRERA' };
  else if (r.proposed_rera) proposal = { field: 'rera_number', existing, proposed: r.proposed_rera, action: r.status === 'verified' ? 'set' : 'review' };

  return {
    number: r.number, pin_id: r.pin_id, title: r.title, developer: r.developer, location: r.location,
    existing_rera: existing, existing_rera_valid: existing ? isMahaRera(existing) : null,
    identity: r.identity, status: r.status, confidence: r.confidence, proposal,
    registered: r.candidates.map((c) => ({ registration: c.registration, registered_name: c.name, promoter: c.promoter, pincode: c.pincode, district: c.district, last_modified: c.last_modified, name_match: c.name_score, spelling_tolerant_match: c.fuzzy_score, promoter_matches_developer: c.promoter_match })),
    sources: r.searches.map((s) => ({ url: s.url, query: s.query, results: s.total })),
    checked_on: r.checked_on,
    not_researched: ['price', 'possession_timeline', 'carpet_area', 'amenities', 'description'],
    flags: [...new Set(flags)],
    _status_on_map: pin.status,
  };
});

const count = (f) => rows.filter(f).length;
const summary = {
  projects: rows.length,
  existing_rera_confirmed: count((r) => r.identity === 'existing_rera_confirmed'),
  new_registration_verified: count((r) => r.proposal?.action === 'set'),
  new_registration_needs_review: count((r) => r.proposal?.action === 'review'),
  multiple_phases_or_projects: count((r) => r.identity === 'multiple_phases_or_projects'),
  weak_match: count((r) => r.identity === 'weak_match'),
  not_found_after_retries: count((r) => r.identity === 'not_found'),
  invalid_existing_rera: rows.filter((r) => r.existing_rera && !r.existing_rera_valid).map((r) => ({ number: r.number, value: r.existing_rera })),
  existing_rera_not_matched_by_name: rows.filter((r) => r.existing_rera_valid && r.identity !== 'existing_rera_confirmed').map((r) => ({ number: r.number, title: r.title, rera: r.existing_rera })),
  promoter_differs: count((r) => r.registered.some((c) => c.promoter_matches_developer === false)),
  spelling_differs: count((r) => r.flags.some((f) => /spelled differently/.test(f))),
  placeholder_titles: rows.filter((r) => r.flags.some((f) => /placeholder/.test(f))).map((r) => `#${r.number} ${r.title}`),
  fields_not_verified: 'price, possession, carpet area, amenities, description — not verifiable from the MahaRERA search page; not proposed',
};

writeFileSync(`${prefix}.json`, JSON.stringify({ generated_at: new Date().toISOString(), source: 'MahaRERA public project search (official)', summary, projects: rows }, null, 2) + '\n');
const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const csv = [['number', 'title', 'developer', 'existing_rera', 'identity', 'status', 'confidence', 'proposed_rera', 'action', 'registered (no · name · promoter · pincode)', 'flags', 'source_url', 'checked_on'].join(',')]
  .concat(rows.map((r) => [r.number, cell(r.title), cell(r.developer), cell(r.existing_rera), r.identity, r.status, r.confidence, cell(r.proposal?.proposed), r.proposal?.action || '',
    cell(r.registered.map((c) => `${c.registration} · ${c.registered_name} · ${c.promoter} · ${c.pincode}`).join(' | ')), cell(r.flags.join(' | ')), cell(r.sources[0]?.url), r.checked_on].join(',')));
writeFileSync(`${prefix}.csv`, csv.join('\n') + '\n');
console.log(JSON.stringify(summary, null, 2));
