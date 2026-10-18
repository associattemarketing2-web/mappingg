// Blank project type on live scraped records, from the configurations already confirmed for the record
// (registry or the developer's own page that prints the RERA number): only BHK homes → "Residential",
// only plots → "Plotted Development". Anything else (shops, offices, mixed, none) stays blank.
//   node --env-file=.env migration/enrichment/scraped/fill-project-type.mjs [--apply]
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const APPLY = process.argv.includes('--apply');
const LOG = path.resolve('seo-doc/enrichment/scraped-project-enrichment/PROJECT-CHANGE-LOG.csv');
const RUN = new Date().toISOString();
const url = new URL(process.env.DATABASE_URL);
url.searchParams.delete('sslmode');
const db = new pg.Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } });
await db.connect();
const { rows } = await db.query(`SELECT id, doc->'data' d, doc->'enrichment'->'fields'->>'configurations' cf, doc->'enrichment'->'fields'->>'developer_project_page' page
  FROM scraped_projects WHERE NOT coalesce((doc->>'deleted')::boolean, false) AND coalesce(doc->'data'->>'project_type', '') = ''
    AND coalesce(doc->'enrichment'->'fields'->>'configurations', '') <> ''`);
const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
let n = 0, saved = 0;
for (const { id, d, cf, page } of rows) {
  const parts = cf.split(',').map((s) => s.trim()).filter(Boolean);
  const type = parts.every((p) => /^\d(\.5)?\s*BHK$/i.test(p)) ? 'Residential' : parts.every((p) => /^(residential\s+)?plots?$/i.test(p)) ? 'Plotted Development' : null;
  if (!type) continue;
  n++;
  if (!APPLY) continue;
  const r = await db.query(`UPDATE scraped_projects SET doc = jsonb_set(doc, '{data,project_type}', to_jsonb($2::text)) WHERE id = $1 AND doc->'data' = $3::jsonb`, [id, type, JSON.stringify(d)]);
  if (r.rowCount) saved++;
  appendFileSync(LOG, [id, d.project_name, 'data.project_type', '', type, page || 'enrichment.configurations', 'derived_from_configurations', 'high', RUN, r.rowCount ? 'saved' : 'skipped_changed'].map(q).join(',') + '\n');
}
console.log({ blank_with_configurations: rows.length, typed: n, saved });
await db.end();
