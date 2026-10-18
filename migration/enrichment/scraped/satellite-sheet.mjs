// Satellite contact sheets of pins for a visual check (Esri World Imagery tiles, zoom 17, ~600 m across, red cross = pin).
//   node migration/enrichment/scraped/satellite-sheet.mjs <pins.json: [{num,name,lat,lng}]> <out-dir>
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const [inFile, outDir] = process.argv.slice(2);
const pins = JSON.parse(readFileSync(inFile, 'utf8'));
const TILES = path.resolve('migration/backup/scraped-enrichment-cache/esri-tiles'); mkdirSync(TILES, { recursive: true }); mkdirSync(outDir, { recursive: true });
const Z = 17, T = 256;
const xy = (lat, lng) => { const n = 2 ** Z, x = (lng + 180) / 360 * n, r = lat * Math.PI / 180; return [x, (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n]; };
async function tile(x, y) {
  const f = path.join(TILES, `${Z}_${x}_${y}.jpg`);
  if (!existsSync(f)) {
    const r = await fetch(`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${Z}/${y}/${x}`, { headers: { 'User-Agent': 'mappingg.com location check' } });
    writeFileSync(f, Buffer.from(await r.arrayBuffer()));
  }
  return readFileSync(f);
}
const W = 3 * T, PANE = 300;
const panes = [];
for (const p of pins) {
  const [fx, fy] = xy(p.lat, p.lng), cx = Math.floor(fx), cy = Math.floor(fy);
  const comp = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) comp.push({ input: await tile(cx + dx, cy + dy), left: (dx + 1) * T, top: (dy + 1) * T });
  const px = Math.round((fx - cx + 1) * T), py = Math.round((fy - cy + 1) * T);
  const mark = Buffer.from(`<svg width="${W}" height="${W}" xmlns="http://www.w3.org/2000/svg"><g stroke="#ff2020" stroke-width="5"><line x1="${px - 22}" y1="${py}" x2="${px - 6}" y2="${py}"/><line x1="${px + 6}" y1="${py}" x2="${px + 22}" y2="${py}"/><line x1="${px}" y1="${py - 22}" x2="${px}" y2="${py - 6}"/><line x1="${px}" y1="${py + 6}" x2="${px}" y2="${py + 22}"/></g><circle cx="${px}" cy="${py}" r="3" fill="#ff2020"/></svg>`);
  const left = Math.min(Math.max(px - 300, 0), W - 600), top = Math.min(Math.max(py - 300, 0), W - 600);
  const img = await sharp({ create: { width: W, height: W, channels: 3, background: '#000' } }).composite([...comp, { input: mark, left: 0, top: 0 }]).png().toBuffer();
  const crop = await sharp(img).extract({ left, top, width: 600, height: 600 }).resize(PANE, PANE).toBuffer();
  const label = Buffer.from(`<svg width="${PANE}" height="${PANE + 34}" xmlns="http://www.w3.org/2000/svg"><rect y="${PANE}" width="${PANE}" height="34" fill="#fff"/><text x="6" y="${PANE + 22}" font-family="Arial" font-size="15" fill="#000">#${p.num} ${String(p.name).replace(/[<&>]/g, '').slice(0, 30)}</text></svg>`);
  panes.push(await sharp({ create: { width: PANE, height: PANE + 34, channels: 3, background: '#fff' } }).composite([{ input: crop, left: 0, top: 0 }, { input: label, left: 0, top: 0 }]).png().toBuffer());
}
const COLS = 3, PER = 9;
for (let s = 0; s * PER < panes.length; s++) {
  const part = panes.slice(s * PER, s * PER + PER), rows = Math.ceil(part.length / COLS);
  await sharp({ create: { width: COLS * (PANE + 6), height: rows * (PANE + 40), channels: 3, background: '#ddd' } })
    .composite(part.map((b, i) => ({ input: b, left: (i % COLS) * (PANE + 6), top: Math.floor(i / COLS) * (PANE + 40) }))).png().toFile(path.join(outDir, `sheet-${s + 1}.png`));
}
console.log(`${panes.length} pins → ${Math.ceil(panes.length / PER)} sheets in ${outDir}`);
