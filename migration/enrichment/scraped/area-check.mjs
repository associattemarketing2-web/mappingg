// Reverse check for pins with no other evidence: the area OpenStreetMap gives AT the pin (road, neighbourhood, suburb,
// village, sector, postcode — Nominatim reverse, 1 request/second) compared with the area words of the RERA address.
//   match      an area name of the address (≥ 4 letters, not a generic word) is in the reverse address, or the postcode equals;
//   no match   the pin's area shares nothing with the address.
// Read-only: AREA-CHECK.csv.   node migration/enrichment/scraped/area-check.mjs <rows.json>
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const rows = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const CACHE = path.resolve('migration/backup/scraped-enrichment-cache/osm-reverse-pins'); mkdirSync(CACHE, { recursive: true });
const GENERIC = new Set('road main cross street layout nagar village hobli taluk taluka ward district urban rural north south east west bengaluru bangalore karnataka mumbai suburban maharashtra noida greater uttar pradesh gurugram gurgaon haryana pune city division sector plot survey khata katha no property bearing near opposite behind next india converted land situated part old new phase block tower'.split(' '));
const words = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length >= 4 && !GENERIC.has(w) && !/^\d+$/.test(w));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const out = [];
for (const r of rows) {
  const f = path.join(CACHE, `${r.lat.toFixed(5)}_${r.lng.toFixed(5)}.json`);
  let j;
  if (existsSync(f)) j = JSON.parse(readFileSync(f, 'utf8'));
  else {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=17&lat=${r.lat}&lon=${r.lng}`, { headers: { 'User-Agent': 'mappingg.com scraped-data location check (admin script)', 'Accept-Language': 'en' } });
    j = res.ok ? await res.json() : {};
    writeFileSync(f, JSON.stringify(j));
    await sleep(1100);
  }
  const a = j.address || {};
  const at = [a.road, a.neighbourhood, a.quarter, a.suburb, a.village, a.hamlet, a.city_district, a.town, j.name].filter(Boolean).join(', ');
  const atWords = new Set(words(at));
  const addrWords = words(r.addr);
  const hit = addrWords.filter((w) => atWords.has(w) || [...atWords].some((x) => x.length >= 5 && w.length >= 5 && (x.startsWith(w.slice(0, 5)) && w.startsWith(x.slice(0, 5)))));
  const pc = String(a.postcode || '').replace(/\s/g, ''), rpc = String(r.pc || '');
  const verdict = hit.length ? 'match' : pc && rpc && pc === rpc ? 'postcode only' : 'no match';
  out.push([r.num, r.name, r.city, verdict, hit.join(' '), at, pc, rpc, r.addr]);
}
writeFileSync(path.resolve('seo-doc/enrichment/scraped-project-enrichment/AREA-CHECK.csv'), ['pin_number,project,city,verdict,shared_words,osm_area_at_pin,osm_postcode,record_pincode,rera_address', ...out.map((x) => x.map(q).join(','))].join('\n') + '\n');
console.log(out.reduce((m, x) => ((m[x[3]] = (m[x[3]] || 0) + 1), m), {}));
