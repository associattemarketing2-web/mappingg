// Developer-directory entries (with the developer's own logo) for the Mumbai / Pune Scraped-data rows whose developer
// had none: Kalpataru and Ekta World. The logos are the ones in the header of each developer's own website.
//
//   node --env-file=.env Developer_Projects/New500_2026-10-31/scripts/dev-logos-add.mjs <logo folder>           dry run
//   node --env-file=.env Developer_Projects/New500_2026-10-31/scripts/dev-logos-add.mjs <logo folder> --apply
//   node --env-file=.env Developer_Projects/New500_2026-10-31/scripts/dev-logos-add.mjs --revert
//
// <logo folder> holds kalpataru.svg (the inline SVG of kalpataru.com's navbar) and ekta.png (ektaworld.com/images/new-logo-png.png).
// Only new entries are created; an existing entry with the same name is left alone.

import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import pg from 'pg';
import sharp from 'sharp';

const APPLY = process.argv.includes('--apply'), REVERT = process.argv.includes('--revert');
const TAG = 'new500-mh-logos';
const url = new URL(process.env.DATABASE_URL); url.searchParams.delete('sslmode');
const db = new pg.Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } });
await db.connect();
if (REVERT) {
  const r = await db.query(`DELETE FROM developers WHERE doc->'source'->>'by' = $1 RETURNING doc->>'name' n`, [TAG]);
  console.log(`Removed ${r.rowCount}: ${r.rows.map((x) => x.n).join(', ')}`); await db.end(); process.exit(0);
}
const dir = process.argv[2];
const ENTRIES = [
  { name: 'Kalpataru', file: 'kalpataru.svg', site: 'https://www.kalpataru.com/', logo_src: 'https://www.kalpataru.com/ (inline SVG logo in the site header)',
    evidence: "official: kalpataru.com site header logo; the site's project pages (e.g. /pune/kalpataru-blossoms-sinhagad-road) show the MahaRERA numbers of the Scraped-data rows" },
  { name: 'Ekta World', file: 'ekta.png', site: 'https://www.ektaworld.com/', logo_src: 'https://www.ektaworld.com/images/new-logo-png.png',
    evidence: "official: ektaworld.com site header logo; its project page /ekta-victoria-bandra-west.html shows the MahaRERA number of the Scraped-data row" },
];
const now = new Date().toISOString();
for (const e of ENTRIES) {
  const have = await db.query(`SELECT id FROM developers WHERE lower(doc->>'name') = lower($1)`, [e.name]);
  if (have.rowCount) { console.log(`${e.name}: already in the directory, left alone`); continue; }
  const png = await sharp(readFileSync(path.join(dir, e.file)), { density: 300 }).resize({ width: 600, withoutEnlargement: false }).png().toBuffer();
  const doc = { id: randomUUID(), name: e.name, logo: `data:image/png;base64,${png.toString('base64')}`, aliases: [],
    source: { at: now, by: TAG, site: e.site, logo_src: e.logo_src, evidence: e.evidence }, created_at: now, updated_at: now };
  console.log(`${e.name}: new entry, logo ${png.length} bytes`);
  if (APPLY) await db.query(`INSERT INTO developers (id, doc) VALUES ($1, $2)`, [doc.id, JSON.stringify(doc)]);
}
if (!APPLY) console.log('Dry run — use --apply.');
await db.end();
