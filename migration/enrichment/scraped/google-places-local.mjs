// Local Google Maps search for live scraped pins that the city-wide search could not confirm: the project's name searched
// only inside a ~3 km box around the pin (small listings rank there that never show city-wide). The answers are appended
// to the same cache file as google-places-fetch.mjs (query prefixed "local:"), so live-pin-check.mjs judges them with the
// same rules. Read-only for the database.
//
//   node --env-file=.env migration/enrichment/scraped/google-places-local.mjs <ids.json>   (scraped record ids)

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const DIR = path.resolve('migration/backup/scraped-enrichment-cache/google-places');
const KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY;
const FIELDS = 'places.id,places.displayName,places.formattedAddress,places.location,places.types,places.addressComponents,places.googleMapsUri,places.websiteUri';
const BOX = 0.03; // degrees (~3.3 km) each side of the pin
const ids = new Set(JSON.parse(readFileSync(process.argv[2], 'utf8')));

const url = new URL(process.env.DATABASE_URL);
url.searchParams.delete('sslmode');
const db = new pg.Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } });
await db.connect();
const { rows } = await db.query(`SELECT s.id, s.doc->'data' d, (pn.doc->>'lat')::float lat, (pn.doc->>'lng')::float lng
  FROM scraped_projects s JOIN project_submissions sub ON sub.id = s.doc->>'submission_id' JOIN projects p ON p.id = sub.doc->>'published_project_id'
  JOIN pins pn ON pn.id = p.doc->>'pin_id' WHERE s.id = ANY($1)`, [[...ids]]);
await db.end();

const BIZ = /\b(private|pvt|limited|ltd|llp|m\/s\.?|developers?|builders?|constructions?|infra(structure)?|projects?|properties|realty|estates?|ventures?|and|&|co|company|india|housing|homes|promoters?)\b\.?/gi;
const brand = (dev) => String(dev || '').replace(/\(.*?\)/g, ' ').replace(BIZ, ' ').replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
const simple = (n) => String(n).replace(/\(.*?\)/g, ' ').replace(/\b(sector|phase|ph|tower|towers|wing|bldg|building|block|avenue)\b[\s\-–:#.]*[\w]{0,4}\b/gi, ' ')
  .replace(/\b\w*\d\w*\b/g, ' ').replace(/[\/\-–,@]+/g, ' ').replace(/\s+/g, ' ').trim();

async function search(textQuery, lat, lng) {
  for (let i = 0; ; i++) {
    const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': KEY, 'X-Goog-FieldMask': FIELDS, Referer: 'https://mappingg.com/' },
      body: JSON.stringify({ textQuery, pageSize: 10, locationRestriction: { rectangle: { low: { latitude: lat - BOX, longitude: lng - BOX }, high: { latitude: lat + BOX, longitude: lng + BOX } } } }),
    });
    const j = await r.json();
    if (r.ok) return j.places || [];
    if (i >= 3 || (r.status < 500 && r.status !== 429)) throw new Error(`${r.status} ${JSON.stringify(j).slice(0, 200)}`);
    await new Promise((s) => setTimeout(s, 3000 * (i + 1)));
  }
}

let n = 0, found = 0;
for (const { id, d, lat, lng } of rows) {
  const f = path.join(DIR, `${id}.json`);
  const cache = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : { id, answers: [] };
  const qs = [...new Set([simple(d.project_name), `${simple(d.project_name)} ${brand(d.developer_name)}`.trim()])].filter(Boolean).map((q) => `local:${q}`);
  let any = false;
  for (const q of qs) {
    if (cache.answers.some((a) => a.query === q)) continue;
    const places = await search(q.slice(6), lat, lng);
    cache.answers.push({ query: q, places });
    if (places.length) any = true;
  }
  writeFileSync(f, JSON.stringify(cache, null, 1));
  if (any) found++;
  if (++n % 25 === 0) console.log(`  ${n} / ${rows.length}`);
}
console.log({ pins: rows.length, with_local_results: found });
