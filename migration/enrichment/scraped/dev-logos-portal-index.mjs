// Index of Bangalore project / builder pages on property portals, from their public sitemaps — used by
// dev-logos-portals.mjs to find the portal page of a RERA project (portals show the developer's logo there).
//   node migration/enrichment/scraped/dev-logos-portal-index.mjs  →  <cache>/dev-logos/portal-index.json

import { writeFileSync, mkdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';

const CACHE = path.resolve('migration/backup/scraped-enrichment-cache/dev-logos');
mkdirSync(CACHE, { recursive: true });
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';

const ROOTS = [
  'https://housiey.com/sitemap.xml',
  'https://www.nobroker.in/sitemap/sitemap_index.xml',
  'https://www.squareyards.com/sitemap-index.xml',
  'https://www.propertypistol.com/sitemap.xml',
  'https://houssed.com/sitemap/houssed-sitemap.xml',
  'https://www.propsoch.com/sitemap.xml',
  'https://www.homznspace.com/sitemaps.xml',
  'https://www.homebazaar.com/sitemap.xml',
];
// Child sitemaps worth opening: project / builder lists, this city's where the portal splits by city
// (CITY_RE, default Bangalore; e.g. CITY_RE='noida|greater-noida|gautam' INDEX_FILE=portal-index-noida.json).
const CITY_RE = process.env.CITY_RE || 'bangalore|bengaluru|blr';
const CHILD = new RegExp(`project|builder|developer|new-?launch|property-sitemap|sitemap\\d*\\.xml$|houssed-sitemap|${CITY_RE}`, 'i');
const OTHER_CITIES = ['bangalore', 'bengaluru', 'mumbai', 'pune', 'delhi', 'gurgaon', 'gurugram', 'noida', 'chennai', 'hyderabad', 'kolkata', 'ahmedabad', 'thane', 'navi', 'kochi', 'goa', 'jaipur',
  'lucknow', 'chandigarh', 'indore', 'nagpur', 'mysore', 'coimbatore'].filter((c) => !new RegExp(CITY_RE, 'i').test(c));
const SKIPCHILD = new RegExp(`blog|news|rent|pg|commercial|locality|localities|listing|resale|agent|associates|location-review|${OTHER_CITIES.join('|')}`, 'i');
const KEEP = new RegExp(process.env.CITY_RE || 'bangalore|bengaluru|blr', 'i');
const PAGE = /project|builder|developer|prjt|\/pdp\/|-pid-|\/projects?\//i;

async function get(u) {
  try {
    const r = await fetch(u, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(30000) });
    if (!r.ok) return '';
    const b = Buffer.from(await r.arrayBuffer());
    return (u.endsWith('.gz') || (b[0] === 0x1f && b[1] === 0x8b) ? gunzipSync(b) : b).toString('utf8');
  } catch { return ''; }
}

const out = {};
for (const root of ROOTS) {
  const host = new URL(root).hostname.replace(/^www\./, '');
  const urls = new Set(), seen = new Set();
  const queue = [root];
  while (queue.length && seen.size < 400) {
    const sm = queue.shift();
    if (seen.has(sm)) continue;
    seen.add(sm);
    const xml = await get(sm);
    const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, '&'));
    if (/<sitemapindex/i.test(xml)) {
      for (const l of locs) if (CHILD.test(l) && !SKIPCHILD.test(l)) queue.push(l);
    } else {
      const cityFile = KEEP.test(sm);
      for (const l of locs) if (PAGE.test(l) && (cityFile || KEEP.test(l))) urls.add(l);
    }
  }
  out[host] = [...urls];
  console.log(host, 'sitemaps', seen.size, 'pages', urls.size);
}
writeFileSync(path.join(CACHE, process.env.INDEX_FILE || 'portal-index.json'), JSON.stringify(out));
