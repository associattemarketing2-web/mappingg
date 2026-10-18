// Applies research/logo-plan.json to Super admin -> Developers (the only table it changes). Same rules as
// migration/enrichment/scraped/dev-logos-apply.mjs: aliases onto entries that already have a logo; new entries
// get the developer's own logo as a PNG data URL. Idempotent: names already present are skipped.
//   node --env-file=.env Developer_Projects/Pune_Mumbai_Verified/scripts/logos-apply.mjs            dry run
//   node --env-file=.env Developer_Projects/Pune_Mumbai_Verified/scripts/logos-apply.mjs --apply
//   node --env-file=.env Developer_Projects/Pune_Mumbai_Verified/scripts/logos-apply.mjs --revert   undo the last --apply
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNS = path.join(ROOT, 'cache', 'logo-runs'); mkdirSync(RUNS, { recursive: true });
const APPLY = process.argv.includes('--apply'), REVERT = process.argv.includes('--revert');
const plan = JSON.parse(readFileSync(path.join(ROOT, 'research', 'logo-plan.json'), 'utf8'));
const normDev = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const now = new Date().toISOString();

const url = new URL(process.env.DATABASE_URL); url.searchParams.delete('sslmode');
const db = new pg.Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false }, query_timeout: 120000 });
await db.connect();

if (REVERT) {
  const f = readdirSync(RUNS).filter((x) => x.startsWith('applied-')).sort().at(-1);
  if (!f) throw new Error('Nothing to revert');
  const run = JSON.parse(readFileSync(path.join(RUNS, f), 'utf8'));
  await db.query('BEGIN');
  await db.query('DELETE FROM developers WHERE id = ANY($1)', [run.created]);
  for (const u of run.updated) await db.query('UPDATE developers SET doc = $2 WHERE id = $1', [u.id, u.before]);
  await db.query('COMMIT'); await db.end();
  console.log(`Reverted ${f}: ${run.created.length} removed, ${run.updated.length} restored`); process.exit(0);
}

const all = (await db.query('SELECT id, doc FROM developers')).rows;
const byName = new Map(all.map((r) => [normDev(r.doc.name), r]));
const taken = new Map(); // any name/alias already pointing at an entry with a logo
for (const r of all) if (r.doc.logo) for (const n of [r.doc.name, ...(r.doc.aliases || [])]) taken.set(normDev(n), r.doc.name);
const changes = [];

for (const a of plan.aliases) {
  const r = byName.get(normDev(a.entry));
  if (!r?.doc.logo) { console.warn(`skip: no entry with a logo named "${a.entry}"`); continue; }
  const add = a.names.filter((n) => !taken.has(normDev(n)));
  for (const n of a.names) if (taken.has(normDev(n)) && taken.get(normDev(n)) !== r.doc.name) console.warn(`note: "${n}" already uses the logo of "${taken.get(normDev(n))}"`);
  if (!add.length) continue;
  r.doc = { ...r.doc, aliases: [...(r.doc.aliases || []), ...add], updated_at: now };
  add.forEach((n) => taken.set(normDev(n), r.doc.name));
  changes.push({ id: r.id, action: 'aliases added', name: r.doc.name, names: add, evidence: a.evidence, doc: r.doc });
}

for (const n of plan.new) {
  if (byName.get(normDev(n.name))?.doc.logo) { console.warn(`skip new "${n.name}": entry exists with a logo (use aliases)`); continue; }
  const names = n.names.filter((x) => !taken.has(normDev(x)) && normDev(x) !== normDev(n.name));
  if (!names.length && !n.names.some((x) => normDev(x) === normDev(n.name))) { console.warn(`skip new "${n.name}": its RERA names already have a logo`); continue; }
  const res = await fetch(n.logo_src, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) { console.warn(`skip "${n.name}": logo HTTP ${res.status}`); continue; }
  const buf = Buffer.from(await res.arrayBuffer());
  // SVG/PNG/WebP -> PNG, at most 600 px wide, transparency kept. A white-only logo gets a dark tile.
  let img = sharp(buf, { density: 300 }).resize({ width: 600, height: 300, fit: 'inside', withoutEnlargement: false });
  const stats = await sharp(await img.clone().png().toBuffer()).stats();
  const white = stats.channels.slice(0, 3).every((c) => c.min > 200) && stats.channels[3] && stats.channels[3].max > 0;
  let png = await img.png().toBuffer();
  // dark_tile: logo with white lettering (made for the site's dark header) - checked by eye, put on a dark tile.
  if (white || n.dark_tile) png = await sharp(png).extend({ top: 30, bottom: 30, left: 30, right: 30, background: '#1f2937' }).flatten({ background: '#1f2937' }).png().toBuffer();
  const meta = await sharp(png).metadata();
  writeFileSync(path.join(RUNS, `${normDev(n.name).replace(/ /g, '-')}.png`), png); // for visual check
  const existing = byName.get(normDev(n.name));
  const logo = 'data:image/png;base64,' + png.toString('base64');
  const source = { by: 'pune-mumbai logos-apply', site: n.site, logo_src: n.logo_src, evidence: n.evidence, office: n.office || null, at: now };
  if (existing) {
    existing.doc = { ...existing.doc, logo, aliases: [...(existing.doc.aliases || []), ...names], source, updated_at: now };
    changes.push({ id: existing.id, action: 'logo added to existing entry', name: n.name, names, evidence: n.evidence, size: `${meta.width}x${meta.height}`, doc: existing.doc });
  } else {
    const id = randomUUID();
    const doc = { id, name: n.name, logo, aliases: names, source, created_at: now, updated_at: now };
    changes.push({ id, action: 'new developer entry', name: n.name, names, evidence: n.evidence, size: `${meta.width}x${meta.height}`, doc, isNew: true });
  }
  names.forEach((x) => taken.set(normDev(x), n.name));
}

console.table(changes.map((c) => ({ action: c.action, entry: c.name, names: c.names.join(' | '), size: c.size || '' })));
if (!APPLY) { console.log('Dry run - nothing written. PNGs for checking:', RUNS); await db.end(); process.exit(0); }
const stamp = now.replace(/[:.]/g, '-');
const before = new Map(all.map((r) => [r.id, JSON.parse(JSON.stringify(r.doc))]));
const orig = (await db.query('SELECT id, doc FROM developers')).rows;
writeFileSync(path.join(RUNS, `developers-before-${stamp}.json`), JSON.stringify(orig));
writeFileSync(path.join(RUNS, `applied-${stamp}.json`), JSON.stringify({ created: changes.filter((c) => c.isNew).map((c) => c.id), updated: changes.filter((c) => !c.isNew).map((c) => ({ id: c.id, before: orig.find((o) => o.id === c.id)?.doc })) }));
await db.query('BEGIN');
for (const c of changes) c.isNew ? await db.query('INSERT INTO developers (id, doc) VALUES ($1, $2)', [c.id, c.doc]) : await db.query('UPDATE developers SET doc = $2 WHERE id = $1', [c.id, c.doc]);
await db.query('COMMIT'); await db.end();
writeFileSync(path.join(ROOT, `logo-changes-${now.slice(0, 10)}.json`), JSON.stringify(changes.map(({ doc, ...c }) => c), null, 2));
console.log(`Saved ${changes.length} changes. Revert with --revert.`); void before;
