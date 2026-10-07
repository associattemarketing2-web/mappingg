// Copies the whole database into MongoDB, exactly as it is, and builds indexes.
//
//   npm run import:mongo-all                      # straight from Postgres (DATABASE_URL)
//   npm run import:mongo-all -- --from <folder>   # from a JSON backup folder:
//        migration/backup/pg-export-<date>/  (npm run export:pg)  — full copy
//        migration/backup/                   (older JSON export)  — documents only
//   add --drop to replace collections that already hold data.
//
// Needs MONGODB_URI (+ optional MONGODB_DB, default "mappingg") in .env/.env.local.
// Document tables become collections with _id = the Postgres row id; inline
// images get the same hidden `_media_md5` fingerprints lib/mongodb.ts writes;
// project files go to the `partners_media` GridFS bucket; backups keep their
// gzipped blobs. Row counts are compared at the end.

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import dns from 'node:dns';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { MongoClient, Binary, GridFSBucket } from 'mongodb';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
for (const name of ['.env', '.env.local']) {
  const file = path.join(__dirname, '..', name);
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
if (dns.getServers().every((s) => s === '::1' || s.startsWith('127.'))) dns.setServers(['8.8.8.8', '1.1.1.1']);

const args = process.argv.slice(2);
const fromDir = args.includes('--from') ? path.resolve(args[args.indexOf('--from') + 1]) : null;
const DROP = args.includes('--drop');

// Keep in sync with lib/mongodb.ts.
const MEDIA = {
  pins: ['image', 'brochure_image'],
  infra_markers: ['icon_image'],
  pins_history: ['row_data.image', 'row_data.brochure_image'],
};
const SPECIAL = new Set(['backups', 'partners_media', 'account_activity', '_prisma_migrations']);
const md5 = (s) => createHash('md5').update(s).digest('hex');
const getPath = (o, p) => p.split('.').reduce((x, k) => (x && typeof x === 'object' ? x[k] : undefined), o);
const unB64 = (v) => (v && typeof v === 'object' && typeof v.$base64 === 'string' ? Buffer.from(v.$base64, 'base64') : v);

function toMongoDoc(table, id, doc) {
  const out = { ...doc, _id: String(id) };
  const d = {};
  for (const p of MEDIA[table] || []) {
    const v = getPath(doc, p);
    if (typeof v === 'string' && v.startsWith('data:')) d[p.replace(/\./g, '__')] = md5(v);
  }
  if (Object.keys(d).length) out._media_md5 = d;
  return out;
}

/* ------------------------------ sources ------------------------------ */

function pgTls(cs) {
  try {
    const u = new URL(cs); const mode = u.searchParams.get('sslmode');
    if (mode === 'disable') return { connectionString: cs };
    if (mode) { u.searchParams.delete('sslmode'); return { connectionString: u.toString(), ssl: true }; }
  } catch { /* noop */ }
  return { connectionString: cs, ssl: { rejectUnauthorized: false } };
}

/** Yields { table, rows } where rows are raw Postgres-shaped rows. */
async function* fromPostgres() {
  const c = new pg.Client(pgTls(process.env.DATABASE_URL));
  await c.connect();
  const { rows: tables } = await c.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY 1`);
  for (const { table_name: t } of tables) {
    const rows = [];
    for (let off = 0; ; off += 300) {
      const r = await c.query(`SELECT * FROM "${t.replace(/"/g, '""')}" ORDER BY ctid LIMIT 300 OFFSET ${off}`);
      rows.push(...r.rows);
      if (r.rows.length < 300) break;
    }
    yield { table: t, rows };
  }
  await c.end();
}

async function* fromFolder(dir) {
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json') && !x.startsWith('_') && !x.startsWith('image-migration'))) {
    const rows = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (!Array.isArray(rows)) continue;
    // Restore binary columns written as { $base64 } by export-postgres.mjs.
    yield { table: f.replace(/\.json$/, ''), rows: rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, unB64(v)]))) };
  }
}

/* ------------------------------- main -------------------------------- */

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set in .env / .env.local');
  const client = await new MongoClient(process.env.MONGODB_URI).connect();
  const db = client.db(process.env.MONGODB_DB || 'mappingg');
  console.log(`Target: MongoDB database "${db.databaseName}"   Source: ${fromDir || 'Postgres (DATABASE_URL)'}\n`);

  const ensureEmpty = async (name) => {
    const n = await db.collection(name).estimatedDocumentCount();
    if (!n) return;
    if (!DROP) throw new Error(`Collection "${name}" already has ${n} documents — rerun with --drop to replace it.`);
    await db.collection(name).drop();
  };

  const summary = [];
  for await (const { table, rows } of fromFolder ? fromFolder(fromDir) : fromPostgres()) {
    if (table === '_prisma_migrations') continue;

    if (table === 'partners_media') {
      for (const n of ['partners_media.files', 'partners_media.chunks']) {
        const exists = await db.listCollections({ name: n }).hasNext();
        if (exists) { if (!DROP && await db.collection(n).estimatedDocumentCount()) throw new Error('GridFS partners_media already has files — use --drop'); await db.collection(n).drop(); }
      }
      const bucket = new GridFSBucket(db, { bucketName: 'partners_media' });
      for (const r of rows) {
        const data = Buffer.isBuffer(r.data) ? r.data : Buffer.from(r.data || '');
        await new Promise((res, rej) => {
          const up = bucket.openUploadStream(r.filename, { metadata: { ...(r.metadata || {}), contentType: r.content_type || '' } });
          up.on('finish', res).on('error', rej);
          up.end(data);
        });
      }
      summary.push([table, rows.length, (await bucket.find({}).toArray()).length]);
      continue;
    }

    if (table === 'backups') {
      await ensureEmpty('backups');
      const docs = rows.map((r) => ({ _id: String(r.id), id: String(r.id), filename: r.filename, created_at: new Date(r.created_at), reason: r.reason, size: Number(r.size) || 0, counts: r.counts || {}, gz: new Binary(Buffer.isBuffer(r.gz) ? r.gz : Buffer.from(r.gz || '')) }));
      for (const d of docs) await db.collection('backups').insertOne(d); // one at a time: blobs can be large
      summary.push([table, rows.length, await db.collection('backups').countDocuments()]);
      continue;
    }

    // Document tables. Postgres rows are { id, doc }; older JSON exports are bare documents.
    await ensureEmpty(table);
    const docs = rows.map((r) => (r && typeof r.doc === 'object' && r.doc !== null && 'id' in r
      ? (table === 'account_activity' ? { _id: String(r.id), ...r.doc } : toMongoDoc(table, r.id, r.doc))
      : toMongoDoc(table, r._id ?? r.id ?? createHash('md5').update(JSON.stringify(r)).digest('hex'), (({ _id, ...rest }) => rest)(r))));
    for (let i = 0; i < docs.length; i += 100) await db.collection(table).insertMany(docs.slice(i, i + 100), { ordered: true });
    summary.push([table, rows.length, await db.collection(table).countDocuments()]);
  }

  console.log('Creating indexes…');
  const idx = async (c, keys, o = {}) => { try { await db.collection(c).createIndex(keys, o); } catch (e) { console.warn(`  index ${c} ${JSON.stringify(keys)}: ${e.message}`); } };
  for (const c of ['pins', 'infra_markers', 'roads', 'area_boundaries', 'infra_types', 'map_settings', 'leads', 'users', 'contact_leads', 'posts', 'builders', 'projects', 'submission_links', 'project_submissions']) await idx(c, { id: 1 });
  await idx('pins', { hidden: 1, number: 1 });
  await idx('pins', { owner_user_id: 1 });
  await idx('pins_history', { changed_at: -1 });
  await idx('pins_history', { history_id: 1 });
  await idx('pins_history', { pin_id: 1, operation: 1 });
  await idx('infra_types', { key: 1 });
  await idx('users', { email: 1 }, { unique: true });
  await idx('leads', { created_at: -1 });
  await idx('leads', { account_id: 1, pin_id: 1 });
  await idx('contact_leads', { created_at: -1 });
  await idx('posts', { slug: 1 });
  await idx('posts', { status: 1, published_at: -1 });
  await idx('builders', { code: 1 });
  await idx('submission_links', { token: 1 });
  await idx('project_submissions', { status: 1, updated_at: -1 });
  await idx('project_submissions', { ref_code: 1 });
  await idx('submission_events', { submission_id: 1, created_at: -1 });
  await idx('projects', { slug: 1 });
  await idx('projects', { is_live: 1, published_at: -1 });
  await idx('account_activity', { user_id: 1, at: -1 });
  await idx('account_activity', { at: -1 });
  await idx('backups', { created_at: -1 });

  console.log('\nTable'.padEnd(30) + 'source'.padStart(8) + 'mongo'.padStart(8));
  let bad = 0;
  for (const [t, a, b] of summary) {
    const ok = a === b; if (!ok) bad++;
    console.log(`${t.padEnd(29)}${String(a).padStart(8)}${String(b).padStart(8)}  ${ok ? 'OK' : 'MISMATCH'}`);
  }
  await client.close();
  console.log(bad ? `\n${bad} table(s) differ — check above.` : '\nAll counts match. Set MONGODB_URI on the server and redeploy to switch.');
  if (bad) process.exit(1);
}

main().catch((e) => {
  console.error('\nImport failed:', e.message);
  if (/planLimitReached/.test(e.message)) console.error('Postgres (Prisma) is still blocked. Unblock it, or import from a JSON backup folder with --from <folder>.');
  process.exit(1);
});
