// Full JSON backup of the Postgres database → migration/backup/pg-export-<timestamp>/.
// Run: `npm run export:pg`  (reads DATABASE_URL from .env / .env.local).
//
// Every table in the `public` schema is written to <table>.json as an array of
// rows. Binary (bytea) columns — project images, brochures, stored snapshots —
// are written as { "$base64": "..." } so nothing is lost. Large tables are read
// in pages, so memory stays flat. A _manifest.json records row counts and
// columns. The output folder is gitignored: it contains private data (users,
// password hashes, leads), so keep it somewhere safe and never commit it.

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

function loadEnv() {
  for (const name of ['.env', '.env.local']) {
    const file = path.join(__dirname, '..', name);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}
loadEnv();

// Same TLS handling as lib/pg.ts (Prisma Postgres requires TLS).
function tlsConfig(connectionString) {
  try {
    const u = new URL(connectionString);
    const mode = u.searchParams.get('sslmode');
    if (mode === 'disable') return { connectionString };
    if (mode) { u.searchParams.delete('sslmode'); return { connectionString: u.toString(), ssl: true }; }
  } catch { /* fall through */ }
  return { connectionString, ssl: { rejectUnauthorized: false } };
}

const PAGE = 500;
const encode = (v) => {
  if (Buffer.isBuffer(v)) return { $base64: v.toString('base64') };
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'bigint') return v.toString();
  return v;
};

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set (.env / .env.local)');
  const client = new pg.Client(tlsConfig(process.env.DATABASE_URL));
  await client.connect();

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.join(__dirname, 'backup', `pg-export-${stamp}`);
  fs.mkdirSync(outDir, { recursive: true });

  const { rows: tables } = await client.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`,
  );
  const manifest = { exportedAt: new Date().toISOString(), tables: {} };

  for (const { table_name: t } of tables) {
    const { rows: cols } = await client.query(
      `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`, [t],
    );
    // Stream rows into the file page by page (ctid order is stable for a read).
    const file = path.join(outDir, `${t}.json`);
    const fd = fs.openSync(file, 'w');
    fs.writeSync(fd, '[\n');
    let count = 0;
    for (let offset = 0; ; offset += PAGE) {
      const { rows } = await client.query(`SELECT * FROM "${t.replace(/"/g, '""')}" ORDER BY ctid LIMIT ${PAGE} OFFSET ${offset}`);
      for (const r of rows) {
        const o = {};
        for (const k of Object.keys(r)) o[k] = encode(r[k]);
        fs.writeSync(fd, (count ? ',\n' : '') + JSON.stringify(o));
        count++;
      }
      if (rows.length < PAGE) break;
    }
    fs.writeSync(fd, '\n]\n');
    fs.closeSync(fd);
    const size = fs.statSync(file).size;
    manifest.tables[t] = { rows: count, bytes: size, columns: cols.map((c) => `${c.column_name}:${c.data_type}`) };
    console.log(`${t.padEnd(28)} ${String(count).padStart(7)} rows  ${(size / 1024).toFixed(1).padStart(9)} KB`);
  }

  fs.writeFileSync(path.join(outDir, '_manifest.json'), JSON.stringify(manifest, null, 2));
  await client.end();
  console.log(`\nBackup written to ${outDir}`);
}

main().catch((e) => {
  console.error('\nBackup failed:', e.message);
  if (/planLimitReached|restrictions/i.test(e.message)) {
    console.error('The Prisma account is blocked (plan limit). Upgrade at https://console.prisma.io, then run this again.');
  }
  process.exit(1);
});
