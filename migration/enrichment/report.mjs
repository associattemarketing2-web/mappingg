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
// The exact MahaRERA search URL whose results contained a registration (for source evidence).
let cacheAll = {};
try { cacheAll = JSON.parse(readFileSync(`${resFile}.cache.json`, 'utf8')); } catch { /* none */ }
const urlFor = (reg) => Object.values(cacheAll).find((q) => (q.rows || []).some((r) => r.registration === reg))?.url || null;
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

  // Cross-pin conflicts: a registration found for this project is stored on a DIFFERENT pin.
  // Only registrations whose name matches THIS project exactly count; a look-alike that belongs to
  // another pin is just a different project. If the other pin's title contains this title, it is a
  // tower/phase of the same development on its own pin ("related"), not a conflict.
  const crossPin = [], related = [];
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  for (const c of r.candidates.filter((c) => c.name_score >= 0.99)) {
    for (const o of pins) {
      if (o.id === r.pin_id || String(o.rera_number || '').replace(/\s/g, '').toUpperCase() !== c.registration) continue;
      const msg = `${c.registration} ("${c.name}") is stored on pin #${o.number} "${o.title}"`;
      if (norm(o.title).includes(norm(r.title).replace(/^the /, ''))) related.push(msg); else crossPin.push(msg);
    }
  }
  if (crossPin.length) flags.push(...crossPin.map((x) => `cross-pin: ${x}`));
  if (related.length) flags.push(...related.map((x) => `related pin (same development, separate pin): ${x}`));

  const firstUrl = r.searches.find((s) => s.total > 0)?.url || r.searches[0]?.url;
  const src = (reg) => urlFor(reg) || firstUrl;
  let proposal = null;
  if (r.identity === 'existing_rera_confirmed') proposal = { field: 'rera_number', existing, proposed: existing, action: 'none', source_url: src(existing.replace(/s/g, '').toUpperCase()), note: 'existing value confirmed on MahaRERA' };
  else if (r.existing_rera_typo_candidate) proposal = { field: 'rera_number', existing, proposed: r.existing_rera_typo_candidate, action: 'review', source_url: src(r.existing_rera_typo_candidate), note: 'stored number is not registered; same digits registered with a different prefix' };
  else if (r.proposed_rera) proposal = { field: 'rera_number', existing, proposed: r.proposed_rera, action: r.status === 'verified' ? 'set' : 'review', source_url: src(r.proposed_rera) };
  if (proposal) {
    const ev = r.candidates.find((c) => c.registration === proposal.proposed);
    proposal.identity_evidence = ev ? `MahaRERA: "${ev.name}", promoter ${ev.promoter}, ${ev.district} ${ev.pincode}; map: "${r.title}"${r.developer ? ` by ${r.developer}` : ''}${r.location ? `, ${r.location}` : ''}` : null;
  }

  // One of four outcomes. Nothing ambiguous is resolved here.
  const invalidExisting = existing && !isMahaRera(existing);
  let outcome, outcome_reason;
  // "Verified" needs the confirming registry row to match the map title WITHOUT spelling tolerance.
  const confirmRow = r.candidates.find((c) => c.registration === existing.replace(/\s/g, '').toUpperCase());
  const exactName = !!confirmRow && confirmRow.name_score >= 0.5;
  if (r.identity === 'existing_rera_confirmed' && !exactName) {
    outcome = 'needs_manual_review';
    const reg = confirmRow ? { registered_name: confirmRow.name, promoter: confirmRow.promoter } : r.existing_rera_registry || {};
    outcome_reason = `stored RERA number exists on MahaRERA as "${reg.registered_name}" (${reg.promoter}); the name only matches with spelling tolerance`;
  } else if (placeholder && r.identity !== 'existing_rera_confirmed') {
    outcome = 'not_found'; outcome_reason = 'placeholder title — not a registered project name; loose name matches ignored';
  } else if (r.identity === 'existing_rera_confirmed' && !crossPin.length && !r.flags.some((f) => /promoter name/.test(f))) {
    outcome = 'verified'; outcome_reason = 'stored RERA number found on MahaRERA under a matching name and developer';
  } else if (r.identity === 'existing_rera_confirmed') {
    outcome = 'verified'; outcome_reason = 'stored RERA number found on MahaRERA under a matching name; registered promoter is a different legal entity (normal for project SPVs) — noted';
  } else if (crossPin.length || r.existing_rera_typo_candidate || invalidExisting) {
    outcome = 'conflicting_evidence';
    outcome_reason = crossPin.length ? 'a matching registration is stored on another pin' : r.existing_rera_typo_candidate ? 'stored RERA number looks like a typo of a registered number' : 'stored RERA value is not a MahaRERA project number';
  } else if (r.identity === 'not_found' && !r.existing_rera_registry) {
    outcome = 'not_found'; outcome_reason = placeholder ? 'placeholder title — not a registered project name' : 'no registered project found by name after 3 tries per query (not proof the project is unregistered)';
  } else {
    outcome = 'needs_manual_review';
    outcome_reason = r.existing_rera_registry
      ? `stored RERA number exists on MahaRERA as "${r.existing_rera_registry.registered_name}" (${r.existing_rera_registry.promoter}) — name differs from the map title`
      : r.identity === 'multiple_phases_or_projects' ? 'several registrations match (phases, wings or same-name projects elsewhere) — phase/site not confirmed'
      : r.identity === 'single_match' ? 'one registration matches, but the name spelling or developer/promoter could not be confirmed'
      : 'only partial name matches';
  }

  return {
    number: r.number, pin_id: r.pin_id, title: r.title, developer: r.developer, location: r.location,
    outcome, outcome_reason, placeholder,
    existing_rera: existing, existing_rera_valid: existing ? isMahaRera(existing) : null, existing_rera_registry: r.existing_rera_registry || null,
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
const cacheFile = `${resFile}.cache.json`;
let queries = null, requests = null;
try { const c = JSON.parse(readFileSync(cacheFile, 'utf8')); queries = Object.keys(c).length; requests = Object.values(c).reduce((s, x) => s + (x.attempts || 1), 0); } catch { /* no cache */ }
const by = (o) => rows.filter((r) => r.outcome === o).map((r) => `#${r.number} ${r.title}`);
const summary = {
  projects: rows.length,
  queries_completed_in_run: queries,
  http_requests_in_run: requests,
  outcomes: {
    verified: by('verified'),
    conflicting_evidence: by('conflicting_evidence'),
    needs_manual_review: by('needs_manual_review'),
    not_found_genuine: rows.filter((r) => r.outcome === 'not_found' && !r.placeholder).map((r) => `#${r.number} ${r.title}`),
    not_found_placeholder: rows.filter((r) => r.outcome === 'not_found' && r.placeholder).map((r) => `#${r.number} ${r.title}`),
  },
  proposed_changes: rows.filter((r) => r.proposal && r.proposal.action !== 'none').map((r) => ({ number: r.number, title: r.title, ...r.proposal })),
  cross_pin_conflicts: rows.flatMap((r) => r.flags.filter((f) => f.startsWith('cross-pin:')).map((f) => `#${r.number}: ${f.slice(11)}`)),
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
