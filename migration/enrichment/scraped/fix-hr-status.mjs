// One-off correction: on older HARERA pages a "View Certificate" link sits before the registration
// status, and the first parser took the link text as the status (188 rows). Re-read the status from the
// cached official page with the fixed parser and correct doc.enrichment.fields.registry_project_status.
// Nothing else in the row changes. Dry run by default.
//
//   node --env-file=.env migration/enrichment/scraped/fix-hr-status.mjs [--apply]

import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import pg from 'pg';
import { parseHr } from './parsers.mjs';

const APPLY = process.argv.includes('--apply');
const CACHE = path.resolve('migration/backup/scraped-enrichment-cache');
const LOG = path.resolve('seo-doc/enrichment/scraped-project-enrichment/PROJECT-CHANGE-LOG.csv');
const RUN = new Date().toISOString();
const BAD = 'View Certificate';

const url = new URL(process.env.DATABASE_URL);
const mode = url.searchParams.get('sslmode');
url.searchParams.delete('sslmode');
const db = new pg.Client(mode === 'disable' ? { connectionString: process.env.DATABASE_URL } : { connectionString: url.toString(), ssl: mode ? true : { rejectUnauthorized: false }, query_timeout: 120000 });
await db.connect();
const canon = (v) => JSON.stringify(v ?? null, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort()) : x));
const csv = (v) => { const s = v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v); return `"${s.replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`; };

const { rows } = await db.query(`SELECT id, doc FROM scraped_projects WHERE doc->'enrichment'->'fields'->>'registry_project_status' = $1 ORDER BY id`, [BAD]);
console.log(`${rows.length} rows with "${BAD}" as the registry status (${APPLY ? 'APPLY' : 'dry run'})`);
if (APPLY && rows.length) {
  const dir = path.resolve(`migration/backup/pg-snapshot-${RUN.replace(/[:.]/g, '-')}-before-hr-status-fix`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'scraped_projects.json'), JSON.stringify(rows));
  console.log(`Backup: ${dir}`);
}

const out = { corrected: 0, removed: 0, failed: 0, values: {} };
for (const { id, doc } of rows) {
  const pid = (String(doc.original?.project_url || '').match(/searchprojectDetail\/(\d+)$/) || [])[1];
  const file = path.join(CACHE, 'hr-pages', `${pid}-detail.txt.gz`);
  const status = pid && existsSync(file) ? parseHr(gunzipSync(readFileSync(file)).toString('utf8').split('\n'), null).registry_status : null;
  const e = structuredClone(doc.enrichment);
  if (status) e.fields.registry_project_status = status;
  else { delete e.fields.registry_project_status; e.updated_fields = e.updated_fields.filter((k) => k !== 'registry_project_status'); }
  out.values[status || '(removed)'] = (out.values[status || '(removed)'] || 0) + 1;
  if (!APPLY) { status ? out.corrected++ : out.removed++; continue; }
  // Only if the enrichment is unchanged since we read it.
  await db.query(`UPDATE scraped_projects SET doc = jsonb_set(doc, '{enrichment}', $2::jsonb) WHERE id = $1 AND doc->'enrichment' = $3::jsonb`,
    [id, JSON.stringify(e), JSON.stringify(doc.enrichment)]);
  const back = (await db.query(`SELECT doc FROM scraped_projects WHERE id = $1`, [id])).rows[0]?.doc;
  const ok = !!back && canon(back.enrichment) === canon(e) && canon({ ...back, enrichment: null }) === canon({ ...doc, enrichment: null });
  if (ok) status ? out.corrected++ : out.removed++; else out.failed++;
  appendFileSync(LOG, [[id, doc.data?.project_name || '', 'enrichment.registry_project_status', BAD, status || '', e.sources[0], e.source_type, 'high', RUN,
    ok ? 'corrected_verified (parser fix: link text was saved as status)' : 'correction_failed']].map((l) => l.map(csv).join(',')).join('\n') + '\n');
}
await db.end();
console.log(JSON.stringify(out, null, 1));
