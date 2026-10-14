// READ-ONLY: re-reads every pin changed in PROJECT-CHANGE-LOG.csv and confirms the saved value is still there,
// then marks PROJECT-SUMMARY.csv (Updated / Skipped) and prints a short per-project report.
//
//   node --env-file=.env --import ./tests/register.mjs migration/enrichment/verify-report.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getDb } from '../../lib/mongodb.ts';

const DIR = path.resolve('seo-doc/enrichment/live-project-enrichment');
const parse = (text) => {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n') { row.push(cur.replace(/\r$/, '')); rows.push(row); row = []; cur = ''; }
    else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  const [head, ...body] = rows;
  return { head, rows: body.filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? '']))) };
};
const cell = (v) => `"${String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;

const log = parse(readFileSync(path.join(DIR, 'PROJECT-CHANGE-LOG.csv'), 'utf8')).rows.filter((r) => r.applied === 'yes');
const db = await getDb();
const pins = db.collection('pins');
const byPin = new Map();
for (const r of log) byPin.set(r.project_id, [...(byPin.get(r.project_id) || []), r]);

let ok = 0, missing = 0;
const report = [];
for (const [id, rows] of byPin) {
  const p = await pins.findOne({ id });
  const fields = [];
  for (const r of rows) {
    let present;
    if (r.field.startsWith('custom: ')) {
      const label = r.field.slice(8);
      const cf = Array.isArray(p?.custom_fields) ? p.custom_fields : [];
      present = r.new_value.includes('(visible ') ? cf.some((c) => c.label === label) : cf.some((c) => c.label === label && c.value === r.new_value);
    } else present = String(p?.[r.field] ?? '') === r.new_value;
    present ? ok++ : missing++;
    if (!present) console.log(`  NOT FOUND #${r.pin_number} ${r.project_name}: ${r.field}`);
    fields.push(r.field.replace('custom: ', ''));
  }
  report.push({ id, number: Number(rows[0].pin_number), name: rows[0].project_name, fields: [...new Set(fields)], sources: [...new Set(rows.map((r) => r.source_url))] });
}
report.sort((a, b) => a.number - b.number);

const sum = parse(readFileSync(path.join(DIR, 'PROJECT-SUMMARY.csv'), 'utf8'));
for (const r of sum.rows) {
  const u = report.find((x) => x.id === r.database_id);
  r.fields_added = u ? u.fields.join(' | ') : '';
  r.changes_applied = u ? byPin.get(r.database_id).length : 0;
  r.overall_status = u ? 'Updated' : 'Skipped (no reliable official info found quickly)';
}
writeFileSync(path.join(DIR, 'PROJECT-SUMMARY.csv'), [sum.head.join(','), ...sum.rows.map((r) => sum.head.map((h) => cell(r[h])).join(','))].join('\n') + '\n');

console.log(`Checked ${sum.rows.length} live pins · updated ${report.length} · skipped ${sum.rows.length - report.length}`);
console.log(`Saved values re-read from DB: ${ok} present, ${missing} missing`);
for (const r of report) console.log(`#${r.number} ${r.name} — ${r.fields.join(', ')} — ${r.sources.join(' ; ')}`);
process.exit(missing ? 1 : 0);
