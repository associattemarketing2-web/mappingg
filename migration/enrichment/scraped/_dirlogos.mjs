import pg from 'pg'; import sharp from 'sharp'; import { mkdirSync, writeFileSync } from 'node:fs';
const url = new URL(process.env.DATABASE_URL); url.searchParams.delete('sslmode');
const db = new pg.Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } }); await db.connect();
const names = process.argv[2].split('|');
const r = await db.query(`SELECT doc->>'name' n, doc->>'logo' l FROM developers WHERE doc->>'name' = ANY($1)`, [names]);
const out = process.argv[3]; mkdirSync(out, { recursive: true });
const TW = 300, TH = 150, COLS = 5; const comps = [];
const esc = (s) => s.replace(/&/g, '&amp;');
for (const [k, x] of r.rows.entries()) {
  let buf;
  if (x.l.startsWith('data:')) buf = Buffer.from(x.l.split(',')[1], 'base64'); else buf = Buffer.from(await (await fetch(x.l)).arrayBuffer());
  const m0 = await sharp(buf).metadata();
  const logo = await sharp(buf).resize({ width: TW - 20, height: TH - 40, fit: 'inside' }).png().toBuffer(); const m = await sharp(logo).metadata();
  const X = (k % COLS) * TW, Y = Math.floor(k / COLS) * TH;
  comps.push({ input: logo, left: X + Math.round((TW - m.width) / 2), top: Y + 5 });
  comps.push({ input: Buffer.from(`<svg width="${TW}" height="${TH}" xmlns="http://www.w3.org/2000/svg"><rect x=".5" y=".5" width="${TW-1}" height="${TH-1}" fill="none" stroke="#aaa"/><text x="5" y="${TH-6}" font-family="Arial" font-size="12" fill="#c00">${esc(x.n)} ${m0.width}x${m0.height}</text></svg>`), left: X, top: Y });
}
await sharp({ create: { width: TW * COLS, height: TH * Math.ceil(r.rows.length / COLS), channels: 3, background: '#fff' } }).composite(comps).png().toFile(out + '/dir.png');
console.log(r.rows.length); await db.end();
