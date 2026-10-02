// Backup all readable Supabase tables to JSON files.
// Usage:
//   node backup-supabase.mjs                → uses anon key (public tables only)
//   SUPABASE_KEY=<service_role> node ...    → uses service_role (includes leads, pins_history)
//
// The key is read from env SUPABASE_KEY if present, otherwise falls back to the
// public anon key embedded in the site. Never commit a service_role key.

import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, 'backup');

const SUPABASE_URL = 'https://kgnhxtrlccsyxmnmnokc.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtnbmh4dHJsY2NzeXhtbm1ub2tjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc4MDM2NjksImV4cCI6MjEwMzM3OTY2OX0.PDC3PpSYdNIz7dVJgpJzQO0EB5Ab-OR5Cy9vjqvZScg';
const KEY = process.env.SUPABASE_KEY || ANON_KEY;

// Optional: authenticate as an admin user so RLS-protected tables (leads,
// pins_history) become readable even with the anon key. Set SUPABASE_EMAIL
// and SUPABASE_PASSWORD to use this path.
async function getAccessToken() {
  const email = process.env.SUPABASE_EMAIL;
  const password = process.env.SUPABASE_PASSWORD;
  if (!email || !password) return null;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    console.error('Auth failed:', res.status, await res.text());
    process.exit(1);
  }
  const data = await res.json();
  console.log('Authenticated as', email);
  return data.access_token;
}

const TABLES = [
  'pins',
  'infra_markers',
  'roads',
  'map_settings',
  'infra_types',
  'area_boundaries',
  'leads',
  'pins_history',
];

const PAGE = 1000;

async function fetchAll(table, authToken) {
  const rows = [];
  let from = 0;
  const bearer = authToken || KEY;
  for (;;) {
    const to = from + PAGE - 1;
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*`, {
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${bearer}`,
        Range: `${from}-${to}`,
        'Range-Unit': 'items',
      },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`${table} ${res.status}: ${body}`);
    }
    const batch = await res.json();
    rows.push(...batch);
    if (batch.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const authToken = await getAccessToken();
  const summary = {};
  for (const table of TABLES) {
    try {
      const rows = await fetchAll(table, authToken);
      await writeFile(join(OUT_DIR, `${table}.json`), JSON.stringify(rows, null, 2));
      summary[table] = rows.length;
      console.log(`  ${table}: ${rows.length} rows -> backup/${table}.json`);
    } catch (err) {
      summary[table] = `ERROR: ${err.message}`;
      console.error(`  ${table}: ${err.message}`);
    }
  }
  await writeFile(join(OUT_DIR, '_summary.json'), JSON.stringify({ takenAt: new Date().toISOString(), counts: summary }, null, 2));
  console.log('\nBackup summary:', summary);
}

main();
