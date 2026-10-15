// Undo an enrichment run: removes doc.enrichment and restores doc.data from the pre-enrichment snapshot,
// only for rows whose enrichment.enriched_at equals the given run timestamp (or every enriched row with --all).
//
//   node --env-file=.env migration/enrichment/scraped/revert.mjs <snapshot scraped_projects.json> <enriched_at ISO | --all> [--apply]
//
// A row is restored only if its data still equals "snapshot data + the run's fills" (nobody edited it since).

import { readFileSync } from 'node:fs';
import pg from 'pg';

const [snapFile, run, flag] = process.argv.slice(2);
const APPLY = flag === '--apply';
const snap = new Map(JSON.parse(readFileSync(snapFile, 'utf8')).map((r) => [r.id, r.doc]));
const url = new URL(process.env.DATABASE_URL);
const mode = url.searchParams.get('sslmode');
url.searchParams.delete('sslmode');
const db = new pg.Client(mode === 'disable' ? { connectionString: process.env.DATABASE_URL } : { connectionString: url.toString(), ssl: mode ? true : { rejectUnauthorized: false } });
await db.connect();
const { rows } = await db.query(`SELECT id, doc FROM scraped_projects WHERE doc ? 'enrichment'`);
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort()) : x));
let done = 0, kept = 0;
for (const { id, doc } of rows) {
  if (run !== '--all' && doc.enrichment.enriched_at !== run) continue;
  const before = snap.get(id);
  const fills = Object.fromEntries(Object.entries(doc.enrichment.data_filled || {}).map(([k, v]) => [k, v.new]));
  if (!before || canon(doc.data) !== canon({ ...(before.data || {}), ...fills })) { kept++; console.log(`kept ${id}: edited since enrichment`); continue; }
  if (APPLY) await db.query(`UPDATE scraped_projects SET doc = (doc - 'enrichment') || jsonb_build_object('data', $2::jsonb) WHERE id = $1`, [id, JSON.stringify(before.data || {})]);
  done++;
}
console.log(`${APPLY ? 'Reverted' : 'Would revert'} ${done} rows; kept ${kept}.`);
await db.end();
