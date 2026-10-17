// Developer logos for the "Added data — Check & go live" records (ids in
// migration/backup/scraped-enrichment-cache/ready-ids.json). Finds nothing in the database is changed:
//
//   node --env-file=.env migration/enrichment/scraped/dev-logos-find.mjs
//
// For every developer (RERA promoter) of those records:
//   1. candidate sites: the website the promoter declared to RERA, plus web-search results for the promoter
//      name / its project names (property portals, company-data sites and social media are ignored);
//   2. a candidate is accepted only when the site itself names the promoter or one of its RERA projects
//      (or its domain is the promoter's name and the site loads) — the developer's own site, not a portal;
//   3. the logo is the site's own header logo (an <img>/<svg> marked "logo", or the schema.org logo),
//      saved as PNG. Favicons are not used. White-only logos are flagged (they vanish on a white card).
// Output: <cache>/dev-logos/results.json and one PNG per site, for review with dev-logos-sheet.mjs.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import pg from 'pg';
import sharp from 'sharp';
import { parse } from 'node-html-parser';

const CACHE = path.resolve('migration/backup/scraped-enrichment-cache/dev-logos');
const HTML = path.join(CACHE, 'html'), IMG = path.join(CACHE, 'img');
for (const d of [CACHE, HTML, IMG]) mkdirSync(d, { recursive: true });
const RESULTS = path.join(CACHE, 'results.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';
const md5 = (s) => createHash('md5').update(s).digest('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- the records ---------------------------------------------------------------------------
const url = new URL(process.env.DATABASE_URL);
url.searchParams.delete('sslmode');
const db = new pg.Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false }, query_timeout: 120000 });
await db.connect();
const ids = JSON.parse(readFileSync('migration/backup/scraped-enrichment-cache/ready-ids.json', 'utf8'));
const { rows } = await db.query(`SELECT doc->'data'->>'developer_name' dev, doc->'data'->>'project_name' p,
  doc->'enrichment'->'fields'->>'developer_website' web FROM scraped_projects WHERE id = ANY($1)`, [ids]);
await db.end();

const GENERIC = new Set(('m s ms pvt private ltd limited llp the and of co company corporation corp india infra infrastructure ' +
  'infrastructures builder builders developer developers development developments construction constructions properties property ' +
  'project projects estate estates realty realtor realtors venture ventures group homes home housing infracon infratech enterprise ' +
  'enterprises promoter promoters shelter shelters spaces space land lands holding holdings realities reality structure structures ' +
  'buildcon associates realcon landmark landmarks township townships living urban resi residential premium habitat infra projects ' +
  'bangalore bengaluru dwelling dwellings sri shri shree new phase tower towers apartment apartments residency enclave layout').split(' '));
const words = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
const core = (s) => words(s).filter((w) => !GENERIC.has(w) && w.length > 1);
const squash = (s) => words(s).join('');

const devs = new Map();
for (const r of rows) {
  const d = devs.get(r.dev) || { dev: r.dev, rows: 0, web: new Set(), projects: new Set() };
  d.rows++; if (r.web) d.web.add(r.web.trim()); if (r.p) d.projects.add(r.p.trim());
  devs.set(r.dev, d);
}

// ---- fetching ------------------------------------------------------------------------------
async function get(u, { binary = false, timeout = 20000 } = {}) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(u, { headers: { 'user-agent': UA, accept: binary ? 'image/*,*/*' : 'text/html,*/*' }, redirect: 'follow', signal: ctl.signal });
    if (!res.ok) return null;
    return { url: res.url, type: res.headers.get('content-type') || '', body: binary ? Buffer.from(await res.arrayBuffer()) : await res.text() };
  } catch { return null; } finally { clearTimeout(t); }
}
async function page(u) {
  const f = path.join(HTML, md5(u) + '.json');
  if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
  const r = await get(u);
  const out = r && /html/i.test(r.type) ? { url: r.url, html: r.body.slice(0, 1_500_000) } : null;
  writeFileSync(f, JSON.stringify(out));
  return out;
}

const SKIP = /(zaubacorp|99acres|magicbricks|housing\.com|nobroker|squareyards|justdial|linkedin|facebook|instagram|twitter|x\.com|youtube|indiamart|dnb\.com|thecompanycheck|tofler|proptiger|commonfloor|makaan|quikr|sulekha|rera|wikipedia|google|bing|duckduckgo|falconebiz|instafinancials|companyhouse|corpository|economictimes|moneycontrol|ambitionbox|glassdoor|naukri|crunchbase|zoominfo|apollo|propsoch|propertypistol|homznspace|anarock|nestaway|nobrokerage|realestateindia|propertywala|roofandfloor|99acre|sobhaa?-?\w*\.(in|co)|houssed|hdfc|icici|sbi|lic|bankbazaar|quora|reddit|pinterest|blogspot|wordpress\.com|wixsite|medium|scribd|issuu|slideshare|yellowpages|asklaila|grotal|tradeindia|cleartax|indiafilings|vakilsearch|opencorporates|companiesinindia|companydetails|bizprospect|knowyourgst|gstzen|mastersindia|piramal|realtynxt|propnewstime|financialexpress|hindustantimes|thehindu|deccanherald|livemint|business-standard|timesofindia|ndtv|news18|nobroker|homes247|squareyard|investors-clinic|ghar|gharbazaar|keyonlinesolutions|propertiesguru|brickfolio|livabl|buyproperty|bricksnwalls|truelancer|mapsofindia|nearbuy|olx|bangalore-?properties|resale|ebizmart|realty-?assistant|bengaluruproperties|homebazaar|propertyguru)/i;

const domainOf = (u) => { try { return new URL(/^https?:/i.test(u) ? u : 'http://' + u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };

let searchQueue = Promise.resolve(), blocked = 0;
// Bing links go through bing.com/ck/a?…&u=a1<base64url of the target>.
const unwrap = (u) => {
  const m = /[?&]u=a1([^&]+)/.exec(u);
  if (!m) return u;
  try { return Buffer.from(m[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); } catch { return u; }
};
async function search(q) {
  return (await searchRaw(q)).map(unwrap);
}
async function searchRaw(q) {
  const f = path.join(HTML, 'bing-' + md5(q) + '.json');
  if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
  // One search at a time, spaced out, however many developers run in parallel.
  const turn = searchQueue; let release; searchQueue = new Promise((r) => { release = r; });
  await turn;
  const r = await get('https://www.bing.com/search?setlang=en&cc=IN&q=' + encodeURIComponent(q));
  sleep(1500).then(release);
  if (!r) { blocked++; return []; }
  const out = [...r.body.matchAll(/class="b_algo"[\s\S]*?<a[^>]+href="(https?:\/\/[^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&')).slice(0, 8);
  if (!out.length) { blocked++; return []; } // a block page or an odd answer: not cached, retried next run
  blocked = 0;
  writeFileSync(f, JSON.stringify(out));
  return out;
}

// ---- verification --------------------------------------------------------------------------
function evidence(d, html, host) {
  const text = ' ' + words(parse(html).textContent + ' ' + (html.match(/<title[^>]*>([^<]*)/i)?.[1] || '')).join(' ') + ' ';
  const sq = text.replace(/ /g, '');
  const name = core(d.dev);
  const namePhrase = name.length ? ' ' + name.join(' ') + ' ' : null;
  const hostSq = host.replace(/\.[a-z.]+$/, '').replace(/[^a-z0-9]/g, '');
  const ev = [];
  if (namePhrase && text.includes(namePhrase)) ev.push('names the developer');
  else if (name.length && squash(name.join(' ')).length >= 5 && sq.includes(squash(name.join(' ')))) ev.push('names the developer');
  const proj = [...d.projects].find((p) => { const c = core(p); return c.length && squash(c.join(' ')).length >= 5 && sq.includes(squash(c.join(' '))); });
  if (proj) ev.push(`lists project “${proj}”`);
  if (name.length && squash(name.join(' ')).length >= 4 && hostSq.includes(squash(name.join(' ')))) ev.push('domain is the developer name');
  // The full name as registered, minus the company-form words ("Ruchira Developers", "Living Structures").
  const full = squash(d.dev.replace(/\b(M\/?s\.?|pvt\.?|private|ltd\.?|limited|llp)\b/gi, ' '));
  if (full.length >= 8 && sq.includes(full)) ev.push('shows the full company name');
  if (/ (bhk|apartments?|villas?|plots?|rera|real estate|residential|possession|amenities|floor plans?|flats?) /.test(text)) ev.push('real-estate site');
  return ev;
}

// ---- logo extraction -----------------------------------------------------------------------
const abs = (u, base) => { try { return new URL(u.trim(), base).href; } catch { return null; } };
function logoCandidates(html, base, d) {
  const root = parse(html);
  const out = [];
  const name = core(d.dev);
  for (const s of html.matchAll(/"logo"\s*:\s*(?:\{[^}]*?"url"\s*:\s*)?"([^"]+)"/g)) { const u = abs(s[1], base); if (u) out.push({ u, score: 6, how: 'schema.org logo' }); }
  root.querySelectorAll('img').forEach((img, i) => {
    const src = img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || (img.getAttribute('srcset') || '').split(/[ ,]/)[0];
    if (!src || /^data:image\/gif|spacer|blank\.|pixel/i.test(src)) return;
    let ctx = `${src} ${img.getAttribute('alt') || ''} ${img.getAttribute('class') || ''} ${img.getAttribute('id') || ''}`;
    let inHeader = false, inFooter = false;
    for (let p = img.parentNode, k = 0; p && k < 6; p = p.parentNode, k++) {
      const tag = (p.rawTagName || '').toLowerCase(); const cls = `${p.getAttribute?.('class') || ''} ${p.getAttribute?.('id') || ''}`;
      if (k < 3) ctx += ' ' + cls;
      if (tag === 'header' || tag === 'nav' || /header|navbar|topbar|masthead/i.test(cls)) inHeader = true;
      if (tag === 'footer' || /footer/i.test(cls)) inFooter = true;
    }
    let score = 0;
    if (/logo/i.test(ctx)) score += 5;
    else if (name.some((w) => w.length > 3 && (src.split('/').pop() || '').toLowerCase().includes(w))) score += 5; // "neobuild-white.png"
    if (/brand/i.test(ctx)) score += 2;
    if (inHeader) score += 3;
    if (inFooter) score -= 3;
    if (name.some((w) => w.length > 3 && ctx.toLowerCase().includes(w))) score += 2;
    if (/white|footer|light|wht|inverse|reverse|sticky-?white|banner|slider|hero|award|partner|client|bank|rera|qr|whatsapp|icon-|social|loader|favicon/i.test(src)) score -= 4;
    if (/dark|black|color|colour/i.test(src)) score += 1;
    score -= i * 0.05;
    if (score >= 5) out.push({ u: abs(src, base), score, how: inHeader ? 'header logo' : 'page logo' });
  });
  root.querySelectorAll('svg').forEach((svg) => {
    let ctx = `${svg.getAttribute('class') || ''} ${svg.getAttribute('id') || ''}`;
    for (let p = svg.parentNode, k = 0; p && k < 3; p = p.parentNode, k++) ctx += ` ${p.getAttribute?.('class') || ''} ${p.getAttribute?.('id') || ''}`;
    if (/logo/i.test(ctx) && svg.toString().length > 400) out.push({ svg: svg.toString(), score: 5.5, how: 'inline svg logo' });
  });
  return out.filter((c) => c.u || c.svg).sort((a, b) => b.score - a.score);
}

async function toPng(c) {
  let buf;
  if (c.svg) buf = Buffer.from(c.svg.includes('xmlns=') ? c.svg : c.svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"'));
  else { const r = await get(c.u, { binary: true }); if (!r || r.body.length < 300) return null; buf = r.body; }
  try {
    const img = sharp(buf, { density: 200 }).trim({ threshold: 10 }).resize({ width: 600, height: 300, fit: 'inside', withoutEnlargement: true }).png();
    const png = await img.toBuffer();
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (info.width < 40 || info.height < 16) return null;
    let n = 0, lum = 0, dark = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 128) { n++; const l = 0.3 * data[i] + 0.59 * data[i + 1] + 0.11 * data[i + 2]; lum += l; if (l < 200) dark++; }
    if (n < 50) return null;
    return { png, w: info.width, h: info.height, whiteOnly: dark / n < 0.03, opaqueBox: n / (info.width * info.height) > 0.97 };
  } catch { return null; }
}

// ---- run -----------------------------------------------------------------------------------
const results = existsSync(RESULTS) ? JSON.parse(readFileSync(RESULTS, 'utf8')) : {};
const list = [...devs.values()].sort((a, b) => b.rows - a.rows);
let n = 0;
// Developers with a logo are kept; the rest are searched again.
const queue = list.filter((d) => !results[d.dev]?.pick?.logo);
await Promise.all(Array.from({ length: 8 }, async () => {
  for (let d; (d = queue.shift());) {
    if (blocked >= 6) { console.log('Search is being blocked — stopping; run again later to continue.'); queue.length = 0; return; }
    await one(d);
  }
}));
async function one(d) {
  n++;
  const declared = [...d.web].map((w) => domainOf(w)).filter(Boolean);
  const cands = new Map(declared.map((h) => [h, 'declared to RERA']));
  const name = d.dev.replace(/\b(M\/?s\.?|pvt\.?|private|ltd\.?|limited|llp)\b/gi, ' ').replace(/\s+/g, ' ').trim();
  const proj = [...d.projects][0] || '';
  for (const q of [`${name} Bangalore real estate developer`, `${proj} ${name} Bangalore`]) {
    for (const u of await search(q)) { const h = domainOf(u); if (h && !SKIP.test(h) && !cands.has(h) && cands.size < 7) cands.set(h, 'web search'); }
  }
  let pick = null;
  const tried = [];
  for (const [host, src] of cands) {
    const pg_ = (await page('https://' + host)) || (await page('http://' + host));
    if (!pg_) { tried.push(`${host}: did not load`); continue; }
    if (pg_.html.length < 1500 || /\/lander|domain (is )?for sale|parked|sedoparking|hugedomains|afternic/i.test(pg_.html.slice(0, 5000))) { tried.push(`${host}: parked / empty page`); continue; }
    const ev = evidence(d, pg_.html, domainOf(pg_.url) || host);
    const has = (k) => ev.some((e) => e.startsWith(k));
    // Declared to RERA: the promoter's own word, so any sign it is that developer's real-estate site.
    // Found by search: must list one of its RERA projects, or show its full name on a domain of its name.
    const ok = has('real-estate') && (src === 'declared to RERA'
      ? has('names') || has('lists') || has('domain') || has('shows')
      : has('lists') || (has('shows') && has('domain')));
    if (!ok) { tried.push(`${host} (${src}): ${ev.join(', ') || 'does not mention the developer or its projects'}`); continue; }
    let logo = null;
    for (const c of logoCandidates(pg_.html, pg_.url, d).slice(0, 6)) {
      const r = await toPng(c);
      if (!r) continue;
      if (!logo || (logo.whiteOnly && !r.whiteOnly)) logo = { ...r, how: c.how, src: c.u || 'inline svg' };
      if (!logo.whiteOnly) break;
    }
    pick = { host, site: pg_.url, source: src, evidence: ev };
    if (logo) {
      const file = path.join(IMG, host.replace(/[^a-z0-9.-]/g, '_') + '.png');
      writeFileSync(file, logo.png);
      Object.assign(pick, { logo: path.relative(CACHE, file).replace(/\\/g, '/'), logo_src: logo.src, logo_how: logo.how, w: logo.w, h: logo.h, white_only: logo.whiteOnly, box: logo.opaqueBox });
      break;
    }
    tried.push(`${host}: verified but no logo found on the page`);
  }
  results[d.dev] = { done: true, rows: d.rows, projects: [...d.projects], declared, pick, tried };
  writeFileSync(RESULTS, JSON.stringify(results, null, 1));
  console.log(`${n}/${list.length} ${d.dev} → ${pick?.logo ? pick.host : pick ? pick.host + ' (no logo)' : '—'}`);
}
const v = Object.values(results);
console.log(`done: ${v.length} developers, site ${v.filter((r) => r.pick).length}, logo ${v.filter((r) => r.pick?.logo).length}`);
