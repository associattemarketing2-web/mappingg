// Second pass for developers whose own site gave no logo (dev-logos-find.mjs): the developer logo shown on a
// property portal's page for one of their RERA projects (Housiey, Square Yards, NoBroker …; pages from
// dev-logos-portal-index.mjs).
//
//   node --env-file=.env migration/enrichment/scraped/dev-logos-portals.mjs
//
// A portal page counts only when it shows the project's RERA registration number, or the developer's name;
// the logo is the image the portal labels as that developer's logo (its alt text names the developer or the
// brand). The portal's own logo, project photos and other builders' logos are ignored. Results go into
// results.json (pick.source = "portal: <host>") for review on the contact sheets like the others.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import pg from 'pg';
import sharp from 'sharp';
import { parse } from 'node-html-parser';

const CACHE = path.resolve('migration/backup/scraped-enrichment-cache/dev-logos');
const HTML = path.join(CACHE, 'html'), IMG = path.join(CACHE, 'img');
const RESULTS = path.join(CACHE, 'results.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';
const md5 = (s) => createHash('md5').update(s).digest('hex');

const url = new URL(process.env.DATABASE_URL);
url.searchParams.delete('sslmode');
const db = new pg.Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false }, query_timeout: 120000 });
await db.connect();
const ids = JSON.parse(readFileSync(process.env.IDS_FILE || 'migration/backup/scraped-enrichment-cache/ready-ids.json', 'utf8'));
const { rows } = await db.query(`SELECT doc->'data'->>'developer_name' dev, doc->'data'->>'project_name' p, doc->'data'->>'rera_number' rera,
  doc->'data'->>'locality' loc FROM scraped_projects WHERE id = ANY($1)`, [ids]);
await db.end();

const GENERIC = new Set(('m s ms pvt private ltd limited llp the and of co company corporation corp india infra infrastructure infrastructures ' +
  'builder builders developer developers development developments construction constructions properties property project projects ' +
  'estate estates realty realtor realtors venture ventures group homes home housing infracon infratech enterprise enterprises promoter ' +
  'promoters shelter shelters spaces space land lands holding holdings realities reality structure structures buildcon associates ' +
  'realcon landmark landmarks township townships living urban resi residential premium habitat bangalore bengaluru dwelling dwellings ' +
  'sri shri shree new').split(' '));
const words = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
const core = (s) => words(s).filter((w) => !GENERIC.has(w) && w.length > 1);
const squash = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const projKey = (p) => squash(String(p).toLowerCase().replace(/\b(phase|tower|block|wing)\b.*$/, ''));

const devs = new Map();
for (const r of rows) {
  const d = devs.get(r.dev) || { dev: r.dev, projects: [], reras: [] };
  d.projects.push(r.p); if (r.rera) d.reras.push(squash(r.rera), squash(r.rera.split('/')[0])); // UP RERA: 'UPRERAPRJ528653/07/2026' is shown as 'UPRERAPRJ528653'
  devs.set(r.dev, d);
}

const idx = JSON.parse(readFileSync(path.join(CACHE, process.env.INDEX_FILE || 'portal-index.json'), 'utf8'));
const PRIORITY = ['housiey.com', 'squareyards.com', 'nobroker.in', 'propsoch.com', 'homznspace.com', 'homebazaar.com'];
const pages = PRIORITY.flatMap((h) => (idx[h] || []).filter((u) => h !== 'nobroker.in' || /prjt/.test(u))
  .map((u) => ({ host: h, u, key: squash(new URL(u).pathname) })));

async function get(u, binary = false) {
  try {
    const r = await fetch(u, { headers: { 'user-agent': UA, 'accept-language': 'en-IN,en;q=0.9' }, signal: AbortSignal.timeout(25000) });
    if (!r.ok) return null;
    return binary ? Buffer.from(await r.arrayBuffer()) : await r.text();
  } catch { return null; }
}
async function page(u) {
  const f = path.join(HTML, 'p-' + md5(u) + '.json');
  if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
  const html = await get(u);
  writeFileSync(f, JSON.stringify(html ? html.slice(0, 2_500_000) : null));
  return html;
}

const PORTAL_SELF = /housiey|square ?yards|nobroker|propsoch|homznspace|home ?bazaar|houssed|property ?pistol/i;
function portalLogos(html, base, d) {
  const root = parse(html);
  const name = core(d.dev);
  const out = [];
  for (const img of root.querySelectorAll('img')) {
    const alt = (img.getAttribute('alt') || '').trim();
    let src = img.getAttribute('data-src') || img.getAttribute('src') || '';
    const set = img.getAttribute('srcset') || img.getAttribute('srcSet') || '';
    if ((!src || src.startsWith('data:')) && set) src = set.split(/\s+/)[0];
    if (!src || src.startsWith('data:') || PORTAL_SELF.test(alt)) continue;
    const decoded = decodeURIComponent(src.replace(/^.*[?&]url=([^&]+).*$/, '$1'));
    const pathish = /developerlogo|\/builders?\/|firmlogos|builder-?logo|developer-?logo|\/logo\//i.test(decoded);
    const altLogo = /logo/i.test(alt) || /developer|builder/i.test(alt);
    if (!pathish && !altLogo) continue;
    const brand = alt.replace(/\b(developer|builder)s?\b|\blogo\b/gi, ' ').replace(/\s+/g, ' ').trim();
    if (!brand) continue;
    const brandMatches = name.some((w) => w.length > 2 && words(brand).includes(w));
    // A logo labelled with a different name is accepted only on a page that shows our RERA number
    // (then it is this project's developer brand, e.g. an SPV marketed under its group's name).
    let abs; try { abs = new URL(src.startsWith('/_next/image') ? decoded : src, base).href; } catch { continue; }
    if (/\/media\/building\/[^/]+\/logo\//.test(abs) && !brandMatches) continue; // NoBroker project logo, not the developer's
    out.push({ u: abs, brand, brandMatches, pathish });
  }
  return out.sort((a, b) => (b.brandMatches - a.brandMatches) || (b.pathish - a.pathish));
}

// Logos rejected on the contact sheets, and images that are not logos at all.
const REJ = JSON.parse(readFileSync('migration/enrichment/scraped/dev-logo-rejects.json', 'utf8'));
const badSrc = (d, u) => REJ.bad_src.some((s) => u.includes(s)) || REJ.bad_dev[d.dev] === u;

/** Square Yards draws the builder's name in plain black text when it has no logo: no colour, only text. */
async function isTextPlaceholder(png) {
  const { data } = await sharp(png).flatten({ background: '#fff' }).raw().toBuffer({ resolveWithObject: true });
  let ink = 0, colour = 0;
  for (let i = 0; i < data.length; i += 3) {
    const mx = Math.max(data[i], data[i + 1], data[i + 2]), mn = Math.min(data[i], data[i + 1], data[i + 2]);
    if (mx < 235) { ink++; if (mx - mn > 40) colour++; }
  }
  return ink > 0 && colour / ink < 0.01;
}

async function toPng(u, host) {
  const buf = await get(u, true);
  if (!buf || buf.length < 300) return null;
  try {
    const png = await sharp(buf, { density: 200 }).trim({ threshold: 10 }).resize({ width: 600, height: 300, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (info.width < 40 || info.height < 30) return null;
    let n = 0, dark = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 128) { n++; if (0.3 * data[i] + 0.59 * data[i + 1] + 0.11 * data[i + 2] < 200) dark++; }
    if (n < 50) return null;
    if (host === 'squareyards.com' && await isTextPlaceholder(png)) return null;
    return { png, w: info.width, h: info.height, whiteOnly: dark / n < 0.03 };
  } catch { return null; }
}

const results = JSON.parse(readFileSync(RESULTS, 'utf8'));
// Drop picks that are rejected or are Square Yards text images, so those developers are searched again.
for (const d of devs.values()) {
  const p = results[d.dev]?.pick;
  if (!p?.logo) continue;
  const text = p.host === 'squareyards.com' && await isTextPlaceholder(readFileSync(path.join(CACHE, p.logo)));
  if (badSrc(d, p.logo_src) || text) results[d.dev].rejected = { ...p, why: text ? 'Square Yards text image, not a logo' : 'rejected on review' }, delete results[d.dev].pick;
}
const todo = [...devs.values()].filter((d) => !results[d.dev]?.pick?.logo);
let n = 0, found = 0;
async function one(d) {
  n++;
  const keys = [...new Set(d.projects.map(projKey).filter((k) => k.length >= 5))];
  const cands = [];
  for (const k of keys) for (const p of pages) if (p.key.includes(k) && !cands.includes(p)) cands.push(p);
  // Square Yards builder pages by the developer's own name.
  const dn = squash(core(d.dev).join(''));
  if (dn.length >= 5) for (const p of pages) if (p.host === 'squareyards.com' && /\/builder$/.test(p.u) && p.key.startsWith(dn) && !cands.includes(p)) cands.push(p);
  const tried = [];
  for (const c of cands.slice(0, 8)) {
    const html = await page(c.u);
    if (!html) { tried.push(`${c.u}: did not load`); continue; }
    const sq = squash(html.replace(/<[^>]+>/g, ' '));
    const reraOk = d.reras.some((r) => r.length >= 10 && sq.includes(r));
    const nameOk = dn.length >= 4 && sq.includes(dn);
    if (!reraOk && !nameOk) { tried.push(`${c.u}: neither the RERA number nor the developer name on the page`); continue; }
    for (const l of portalLogos(html, c.u, d)) {
      if (!l.brandMatches && !reraOk) continue;
      if (badSrc(d, l.u)) continue;
      const img = await toPng(l.u, c.host);
      if (!img) continue;
      const file = path.join(IMG, 'portal-' + md5(l.u).slice(0, 12) + '.png');
      writeFileSync(file, img.png);
      results[d.dev].pick = { host: c.host, site: c.u, source: `portal: ${c.host}`, brand: l.brand,
        evidence: [reraOk ? 'page shows the RERA number' : null, nameOk ? 'page names the developer' : null, l.brandMatches ? 'logo labelled with the developer name' : `logo labelled “${l.brand}”`].filter(Boolean),
        logo: path.relative(CACHE, file).replace(/\\/g, '/'), logo_src: l.u, logo_how: 'portal developer logo', w: img.w, h: img.h, white_only: img.whiteOnly };
      results[d.dev].portal_tried = tried;
      found++;
      console.log(`${n}/${todo.length} ${d.dev} → ${l.brand} (${c.host}${reraOk ? ', RERA no. on page' : ''})`);
      return;
    }
    tried.push(`${c.u}: verified page but no developer logo on it`);
  }
  results[d.dev].portal_tried = tried;
  console.log(`${n}/${todo.length} ${d.dev} → —`);
}
const queue = [...todo];
await Promise.all(Array.from({ length: 6 }, async () => { for (let d; (d = queue.shift());) { await one(d); writeFileSync(RESULTS, JSON.stringify(results, null, 1)); } }));
console.log(`portal pass done: ${found} of ${todo.length} developers got a logo`);
