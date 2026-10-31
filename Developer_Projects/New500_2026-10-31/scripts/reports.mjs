// Excel reports for the "500 new projects" research, rebuilt from every batch file in ../batches.
//
//   NODE_PATH=<folder with exceljs> node Developer_Projects/New500_2026-10-31/scripts/reports.mjs
//
// Writes to ../reports:
//   mappingg_500_new_projects.xlsx       every project that passed all checks (all batches), one sheet per city
//   mappingg_verified_projects.xlsx      the same projects with the location evidence and quality score
//   mappingg_rejected_projects.xlsx      failed a check, with the stage and reason
//   mappingg_duplicate_projects.xlsx     already in Mappingg (RERA number or project + developer)
//   mappingg_missing_fields_report.xlsx  fields the registry does not show for accepted projects (left blank, never invented)
//   mappingg_source_registry.xlsx        every source looked at: used, blocked, or not reachable

import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ExcelJS = require('exceljs');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'reports'); mkdirSync(OUT, { recursive: true });
const batches = readdirSync(path.join(ROOT, 'batches')).filter((f) => f.endsWith('.json')).sort()
  .map((f) => ({ file: f, city: /^tn-/.test(f) ? 'Chennai' : f.split('-')[0], ...JSON.parse(readFileSync(path.join(ROOT, 'batches', f), 'utf8')) }));
const sources = JSON.parse(readFileSync(path.join(ROOT, 'sources.json'), 'utf8'));

const all = (key) => batches.flatMap((b) => (b[key] || []).map((x) => ({ city: b.city, batch: b.counts?.batch, ...x })));
const accepted = all('accepted'), rejected = all('rejected'), duplicates = all('duplicates'), missing = all('missing');

async function book(name, sheets) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Mappingg research'; wb.created = new Date();
  for (const { title, columns, rows } of sheets) {
    const ws = wb.addWorksheet(title.slice(0, 31));
    ws.columns = columns.map(([header, key, width = 18]) => ({ header, key, width }));
    ws.addRows(rows);
    ws.getRow(1).font = { bold: true }; ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
    columns.forEach(([, key], i) => { if (/url/.test(key)) ws.getColumn(i + 1).eachCell((c, r) => { if (r > 1 && c.value) c.value = { text: String(c.value), hyperlink: String(c.value) }; }); });
  }
  await wb.xlsx.writeFile(path.join(OUT, name));
  console.log(path.join(OUT, name));
}
const byCity = (rows) => [...new Set(rows.map((r) => r.city))].map((c) => [c, rows.filter((r) => r.city === c)]);

const PROJECT_COLS = [
  ['Batch', 'batch', 7], ['City', 'city', 11], ['Project name', 'project_name', 34], ['Developer / promoter', 'developer', 40], ['RERA number', 'certificate', 26],
  ['District', 'district', 13], ['Locality', 'locality', 20], ['Pincode', 'pincode', 9], ['Latitude', 'lat', 11], ['Longitude', 'lng', 11],
  ['Category', 'building_type', 26], ['Construction status (RERA)', 'stage', 18], ['Registration date', 'registration_date', 13], ['Completion date (RERA)', 'completion', 13],
  ['Dwelling units', 'units', 9], ['Land area (sq m)', 'land_sqm', 11], ['Project cost declared to RERA (₹)', 'cost', 16], ['Developer website', 'website', 26],
  ['RERA project page', 'rera_url', 40], ['RERA Form A', 'form_url', 40], ['Quality score', 'score', 9],
];
const summary = { title: 'Summary', columns: [['Batch', 'batch', 8], ['City', 'city', 12], ['Read from registry', 'read_from_registry'], ['Extracted', 'extracted'], ['RERA matched', 'rera_matched'],
  ['Duplicate rejected', 'duplicate_rejected'], ['Identity / incomplete rejected', 'identity_rejected'], ['Status rejected', 'status_rejected'], ['Location rejected', 'location_rejected'],
  ['Location verified', 'location_verified'], ['In batch (ready for review)', 'in_this_batch']], rows: batches.map((b) => ({ city: b.city, ...b.counts })) };

await book('mappingg_500_new_projects.xlsx', [summary, { title: 'All projects', columns: PROJECT_COLS, rows: accepted }, ...byCity(accepted).map(([c, rows]) => ({ title: c, columns: PROJECT_COLS, rows }))]);
await book('mappingg_verified_projects.xlsx', [{ title: 'Verified', columns: [...PROJECT_COLS, ['Location evidence', 'pin_reason', 70], ['Existing Mappingg point within 40 m', 'near', 40]],
  rows: accepted.map((a) => ({ ...a, near: (a.near_existing || []).join('; ') })) }]);
await book('mappingg_rejected_projects.xlsx', [{ title: 'Rejected', columns: [['Batch', 'batch', 7], ['City', 'city', 11], ['RERA number', 'certificate', 26], ['Project name', 'project_name', 34], ['Developer', 'developer', 36],
  ['Failed check', 'stage', 12], ['Reason', 'reason', 80], ['Latitude (as declared)', 'lat', 12], ['Longitude (as declared)', 'lng', 12], ['RERA project page', 'rera_url', 40]],
  rows: rejected.map((r) => ({ ...r, reason: (r.reasons || []).join('; ') })) }]);
await book('mappingg_duplicate_projects.xlsx', [{ title: 'Duplicates', columns: [['Batch', 'batch', 7], ['City', 'city', 11], ['RERA number', 'certificate', 26], ['Project name', 'project_name', 34], ['Developer', 'developer', 36],
  ['Matched on', 'match', 22], ['Already in Mappingg as', 'existing', 70], ['RERA project page', 'rera_url', 40]], rows: duplicates }]);
await book('mappingg_missing_fields_report.xlsx', [{ title: 'Missing fields', columns: [['Batch', 'batch', 7], ['City', 'city', 11], ['RERA number', 'certificate', 26], ['Project name', 'project_name', 34], ['Not shown by the registry (left blank)', 'fields', 90]],
  rows: missing.map((m) => ({ ...m, fields: m.missing.join('; ') })) }]);
await book('mappingg_source_registry.xlsx', [{ title: 'Sources', columns: [['Source', 'name', 30], ['URL', 'url', 40], ['Kind', 'kind', 16], ['Status', 'status', 14], ['What it gave / why not used', 'note', 100], ['Checked on', 'checked', 12]], rows: sources }]);
