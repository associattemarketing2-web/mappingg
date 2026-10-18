// Google Maps (Places API, Text Search) lookups for live scraped records that still lack a verified map pin or an
// address. Read-only: it only saves the raw Places answers to the cache; google-locate.mjs decides what is used.
//
//   node --env-file=.env migration/enrichment/scraped/google-places-fetch.mjs [--all] [--limit N]
//
// Uses the site's own Maps key (NEXT_PUBLIC_GOOGLE_MAPS_KEY, referrer-restricted to mappingg.com). Two searches per
// record: "<project> <locality> <city>" and "<project> <developer> <city>". Answers already cached are not fetched again.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const ALL = process.argv.includes('--all');
// --retry: records still without a verified pin or address get a third search with a simplified name
// ("Life Republic Sector R31/31st Avenue – Echoes/Phase – 1" → "Life Republic Echoes").
const RETRY = process.argv.includes('--retry');
const LIMIT = process.argv.includes('--limit') ? Number(process.argv[process.argv.indexOf('--limit') + 1]) : Infinity;
const DIR = path.resolve('migration/backup/scraped-enrichment-cache/google-places');
mkdirSync(DIR, { recursive: true });
const KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY;
if (!KEY) throw new Error('NEXT_PUBLIC_GOOGLE_MAPS_KEY missing');
const FIELDS = 'places.id,places.displayName,places.formattedAddress,places.location,places.types,places.addressComponents,places.googleMapsUri,places.websiteUri';

const url = new URL(process.env.DATABASE_URL);
const mode = url.searchParams.get('sslmode');
url.searchParams.delete('sslmode');
const db = new pg.Client(mode === 'disable' ? { connectionString: process.env.DATABASE_URL } : { connectionString: url.toString(), ssl: mode ? true : { rejectUnauthorized: false } });
await db.connect();
const { rows } = await db.query(`SELECT id, doc->'data' d FROM scraped_projects WHERE NOT coalesce((doc->>'deleted')::boolean, false)`);
await db.end();

const BIZ = /\b(private|pvt|limited|ltd|llp|m\/s\.?|developers?|builders?|constructions?|infra(structure)?|projects?|properties|realty|estates?|ventures?|and|&|co|company|india|housing|homes|promoters?)\b\.?/gi;
const brand = (dev) => String(dev || '').replace(/\(.*?\)/g, ' ').replace(BIZ, ' ').replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
const ok = (d) => ['verified', 'manual'].includes(d.pin_check);
// --ids <file.json>: only these record ids (e.g. records still missing project facts, to find their official page).
const IDS = process.argv.includes('--ids') ? new Set(JSON.parse(readFileSync(process.argv[process.argv.indexOf('--ids') + 1], 'utf8'))) : null;
const todo = rows.filter(({ id, d }) => (IDS ? IDS.has(id) : ALL || !ok(d) || !d.address));

async function search(textQuery) {
  for (let i = 0; ; i++) {
    const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': KEY, 'X-Goog-FieldMask': FIELDS, Referer: 'https://mappingg.com/' },
      body: JSON.stringify({ textQuery, regionCode: 'IN', pageSize: 5 }),
    });
    const j = await r.json();
    if (r.ok) return j.places || [];
    if (i >= 3 || r.status < 500 && r.status !== 429) throw new Error(`${r.status} ${JSON.stringify(j).slice(0, 200)}`);
    await new Promise((s) => setTimeout(s, 3000 * (i + 1)));
  }
}

let fetched = 0, cached = 0;
for (const { id, d } of todo) {
  if (fetched >= LIMIT) break;
  const f = path.join(DIR, `${id}.json`);
  if (existsSync(f) && !RETRY) { cached++; continue; }
  const city = d.city === 'Kalyan_Dombivli' ? 'Kalyan' : d.city;
  const prev = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')).answers : [];
  const simple = String(d.project_name).replace(/\(.*?\)/g, ' ').replace(/\b(sector|phase|ph|tower|towers|wing|bldg|building|block|avenue)\b[\s\-–:#.]*[\w]{0,4}\b/gi, ' ').replace(/\b\w*\d\w*\b/g, ' ').replace(/[\/\-–,]+/g, ' ').replace(/\s+/g, ' ').trim();
  const queries = RETRY ? [[simple, brand(d.developer_name), city].filter(Boolean).join(' ')].filter((q) => !prev.some((a) => a.query === q)) : [...new Set([
    [d.project_name, d.locality, city].filter(Boolean).join(' '),
    [d.project_name, brand(d.developer_name), city].filter(Boolean).join(' '),
  ])];
  if (RETRY && !queries.length) { cached++; continue; }
  const answers = [...prev];
  for (const q of queries) answers.push({ query: q, places: await search(q) });
  writeFileSync(f, JSON.stringify({ id, fetched_at: new Date().toISOString(), answers }, null, 1));
  if (++fetched % 25 === 0) console.log(`  ${fetched} fetched`);
}
console.log({ records: todo.length, fetched, already_cached: cached });
