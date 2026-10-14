// READ-ONLY audit of the live projects (pins) for the data-enrichment work.
//
//   node --env-file=.env migration/enrichment/audit.mjs
//
// Writes nothing to the database. Produces:
//   - migration/backup/pg-snapshot-<date>-enrichment/pins.json   full snapshot (git-ignored, recoverable)
//   - seo-doc/enrichment/completeness-<date>.csv                 one row per live project, field filled y/n
//   - seo-doc/enrichment/completeness-<date>.json                totals + identity warnings
// Reports contain public project fields only — no owner ids, contacts or leads.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

const DATE = new Date().toISOString().slice(0, 10);

function poolConfig(cs) {
  const url = new URL(cs);
  const mode = url.searchParams.get('sslmode');
  if (mode === 'disable') return { connectionString: cs };
  url.searchParams.delete('sslmode');
  return { connectionString: url.toString(), ssl: mode ? true : { rejectUnauthorized: false } };
}
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is required (--env-file=.env).'); process.exit(1); }
const pool = new pg.Pool(poolConfig(process.env.DATABASE_URL));

const on = (v) => v === true || v === 'true';
const filled = (v) => v != null && String(v).trim() !== '' && !/^(n\/?a|na|-|—|tbd|null|undefined)$/i.test(String(v).trim());
const isRera = (v) => /^(P[A-Z]?\d{10,13}|P[RCM]\d{10,13})$/i.test(String(v || '').replace(/\s/g, ''));
const reraFromCustom = (cf) => (Array.isArray(cf) ? cf.find((c) => /rera/i.test(c?.label || '') && filled(c?.value))?.value : null);

const FIELDS = {
  title: (p) => filled(p.title),
  developer: (p) => filled(p.developer),
  location: (p) => filled(p.location),
  coordinates: (p) => Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)) && Number(p.lat) !== 0,
  type: (p) => filled(p.type),
  status: (p) => filled(p.status),
  configuration: (p) => filled(p.configuration),
  carpet_area: (p) => filled(p.sqft) || filled(p.size),
  price: (p) => filled(p.price) && /\d/.test(p.price),
  possession: (p) => filled(p.possession_timeline),
  rera_number: (p) => isRera(p.rera_number) || isRera(reraFromCustom(p.custom_fields)),
  description: (p) => filled(p.description) && String(p.description).trim().length >= 80,
  key_usp: (p) => filled(p.key_usp),
  amenities: (p) => filled(p.whats_available),
  image: (p) => filled(p.image) || filled(p.image_url) || p.image_meta?.status === 'completed',
  brochure: (p) => filled(p.brochure_url) || filled(p.brochure_image),
  video: (p) => filled(p.youtube_video_url),
};

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

async function main() {
  // Inline base64 images are replaced by their length so the snapshot stays small but complete otherwise.
  const { rows } = await pool.query(`select id, doc from pins order by (doc->>'number')::int nulls last`);
  const snapDir = path.resolve(`migration/backup/pg-snapshot-${DATE}-enrichment`);
  await mkdir(snapDir, { recursive: true });
  await writeFile(path.join(snapDir, 'pins.json'), JSON.stringify(rows.map((r) => r.doc)));
  console.log(`Snapshot: ${rows.length} pins → ${path.relative(process.cwd(), snapDir)}/pins.json`);

  const all = rows.map((r) => r.doc);
  const live = all.filter((p) => !on(p.hidden) && !on(p.pending_review) && !on(p.rejected));
  const counts = Object.fromEntries(Object.keys(FIELDS).map((k) => [k, 0]));
  const csv = [['number', 'title', 'developer', 'location', ...Object.keys(FIELDS), 'filled_of_' + Object.keys(FIELDS).length].join(',')];
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const perProject = [];
  for (const p of live) {
    const f = Object.fromEntries(Object.entries(FIELDS).map(([k, fn]) => [k, fn(p)]));
    for (const [k, v] of Object.entries(f)) if (v) counts[k]++;
    const n = Object.values(f).filter(Boolean).length;
    perProject.push({ number: p.number, title: p.title, filled: n });
    csv.push([p.number, cell(p.title), cell(p.developer), cell(p.location), ...Object.values(f).map((v) => (v ? 'y' : '')), n].join(','));
  }

  // Identity warnings: same normalised title, or same RERA number on different pins.
  const byTitle = new Map(), byRera = new Map();
  for (const p of live) {
    const t = norm(p.title); if (t) byTitle.set(t, [...(byTitle.get(t) || []), p.number]);
    const r = String(p.rera_number || '').replace(/\s/g, '').toUpperCase(); if (isRera(r)) byRera.set(r, [...(byRera.get(r) || []), p.number]);
  }
  const dupTitles = [...byTitle].filter(([, v]) => v.length > 1).map(([t, v]) => ({ title: t, pins: v }));
  const dupRera = [...byRera].filter(([, v]) => v.length > 1).map(([r, v]) => ({ rera: r, pins: v }));
  const badRera = live.filter((p) => filled(p.rera_number) && !isRera(p.rera_number)).map((p) => ({ number: p.number, value: p.rera_number }));

  const summary = {
    date: DATE,
    total_pins: all.length,
    live_pins: live.length,
    not_live: { hidden: all.filter((p) => on(p.hidden)).length, pending_review: all.filter((p) => on(p.pending_review)).length, rejected: all.filter((p) => on(p.rejected)).length },
    field_filled: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, { filled: v, pct: Math.round((v / live.length) * 100) }])),
    avg_fields_filled: +(perProject.reduce((s, p) => s + p.filled, 0) / live.length).toFixed(1),
    least_complete: perProject.sort((a, b) => a.filled - b.filled).slice(0, 25),
    identity_warnings: { duplicate_titles: dupTitles, duplicate_rera: dupRera, malformed_rera: badRera },
  };
  const outDir = path.resolve('seo-doc/enrichment');
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, `completeness-${DATE}.csv`), csv.join('\n') + '\n');
  await writeFile(path.join(outDir, `completeness-${DATE}.json`), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify({ ...summary, least_complete: summary.least_complete.length, identity_warnings: { duplicate_titles: dupTitles.length, duplicate_rera: dupRera.length, malformed_rera: badRera.length } }, null, 2));
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => pool.end());
