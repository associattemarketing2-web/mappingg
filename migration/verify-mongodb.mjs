// Verify MongoDB collection counts against the JSON backups.
//   MONGODB_URI="mongodb+srv://..." node migration/verify-mongodb.mjs

import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import './dns-fix.mjs';
import { MongoClient } from 'mongodb';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, 'backup');
const dbName = process.env.MONGODB_DB || 'mappingg';
const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI is required.'); process.exit(1); }

async function main() {
  const files = (await readdir(OUT_DIR)).filter((f) => f.endsWith('.json') && !f.startsWith('_'));
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);

  let allMatch = true;
  for (const file of files) {
    const table = file.replace(/\.json$/, '');
    const rows = JSON.parse(await readFile(join(OUT_DIR, file), 'utf8'));
    const mongo = await db.collection(table).countDocuments();
    const match = mongo >= rows.length;
    if (!match) allMatch = false;
    console.log(`  ${match ? 'PASS' : 'FAIL'}  ${table}: backup=${rows.length} mongo=${mongo}`);
  }
  console.log(allMatch ? '\nAll collections verified.' : '\nMismatch detected — see above.');
  await client.close();
  process.exit(allMatch ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
