// One-off (21 Nov 2026): fill empty construction_status (and total_units for plotted projects) on live intake forms
// from the RERA registry facts already stored on the record. User approved: "Yes, from RERA".
//
//   node --env-file=.env migration/rera-status-2026-11-21.mjs              (dry run)
//   node --env-file=.env migration/rera-status-2026-11-21.mjs --apply
//   node --env-file=.env migration/rera-status-2026-11-21.mjs --revert=<backup dir>
//
// construction_status:
//   "Registry project status (project page)" = "New Project Launch" | "New"  → New Launch
//   "Registry project status (project page)" = "Ongoing"                     → Under Construction
//   otherwise RERA proposed completion / possession_date_rera in the future   → Under Construction
//   Never "Ready to Move" (no OC / completion record stored). Lapsed / not-checked registry rows are skipped.
// total_units ← "Total plots (RERA)" (plotted layouts only).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pg = require('pg');

const APPLY = process.argv.includes('--apply');
const REVERT = process.argv.find((a) => a.startsWith('--revert='))?.slice(9);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/, ''), ssl: { rejectUnauthorized: false }, max: 3 });
const q = (sql, params) => pool.query(sql, params);

if (REVERT) {
  const before = JSON.parse(readFileSync(path.join(REVERT, 'before.json'), 'utf8'));
  for (const s of before.submissions) await q(`UPDATE project_submissions SET doc = $2::jsonb WHERE id = $1`, [s.id, JSON.stringify(s)]);
  for (const p of before.projects) await q(`UPDATE projects SET doc = $2::jsonb WHERE id = $1`, [p.id, JSON.stringify(p)]);
  console.log(`reverted ${before.submissions.length} submissions`); await pool.end(); process.exit(0);
}

const empty = (v) => v == null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);
const NOW = new Date().toISOString().slice(0, 7);
const ad = (s, l) => (s.additional_details || []).find((d) => d.label === l)?.value;

const { rows } = await q(`SELECT p.doc->>'number' AS n, p.doc->>'title' AS title, pr.doc AS proj, s.doc AS sub
  FROM pins p JOIN projects pr ON pr.id = p.doc->>'intake_project_id' JOIN project_submissions s ON s.id = pr.doc->>'submission_id'
  WHERE coalesce(p.doc->>'hidden','false') <> 'true'`);

const plans = []; const log = [];
for (const { n, title, proj, sub } of rows) {
  const set = {}; const pset = {};
  const add = (k, v, src) => { if (!empty(sub[k])) return; set[k] = v; if (empty(proj[k])) pset[k] = v; log.push([n, title, k, v, src]); };
  const reg = String(ad(sub, 'Registry status') || '');
  const okReg = reg && !/not checked|lapse[ds]? —|revoked|completion date pas/i.test(reg);
  if (okReg) {
    const ps = ad(sub, 'Registry project status (project page)');
    const comp = String(ad(sub, 'Proposed completion (RERA)') || sub.possession_date_rera || '').slice(0, 7);
    // K-RERA "New Project Launch" is a registration category (registered after 2017), not "launching now": use dates.
    const start = String(ad(sub, 'Project start date (RERA)') || '').slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(comp) && comp >= NOW) {
      if (/^\d{4}-\d{2}$/.test(start) && start > NOW) add('construction_status', 'New Launch', `RERA start ${start} (not started yet), completion ${comp}`);
      else add('construction_status', 'Under Construction', `RERA completion ${comp}${start ? `, start ${start}` : ''}${ps ? `, registry "${ps}"` : ''}`);
    }
  }
  const plots = ad(sub, 'Total plots (RERA)');
  if (plots && /^\d+$/.test(String(plots).trim())) add('total_units', Number(plots), 'Total plots (RERA)');
  if (Object.keys(set).length) plans.push({ proj, sub, set, pset });
}
const by = {}; for (const r of log) by[`${r[2]}=${r[3] && typeof r[3] === 'string' ? r[3] : 'n'}`] = (by[`${r[2]}=${typeof r[3] === 'string' ? r[3] : 'n'}`] || 0) + 1;
console.log(`${plans.length} forms`, by);
const LOG = `seo-doc/enrichment/live-project-enrichment/RERA-STATUS-2026-11-21${APPLY ? '' : '-preview'}.csv`;
writeFileSync(LOG, [['pin_no', 'title', 'field', 'value', 'source'], ...log].map((r) => r.map((x) => `"${String(x ?? '').replace(/"/g, '""')}"`).join(',')).join('\n'));
console.log(`log → ${LOG}`);
if (!APPLY) { console.log('Dry run.'); await pool.end(); process.exit(0); }

const dir = path.resolve(`migration/backup/pg-snapshot-${new Date().toISOString().replace(/[:.]/g, '-')}-before-rera-status`);
mkdirSync(dir, { recursive: true });
writeFileSync(path.join(dir, 'before.json'), JSON.stringify({ submissions: plans.map((p) => p.sub), projects: plans.map((p) => p.proj) }));
for (const p of plans) {
  await q(`UPDATE project_submissions SET doc = doc || $2::jsonb WHERE id = $1`, [p.sub.id, JSON.stringify(p.set)]);
  if (Object.keys(p.pset).length) await q(`UPDATE projects SET doc = doc || $2::jsonb WHERE id = $1`, [p.proj.id, JSON.stringify(p.pset)]);
}
const { rows: after } = await q(`SELECT doc FROM project_submissions WHERE id = ANY($1)`, [plans.map((p) => p.sub.id)]);
const am = new Map(after.map((r) => [r.doc.id, r.doc])); let bad = 0;
for (const p of plans) for (const [k, v] of Object.entries(p.sub)) if (!empty(v) && JSON.stringify(am.get(p.sub.id)[k]) !== JSON.stringify(v)) bad++;
console.log(`backup → ${path.relative(process.cwd(), dir)}; applied ${plans.length}; existing values changed: ${bad}`);
await pool.end();
