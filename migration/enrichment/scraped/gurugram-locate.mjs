// Map location for Gurugram (HARERA) records from the developer's own website — HARERA publishes no coordinates.
//
//   node --env-file=.env migration/enrichment/scraped/gurugram-locate.mjs            dry run
//   node --env-file=.env migration/enrichment/scraped/gurugram-locate.mjs --apply
//
// For every current HARERA record without coordinates:
//   1. the developer's website as declared to HARERA (enrichment.fields.developer_website);
//   2. the project's page on that site (a link whose text / address names the project), else the home page;
//   3. the map point on that page (Google Maps embed / link, schema.org geo);
//   4. the point counts only when it lies inside the boundary of the sector named in the HARERA address
//      (OpenStreetMap administrative boundary of "Sector N, <town>"; ≤ 0.5 km outside counts), and is not
//      the same point as another promoter's project. Then data.lat/lng are set (pin_check "verified") with the
//      page as the source, and a missing pincode is filled from OpenStreetMap at the point (noted as such).
// `original` and the HARERA facts are never changed. Rows without a sector in the address, without a website,
// or whose site shows no point inside that sector are listed in GURUGRAM-LOCATION.csv with the reason.

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import pg from 'pg';
import { parse } from 'node-html-parser';

const APPLY = process.argv.includes('--apply');
const CACHE = path.resolve('migration/backup/scraped-enrichment-cache');
const PAGES = path.join(CACHE, 'gurugram-sites'), OSM = path.join(CACHE, 'osm-pincodes');
for (const d of [PAGES, OSM]) mkdirSync(d, { recursive: true });
const OUTDIR = path.resolve('seo-doc/enrichment/scraped-project-enrichment');
const RUN = new Date().toISOString(), TODAY = RUN.slice(0, 10);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';
const NOM = { 'User-Agent': 'mappingg-admin-location-check/1.0 (associattemarketing@gmail.com)' };
const BOUNDS = { minLat: 28.1, maxLat: 28.65, minLng: 76.6, maxLng: 77.25 }; // Gurugram district
const md5 = (s) => createHash('md5').update(s).digest('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const csv = (v) => `"${String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
const words = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
const GENERIC = new Set('the phase tower towers block residences residency homes apartments apartment floors plots plot project sector gurugram gurgaon city by at and of new i ii iii iv 1 2 3 4 5'.split(' '));

// ---- geometry ----------------------------------------------------------------------------------
const inRing = (x, y, ring) => { let ins = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins; } return ins; };
const polygons = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);
const inside = (lng, lat, g) => polygons(g).some((p) => inRing(lng, lat, p[0]) && !p.slice(1).some((h) => inRing(lng, lat, h)));
function kmToEdge(lng, lat, g) {
  const kx = 111.32 * Math.cos((lat * Math.PI) / 180), ky = 110.57; let best = Infinity;
  for (const p of polygons(g)) for (const ring of p) for (let i = 1; i < ring.length; i++) {
    const ax = (ring[i - 1][0] - lng) * kx, ay = (ring[i - 1][1] - lat) * ky, bx = (ring[i][0] - lng) * kx, by = (ring[i][1] - lat) * ky;
    const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

// ---- OpenStreetMap (cached, ≤ 1 request / second) ----------------------------------------------
async function nominatim(url, file) {
  const f = path.join(OSM, file);
  if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
  await sleep(1100);
  const r = await fetch(url, { headers: NOM });
  if (!r.ok) throw new Error(`Nominatim HTTP ${r.status}`);
  const j = await r.json();
  writeFileSync(f, JSON.stringify(j));
  return j;
}
/** "SECTOR- 36A" / "Sector 5, Sohna" → { sector: '36A', town: 'Sohna' }. */
function sectorOf(address) {
  const m = String(address || '').match(/\bsec(?:tor)?\s*[-.:]?\s*(\d{1,3}\s?[A-Z]?)\b/i);
  if (!m) return null;
  const town = /sohna/i.test(address) ? 'Sohna' : /pataudi/i.test(address) ? 'Pataudi' : /farrukh ?nagar/i.test(address) ? 'Farrukhnagar' : /manesar/i.test(address) ? 'Manesar' : 'Gurugram';
  return { sector: m[1].replace(/\s+/g, '').toUpperCase(), town };
}
async function sectorBoundary({ sector, town }) {
  const q = `Sector ${sector}, ${town}`;
  const hits = await nominatim(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&countrycodes=in&format=json&polygon_geojson=1&limit=5`, `sector-${md5(q)}.json`);
  // The search is fuzzy ("Sector 89A" can return Sector 62): the boundary's own name must be this sector.
  const re = new RegExp(`^sector\\s*-?\\s*${sector}$`, 'i');
  const named = hits.filter((h) => re.test(String(h.name || h.display_name.split(',')[0]).trim()));
  // Prefer the boundary; a named point (no boundary mapped) is accepted with a 1.5 km radius instead.
  return named.find((h) => /Polygon/.test(h.geojson?.type || '')) || named[0] || null;
}
const kmBetween = (a, b) => Math.hypot((a.lng - b.lng) * 111.32 * Math.cos((a.lat * Math.PI) / 180), (a.lat - b.lat) * 110.57);
/** Is the point in the sector? Inside its boundary (≤ 0.5 km outside counts), or ≤ 1.5 km from its mapped point. */
function inSector(pt, s) {
  if (/Polygon/.test(s.geojson?.type || '')) { const inS = inside(pt.lng, pt.lat, s.geojson); const edge = inS ? 0 : kmToEdge(pt.lng, pt.lat, s.geojson); return { ok: edge <= 0.5, edge, how: 'boundary' }; }
  const km = kmBetween(pt, { lat: Number(s.lat), lng: Number(s.lon) }); return { ok: km <= 1.5, edge: km, how: 'point' };
}
// Developer sites already verified while finding logos (dev-logos-find.mjs) — used when none was declared to HARERA.
const LOGO_RESULTS = path.join(CACHE, 'dev-logos', 'results.json');
const verifiedSites = existsSync(LOGO_RESULTS) ? Object.fromEntries(Object.entries(JSON.parse(readFileSync(LOGO_RESULTS, 'utf8'))).filter(([, r]) => r.pick?.site && !/^portal/.test(r.pick.source || '')).map(([dev, r]) => [dev, r.pick.site])) : {};
const reverse = (lat, lng) => nominatim(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=17&addressdetails=1`, `rev-${lat.toFixed(5)}_${lng.toFixed(5)}.json`);

// ---- developer sites -----------------------------------------------------------------------------
async function page(u) {
  const f = path.join(PAGES, md5(u) + '.json');
  if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
  let out = null;
  try {
    const r = await fetch(u, { headers: { 'user-agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(25000) });
    if (r.ok && /html/i.test(r.headers.get('content-type') || '')) out = { url: r.url, html: (await r.text()).slice(0, 2_000_000) };
  } catch { /* unreachable */ }
  writeFileSync(f, JSON.stringify(out));
  return out;
}
/** Every map point on a page: Google Maps embeds / links (!3d lat !2d lng, @lat,lng, q=lat,lng, ll=), schema.org geo. */
function points(html) {
  const out = [];
  const add = (lat, lng, how) => { lat = Number(lat); lng = Number(lng); if (lat >= BOUNDS.minLat && lat <= BOUNDS.maxLat && lng >= BOUNDS.minLng && lng <= BOUNDS.maxLng) out.push({ lat, lng, how }); };
  const h = html.replace(/&amp;/g, '&').replace(/%2C/gi, ',');
  for (const m of h.matchAll(/!3d(\d{2}\.\d{4,})!(?:4d|2d)?[^!]*?!?2d(\d{2}\.\d{4,})/g)) add(m[1], m[2], 'Google Maps embed');
  for (const m of h.matchAll(/!2d(\d{2}\.\d{4,})!3d(\d{2}\.\d{4,})/g)) add(m[2], m[1], 'Google Maps embed');
  for (const m of h.matchAll(/@(\d{2}\.\d{4,}),(\d{2}\.\d{4,})/g)) add(m[1], m[2], 'Google Maps link');
  for (const m of h.matchAll(/[?&](?:q|ll|query|center|daddr|destination)=(\d{2}\.\d{4,}),\s*(\d{2}\.\d{4,})/g)) add(m[1], m[2], 'Google Maps link');
  for (const m of h.matchAll(/"latitude"\s*:\s*"?(\d{2}\.\d{4,})"?\s*,\s*"longitude"\s*:\s*"?(\d{2}\.\d{4,})/g)) add(m[1], m[2], 'schema.org geo');
  return out;
}
/** The project's page on the developer's site: links whose text or address names the project. */
async function projectPages(site, name) {
  const home = await page(site);
  if (!home) return { home: null, pages: [] };
  const key = words(name).filter((w) => !GENERIC.has(w) && w.length > 2);
  const host = new URL(home.url).hostname;
  const links = new Map();
  // A link counts when its text / path has two of the project's words, or one distinctive word (5+ letters) in the path.
  const score = (text, pathname) => {
    const txt = ` ${String(text).toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `, p = ` ${pathname.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
    const hit = key.filter((w) => txt.includes(` ${w}`) || p.includes(` ${w}`)).length;
    return hit >= Math.min(2, key.length) ? hit : key.some((w) => w.length >= 5 && p.includes(` ${w}`)) ? 1 : 0;
  };
  for (const a of parse(home.html).querySelectorAll('a')) {
    let href; try { href = new URL(a.getAttribute('href') || '', home.url); } catch { continue; }
    if (href.hostname !== host) continue;
    const s = key.length ? score(a.textContent, href.pathname) : 0;
    if (s) links.set(href.origin + href.pathname, Math.max(s, links.get(href.origin + href.pathname) || 0));
  }
  // The site's sitemap lists project pages the home page may not link to.
  if (key.length && links.size < 3) {
    const origin = new URL(home.url).origin;
    for (const sm of [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`, `${origin}/page-sitemap.xml`, `${origin}/project-sitemap.xml`]) {
      let xml = null;
      try { const r = await fetch(sm, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20000) }); if (r.ok) xml = await r.text(); } catch { /* none */ }
      if (!xml) continue;
      for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
        let u; try { u = new URL(m[1]); } catch { continue; }
        if (u.hostname.replace(/^www\./, '') !== host.replace(/^www\./, '') || /\.xml$/i.test(u.pathname)) continue;
        const s = score('', u.pathname); if (s) links.set(u.origin + u.pathname, Math.max(s, links.get(u.origin + u.pathname) || 0));
      }
    }
  }
  const pages = [];
  for (const [u] of [...links].sort((a, b) => b[1] - a[1]).slice(0, 3)) { const p = await page(u); if (p) pages.push(p); }
  return { home, pages };
}

// ---- run -----------------------------------------------------------------------------------------
const url = new URL(process.env.DATABASE_URL);
url.searchParams.delete('sslmode');
const db = new pg.Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false }, query_timeout: 120000 });
await db.connect();
const { rows } = await db.query(`SELECT id, doc FROM scraped_projects WHERE doc->'original'->>'regulator' = 'HARERA Gurugram'
  AND doc ? 'enrichment' AND NOT coalesce((doc->>'deleted')::boolean, false) AND doc->'data'->>'lat' IS NULL
  AND doc->'enrichment'->'fields'->>'proposed_completion' >= $1`, [TODAY]);
console.log(`${rows.length} current HARERA records without a location`);

const found = [], report = [];
for (const { id, doc } of rows) {
  const d = doc.data, f = doc.enrichment.fields || {};
  const name = d.project_name, address = f.full_address || d.address || d.locality;
  const no = (reason) => report.push({ id, name, dev: d.developer_name, address, reason });
  const sec = sectorOf(`${address} ${d.locality || ''}`);
  if (!sec) { no('HARERA address names no sector'); continue; }
  const declared = f.developer_website ? (/^https?:/i.test(f.developer_website) ? f.developer_website : `http://${f.developer_website}`).trim() : null;
  const site = declared || verifiedSites[d.developer_name] || null;
  if (!site) { no('no developer website (none declared to HARERA, none verified)'); continue; }
  const { home, pages } = await projectPages(site, name);
  if (!home) { no(`developer website ${site} did not load`); continue; }
  if (!pages.length) { no('no page for this project on the developer website'); continue; }
  const boundary = await sectorBoundary(sec);
  if (!boundary) { no(`Sector ${sec.sector}, ${sec.town} is not on OpenStreetMap`); continue; }
  // Only the project's own page: a point on the home page may be the head office.
  let pick = null;
  for (const p of pages) {
    for (const pt of points(p.html)) { const s = inSector(pt, boundary); if (s.ok) { pick = { ...pt, source: p.url, onProjectPage: true, edge: s.edge, check: s.how }; break; } }
    if (pick) break;
  }
  if (!pick) {
    const any = pages.flatMap((p) => points(p.html));
    no(any.length ? `the project page's map point is not in Sector ${sec.sector}, ${sec.town}` : 'no map point on the project page');
    continue;
  }
  pick.site_source = declared ? 'declared to HARERA' : 'developer site verified for its logo';
  found.push({ id, doc, name, sec, boundary, ...pick });
}
// Not the same point as a different promoter's project.
const key = (p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;
const devsAt = new Map();
// One developer = one website: SPVs of a brand have different legal names but share the brand's site.
for (const p of found) { const k = key(p); if (!devsAt.has(k)) devsAt.set(k, new Set()); devsAt.get(k).add(new URL(p.source).hostname.replace(/^www./, '')); }
const ok = [];
for (const p of found) {
  if (devsAt.get(key(p)).size > 1) { report.push({ id: p.id, name: p.name, dev: p.doc.data.developer_name, reason: `same point as another promoter's project (${key(p)})` }); continue; }
  const rev = await reverse(p.lat, p.lng);
  const pc = /^12\d{4}$/.test(rev.address?.postcode || '') ? rev.address.postcode : null;
  ok.push({ ...p, pincode: pc });
}

console.log(`located: ${ok.length}; not located: ${report.length}`);
const reasons = {}; for (const r of report) { const k = r.reason.replace(/Sector \S+, \w+/, 'Sector X').replace(/https?:\S+/, 'URL').replace(/\(.*\)/, ''); reasons[k] = (reasons[k] || 0) + 1; }
console.log(reasons);
writeFileSync(path.join(OUTDIR, 'GURUGRAM-LOCATION.csv'), ['record_id,project_name,developer,result,lat,lng,source,detail',
  ...ok.map((p) => [p.id, p.name, p.doc.data.developer_name, 'located', p.lat, p.lng, p.source, `${p.how}; inside Sector ${p.sec.sector}, ${p.sec.town} (OpenStreetMap ${p.boundary.osm_type}/${p.boundary.osm_id})${p.pincode ? `; pincode ${p.pincode} from OpenStreetMap` : ''}`].map(csv).join(',')),
  ...report.map((r) => [r.id, r.name, r.dev, 'not located', '', '', '', r.reason].map(csv).join(','))].join('\n') + '\n');
if (!APPLY) { for (const p of ok.slice(0, 12)) console.log(`${p.name} → ${p.lat},${p.lng} (${p.how}${p.onProjectPage ? ', project page' : ', home page'}) ${p.source}`); console.log('Dry run — nothing written.'); await db.end(); process.exit(0); }

mkdirSync(path.resolve(`migration/backup/pg-snapshot-${RUN.replace(/[:.]/g, '-')}-before-gurugram-locate`), { recursive: true });
writeFileSync(path.resolve(`migration/backup/pg-snapshot-${RUN.replace(/[:.]/g, '-')}-before-gurugram-locate/scraped_projects.json`), JSON.stringify(ok.map((p) => ({ id: p.id, doc: p.doc }))));
let written = 0;
for (const p of ok) {
  const before = p.doc.data;
  const reason = `Location from the developer's own website (${p.source}, ${p.how}${p.onProjectPage ? ', project page' : ''}); inside Sector ${p.sec.sector}, ${p.sec.town} — the sector in the HARERA address (OpenStreetMap ${p.check === 'point' ? `sector point, ${p.edge.toFixed(1)} km away` : `boundary${p.edge ? `, ${p.edge.toFixed(1)} km from its edge` : ''}`}; website ${p.site_source}); not shared with another promoter's project. HARERA publishes no coordinates.`;
  const data = { ...before, lat: p.lat, lng: p.lng, pin_check: 'verified', pin_reason: reason, ...(!before.pincode && p.pincode ? { pincode: p.pincode } : {}) };
  const filled = { ...(p.doc.enrichment.data_filled || {}), ...(!before.pincode && p.pincode ? { pincode: { old: null, new: p.pincode, source: 'OpenStreetMap reverse lookup at the developer-website point' } } : {}) };
  const res = await db.query(`UPDATE scraped_projects SET doc = doc || jsonb_build_object('data', $2::jsonb, 'location_source', $3::jsonb)
      || jsonb_build_object('enrichment', (doc->'enrichment') || jsonb_build_object('data_filled', $5::jsonb))
    WHERE id = $1 AND doc->'data' = $4::jsonb`,
    [p.id, JSON.stringify(data), JSON.stringify({ source: 'developer_website', source_url: p.source, sector_boundary: `https://www.openstreetmap.org/${p.boundary.osm_type}/${p.boundary.osm_id}`, checked_at: RUN, old: { lat: null, lng: null, pin_check: before.pin_check, pin_reason: before.pin_reason } }), JSON.stringify(before), JSON.stringify(filled)]);
  written += res.rowCount;
  appendFileSync(path.join(OUTDIR, 'PROJECT-CHANGE-LOG.csv'), [[p.id, p.name, 'data.lat,data.lng', '', `${p.lat},${p.lng}`, p.source, 'developer_website', 'medium', RUN, res.rowCount ? 'saved' : 'not_saved_row_changed']].map((l) => l.map(csv).join(',')).join('\n') + '\n');
}
console.log(`Saved ${written} locations.`);
await db.end();
