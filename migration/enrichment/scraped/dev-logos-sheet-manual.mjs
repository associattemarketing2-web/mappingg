// Contact sheet of the hand-found logos (manual.json): <cache>/dev-logos/manual-sheet.png
import { readFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
const CACHE = path.resolve('migration/backup/scraped-enrichment-cache/dev-logos');
const items = Object.entries(JSON.parse(readFileSync(path.join(CACHE, 'manual.json'), 'utf8')));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const TW = 250, TH = 130, COLS = 8, comps = [];
for (const [k, [dev, m]] of items.entries()) {
  const X = (k % COLS) * TW, Y = Math.floor(k / COLS) * TH;
  let img = sharp(path.join(CACHE, m.logo));
  if (m.white_only) img = img.flatten({ background: '#1f2937' });
  const l = await img.resize({ width: TW - 20, height: TH - 40, fit: 'inside' }).png().toBuffer(), md = await sharp(l).metadata();
  comps.push({ input: l, left: X + Math.round((TW - md.width) / 2), top: Y + 4 });
  comps.push({ input: Buffer.from(`<svg width="${TW}" height="${TH}" xmlns="http://www.w3.org/2000/svg"><rect x=".5" y=".5" width="${TW - 1}" height="${TH - 1}" fill="none" stroke="#bbb"/><text x="4" y="${TH - 6}" font-family="Arial" font-size="11" fill="#c00">M${k + 1} ${esc(dev.slice(0, 32))}</text></svg>`), left: X, top: Y });
}
await sharp({ create: { width: TW * COLS, height: TH * Math.ceil(items.length / COLS), channels: 3, background: '#fff' } }).composite(comps).png().toFile(path.join(CACHE, 'manual-sheet.png'));
console.log(items.length);
