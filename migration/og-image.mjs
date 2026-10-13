// Renders the site-wide social share image (Open Graph / Twitter card), 1200x630,
// with the same illustrated renderer as the blog covers (migration/blog-covers.mjs).
//
//   node migration/og-image.mjs
//
// Writes public/og/mappingg-og-v1.jpg — the default image (SITE.ogFallback) for any
// page without its own (project photos and blog covers still take precedence).
// Bump the file name when the design changes: /og is cached by browsers.

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { makeCover } from './blog-covers.mjs';

const OUT = path.resolve('public/og/mappingg-og-v1.jpg');
await mkdir(path.dirname(OUT), { recursive: true });
const tmp = OUT.replace(/\.jpg$/, '.tmp.jpg');
await makeCover(tmp, {
  theme: 'emerald',
  kicker: 'Live real estate map',
  lines: ['Every property project,', 'mapped and', 'verified'],
  // Only true statements: coverage, what each project shows, and buyer access.
  stats: [['Pune', '& Mumbai MMR'], ['MahaRERA', 'numbers shown'], ['Free', 'for home buyers']],
  pins: ['Kharadi', 'Baner', 'Thane', 'Kharghar'],
  tagline: 'Pune & Mumbai’s live real-estate map',
});
// Re-encode for a small, progressive file (social crawlers fetch it often).
await sharp(tmp).jpeg({ quality: 82, progressive: true, mozjpeg: true }).toFile(OUT);
await import('node:fs/promises').then((fs) => fs.rm(tmp));
const meta = await sharp(OUT).metadata();
console.log(`OG image: ${path.relative(process.cwd(), OUT)} ${meta.width}x${meta.height}`);
