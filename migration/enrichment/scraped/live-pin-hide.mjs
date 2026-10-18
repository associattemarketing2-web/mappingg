// Hide live scraped-data pins whose location could not be confirmed (owner's decision, 18 Oct 2026). The pin stays in the
// database (hidden: true, like unpublishing) and comes back with --unhide; republishing the project also shows it again.
//   node --env-file=.env migration/enrichment/scraped/live-pin-hide.mjs <numbers comma-separated> [--apply | --unhide]
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const nums = String(process.argv[2] || '').split(',').filter(Boolean);
const APPLY = process.argv.includes('--apply'), UNHIDE = process.argv.includes('--unhide');
const RUN = new Date().toISOString();
const url = new URL(process.env.DATABASE_URL); url.searchParams.delete('sslmode');
const db = new pg.Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } });
await db.connect();
const { rows } = await db.query(`SELECT pn.id, pn.doc->>'number' num, pn.doc->>'title' title, coalesce((pn.doc->>'hidden')::boolean, false) hidden
  FROM scraped_projects s JOIN project_submissions sub ON sub.id = s.doc->>'submission_id' JOIN projects p ON p.id = sub.doc->>'published_project_id'
  JOIN pins pn ON pn.id = p.doc->>'pin_id' WHERE pn.doc->>'number' = ANY($1) AND pn.doc->>'source' = 'intake'`, [nums]);
rows.forEach((r) => console.log(`#${r.num} ${r.title} (hidden now: ${r.hidden})`));
if (rows.length !== nums.length) console.log('Some numbers are not live scraped-data pins; they are left alone.');
if (!APPLY && !UNHIDE) { console.log('Dry run.'); await db.end(); process.exit(0); }
const BK = path.resolve('migration/backup/live-pin-check'); mkdirSync(BK, { recursive: true });
writeFileSync(path.join(BK, `hide-${RUN.replace(/[:.]/g, '-')}.json`), JSON.stringify(rows));
const r = await db.query(`UPDATE pins SET doc = doc || jsonb_build_object('hidden', $2::boolean, 'updated_at', $3::text) WHERE id = ANY($1)`, [rows.map((x) => x.id), !UNHIDE, RUN]);
console.log(`${UNHIDE ? 'Shown' : 'Hidden'} ${r.rowCount} pins.`);
await db.end();
