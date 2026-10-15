// READ-ONLY: row counts + content hashes of the live tables, to prove an enrichment run left them alone.
//
//   node --env-file=.env migration/enrichment/scraped/live-fingerprint.mjs [out.json]
//
// Run before and after; the hashes must match.

import { writeFileSync } from 'node:fs';
import pg from 'pg';

const url = new URL(process.env.DATABASE_URL);
const mode = url.searchParams.get('sslmode');
url.searchParams.delete('sslmode');
const db = new pg.Client(mode === 'disable' ? { connectionString: process.env.DATABASE_URL } : { connectionString: url.toString(), ssl: mode ? true : { rejectUnauthorized: false }, query_timeout: 600000 });
await db.connect();
const out = { at: new Date().toISOString() };
for (const t of ['pins', 'projects', 'project_submissions', 'pins_history']) {
  const { rows } = await db.query(`SELECT count(*)::int AS n, md5(coalesce(string_agg(md5(id || doc::text), '' ORDER BY id), '')) AS h FROM "${t}"`);
  out[t] = rows[0];
}
await db.end();
console.log(JSON.stringify(out));
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(out, null, 1));
