// READ-ONLY: re-read every scraped_projects row and check the enrichment against the pre-enrichment snapshot.
//
//   node --env-file=.env migration/enrichment/scraped/verify.mjs <snapshot scraped_projects.json>
//
// For enriched rows: id, key, original, deleted, submission links and pin_check are unchanged; data equals
// the snapshot's data plus the recorded fills, each fill was on a previously blank field; review status is
// "Pending Review". For other rows: the document is identical to the snapshot (or edited by the team since,
// which is reported, not treated as an error).

import { readFileSync } from 'node:fs';
import pg from 'pg';

const snap = new Map(JSON.parse(readFileSync(process.argv[2], 'utf8')).map((r) => [r.id, r.doc]));
const url = new URL(process.env.DATABASE_URL);
const mode = url.searchParams.get('sslmode');
url.searchParams.delete('sslmode');
const db = new pg.Client(mode === 'disable' ? { connectionString: process.env.DATABASE_URL } : { connectionString: url.toString(), ssl: mode ? true : { rejectUnauthorized: false }, query_timeout: 600000 });
await db.connect();
const { rows } = await db.query('SELECT id, doc FROM scraped_projects ORDER BY id');
await db.end();
const canon = (v) => JSON.stringify(v ?? null, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort()) : x));
const blank = (v) => v == null || String(v).trim() === '';
const res = { rows: rows.length, snapshot: snap.size, enriched: 0, enriched_ok: 0, enriched_bad: [], untouched_identical: 0, edited_by_team_since: [], missing_from_db: 0, fields: 0, fills: 0 };
for (const { id, doc } of rows) {
  const before = snap.get(id);
  if (!before) { res.edited_by_team_since.push(`${id}: new row`); continue; }
  if (!doc.enrichment) {
    if (canon(doc) === canon(before)) res.untouched_identical++;
    else res.edited_by_team_since.push(id);
    continue;
  }
  res.enriched++;
  const e = doc.enrichment, fills = Object.fromEntries(Object.entries(e.data_filled || {}).map(([k, v]) => [k, v.new]));
  const problems = [];
  for (const k of ['id', 'key', 'original', 'deleted', 'submission_id', 'added_at', 'imported_at', 'dataset_generated', 'edited_at'])
    if (canon(doc[k]) !== canon(before[k])) problems.push(`${k} changed`);
  if (canon(doc.data) !== canon({ ...(before.data || {}), ...fills })) problems.push('data differs from snapshot + fills');
  for (const k of Object.keys(fills)) if (!blank(before.data?.[k])) problems.push(`fill on non-blank ${k}`);
  if (doc.data?.pin_check !== before.data?.pin_check || doc.data?.lat !== before.data?.lat || doc.data?.lng !== before.data?.lng) problems.push('location changed');
  if (e.review_status !== 'Pending Review') problems.push(`review status ${e.review_status}`);
  if (!Object.keys(e.fields || {}).length || !(e.sources || []).length) problems.push('no fields or sources');
  if (problems.length) res.enriched_bad.push(`${id}: ${problems.join(', ')}`);
  else { res.enriched_ok++; res.fields += Object.keys(e.fields).length; res.fills += Object.keys(fills).length; }
}
res.missing_from_db = [...snap.keys()].filter((id) => !rows.some((r) => r.id === id)).length;
console.log(JSON.stringify({ ...res, edited_by_team_since: res.edited_by_team_since.length, edited_ids: res.edited_by_team_since.slice(0, 20), enriched_bad: res.enriched_bad.slice(0, 20), enriched_bad_count: res.enriched_bad.length }, null, 1));
