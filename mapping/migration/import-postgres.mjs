// Import the exported JSON (migration/backup/<collection>.json) into Postgres.
// Creates the schema first (idempotent), then upserts every document, then
// asserts the row counts match the export. Run after export-mongo.mjs:
//   node migration/import-postgres.mjs

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

function loadEnv() {
  const file = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}
loadEnv();

const COLLECTIONS = [
  'pins', 'infra_markers', 'roads', 'area_boundaries', 'infra_types', 'map_settings',
  'leads', 'pins_history', 'users', 'builders', 'submission_links', 'project_submissions',
  'submission_events', 'projects', 'counters', 'posts', 'contact_leads',
];

const connectionString = process.env.DATABASE_URL;
if (!connectionString) { console.error('DATABASE_URL is not set in .env.local'); process.exit(1); }

const BATCH = 100;
const backupDir = path.join(__dirname, 'backup');

async function main() {
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();

  // 1) schema
  const schema = fs.readFileSync(path.join(__dirname, 'pg-schema.sql'), 'utf8');
  await client.query(schema);
  console.log('Schema applied.\n');

  // 2) import
  const sourceCounts = {};
  const importedCounts = {};
  for (const name of COLLECTIONS) {
    const file = path.join(backupDir, `${name}.json`);
    const rows = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
    sourceCounts[name] = rows.length;

    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH);
      const values = [];
      const tuples = chunk.map((doc, j) => {
        const { _id, ...rest } = doc;
        const id = String(_id ?? rest.id);
        if (rest.id == null) rest.id = id;
        values.push(id, JSON.stringify(rest));
        return `($${j * 2 + 1}, $${j * 2 + 2}::jsonb)`;
      });
      if (!tuples.length) continue;
      await client.query(
        `INSERT INTO "${name}" (id, doc) VALUES ${tuples.join(', ')}
         ON CONFLICT (id) DO UPDATE SET doc = EXCLUDED.doc`,
        values,
      );
    }

    const res = await client.query(`SELECT count(*)::int AS n FROM "${name}"`);
    importedCounts[name] = res.rows[0].n;
    const ok = importedCounts[name] >= sourceCounts[name];
    console.log(`  ${name.padEnd(20)} source=${sourceCounts[name]}  in_db=${importedCounts[name]}  ${ok ? 'OK' : 'MISMATCH'}`);
  }

  // 3) assert
  const mismatches = COLLECTIONS.filter((n) => importedCounts[n] < sourceCounts[n]);
  await client.end();
  if (mismatches.length) {
    console.error('\nCount mismatch in:', mismatches.join(', '));
    process.exit(1);
  }
  console.log('\nImport complete — all counts match.');
}

main().catch((e) => { console.error('Import failed:', e); process.exit(1); });
