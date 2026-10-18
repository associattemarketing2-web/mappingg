// OpenStreetMap evidence for live scraped pins that Google could not confirm: the project's name searched with Nominatim
// inside a ~3 km box around the pin (1 request/second, as its usage policy asks). OSM often maps a housing project as a
// named area (landuse=residential / building) with its outline, so a pin INSIDE that outline is on the project.
// Each hit is appended to the Google cache file as a place-like entry (query "osm:…"), so live-pin-check.mjs judges it
// with the same name / pincode / building rules: a pin inside the outline gets the pin's own point (= 0 m, confirmed),
// otherwise the outline's centre. Read-only for the database.
//
//   node --env-file=.env migration/enrichment/scraped/osm-places-local.mjs <ids.json>   (scraped record ids)

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const DIR = path.resolve('migration/backup/scraped-enrichment-cache/google-places');
const BOX = 0.03, MARGIN = 0.0005; // ~3.3 km search box; ~50 m tolerance on the outline
const ids = new Set(JSON.parse(readFileSync(process.argv[2], 'utf8')));
const url = new URL(process.env.DATABASE_URL);
url.searchParams.delete('sslmode');
const db = new pg.Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } });
await db.connect();
const { rows } = await db.query(`SELECT s.id, s.doc->'data' d, (pn.doc->>'lat')::float lat, (pn.doc->>'lng')::float lng
  FROM scraped_projects s JOIN project_submissions sub ON sub.id = s.doc->>'submission_id' JOIN projects p ON p.id = sub.doc->>'published_project_id'
  JOIN pins pn ON pn.id = p.doc->>'pin_id' WHERE s.id = ANY($1)`, [[...ids]]);
await db.end();

const simple = (n) => String(n).replace(/\(.*?\)/g, ' ').replace(/\b(sector|phase|ph|tower|towers|wing|bldg|building|block|avenue)\b[\s\-–:#.]*[\w]{0,4}\b/gi, ' ')
  .replace(/\b\w*\d\w*\b/g, ' ').replace(/[\/\-–,@&]+/g, ' ').replace(/\s+/g, ' ').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let n = 0, hits = 0, inside = 0;
for (const { id, d, lat, lng } of rows) {
  const f = path.join(DIR, `${id}.json`);
  const cache = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : { id, answers: [] };
  const q = simple(d.project_name);
  if (!q || cache.answers.some((a) => a.query === `osm:${q}`)) { n++; continue; }
  const u = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=10&bounded=1&q=${encodeURIComponent(q)}`
    + `&viewbox=${lng - BOX},${lat + BOX},${lng + BOX},${lat - BOX}`;
  let res = [];
  try { const r = await fetch(u, { headers: { 'User-Agent': 'mappingg.com scraped-data location check (admin script)' } }); res = r.ok ? await r.json() : []; } catch { res = []; }
  await sleep(1100);
  const places = res.filter((x) => x.name).map((x) => {
    const [s, nn, w, e] = (x.boundingbox || []).map(Number);
    const isIn = x.boundingbox && lat >= s - MARGIN && lat <= nn + MARGIN && lng >= w - MARGIN && lng <= e + MARGIN && (nn - s) < 0.03;
    if (isIn) inside++;
    return {
      id: `osm:${x.osm_type}/${x.osm_id}`,
      displayName: { text: x.name },
      formattedAddress: x.display_name,
      location: isIn ? { latitude: lat, longitude: lng } : { latitude: Number(x.lat), longitude: Number(x.lon) },
      types: [x.type === 'residential' || x.category === 'building' || x.category === 'landuse' ? 'housing_complex' : x.type, `osm_${x.category}`],
      addressComponents: x.address?.postcode ? [{ types: ['postal_code'], longText: String(x.address.postcode).replace(/\s/g, '') }] : [],
      googleMapsUri: `https://www.openstreetmap.org/${x.osm_type}/${x.osm_id}`,
      osm_inside_outline: !!isIn,
    };
  });
  if (places.length) hits++;
  cache.answers.push({ query: `osm:${q}`, places });
  writeFileSync(f, JSON.stringify(cache, null, 1));
  if (++n % 25 === 0) console.log(`  ${n} / ${rows.length}`);
}
console.log({ pins: rows.length, with_osm_hits: hits, pin_inside_a_named_outline: inside });
