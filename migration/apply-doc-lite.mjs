// Applies (or with --revert removes) the doc_lite columns from pg-doc-lite.sql,
// then checks every row's light copy against the digest the app computed before,
// and times the public pin list both ways.
//
//   node --env-file=.env migration/apply-doc-lite.mjs            apply + verify
//   node --env-file=.env migration/apply-doc-lite.mjs --check    verify + time only
//   node --env-file=.env migration/apply-doc-lite.mjs --revert   drop the columns
//
// Reverting while the app is running is safe only after a restart/redeploy (each
// server process remembers whether the column exists), or set DOC_LITE=off first.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));
const mode = process.argv.includes('--revert') ? 'revert' : process.argv.includes('--check') ? 'check' : 'apply';
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
const c = new pg.Client({ connectionString: url.replace(/[?&]sslmode=[^&]*/, ''), ssl: /sslmode=disable/.test(url) ? false : { rejectUnauthorized: false } });
await c.connect();

const has = async (t) => (await c.query(`SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 AND column_name = 'doc_lite'`, [t])).rowCount > 0;

if (mode === 'revert') {
  await c.query(`ALTER TABLE "pins" DROP COLUMN IF EXISTS doc_lite`);
  await c.query(`ALTER TABLE "developers" DROP COLUMN IF EXISTS doc_lite`);
  await c.query(`DROP FUNCTION IF EXISTS mg_doc_lite(jsonb, text[])`);
  console.log('Reverted: doc_lite columns and mg_doc_lite() dropped. Restart the app (or it will keep asking for the column until it does).');
  await c.end();
  process.exit(0);
}

if (mode === 'apply') {
  const t0 = Date.now();
  await c.query(fs.readFileSync(path.join(here, 'pg-doc-lite.sql'), 'utf8'));
  console.log(`Applied pg-doc-lite.sql in ${Date.now() - t0} ms`);
}

for (const [table, keys] of [['pins', ['image', 'brochure_image']], ['developers', ['logo']]]) {
  if (!(await has(table))) { console.log(`${table}: no doc_lite column`); continue; }
  // Every non-image key must be identical; every image key must equal the old on-the-fly digest.
  const digest = (k) => `CASE WHEN left(doc->>'${k}', 5) = 'data:' THEN to_jsonb('data:mg-digest;md5,' || md5(doc->>'${k}')) ELSE doc->'${k}' END`;
  const bad = await c.query(`
    SELECT count(*)::int AS n FROM "${table}"
     WHERE (doc_lite - $1::text[]) IS DISTINCT FROM (doc - $1::text[])
        ${keys.map((k) => `OR doc_lite->'${k}' IS DISTINCT FROM ${digest(k)}`).join('\n        ')}`, [keys]);
  const size = await c.query(`SELECT count(*)::int AS rows, sum(pg_column_size(doc))::bigint AS doc, sum(pg_column_size(doc_lite))::bigint AS lite FROM "${table}"`);
  const s = size.rows[0];
  console.log(`${table}: ${s.rows} rows, mismatches=${bad.rows[0].n}, stored doc=${(s.doc / 1048576).toFixed(1)} MB, doc_lite=${(s.lite / 1048576).toFixed(2)} MB`);
  if (bad.rows[0].n) process.exitCode = 1;
}

if (await has('pins')) {
  const cols = 'id,number,lat,lng,title,type,status,price,description,updated_at,configuration,sqft,possession_timeline,launch_date,whats_available,highlighted,size,developer,location,key_usp,field_visibility,custom_fields,youtube_video_url,brochure_width,brochure_height,rera_number,image,brochure_image,brochure_url'.split(',');
  const media = new Set(['image', 'brochure_image']);
  const dig = (k) => `CASE WHEN left(doc->>'${k}',5)='data:' THEN to_jsonb('data:mg-digest;md5,'||md5(doc->>'${k}')) END`;
  const before = `SELECT jsonb_build_object(${cols.map((k) => (media.has(k) ? `'${k}', coalesce(${dig(k)}, doc->'${k}')` : `'${k}', doc->'${k}'`)).join(',')}) d FROM pins WHERE doc->'hidden' IS DISTINCT FROM 'true'::jsonb`;
  const after = `SELECT jsonb_build_object(${cols.map((k) => `'${k}', doc->'${k}'`).join(',')}) d FROM (SELECT id, doc_lite AS doc FROM pins) pins WHERE doc->'hidden' IS DISTINCT FROM 'true'::jsonb`;
  const time = async (sql) => { const r = []; let res; for (let i = 0; i < 3; i++) { const t = Date.now(); res = await c.query(sql); r.push(Date.now() - t); } return { ms: r, json: JSON.stringify(res.rows) }; };
  const a = await time(before), b = await time(after);
  console.log(`Public map pin list: doc ${a.ms.join('/')} ms → doc_lite ${b.ms.join('/')} ms; identical output: ${a.json === b.json}`);
  if (a.json !== b.json) process.exitCode = 1;
}
await c.end();
