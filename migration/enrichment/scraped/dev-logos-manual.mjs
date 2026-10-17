// Logos found by hand (web search) for developers the automatic passes missed.
//   node migration/enrichment/scraped/dev-logos-manual.mjs <manual-input.json>
// Input: [{ "dev": "<RERA promoter name>", "page": "<developer site or portal page>", "img"?: "<logo image URL>", "brand"?: "…" }]
// Without "img", the page's own header logo (developer site) or its labelled developer logo (portal) is taken.
// Saved into <cache>/dev-logos/manual.json + img/, then reviewed on the contact sheet like the others.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';
import { parse } from 'node-html-parser';

const CACHE = path.resolve('migration/backup/scraped-enrichment-cache/dev-logos');
const OUT = path.join(CACHE, 'manual.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';
const md5 = (s) => createHash('md5').update(s).digest('hex');
const manual = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
const words = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter((w) => w.length > 2);

/** Square Yards draws the builder's name in plain black text when it has no logo: no colour, only text. */
async function isTextImage(png) {
  const { data } = await sharp(png).flatten({ background: '#fff' }).raw().toBuffer({ resolveWithObject: true });
  let ink = 0, colour = 0;
  for (let i = 0; i < data.length; i += 3) {
    const mx = Math.max(data[i], data[i + 1], data[i + 2]), mn = Math.min(data[i], data[i + 1], data[i + 2]);
    if (mx < 235) { ink++; if (mx - mn > 40) colour++; }
  }
  return ink > 0 && colour / ink < 0.03; // JPEG noise leaves a few coloured pixels on plain black text
}

async function get(u, binary) {
  try {
    const r = await fetch(u, { headers: { 'user-agent': UA, 'accept-language': 'en-IN,en;q=0.9' }, redirect: 'follow', signal: AbortSignal.timeout(25000) });
    if (!r.ok) return null;
    return binary ? Buffer.from(await r.arrayBuffer()) : { url: r.url, html: await r.text() };
  } catch { return null; }
}

function candidates(html, base, hint) {
  const root = parse(html);
  const portal = /housiey|squareyards|houssed|nobroker/.test(new URL(base).hostname);
  const out = [];
  for (const s of html.matchAll(/"logo"\s*:\s*(?:\{[^}]*?"url"\s*:\s*)?"([^"]+)"/g)) out.push({ u: s[1], score: 6 });
  root.querySelectorAll('img').forEach((img, i) => {
    let src = img.getAttribute('data-src') || img.getAttribute('src') || '';
    const set = img.getAttribute('srcset') || img.getAttribute('srcSet') || '';
    if ((!src || src.startsWith('data:')) && set) src = set.split(/\s+/)[0];
    if (!src || src.startsWith('data:')) return;
    const alt = img.getAttribute('alt') || '';
    let ctx = `${src} ${alt} ${img.getAttribute('class') || ''} ${img.getAttribute('id') || ''}`, header = false;
    for (let p = img.parentNode, k = 0; p && k < 5; p = p.parentNode, k++) {
      const c = `${p.getAttribute?.('class') || ''} ${p.getAttribute?.('id') || ''}`;
      if (k < 3) ctx += ' ' + c;
      if ((p.rawTagName || '').toLowerCase() === 'header' || /header|navbar/i.test(c)) header = true;
    }
    let score = 0;
    if (/logo/i.test(ctx)) score += 5;
    if (/developerlogo|\/builders?\/|firmlogos/i.test(src)) score += 5;
    if (header) score += 3;
    if (hint.some((w) => ctx.toLowerCase().includes(w))) score += 3;
    if (/housiey|square ?yards|nobroker|houssed/i.test(alt) || /white|footer|banner|slider|award|whatsapp|pi-builder-office/i.test(ctx)) score -= 6;
    score -= i * 0.03;
    // On a portal page only the image labelled with this builder's name is its logo (pages list other builders too).
    if (portal && !hint.some((w) => alt.toLowerCase().includes(w))) return;
    if (/developer-img\.|squareyards-logo|\/assets\/images\/squareyards|pi-builder-office/i.test(src)) return;
    if (score >= 5) out.push({ u: src.startsWith('/_next/image') ? decodeURIComponent(src.replace(/^.*[?&]url=([^&]+).*$/, '$1')) : src, score });
  });
  return out.sort((a, b) => b.score - a.score).map((c) => { try { return new URL(c.u.replace(/(static\.squareyards\.com\/[^?]+)\?aio=.*$/, '$1'), base).href; } catch { return null; } }).filter(Boolean);
}

for (const it of JSON.parse(readFileSync(process.argv[2], 'utf8'))) {
  const hint = words(it.brand || it.dev);
  let list = it.img ? [it.img] : [];
  if (!it.img) {
    let p = await get(it.page);
    for (let t = 0; !p && t < 3; t++) { await new Promise((r) => setTimeout(r, 8000)); p = await get(it.page); } // portals rate-limit bursts
    if (!p) { console.log(`✗ ${it.dev}: page did not load`); continue; }
    list = candidates(p.html, p.url, hint);
  }
  let saved = null;
  for (const u of list.slice(0, 5)) {
    const buf = await get(u, true);
    if (!buf || buf.length < 200) continue;
    try {
      const png = await sharp(buf, { density: 200 }).trim({ threshold: 10 }).resize({ width: 600, height: 300, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
      const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      if (info.width < 30) continue;
      if (/squareyards/.test(u) && await isTextImage(png)) { console.log(`  ${it.dev}: Square Yards shows only the name as text (no logo) — skipped`); continue; }
      let n = 0, dark = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 128) { n++; if (0.3 * data[i] + 0.59 * data[i + 1] + 0.11 * data[i + 2] < 200) dark++; }
      const file = path.join(CACHE, 'img', 'manual-' + md5(u).slice(0, 12) + '.png');
      writeFileSync(file, png);
      saved = { logo: path.relative(CACHE, file).replace(/\\/g, '/'), logo_src: u, site: it.page, brand: it.brand, white_only: n > 0 && dark / n < 0.03 };
      break;
    } catch { /* not an image */ }
  }
  if (!saved) { console.log(`✗ ${it.dev}: no logo image on ${it.page}`); continue; }
  manual[it.dev] = saved;
  console.log(`✓ ${it.dev} ← ${saved.logo_src}`);
}
writeFileSync(OUT, JSON.stringify(manual, null, 1));
