// Noida rows whose UP RERA entry has no project address: the locality is named from OpenStreetMap at the
// project's verified UP RERA point (reverse lookup cached by up-import.mjs). Working copy (`data.locality`) only,
// recorded in enrichment.data_filled with its source; `original` keeps the registry's blank. Only rows with a
// verified location and no locality are touched.
//   node --env-file=.env migration/enrichment/scraped/up-fill-locality.mjs [--apply]

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const APPLY = process.argv.includes('--apply');
const PIN_DIR = path.resolve('migration/backup/scraped-enrichment-cache/osm-pincodes');
const url = new URL(process.env.DATABASE_URL);
url.searchParams.delete('sslmode');
const db = new pg.Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } });
await db.connect();
const { rows } = await db.query(`SELECT id, doc FROM scraped_projects WHERE doc->'original'->>'regulator' = 'UP RERA'
  AND doc->'data'->>'pin_check' = 'verified' AND coalesce(doc->'data'->>'locality', '') = ''`);
let n = 0;
for (const { id, doc } of rows) {
  const { lat, lng } = doc.data;
  const file = path.join(PIN_DIR, `rev-${Number(lat).toFixed(5)}_${Number(lng).toFixed(5)}.json`);
  if (!existsSync(file)) continue;
  const a = JSON.parse(readFileSync(file, 'utf8')).address || {};
  const place = a.suburb || a.neighbourhood || a.quarter || a.residential || a.village || a.hamlet;
  const town = a.city || a.town || a.city_district || a.county;
  const locality = [place, town].filter(Boolean).filter((v, i, l) => l.indexOf(v) === i).join(', ');
  if (!locality) continue;
  n++;
  console.log(`${doc.data.project_name} → ${locality}`);
  if (!APPLY) continue;
  const filled = { ...(doc.enrichment?.data_filled || {}), locality: { old: null, new: locality, source: 'OpenStreetMap reverse lookup at the verified UP RERA point (UP RERA shows no project address)' } };
  await db.query(`UPDATE scraped_projects SET doc = jsonb_set(jsonb_set(doc, '{data,locality}', to_jsonb($2::text)), '{enrichment,data_filled}', $3::jsonb)
    WHERE id = $1 AND coalesce(doc->'data'->>'locality', '') = ''`, [id, locality, JSON.stringify(filled)]);
}
console.log(`${n} localities ${APPLY ? 'saved' : 'to save (dry run)'}`);
await db.end();
