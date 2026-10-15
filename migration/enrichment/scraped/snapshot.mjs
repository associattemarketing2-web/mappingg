// READ-ONLY: copy every scraped_projects row to a git-ignored snapshot before enrichment.
//
//   node --env-file=.env migration/enrichment/scraped/snapshot.mjs [label]
//
// Writes migration/backup/pg-snapshot-<time>-<label>/scraped_projects.json ([{ id, doc }]).
// The research scripts read this file, so the registry is only queried once.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const label = process.argv[2] || 'scraped';
const url = new URL(process.env.DATABASE_URL);
const mode = url.searchParams.get('sslmode');
url.searchParams.delete('sslmode');
const client = new pg.Client(mode === 'disable' ? { connectionString: process.env.DATABASE_URL } : { connectionString: url.toString(), ssl: mode ? true : { rejectUnauthorized: false }, query_timeout: 600000 });
await client.connect();
const { rows } = await client.query('SELECT id, doc FROM scraped_projects ORDER BY id');
await client.end();
const dir = path.resolve(`migration/backup/pg-snapshot-${new Date().toISOString().replace(/[:.]/g, '-')}-${label}`);
mkdirSync(dir, { recursive: true });
writeFileSync(path.join(dir, 'scraped_projects.json'), JSON.stringify(rows));
console.log(`${rows.length} rows → ${path.relative(process.cwd(), dir)}/scraped_projects.json`);
