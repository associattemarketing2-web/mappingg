// Fresh export of the live MongoDB data → migration/backup/<collection>.json.
// Run before importing into Postgres: `node migration/export-mongo.mjs`.
//
// Only the known data collections are exported (not GridFS buckets). Documents
// keep their string `_id`; the Postgres importer uses it as the primary key.

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import dns from 'node:dns';
import { MongoClient } from 'mongodb';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

// --- minimal .env.local loader (no dotenv dependency) ---
function loadEnv() {
  const file = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}
loadEnv();

// Same loopback-DNS workaround as lib/mongodb.ts (SRV lookups on some networks).
const isLoopback = (s) => s === '::1' || s.startsWith('127.');
if (dns.getServers().every(isLoopback)) {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
  dns.promises.setServers(['8.8.8.8', '1.1.1.1']);
}

const COLLECTIONS = [
  'pins', 'infra_markers', 'roads', 'area_boundaries', 'infra_types', 'map_settings',
  'leads', 'pins_history', 'users', 'builders', 'submission_links', 'project_submissions',
  'submission_events', 'projects', 'counters', 'posts', 'contact_leads',
];

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || 'mappingg';
if (!uri) { console.error('MONGODB_URI is not set in .env.local'); process.exit(1); }

function serialize(doc) {
  // Make the _id JSON-safe (ObjectId → hex string) but keep string _ids as-is.
  const id = doc._id;
  if (id && typeof id === 'object' && typeof id.toHexString === 'function') {
    return { ...doc, _id: id.toHexString() };
  }
  return doc;
}

async function main() {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
  await client.connect();
  const db = client.db(dbName);
  const outDir = path.join(__dirname, 'backup');
  fs.mkdirSync(outDir, { recursive: true });

  const counts = {};
  for (const name of COLLECTIONS) {
    const rows = (await db.collection(name).find({}).toArray()).map(serialize);
    fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(rows, null, 2));
    counts[name] = rows.length;
    console.log(`  ${name.padEnd(20)} ${rows.length}`);
  }
  fs.writeFileSync(
    path.join(outDir, '_export-summary.json'),
    JSON.stringify({ takenAt: new Date().toISOString(), source: 'mongodb', counts }, null, 2),
  );
  await client.close();
  console.log('\nExport complete →', outDir);
}

main().catch((e) => { console.error('Export failed:', e); process.exit(1); });
