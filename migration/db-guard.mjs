// Database safety check + safe schema changes.
//
//   npm run db:check                      compare the database with the last good snapshot;
//                                         ALERT (exit 1) when a table, a column or many rows are gone
//   npm run db:snapshot                   save the current state as the good snapshot
//   npm run db:migrate -- file.sql        run a schema change SAFELY:
//                                           1. refuses DROP / TRUNCATE / RENAME / DELETE-all … (lib/db-guard.mjs)
//                                           2. runs it inside a transaction
//                                           3. before committing, checks no table / column / rows were lost
//                                           4. anything lost → ROLLBACK (database stays exactly as it was) + alert
//   npm run db:migrate -- file.sql --dry-run           run + check, then always roll back
//   npm run db:migrate -- file.sql --allow-destructive only after `npm run export:pg`
//
// The snapshot lives in the database (table db_guard_baseline, so s-admin can
// compare against it too) and as a JSON copy in migration/backup/db-guard/.
// `npm run dev` runs the check on start and prints any alert.

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import pg from 'pg';
import { GUARD_LOG_SQL, riskOf } from '../lib/db-guard.mjs';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

for (const name of ['.env', '.env.local']) {
  const file = path.join(ROOT, name);
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

function tlsConfig(connectionString) {
  try {
    const u = new URL(connectionString);
    const mode = u.searchParams.get('sslmode');
    if (mode === 'disable') return { connectionString };
    if (mode) { u.searchParams.delete('sslmode'); return { connectionString: u.toString(), ssl: true }; }
  } catch { /* fall through */ }
  if (/localhost|127\.0\.0\.1/.test(connectionString)) return { connectionString };
  return { connectionString, ssl: { rejectUnauthorized: false } };
}

const BASELINE_SQL = `CREATE TABLE IF NOT EXISTS db_guard_baseline (
  key text PRIMARY KEY, value jsonb NOT NULL, at timestamptz NOT NULL DEFAULT now())`;
// Tables the guard itself owns, and pure logs the app may trim: not compared by row count.
const OWN = new Set(['db_guard_baseline', 'db_guard_log']);
const BIG = 200_000; // above this many rows use the planner's estimate instead of count(*)

const red = (s) => (process.stdout.isTTY ? `\x1b[41m\x1b[97m${s}\x1b[0m` : s);
const green = (s) => (process.stdout.isTTY ? `\x1b[32m${s}\x1b[0m` : s);

/** Tables → { rows, approx, columns[] } for the current schema. */
async function snapshot(c) {
  const cols = await c.query(`SELECT table_name t, column_name col FROM information_schema.columns
    WHERE table_schema = current_schema() ORDER BY table_name, ordinal_position`);
  const est = await c.query(`SELECT relname t, GREATEST(reltuples, 0)::bigint n FROM pg_class
    WHERE relkind IN ('r','p') AND relnamespace = current_schema()::regnamespace`);
  const estimate = Object.fromEntries(est.rows.map((r) => [r.t, Number(r.n)]));
  const tables = {};
  for (const { t, col } of cols.rows) {
    if (!(t in estimate)) continue; // views
    (tables[t] ??= { rows: 0, approx: false, columns: [] }).columns.push(col);
  }
  for (const t of Object.keys(tables)) {
    if (estimate[t] > BIG) { tables[t].rows = estimate[t]; tables[t].approx = true; continue; }
    const r = await c.query(`SELECT count(*)::bigint n FROM "${t.replace(/"/g, '""')}"`);
    tables[t].rows = Number(r.rows[0].n);
  }
  return { at: new Date().toISOString(), tables };
}

/** Problems between a good snapshot and now. */
export function compare(base, now) {
  const alerts = [];
  const warnings = [];
  for (const [t, b] of Object.entries(base.tables || {})) {
    if (OWN.has(t)) continue;
    const n = now.tables[t];
    if (!n) { alerts.push(`table "${t}" is GONE (had ${b.rows} rows)`); continue; }
    const lostCols = b.columns.filter((col) => !n.columns.includes(col));
    if (lostCols.length) alerts.push(`table "${t}" lost column(s): ${lostCols.join(', ')}`);
    const lost = b.rows - n.rows;
    if (lost <= 0) continue;
    const share = b.rows ? lost / b.rows : 0;
    const approx = b.approx || n.approx;
    if (b.rows > 0 && n.rows === 0) alerts.push(`table "${t}" is now EMPTY (had ${b.rows} rows)`);
    else if (!approx && lost >= 10 && share >= 0.05) alerts.push(`table "${t}" lost ${lost} of ${b.rows} rows (${Math.round(share * 100)}%)`);
    else if (approx && share >= 0.2) alerts.push(`table "${t}" lost about ${lost} of ${b.rows} rows`);
    else if (lost >= 5) warnings.push(`"${t}": ${b.rows} → ${n.rows} rows`);
  }
  return { alerts, warnings };
}

async function loadBaseline(c) {
  await c.query(BASELINE_SQL);
  const r = await c.query(`SELECT value FROM db_guard_baseline WHERE key = 'main'`);
  return r.rows[0]?.value || null;
}

async function saveBaseline(c, snap) {
  await c.query(BASELINE_SQL);
  await c.query(`INSERT INTO db_guard_baseline (key, value, at) VALUES ('main', $1, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now()`, [JSON.stringify(snap)]);
  const dir = path.join(ROOT, 'migration', 'backup', 'db-guard');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'baseline.json'), JSON.stringify(snap, null, 2));
}

async function logAlert(c, kind, detail) {
  try {
    await c.query(GUARD_LOG_SQL);
    await c.query('INSERT INTO db_guard_log (source, kind, detail) VALUES ($1, $2, $3)', ['db-guard', kind, detail.slice(0, 4000)]);
  } catch { /* best effort */ }
}

function printAlerts(title, alerts, warnings = []) {
  if (alerts.length) {
    console.log('\n' + red(` ⛔ DATABASE ALERT — ${title} `));
    for (const a of alerts) console.log(red(' • ') + ' ' + a);
    console.log('   Nothing was deleted by this check. Find what changed before saving new data;');
    console.log('   restore from a backup (migration/backup/pg-export-*) if needed.\n');
  }
  for (const w of warnings) console.log(`[db-guard] note: ${w}`);
}

async function connect() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  const c = new pg.Client({ ...tlsConfig(process.env.DATABASE_URL), connectionTimeoutMillis: 15_000, statement_timeout: 60_000 });
  await c.connect();
  return c;
}

async function cmdCheck({ quiet }) {
  const c = await connect();
  try {
    const base = await loadBaseline(c);
    const now = await snapshot(c);
    if (!base) {
      await saveBaseline(c, now);
      console.log(green(`[db-guard] first snapshot saved: ${Object.keys(now.tables).length} tables`));
      return 0;
    }
    const { alerts, warnings } = compare(base, now);
    if (alerts.length) {
      printAlerts(`compared with the good snapshot of ${base.at}`, alerts, warnings);
      await logAlert(c, 'check-failed', alerts.join('\n'));
      return 1; // keep the old snapshot so the alert stays until it is fixed
    }
    if (!quiet || warnings.length) printAlerts('', [], warnings);
    await saveBaseline(c, now); // all good: track growth / new tables
    console.log(green(`[db-guard] database OK — ${Object.keys(now.tables).length} tables, nothing missing`));
    return 0;
  } finally { await c.end().catch(() => undefined); }
}

async function cmdSnapshot() {
  const c = await connect();
  try {
    const now = await snapshot(c);
    await saveBaseline(c, now);
    console.log(green(`[db-guard] snapshot saved: ${Object.keys(now.tables).length} tables`));
    return 0;
  } finally { await c.end().catch(() => undefined); }
}

async function cmdMigrate(file, { dryRun, allowDestructive }) {
  if (!file || !fs.existsSync(file)) { console.error('Usage: npm run db:migrate -- <file.sql> [--dry-run] [--allow-destructive]'); return 2; }
  const sql = fs.readFileSync(file, 'utf8');
  const risk = riskOf(sql);
  if (risk && !allowDestructive) {
    printAlerts('migration REFUSED, nothing was run', [risk, 'Take a backup (npm run export:pg) and add --allow-destructive only if you really mean it.']);
    return 1;
  }
  if (/\bCONCURRENTLY\b/i.test(sql)) { console.error('[db-guard] CREATE INDEX CONCURRENTLY cannot run inside the safety transaction — remove CONCURRENTLY.'); return 2; }
  const c = await connect();
  try {
    const before = await snapshot(c);
    await c.query('BEGIN');
    try {
      await c.query(sql);
    } catch (e) {
      await c.query('ROLLBACK');
      console.error(red(` ⛔ migration failed — rolled back, database unchanged `) + `\n   ${e.message}`);
      return 1;
    }
    const after = await snapshot(c);
    const { alerts, warnings } = compare(before, after);
    if (alerts.length && !allowDestructive) {
      await c.query('ROLLBACK');
      printAlerts('migration ROLLED BACK — it would have lost data', alerts, warnings);
      await logAlert(c, 'migration-rolled-back', `${path.basename(file)}\n${alerts.join('\n')}`);
      return 1;
    }
    if (dryRun) {
      await c.query('ROLLBACK');
      printAlerts('dry run', alerts, warnings);
      const added = Object.keys(after.tables).filter((t) => !before.tables[t]);
      console.log(green(`[db-guard] dry run OK (rolled back). New tables: ${added.join(', ') || 'none'}`));
      return 0;
    }
    await c.query('COMMIT');
    await saveBaseline(c, after);
    printAlerts('', [], warnings);
    console.log(green(`[db-guard] migration applied safely — no table, column or rows lost`));
    return 0;
  } finally { await c.end().catch(() => undefined); }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === url.fileURLToPath(import.meta.url);
if (isMain) {
  const [cmd = 'check', ...rest] = process.argv.slice(2);
  const flags = new Set(rest.filter((a) => a.startsWith('--')));
  const args = rest.filter((a) => !a.startsWith('--'));
  const run = cmd === 'snapshot' ? cmdSnapshot()
    : cmd === 'migrate' ? cmdMigrate(args[0], { dryRun: flags.has('--dry-run'), allowDestructive: flags.has('--allow-destructive') })
    : cmdCheck({ quiet: flags.has('--quiet') });
  run.then((code) => { process.exitCode = code; })
    .catch((e) => { console.error(`[db-guard] could not check the database: ${e.message}`); process.exitCode = flags.has('--soft') ? 0 : 2; });
}
