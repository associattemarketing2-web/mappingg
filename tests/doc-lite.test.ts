import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startTestDb } from './helpers/api-db';
import { getDb, liteColumn, resetLiteTables } from '../lib/mongo-compat';
import { runDbOp } from '../lib/db-engine';
import { withMediaUrls } from '../lib/pin-media';

// Performance regression guard for the doc_lite column (migration/pg-doc-lite.sql):
// light reads must return exactly what full-document reads return, image reads
// that need the real bytes must still get them, and writes must keep the light
// copy in sync without the app ever writing it.

const LOGO = 'data:image/png;base64,' + 'A'.repeat(40_000); // a big inline logo, like production rows
const BRO = 'data:image/jpeg;base64,' + 'B'.repeat(20_000);
const PINS = [
  { id: 'a1', number: 1, title: 'Alpha', image: LOGO, brochure_image: BRO, lat: 18.5, lng: 73.9, status: 'available', updated_at: '2026-11-01T00:00:00Z', custom_fields: [{ label: 'x', value: 'y' }] },
  { id: 'a2', number: 2, title: 'Beta', image: '/api/partners/storage?k=1', lat: 18.6, lng: 73.8, hidden: true },
  { id: 'a3', number: 3, title: 'Gamma', lat: 19.1, lng: 72.9, image_meta: { status: 'completed', imageUrl: 'https://cdn.example/g.webp' } },
];

const LIST = 'id,number,lat,lng,title,status,updated_at,custom_fields,image,brochure_image';

/** db-engine keeps public reads in memory — clear it so every snapshot really queries the database. */
function clearReadCache() {
  (globalThis as unknown as { __pubReadCache?: Map<string, unknown> }).__pubReadCache?.clear();
}

async function snapshot() {
  clearReadCache();
  const db = await getDb();
  const pins = db.collection('pins');
  return {
    // Public map list (db-engine digests images → /api/media URLs).
    publicList: withMediaUrls('pins', (await runDbOp({ table: 'pins', action: 'select', columns: LIST }, false)).data),
    staffList: withMediaUrls('pins', (await runDbOp({ table: 'pins', action: 'select', columns: LIST, order: { col: 'number', ascending: false } }, true)).data),
    one: withMediaUrls('pins', (await runDbOp({ table: 'pins', action: 'select', columns: LIST, filters: [{ op: 'eq', col: 'id', val: 'a1' }], single: true }, true)).data),
    // Reads that need the real image must still get base64.
    rawImage: await pins.findOne({ id: 'a1' }, { projection: { image: 1 } }),
    fullDoc: await pins.findOne({ id: 'a1' }),
    // Filters on an image field must see the real value.
    byImage: (await pins.find({ image: LOGO }, { projection: { id: 1 } }).toArray()).map((d) => d.id),
    count: await pins.countDocuments({ hidden: { $ne: true } }),
    titles: (await pins.find({ $or: [{ number: 1 }, { number: 3 }] }, { projection: { title: 1 } }).sort({ number: 1 }).toArray()).map((d) => d.title),
  };
}

test('doc_lite reads return exactly what doc reads return, and stay in sync on writes', async () => {
  const { pg, insert } = await startTestDb();
  await insert('pins', PINS);
  await pg.exec(`CREATE TABLE IF NOT EXISTS "developers" (id text PRIMARY KEY, doc jsonb NOT NULL DEFAULT '{}'::jsonb)`);
  resetLiteTables();

  assert.equal(await liteColumn('pins'), 'doc', 'no column yet → full documents');
  const before = await snapshot();
  assert.ok(String((before.publicList as { image: string }[])[0].image).startsWith('/api/media/pins/a1?f=image&v='));

  await pg.exec(fs.readFileSync(new URL('../migration/pg-doc-lite.sql', import.meta.url), 'utf8'));
  resetLiteTables();
  assert.equal(await liteColumn('pins'), 'doc_lite');
  assert.equal(await liteColumn('posts'), 'doc', 'tables without inline media never use it');

  // The light copy really is light, and holds the exact digest the old query computed.
  const row = (await pg.query<{ lite: Record<string, string>; md5: string }>(`SELECT doc_lite AS lite, md5(doc->>'image') AS md5 FROM pins WHERE id = 'a1'`)).rows[0];
  assert.equal(row.lite.image, 'data:mg-digest;md5,' + row.md5);
  assert.ok(JSON.stringify(row.lite).length < 1000);

  // Record the SQL so we know the light path really ran (and the raw-image read didn't use it).
  const pool = (globalThis as unknown as { _pgPool: { query: (t: string, p?: unknown[]) => Promise<unknown> } })._pgPool;
  const seen: string[] = [];
  const realQuery = pool.query;
  pool.query = (t, p) => { seen.push(t); return realQuery(t, p); };
  const after = await snapshot();
  pool.query = realQuery;
  assert.deepEqual(after, before, 'same results with and without doc_lite');
  const selects = seen.filter((s) => s.startsWith('SELECT'));
  assert.ok(selects.filter((s) => s.includes('doc_lite AS doc')).length >= 4, 'list/count reads use doc_lite');
  assert.ok(selects.some((s) => s.includes('FROM "pins" WHERE')), 'raw image / image-filter reads use doc');
  assert.ok(!selects.some((s) => s.includes('doc_lite') && s.includes('md5(')), 'no md5 over base64 on light reads');
  assert.equal((after.rawImage as { image: string }).image, LOGO, 'raw image still read from doc');

  // A normal app write (no mention of doc_lite) updates the light copy.
  const NEW = 'data:image/png;base64,' + 'C'.repeat(10_000);
  await (await getDb()).collection('pins').updateOne({ id: 'a1' }, { $set: { image: NEW, title: 'Alpha 2' } });
  clearReadCache();
  const list = withMediaUrls('pins', (await runDbOp({ table: 'pins', action: 'select', columns: 'id,title,image', filters: [{ op: 'eq', col: 'id', val: 'a1' }], single: true }, true)).data) as { title: string; image: string };
  assert.equal(list.title, 'Alpha 2');
  const v = (await pg.query<{ v: string }>(`SELECT left(md5($1), 12) AS v`, [NEW])).rows[0].v;
  assert.equal(list.image, `/api/media/pins/a1?f=image&v=${v}`, 'new image → new versioned URL');

  // Revert path: dropping the column is clean.
  await pg.exec(`ALTER TABLE pins DROP COLUMN doc_lite; ALTER TABLE developers DROP COLUMN doc_lite; DROP FUNCTION mg_doc_lite(jsonb, text[]);`);
  resetLiteTables();
  assert.equal(await liteColumn('pins'), 'doc');
});
