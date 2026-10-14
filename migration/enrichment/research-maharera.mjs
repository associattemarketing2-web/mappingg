// READ-ONLY MahaRERA identity research for a batch of map projects.
//
//   node migration/enrichment/research-maharera.mjs <snapshot pins.json> <out.json> <numbers…|--batch N --size 50 --skip 9,19,…>
//
// For each pin it searches the official MahaRERA public project search
// (www.maharera.maharashtra.gov.in/projects-search-result) by name, parses the
// registered rows (registration no., registered name, promoter, pincode,
// district) and classifies the identity match. It never writes to the database.
// One request every 4 s; results are cached in <out>.cache.json so a run can resume.
//
// MahaRERA's map coordinates are NOT used (spot checks put projects tens of km away).

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { localitiesOf } from '../../lib/locality.ts';
import { cityFrom } from '../../lib/seo/city.ts';
import { isPropertyProject } from '../../lib/seo/project-filter.ts';

const [snapFile, outFile, ...args] = process.argv.slice(2);
const pins = JSON.parse(readFileSync(snapFile, 'utf8'));
const cacheFile = `${outFile}.cache.json`;
const cache = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, 'utf8')) : {};
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = 'https://www.maharera.maharashtra.gov.in/projects-search-result';
const searchUrl = (name) => `${BASE}?project_name=${encodeURIComponent(name).replace(/%20/g, '+')}&project_location=&project_completion_date=&project_state=27&project_district=0&carpetAreas=&completionDate=&project_division=&page=1&op=Search`;
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&#039;/g, "'").replace(/&quot;/g, '"').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

const MH_CITIES = new Set(['pune', 'mumbai', 'nashik']);
const isMahaRera = (v) => /^(P\d{11}|P[RCM]\d{13})$/.test(String(v || '').replace(/\s/g, '').toUpperCase());

// ---- choose pins -------------------------------------------------------------------
let numbers;
if (args[0] === '--batch') {
  const size = Number(args[args.indexOf('--size') + 1] || 50);
  const skip = new Set(String(args[args.indexOf('--skip') + 1] || '').split(',').map(Number));
  numbers = pins
    .filter((p) => !skip.has(Number(p.number)) && isPropertyProject(p) && p.title)
    .filter((p) => MH_CITIES.has(cityFrom(p.location, Number(p.lat), Number(p.lng))))
    .sort((a, b) => Number(a.number) - Number(b.number))
    .slice(0, size)
    .map((p) => p.id);
} else {
  numbers = pins.filter((p) => args.map(Number).includes(Number(p.number))).map((p) => p.id);
}

// ---- search ------------------------------------------------------------------------------
async function fetchHtml(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (res.ok) return await res.text();
    } catch { /* retry */ }
    await wait(5000 * (i + 1));
  }
  return '';
}

// MahaRERA's search sometimes answers "No Records Found" for a query that has
// results (seen in testing: 0, then 2 results 8 s later). A positive answer is
// trusted at once; a zero is only accepted after 3 tries 8 s apart.
async function search(name) {
  const key = name.toUpperCase();
  if (cache[key]) return cache[key];
  let html = '', attempts = 0;
  for (; attempts < 3; attempts++) {
    await wait(attempts ? 8000 : 4000);
    html = await fetchHtml(searchUrl(key));
    if (html && /Showing Final <span class="colorBlue">[1-9]/.test(html)) break;
  }
  if (!html) return { error: 'fetch failed', url: searchUrl(key), rows: [], total: 0 };
  const rows = [];
  for (const block of html.split('<div class="row shadow p-3 mb-5 bg-body rounded">').slice(1)) {
    const reg = /<p class="p-0">#\s*([A-Z0-9]+)<\/p>/.exec(block)?.[1];
    if (!reg) continue;
    const field = (label) => decode((new RegExp(`greyColor">${label}</div>\\s*<p>([\\s\\S]*?)</p>`).exec(block) || [])[1] || '');
    rows.push({
      registration: reg,
      name: decode(/<h4 class="title4"><strong>([\s\S]*?)<\/strong>/.exec(block)?.[1] || ''),
      promoter: decode(/<p class="darkBlue bold ">([\s\S]*?)<\/p>/.exec(block)?.[1] || ''),
      taluka: decode(/fa-location-dot"><\/em>([\s\S]*?)<\/a>/.exec(block)?.[1] || ''),
      pincode: field('Pincode'),
      district: field('District'),
      last_modified: field('Last Modified'),
      detail_url: (/href="(https:\/\/maharerait\.maharashtra\.gov\.in\/public\/project\/view\/\d+)"/.exec(block) || [])[1] || null,
    });
  }
  const out = { url: searchUrl(key), rows, total: Number(/Showing Final <span class="colorBlue">(\d+)<\/span>/.exec(html)?.[1] || rows.length), attempts: Math.min(attempts + 1, 3), checked_at: new Date().toISOString() };
  cache[key] = out;
  writeFileSync(cacheFile, JSON.stringify(cache));
  return out;
}

// ---- name variants and matching ------------------------------------------------------------
const STOP = new Set(['by', 'the', 'and', 'phase', 'new', 'project', 'pune', 'mumbai', 'navi', 'tower', 'towers', 'group', 'developers', 'developer', 'realty', 'properties', 'property', 'builders', 'corp', 'ltd', 'pvt', 'llp', 'infra', 'i', 'ii', 'iii', 'a', 'b', 'c']);
const tokens = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((t) => t.length > 1 && !STOP.has(t));

function variants(p) {
  const title = String(p.title || '').replace(/\s+/g, ' ').trim();
  const devTok = new Set(tokens(p.developer));
  const out = new Set([title]);
  const noBy = title.replace(/\s+(by|-|–|:)\s+.*$/i, '').trim();
  out.add(noBy);
  // Drop developer brand words ("Kohinoor Kaleido" → "Kaleido", "Mantra Melange" → "Melange").
  const core = noBy.split(' ').filter((w) => !devTok.has(w.toLowerCase()) && !STOP.has(w.toLowerCase())).join(' ').trim();
  if (core && core.length >= 4) out.add(core);
  const words = noBy.split(' ');
  // Short leading brand ("VJ Yashwin Enchante" → "Yashwin Enchante").
  if (words.length > 2 && words[0].length <= 3) out.add(words.slice(1).join(' '));
  // Spelling-tolerant: brand + first letters of the next word ("Kohinoor Kalideo" → "Kohinoor Kal"),
  // or the first 6 letters of a one-word core ("Mellizia" → "Melliz").
  if (words.length >= 2 && words[1].length >= 5) out.add(`${words[0]} ${words[1].slice(0, 3)}`);
  const coreWord = core.split(' ')[0] || '';
  if (coreWord.length >= 7) out.add(coreWord.slice(0, 6));
  return [...out].filter((v) => v.length >= 3).slice(0, 5);
}

const districtOk = (p, row) => {
  const city = cityFrom(p.location, Number(p.lat), Number(p.lng));
  const d = row.district.toLowerCase();
  if (city === 'pune') return d === 'pune';
  if (city === 'mumbai') return /mumbai|thane|raigad|palghar/.test(d);
  if (city === 'nashik') return d === 'nashik';
  return false;
};
// Optimal-string-alignment distance (counts a swap of two letters as one edit).
function dist(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length];
}
const near = (x, y) => x === y || (x.length >= 6 && y.length >= 6 && dist(x, y) <= 2);
/** Share of the map title's words found in the registered name; exact = no spelling tolerance used. */
const nameScore = (p, row, exact = true) => {
  const a = tokens(p.title), b = tokens(row.name);
  if (!a.length || !b.length) return 0;
  return a.filter((t) => (exact ? b.includes(t) : b.some((u) => near(t, u)))).length / a.length;
};
const promoterOk = (p, row) => {
  const d = tokens(p.developer);
  if (!d.length) return null; // unknown developer on the map
  const pr = tokens(row.promoter), joined = pr.join('');
  // "Platinum Corp" ↔ "PLATINUMCORP LIFESCAPES"; "Villas Javdekar" ↔ "Vilas Javdekar …".
  return d.some((t) => pr.some((u) => near(t, u)) || (t.length >= 5 && joined.includes(t)));
};

function classify(p, rows) {
  const existing = String(p.rera_number || '').replace(/\s/g, '').toUpperCase();
  const cand = rows
    .filter((r) => districtOk(p, r))
    .map((r) => ({ ...r, name_score: +nameScore(p, r).toFixed(2), fuzzy_score: +nameScore(p, r, false).toFixed(2), promoter_match: promoterOk(p, r) }))
    .filter((r) => r.fuzzy_score >= 0.5)
    .sort((a, b) => b.name_score - a.name_score);
  const strong = cand.filter((r) => r.fuzzy_score >= 0.99 || (r.fuzzy_score >= 0.5 && r.promoter_match === true));
  const spelling = (r) => r.name_score < r.fuzzy_score;
  const existingRow = cand.find((r) => r.registration === existing);
  const flags = [];
  if (existing && !isMahaRera(existing)) flags.push(`existing RERA value is not a MahaRERA project number ("${p.rera_number}")`);
  if (existing && isMahaRera(existing) && !existingRow) flags.push('existing RERA number not found among name-search results (registered name may differ) — not disproved');
  if (cand.some((r) => r.promoter_match === false)) flags.push('a candidate has a different promoter name (brand vs legal entity, or a different project)');
  // Extra words in a registered name often name a different site ("Lodha Crown Kolshet").
  const titleTok = tokens(p.title), locText = String(p.location || '').toLowerCase();
  for (const r of cand) {
    const extra = tokens(r.name).filter((t) => !/^\d+$/.test(t) && !titleTok.some((x) => near(x, t)) && !locText.includes(t) && !/^(residential|commercial|wing|building|bldg|plot|tower|phase|callisto)$/.test(t));
    if (extra.length) flags.push(`${r.registration} "${r.name}": extra words not in the map title/location (${extra.join(', ')}) — check it is the same site`);
  }

  let identity, proposed = null, status, confidence;
  if (existingRow) {
    identity = 'existing_rera_confirmed'; status = 'verified'; confidence = 'high';
  } else if (strong.length === 1 && !existing) {
    identity = 'single_match'; proposed = strong[0].registration;
    status = strong[0].promoter_match === false ? 'needs_review' : 'verified';
    confidence = strong[0].promoter_match === true && strong[0].name_score >= 0.99 ? 'high' : 'medium';
    if (confidence !== 'high') status = 'needs_review';
    if (spelling(strong[0])) flags.push(`registered name "${strong[0].name}" is spelled differently from the map title`);
  } else if (strong.length > 1) {
    if (strong.some(spelling)) flags.push('registered names are spelled differently from the map title');
    identity = 'multiple_phases_or_projects'; status = 'needs_review'; confidence = 'medium';
  } else if (cand.length) {
    identity = 'weak_match'; status = 'needs_review'; confidence = 'low';
  } else {
    identity = 'not_found'; status = 'not_found'; confidence = 'low';
  }
  return { identity, status, confidence, proposed_rera: proposed, candidates: cand.slice(0, 8), flags };
}

// ---- run -------------------------------------------------------------------------------------
const results = [];
for (const id of numbers) {
  const p = pins.find((x) => x.id === id);
  const searches = [];
  const rows = new Map();
  for (const v of variants(p)) {
    const r = await search(v);
    searches.push({ query: v, url: r.url, total: r.total, error: r.error });
    for (const row of r.rows) rows.set(row.registration, row);
    if (r.total > 0 && r.total <= 10) break; // a specific hit; no need for looser variants
  }
  const c = classify(p, [...rows.values()]);
  results.push({
    number: p.number, pin_id: p.id, title: p.title, developer: p.developer || '', location: p.location || '',
    existing_rera: p.rera_number || '', checked_on: new Date().toISOString().slice(0, 10), searches, ...c,
  });
  console.log(`#${p.number} ${p.title}: ${c.identity}${c.proposed_rera ? ' → ' + c.proposed_rera : ''} (${c.candidates.length} cand.)`);
}
writeFileSync(outFile, JSON.stringify({ source: 'MahaRERA public project search (official)', generated_at: new Date().toISOString(), results }, null, 2) + '\n');
