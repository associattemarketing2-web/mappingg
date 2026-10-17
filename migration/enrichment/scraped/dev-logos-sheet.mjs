// Contact sheets of the logos found by dev-logos-find.mjs, for checking them by eye before they are saved.
//   node migration/enrichment/scraped/dev-logos-sheet.mjs  →  <cache>/dev-logos/sheet-01.png …
// Each tile: index, developer, site; the logo on white (how a card shows it).

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const CACHE = path.resolve('migration/backup/scraped-enrichment-cache/dev-logos');
const results = JSON.parse(readFileSync(path.join(CACHE, 'results.json'), 'utf8'));
const items = Object.entries(results).filter(([, r]) => r.pick?.logo).map(([dev, r], i) => ({ i: i + 1, dev, ...r.pick }));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const TW = 250, TH = 150, COLS = 8, ROWS = 6;
writeFileSync(path.join(CACHE, 'sheet-index.json'), JSON.stringify(items.map(({ i, dev, host }) => ({ i, dev, host })), null, 1));
for (let s = 0; s * COLS * ROWS < items.length; s++) {
  const page = items.slice(s * COLS * ROWS, (s + 1) * COLS * ROWS);
  const comps = [];
  for (const [k, it] of page.entries()) {
    const x = (k % COLS) * TW, y = Math.floor(k / COLS) * TH;
    const logo = await sharp(path.join(CACHE, it.logo)).resize({ width: TW - 30, height: TH - 60, fit: 'inside' }).png().toBuffer();
    const m = await sharp(logo).metadata();
    comps.push({ input: logo, left: x + Math.round((TW - m.width) / 2), top: y + 12 + Math.round((TH - 60 - m.height) / 2) });
    comps.push({ input: Buffer.from(`<svg width="${TW}" height="${TH}" xmlns="http://www.w3.org/2000/svg"><rect x="0.5" y="0.5" width="${TW - 1}" height="${TH - 1}" fill="none" stroke="#bbb"/>
      <text x="6" y="${TH - 28}" font-family="Arial" font-size="13" font-weight="bold" fill="#c00">#${it.i}${it.white_only ? ' WHITE' : ''}</text>
      <text x="6" y="${TH - 14}" font-family="Arial" font-size="11" fill="#000">${esc(it.dev.slice(0, 36))}</text>
      <text x="6" y="${TH - 3}" font-family="Arial" font-size="10" fill="#555">${esc((it.brand ? it.brand + " · " : "") + it.host).slice(0, 40)}</text></svg>`), left: x, top: y });
  }
  const out = path.join(CACHE, `sheet-${String(s + 1).padStart(2, '0')}.png`);
  await sharp({ create: { width: TW * COLS, height: TH * ROWS, channels: 3, background: '#ffffff' } }).composite(comps).png().toFile(out);
  console.log(out, page.length);
}
