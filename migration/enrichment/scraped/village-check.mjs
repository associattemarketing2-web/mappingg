// Is the pin in the village / sector its RERA address names? For live scraped pins that neither Google nor OSM could tie
// to the project by name. The place is read from the registry address ("Sy No 12 of Gubballala Village …", MahaRERA
// "… at Oshiwara, Andheri …", "Sector 150, Noida"), looked up on OpenStreetMap (Nominatim, ≤ 30 km from the pin,
// 1 request/second), and the pin is compared with it:
//   in place      pin inside the place's outline (+300 m) or ≤ 2.5 km from its centre;
//   near          2.5-5 km (villages and sectors are wide; not proof either way);
//   wrong place   > 5 km from the named place — the pin is not where the registry says the project is;
//   no place      the address names no village / sector, or OSM does not know it.
// Read-only: writes VILLAGE-CHECK.csv and the cache only.
//   node migration/enrichment/scraped/village-check.mjs <unres.json>

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const rows = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const CACHE = path.resolve('migration/backup/scraped-enrichment-cache/village-check'); mkdirSync(CACHE, { recursive: true });
const OUT = path.resolve('seo-doc/enrichment/scraped-project-enrichment/VILLAGE-CHECK.csv');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const km = (a, b, c, d) => { const R = 6371, r = Math.PI / 180, x = Math.sin((c - a) * r / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin((d - b) * r / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };
const title = (s) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

function placeOf(r) {
  const a = String(r.addr || '');
  let m = a.match(/\b(?:of\s+)?([A-Za-z][A-Za-z.\- ]{2,40}?)\s+village\b/i) || a.match(/\bvillage\s*[:\-]?\s*([A-Za-z][A-Za-z.\- ]{2,40}?)(?:[,(]|\s+(?:hobli|taluk|tq))/i);
  if (m) return { kind: 'village', name: title(m[1].replace(/^(?:of|at|in)\s+/i, '').trim()) };
  m = a.match(/\bsector[\s\-]*([0-9]{1,3}[A-Za-z]?|[A-Za-z]{2,5}(?:[\s\-][IVX0-9]+)?)\b/i);
  if (m && /noida|gurugram|gurgaon|ghaziabad/i.test(`${a} ${r.city}`)) return { kind: 'sector', name: `Sector ${m[1].toUpperCase()}`, city: /gur/i.test(`${a} ${r.city}`) ? 'Gurugram' : /greater noida/i.test(a) ? 'Greater Noida' : 'Noida' };
  m = a.match(/\bat\s+([A-Za-z][A-Za-z .\-]{2,40}?)\s*(?:\(|,)/);
  if (m && !/m\.? ?corp|ward|cts|plot|survey|village/i.test(m[1])) return { kind: 'area', name: title(m[1].trim()) };
  return null;
}

async function lookup(q, lat, lng) {
  const f = path.join(CACHE, encodeURIComponent(`${q}|${lat.toFixed(2)}|${lng.toFixed(2)}`).slice(0, 180) + '.json');
  if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
  const B = 0.3;
  const u = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&bounded=1&q=${encodeURIComponent(q)}&viewbox=${lng - B},${lat + B},${lng + B},${lat - B}`;
  let res = [];
  try { const r = await fetch(u, { headers: { 'User-Agent': 'mappingg.com scraped-data location check (admin script)' } }); res = r.ok ? await r.json() : []; } catch { res = []; }
  await sleep(1100);
  writeFileSync(f, JSON.stringify(res));
  return res;
}

const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const out = [];
for (const r of rows) {
  const p = placeOf(r);
  if (!p) { out.push({ r, verdict: 'no place', detail: 'address names no village / sector / area' }); continue; }
  const query = p.kind === 'sector' ? `${p.name}, ${p.city}` : `${p.name}`;
  // Only a place whose OWN name is the named village / sector (Nominatim also returns roads and other sectors);
  // villages share names, so the nearest same-named place is the one compared.
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const hits = (await lookup(query, r.lat, r.lng)).filter((x) => /village|hamlet|suburb|neighbourhood|quarter|town|administrative|residential|locality|city_district/.test(`${x.type} ${x.addresstype}`)
    && x.addresstype !== 'road' && (norm(x.name) === norm(p.name) || norm(x.name).startsWith(norm(p.name)) || norm(p.name).startsWith(norm(x.name))));
  if (!hits.length) { out.push({ r, p, verdict: 'no place', detail: `OpenStreetMap does not know "${query}" near the pin` }); continue; }
  const best = hits.map((x) => {
    const [s, n, w, e] = (x.boundingbox || []).map(Number), M = 0.003;
    const inside = x.boundingbox && r.lat >= s - M && r.lat <= n + M && r.lng >= w - M && r.lng <= e + M && (n - s) < 0.15;
    return { x, inside, d: km(r.lat, r.lng, Number(x.lat), Number(x.lon)) };
  }).sort((a, b) => (b.inside - a.inside) || a.d - b.d)[0];
  const verdict = best.inside || best.d <= 2.5 ? 'in place' : best.d <= 5 ? 'near' : 'wrong place';
  out.push({ r, p, best, verdict, detail: `${p.kind} "${p.name}" → OSM ${best.x.name} (${best.x.addresstype}); pin ${best.inside ? 'inside its outline' : `${best.d.toFixed(1)} km from its centre`}` });
}
writeFileSync(OUT, ['pin_number,project,city,regulator,status_before,verdict,detail,pin_lat,pin_lng,place_lat,place_lng,address',
  ...out.map((o) => [o.r.num, o.r.name, o.r.city, o.r.reg, o.r.status, o.verdict, o.detail, o.r.lat, o.r.lng, o.best?.x.lat ?? '', o.best?.x.lon ?? '', o.r.addr].map(q).join(','))].join('\n') + '\n');
console.log(out.reduce((a, o) => ((a[o.verdict] = (a[o.verdict] || 0) + 1), a), {}));
