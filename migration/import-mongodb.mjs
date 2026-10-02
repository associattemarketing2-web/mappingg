// Import the JSON backups into MongoDB.
// The connection string is read from env MONGODB_URI (never hardcode secrets).
//   MONGODB_URI="mongodb+srv://..." node import-mongodb.mjs
//
// Each backup/<table>.json becomes a collection of the same name in DB "mappingg".
// The Supabase text "id" (uuid) is preserved as a field and also used as _id so
// re-running the import upserts instead of duplicating.

import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import './dns-fix.mjs';
import { MongoClient } from 'mongodb';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, 'backup');
const DB_NAME = process.env.MONGODB_DB || 'mappingg';

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI env var is required.');
  process.exit(1);
}

async function main() {
  const files = (await readdir(OUT_DIR)).filter(f => f.endsWith('.json') && !f.startsWith('_'));
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(DB_NAME);
  const summary = {};

  for (const file of files) {
    const table = file.replace(/\.json$/, '');
    const rows = JSON.parse(await readFile(join(OUT_DIR, file), 'utf8'));
    const coll = db.collection(table);

    if (rows.length === 0) {
      summary[table] = 0;
      console.log(`  ${table}: 0 rows (skipped)`);
      continue;
    }

    // Use the Supabase uuid/id as Mongo _id when available for idempotent upserts.
    const ops = rows.map(doc => {
      const _id = doc.id != null ? String(doc.id) : undefined;
      const value = { ...doc };
      if (_id !== undefined) value._id = _id;
      return {
        replaceOne: {
          filter: { _id: _id !== undefined ? _id : doc._id },
          replacement: value,
          upsert: true,
        },
      };
    });

    const result = await coll.bulkWrite(ops, { ordered: false });
    const count = await coll.countDocuments();
    summary[table] = { inBackup: rows.length, inMongo: count, upserted: result.upsertedCount, modified: result.modifiedCount };
    console.log(`  ${table}: backup=${rows.length} mongo=${count}`);
  }

  console.log('\nImport summary:', JSON.stringify(summary, null, 2));
  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
