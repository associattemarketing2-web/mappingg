// Merges every available JSON export into MongoDB, keeping the NEWEST version
// of each record — nothing already in MongoDB is deleted.
//
//   node migration/merge-into-mongo.mjs [--dry] <folder> [<folder> …]
//
// Records are matched by `id` (falling back to `_id`); when several sources
// hold the same record, the one with the latest updated_at / created_at /
// changed_at wins (later folders win ties). Inline images get the hidden
// `_media_md5` fingerprints lib/mongodb.ts expects, and the same indexes as
// import-to-mongo.mjs are created. Use when Postgres can't be read and the
// data has to be rebuilt from exports.

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import dns from 'node:dns';
import { createHash } from 'node:crypto';
import { MongoClient } from 'mongodb';

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
const DRY = args.includes('--dry');
const folders = args.filter((a) => !a.startsWith('--')).map((f) => path.resolve(f));
if (!folders.length) { console.error('Usage: node migration/merge-into-mongo.mjs [--dry] <folder> [<folder> …]'); process.exit(1); }

// Keep in sync with lib/mongodb.ts.
const MEDIA = {
  pins: ['image', 'brochure_image'],
  infra_markers: ['icon_image'],
  pins_history: ['row_data.image', 'row_data.brochure_image'],
};
const md5 = (s) => createHash('md5').update(s).digest('hex');
const getPath = (o, p) => p.split('.').reduce((x, k) => (x && typeof x === 'object' ? x[k] : undefined), o);
const stamp = (d) => String(d.updated_at || d.changed_at || d.created_at || '');
const keyOf = (table, d) => (table === 'pins_history' && d.history_id != null ? `h:${d.history_id}` : String(d.id ?? d._id));

// table -> record key -> the _id that record already has in MongoDB (so it is updated, never duplicated).
const existingIds = new Map();

function finalize(table, doc) {
  const { _media_md5: _old, ...rest } = doc;
  const out = { ...rest, _id: existingIds.get(table)?.get(keyOf(table, doc)) ?? String(doc._id ?? doc.id) };
  const h = {};
  for (const p of MEDIA[table] || []) {
    const v = getPath(out, p);
    if (typeof v === 'string' && v.startsWith('data:')) h[p.replace(/\./g, '__')] = md5(v);
  }
  if (Object.keys(h).length) out._media_md5 = h;
  return out;
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set');
  const client = await new MongoClient(process.env.MONGODB_URI).connect();
  const db = client.db(process.env.MONGODB_DB || 'mappingg');

  // table -> key -> { doc, from }
  const merged = new Map();
  const consider = (table, doc, from) => {
    if (!doc || typeof doc !== 'object') return;
    if (!merged.has(table)) merged.set(table, new Map());
    const m = merged.get(table);
    const k = keyOf(table, doc);
    const cur = m.get(k);
    if (!cur || stamp(doc) >= stamp(cur.doc)) m.set(k, { doc, from });
  };

  // 1) What MongoDB already has (lowest priority on ties).
  for (const { name } of await db.listCollections().toArray()) {
    if (name.startsWith('system.') || name.includes('.files') || name.includes('.chunks') || name === 'backups') continue;
    const ids = new Map();
    existingIds.set(name, ids);
    for (const d of await db.collection(name).find({}).toArray()) { ids.set(keyOf(name, d), d._id); consider(name, d, 'mongodb'); }
  }
  // 2) Each export folder, in the order given.
  for (const dir of folders) {
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json') && !x.startsWith('_') && !x.startsWith('image-migration'))) {
      let rows;
      try { rows = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
      if (!Array.isArray(rows)) continue;
      const table = f.replace(/\.json$/, '');
      for (const r of rows) consider(table, r && r.doc && typeof r.doc === 'object' && 'id' in r ? { ...r.doc, _id: r.id } : r, path.basename(dir));
    }
  }

  console.log(`${DRY ? '[dry run] ' : ''}Merging into "${db.databaseName}":\n`);
  console.log('Collection'.padEnd(24) + 'before'.padStart(8) + 'after'.padStart(8) + '  newest record from');
  for (const [table, m] of [...merged.entries()].sort()) {
    const before = await db.collection(table).countDocuments();
    const docs = [...m.values()];
    if (!DRY) {
      const ops = docs.map(({ doc }) => {
        const d = finalize(table, doc);
        return { replaceOne: { filter: { _id: d._id }, replacement: d, upsert: true } };
      });
      for (let i = 0; i < ops.length; i += 50) await db.collection(table).bulkWrite(ops.slice(i, i + 50), { ordered: false });
    }
    const after = DRY ? docs.length : await db.collection(table).countDocuments();
    const bySource = {};
    for (const { from } of docs) bySource[from] = (bySource[from] || 0) + 1;
    console.log(`${table.padEnd(24)}${String(before).padStart(8)}${String(after).padStart(8)}  ${Object.entries(bySource).map(([k, v]) => `${k}:${v}`).join(', ')}`);
  }

  if (!DRY) {
    const idx = async (c, keys, o = {}) => { try { await db.collection(c).createIndex(keys, o); } catch (e) { console.warn(`  index ${c}: ${e.message}`); } };
    for (const c of ['pins', 'infra_markers', 'roads', 'area_boundaries', 'infra_types', 'map_settings', 'leads', 'users', 'contact_leads', 'posts', 'builders', 'projects', 'submission_links', 'project_submissions']) await idx(c, { id: 1 });
    await idx('pins', { hidden: 1, number: 1 });
    await idx('pins', { owner_user_id: 1 });
    await idx('pins_history', { changed_at: -1 });
    await idx('pins_history', { history_id: 1 });
    await idx('pins_history', { pin_id: 1, operation: 1 });
    await idx('infra_types', { key: 1 });
    await idx('users', { email: 1 }, { unique: true });
    await idx('leads', { account_id: 1, pin_id: 1 });
    await idx('posts', { slug: 1 });
    await idx('builders', { code: 1 });
    await idx('submission_links', { token: 1 });
    await idx('project_submissions', { status: 1, updated_at: -1 });
    await idx('submission_events', { submission_id: 1, created_at: -1 });
    await idx('projects', { slug: 1 });
    await idx('account_activity', { user_id: 1, at: -1 });
    await idx('account_activity', { at: -1 });
    console.log('\nIndexes ready.');
  }
  await client.close();
}

main().catch((e) => { console.error('Merge failed:', e.message); process.exit(1); });
