// Puts the developers' own logos on the "Added data — Check & go live" records, through Super admin → Developers
// (the scraped list, and the pin when a record is published, take the logo from there by developer name).
//
//   node --env-file=.env migration/enrichment/scraped/dev-logos-apply.mjs            dry run
//   node --env-file=.env migration/enrichment/scraped/dev-logos-apply.mjs --apply
//   node --env-file=.env migration/enrichment/scraped/dev-logos-apply.mjs --revert   undo the last --apply
//
// 1. dev-logo-aliases.json: RERA promoter names → an existing developer entry (its logo was checked by hand):
//    the names are added to that entry's `aliases`.
// 2. <cache>/dev-logos/accepted.json (from dev-logos-find.mjs, reviewed on the contact sheets): one developer
//    site → a new entry with that site's own logo, named after the promoter, with every promoter name of
//    that site as aliases. An entry that already has the name but no logo gets the logo instead.
// Only the `developers` table changes; scraped records, pins and projects are not touched. A snapshot of the
// table is saved first, and every change is listed in DEVELOPER-LOGOS.csv.

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import pg from 'pg';
import sharp from 'sharp';

const APPLY = process.argv.includes('--apply'), REVERT = process.argv.includes('--revert');
const CACHE = path.resolve('migration/backup/scraped-enrichment-cache/dev-logos');
const OUT = path.resolve('seo-doc/enrichment/scraped-project-enrichment/DEVELOPER-LOGOS.csv');
const normDev = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const csv = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

const url = new URL(process.env.DATABASE_URL);
url.searchParams.delete('sslmode');
const db = new pg.Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false }, query_timeout: 120000 });
await db.connect();

if (REVERT) {
  const runs = readdirSync(CACHE).filter((f) => f.startsWith('applied-')).sort();
  if (!runs.length) throw new Error('Nothing to revert');
  const run = JSON.parse(readFileSync(path.join(CACHE, runs.at(-1)), 'utf8'));
  await db.query('BEGIN');
  await db.query(`DELETE FROM developers WHERE id = ANY($1)`, [run.created]);
  for (const u of run.updated) await db.query(`UPDATE developers SET doc = $2 WHERE id = $1`, [u.id, u.before]);
  await db.query('COMMIT');
  console.log(`Reverted ${runs.at(-1)}: ${run.created.length} entries removed, ${run.updated.length} restored`);
  await db.end();
  process.exit(0);
}

const all = (await db.query(`SELECT id, doc FROM developers`)).rows;
const byName = new Map(all.map((r) => [normDev(r.doc.name), r]));
const changes = []; // { id, name, action, aliases, site }
const now = new Date().toISOString();

// 1. aliases onto existing entries
const aliases = JSON.parse(readFileSync('migration/enrichment/scraped/dev-logo-aliases.json', 'utf8'));
for (const [name, list] of Object.entries(aliases)) {
  if (name.startsWith('_')) continue;
  const r = byName.get(normDev(name));
  if (!r?.doc.logo) throw new Error(`No developer entry with a logo named “${name}”`);
  const have = new Set((r.doc.aliases || []).map(normDev));
  const add = list.filter((a) => normDev(a) !== normDev(name) && !have.has(normDev(a)));
  if (!add.length) continue;
  r.doc = { ...r.doc, aliases: [...(r.doc.aliases || []), ...add], updated_at: now };
  changes.push({ id: r.id, name: r.doc.name, action: 'aliases added (existing logo)', aliases: add, site: '', doc: r.doc });
}

// 2. new entries from the developers' own sites
const accepted = existsSync(path.join(CACHE, 'accepted.json')) ? JSON.parse(readFileSync(path.join(CACHE, 'accepted.json'), 'utf8')) : [];
const brand = (s) => String(s).replace(/\bM\s*\/?\s*s\.?\s/gi, ' ').replace(/\b(pvt|private|ltd|limited|llp|\(india\)|india)\b\.?/gi, ' ')
  .replace(/[.,]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
for (const a of accepted) {
  let png = readFileSync(path.join(CACHE, a.logo));
  // A white logo (made for the site's dark header) goes on a dark tile, or it would vanish on a white card.
  if (a.white_only) {
    const m = await sharp(png).metadata(), pad = Math.round(Math.max(m.width, m.height) * 0.12);
    png = await sharp(png).extend({ top: pad, bottom: pad, left: pad, right: pad, background: '#1f2937' }).flatten({ background: '#1f2937' }).png().toBuffer();
  }
  const logo = 'data:image/png;base64,' + png.toString('base64');
  const name = a.name || brand(a.devs[0]);
  const existing = byName.get(normDev(name)) || a.devs.map((d) => byName.get(normDev(d))).find(Boolean);
  const names = a.devs.filter((d) => normDev(d) !== normDev(existing?.doc.name || name));
  if (existing) {
    if (existing.doc.logo) { console.warn(`skip ${a.host}: “${existing.doc.name}” already has a logo — add it to dev-logo-aliases.json if it is the same developer`); continue; }
    const have = new Set((existing.doc.aliases || []).map(normDev));
    existing.doc = { ...existing.doc, logo, aliases: [...(existing.doc.aliases || []), ...names.filter((d) => !have.has(normDev(d)))], updated_at: now };
    changes.push({ id: existing.id, name: existing.doc.name, action: 'logo added to existing entry', aliases: names, site: a.site, doc: existing.doc });
    continue;
  }
  const id = randomUUID();
  const doc = { id, name, logo, aliases: names, created_at: now, updated_at: now, source: { by: 'dev-logos-apply', site: a.site, logo_src: a.logo_src, at: now } };
  byName.set(normDev(name), { id, doc });
  changes.push({ id, name, action: 'new developer entry', aliases: names, site: a.site, doc, isNew: true });
}

console.log(`${changes.filter((c) => c.isNew).length} new entries, ${changes.filter((c) => !c.isNew).length} updated entries`);
const lines = ['developer_entry,action,promoter_names_matched,logo_from_site', ...changes.map((c) => [c.name, c.action, c.aliases.join(' | '), c.site].map(csv).join(','))];
if (!APPLY) { console.log(lines.slice(0, 15).join('\n')); console.log('Dry run — nothing written. Use --apply.'); await db.end(); process.exit(0); }

const before = new Map((await db.query(`SELECT id, doc FROM developers`)).rows.map((r) => [r.id, r.doc]));
writeFileSync(path.join(CACHE, `developers-before-${now.replace(/[:.]/g, '-')}.json`), JSON.stringify([...before].map(([id, doc]) => ({ id, doc }))));
writeFileSync(path.join(CACHE, `applied-${now.replace(/[:.]/g, '-')}.json`), JSON.stringify({
  created: changes.filter((c) => c.isNew).map((c) => c.id),
  updated: changes.filter((c) => !c.isNew).map((c) => ({ id: c.id, before: before.get(c.id) })),
}));
await db.query('BEGIN');
for (const c of changes) {
  if (c.isNew) await db.query(`INSERT INTO developers (id, doc) VALUES ($1, $2)`, [c.id, c.doc]);
  else await db.query(`UPDATE developers SET doc = $2 WHERE id = $1`, [c.id, c.doc]);
}
await db.query('COMMIT');
writeFileSync(OUT, lines.join('\n') + '\n');
console.log(`Saved. Log: ${path.relative(process.cwd(), OUT)}`);
await db.end();
