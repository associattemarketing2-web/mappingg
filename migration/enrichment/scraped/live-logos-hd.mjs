// Sharper developer logos that fit the round map pin, for the live projects added from scraped data
// (and any other pin or developer entry that uses exactly the same logo file).
//
//   node --env-file=.env migration/enrichment/scraped/live-logos-hd.mjs            dry run: counts only
//   node --env-file=.env migration/enrichment/scraped/live-logos-hd.mjs --apply    write
//   node --env-file=.env migration/enrichment/scraped/live-logos-hd.mjs --revert   put the old logos back
//
// Input: <cache>/live-logos-hd/plan.json + img/<i>.png, built 18 Oct 2026 and checked by eye. Each entry maps an
// old logo (md5 of its data: URL) to a new 512x512 PNG: the same logo, from a larger original where one was found
// (portal original without the resize parameter, or the developer's own website), empty border trimmed and scaled
// so the whole logo sits inside the round pin. No logo was swapped for a different design.
// Before writing, the old pin images and developer logos are saved to <cache>/live-logos-hd/before-<time>.json.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const DIR = path.resolve('migration/backup/scraped-enrichment-cache/live-logos-hd');
const mode = process.argv.includes('--apply') ? 'apply' : process.argv.includes('--revert') ? 'revert' : 'dry';
const url = new URL(process.env.DATABASE_URL); url.searchParams.delete('sslmode');
const db = new pg.Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false }, query_timeout: 300000 });
await db.connect();

if (mode === 'revert') {
  const last = readdirSync(DIR).filter((f) => /^before-.*\.json$/.test(f)).sort().pop();
  if (!last) throw new Error('No before-*.json backup found');
  const b = JSON.parse(readFileSync(path.join(DIR, last), 'utf8'));
  await db.query('BEGIN');
  for (const p of b.pins) await db.query(`UPDATE pins SET doc = doc || jsonb_build_object('image', $2::text) WHERE id = $1`, [p.id, p.image]);
  for (const d of b.developers) await db.query(`UPDATE developers SET doc = doc || jsonb_build_object('logo', $2::text, 'updated_at', $3::text) WHERE id = $1`, [d.id, d.logo, d.updated_at]);
  await db.query('COMMIT');
  console.log(`reverted from ${last}: ${b.pins.length} pins, ${b.developers.length} developers`);
  await db.end(); process.exit(0);
}

const plan = JSON.parse(readFileSync(path.join(DIR, 'plan.json'), 'utf8'));
const newUrl = new Map(plan.map((p) => [p.old_md5, 'data:image/png;base64,' + readFileSync(path.join(DIR, p.file)).toString('base64')]));
const olds = [...newUrl.keys()];
const pins = (await db.query(`SELECT id, doc->>'image' image, md5(doc->>'image') h FROM pins WHERE md5(doc->>'image') = ANY($1)`, [olds])).rows;
const devs = (await db.query(`SELECT id, doc->>'logo' logo, doc->>'updated_at' updated_at, md5(doc->>'logo') h FROM developers WHERE md5(doc->>'logo') = ANY($1)`, [olds])).rows;
console.log(`${plan.length} logos (${plan.filter((p) => p.upgraded).length} from a larger original) → ${pins.length} pins, ${devs.length} developer entries`);
if (mode === 'dry') { console.log('dry run — pass --apply to write'); await db.end(); process.exit(0); }

const stamp = new Date().toISOString();
writeFileSync(path.join(DIR, `before-${stamp.replace(/[:.]/g, '-')}.json`), JSON.stringify({ at: stamp, pins: pins.map(({ id, image }) => ({ id, image })), developers: devs.map(({ id, logo, updated_at }) => ({ id, logo, updated_at })) }));
await db.query('BEGIN');
for (const p of pins) await db.query(`UPDATE pins SET doc = doc || jsonb_build_object('image', $2::text) WHERE id = $1`, [p.id, newUrl.get(p.h)]);
for (const d of devs) await db.query(`UPDATE developers SET doc = doc || jsonb_build_object('logo', $2::text, 'updated_at', $3::text) WHERE id = $1`, [d.id, newUrl.get(d.h), stamp]);
await db.query('COMMIT');
console.log(`updated ${pins.length} pins and ${devs.length} developer entries (backup: before-${stamp.replace(/[:.]/g, '-')}.json)`);
await db.end();
