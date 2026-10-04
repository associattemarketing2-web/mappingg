// Fresh Supabase → PostgreSQL sync.
//
//   node migration/sync-supabase-to-pg.mjs            (backup + replace)
//   node migration/sync-supabase-to-pg.mjs --dry-run  (backup only, no DB writes)
//
// 1. Downloads every map table from Supabase (paged, with retries) and saves it
//    as JSON to migration/backup/supabase-<timestamp>/ and migration/backup/<table>.json.
// 2. Snapshots the current Postgres rows of those tables to
//    migration/backup/pg-snapshot-<timestamp>/ so the old data can be restored.
// 3. In one transaction per table: deletes the old Postgres rows and inserts the
//    Supabase rows, then checks the counts match.
//
// Only tables that come from Supabase are replaced. Postgres-only tables (users,
// posts, builders, submissions…) are never touched. A table whose download fails
// or comes back incomplete is skipped, so its Postgres data is left as it was.

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DRY_RUN = process.argv.includes('--dry-run');

function loadEnv() {
  for (const name of ['.env.local', '.env']) {
    const file = path.join(ROOT, name);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      if (/^\s*#/.test(line)) continue;
      const m = /^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/.exec(line);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
    }
  }
}
loadEnv();

const SUPABASE_URL = 'https://kgnhxtrlccsyxmnmnokc.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtnbmh4dHJsY2NzeXhtbm1ub2tjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc4MDM2NjksImV4cCI6MjEwMzM3OTY2OX0.PDC3PpSYdNIz7dVJgpJzQO0EB5Ab-OR5Cy9vjqvZScg';
const KEY = process.env.SUPABASE_KEY || ANON_KEY;

const TABLES = ['pins', 'infra_markers', 'roads', 'map_settings', 'infra_types', 'area_boundaries', 'leads', 'pins_history'];
// Pins carry base64 images, so keep pages small to avoid huge responses on a flaky link.
const PAGE = 25;
// Primary-key column per table in Supabase (pins_history has no `id` column).
const KEY_COL = { pins_history: 'history_id' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchRetry(u, opts, tries = 6) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(u, opts);
      if (res.ok || (res.status < 500 && res.status !== 429)) return res;
      if (i >= tries) return res;
    } catch (e) {
      if (i >= tries) throw e;
    }
    await sleep(800 * i);
  }
}

async function fetchTable(table) {
  const keyCol = KEY_COL[table] || 'id';
  const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, Prefer: 'count=exact' };
  const rows = [];
  let total = null;
  for (let from = 0; ; from += PAGE) {
    const res = await fetchRetry(
      `${SUPABASE_URL}/rest/v1/${table}?select=*&order=${keyCol}.asc`,
      { headers: { ...headers, Range: `${from}-${from + PAGE - 1}`, 'Range-Unit': 'items' } },
    );
    if (!res.ok && res.status !== 416) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const m = /\/(\d+)$/.exec(res.headers.get('content-range') || '');
    if (m) total = Number(m[1]);
    const batch = res.status === 416 ? [] : await res.json();
    rows.push(...batch);
    if (batch.length < PAGE || (total != null && rows.length >= total)) break;
  }
  if (total != null && rows.length !== total) throw new Error(`incomplete: got ${rows.length} of ${total}`);
  return rows;
}

// Image fields the app serves through /api/media (see lib/pin-media.ts). Any of
// them still pointing at Supabase Storage is downloaded and stored inline as a
// data: URL, so every image lives in Postgres and keeps working without Supabase.
const INLINE_FIELDS = { pins: ['image', 'brochure_image'], infra_markers: ['icon_image'] };

async function inlineStorageImages(table, rows) {
  const fields = INLINE_FIELDS[table];
  if (!fields) return 0;
  let n = 0;
  for (const row of rows) {
    for (const f of fields) {
      const v = row[f];
      if (typeof v !== 'string' || !v.startsWith(`${SUPABASE_URL}/storage/`)) continue;
      try {
        const res = await fetchRetry(v, {});
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const mime = (res.headers.get('content-type') || 'image/jpeg').split(';')[0];
        row[f] = `data:${mime};base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`;
        n++;
      } catch (e) {
        console.log(`    ${table}.${f} #${row.number ?? row.id}: kept URL (${e.message})`);
      }
    }
  }
  return n;
}

async function main() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const supaDir = path.join(__dirname, 'backup', `supabase-${stamp}`);
  const snapDir = path.join(__dirname, 'backup', `pg-snapshot-${stamp}`);
  fs.mkdirSync(supaDir, { recursive: true });

  // 1) Supabase backup
  console.log('Downloading from Supabase…');
  const data = {};
  const summary = {};
  for (const t of TABLES) {
    try {
      const rows = await fetchTable(t);
      data[t] = rows;
      summary[t] = rows.length;
      const json = JSON.stringify(rows, null, 2);
      fs.writeFileSync(path.join(supaDir, `${t}.json`), json);
      fs.writeFileSync(path.join(__dirname, 'backup', `${t}.json`), json);
      const inlined = await inlineStorageImages(t, rows);
      console.log(`  ${t.padEnd(18)} ${rows.length} rows${inlined ? ` (${inlined} storage images inlined)` : ''}`);
    } catch (e) {
      summary[t] = `ERROR: ${e.message}`;
      console.log(`  ${t.padEnd(18)} SKIPPED (${e.message})`);
    }
  }
  fs.writeFileSync(path.join(supaDir, '_summary.json'), JSON.stringify({ takenAt: new Date().toISOString(), counts: summary }, null, 2));
  console.log(`Saved to ${path.relative(ROOT, supaDir)}\n`);

  if (DRY_RUN) { console.log('--dry-run: Postgres not changed.'); return; }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set in .env / .env.local');

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  await client.query(fs.readFileSync(path.join(__dirname, 'pg-schema.sql'), 'utf8'));

  // 2) snapshot current Postgres rows
  fs.mkdirSync(snapDir, { recursive: true });
  for (const t of TABLES) {
    const r = await client.query(`SELECT id, doc FROM "${t}"`);
    fs.writeFileSync(path.join(snapDir, `${t}.json`), JSON.stringify(r.rows.map((x) => ({ _id: x.id, ...x.doc })), null, 2));
  }
  console.log(`Old Postgres data saved to ${path.relative(ROOT, snapDir)}\n`);

  // 3) replace
  // Empty Supabase results for RLS-protected tables (leads, pins_history) mean
  // "not readable with this key", not "empty" — keep the Postgres rows then.
  const PROTECTED = new Set(['leads', 'pins_history']);
  for (const t of TABLES) {
    const rows = data[t];
    if (!rows) { console.log(`  ${t.padEnd(18)} kept old data (download failed)`); continue; }
    if (!rows.length && PROTECTED.has(t)) { console.log(`  ${t.padEnd(18)} kept old data (not readable with anon key)`); continue; }
    await client.query('BEGIN');
    try {
      const before = (await client.query(`SELECT count(*)::int n FROM "${t}"`)).rows[0].n;
      await client.query(`DELETE FROM "${t}"`);
      for (let i = 0; i < rows.length; i += 50) {
        const chunk = rows.slice(i, i + 50);
        const values = [];
        const tuples = chunk.map((doc, j) => {
          const { _id, ...rest } = doc;
          const id = String(_id ?? rest[KEY_COL[t] || 'id']);
          if (rest.id == null) rest.id = id;
          values.push(id, JSON.stringify(rest));
          return `($${j * 2 + 1}, $${j * 2 + 2}::jsonb)`;
        });
        await client.query(`INSERT INTO "${t}" (id, doc) VALUES ${tuples.join(', ')}`, values);
      }
      const after = (await client.query(`SELECT count(*)::int n FROM "${t}"`)).rows[0].n;
      if (after !== rows.length) throw new Error(`count mismatch ${after} vs ${rows.length}`);
      await client.query('COMMIT');
      console.log(`  ${t.padEnd(18)} ${before} → ${after}  OK`);
    } catch (e) {
      await client.query('ROLLBACK');
      console.log(`  ${t.padEnd(18)} ROLLED BACK (${e.message})`);
    }
  }
  await client.end();
  console.log('\nSync complete.');
}

main().catch((e) => { console.error('Sync failed:', e); process.exit(1); });
