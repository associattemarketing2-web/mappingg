// Hand-checked moves of live scraped pins (each decided on Google Maps + the RERA address; reasons below), with the same
// backup / log as live-pin-check.mjs, so `live-pin-check.mjs --revert` puts the last batch back.
//   node --env-file=.env migration/enrichment/scraped/live-pin-manual.mjs [--apply]
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const APPLY = process.argv.includes('--apply');
const RUN = new Date().toISOString();
const BK = path.resolve('migration/backup/live-pin-check'); mkdirSync(BK, { recursive: true });
const LOG = path.resolve('seo-doc/enrichment/scraped-project-enrichment/PROJECT-CHANGE-LOG.csv');
// First batch (18 Oct 2026, already applied); a later batch is passed as --moves <file.json> in the same shape.
const FIRST = [
  { num: 611, lat: 28.44638, lng: 77.51798, why: 'Google Maps "CGEWHO P4" (CGEWHO Plot No 7, P-4, Phi II) = RERA address "Plot No. 07, Sector P-4"; pin was 320 m away' },
  { num: 289, lat: 19.00345, lng: 72.85332, why: 'RERA address is Dnyaneshwar Nagar, Parel-Sewri; pin was in Kurla East (~7 km). Moved to the project\'s on-site sales office on DG Mahajani Rd, Dnyaneshwar Nagar, Sewri (Google Maps)' },
  { num: 729, lat: 18.62995, lng: 73.71527, why: 'Google Maps "Echoes, Life Republic by Kolte Patil" (pincode 411033 = record); pin was 1.5 km away' },
  { num: 773, ref: 921, why: 'Same project as pins #920/#921 (Lodha Azur), which are on the Google Maps place "Lodha Azur"; this phase was 1.4 km away' },
];
const MOVES = process.argv.includes('--moves') ? JSON.parse(readFileSync(process.argv[process.argv.indexOf('--moves') + 1], 'utf8')) : FIRST;

const url = new URL(process.env.DATABASE_URL); url.searchParams.delete('sslmode');
const db = new pg.Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } });
await db.connect();
const row = async (num) => (await db.query(`SELECT s.id sid, s.doc->'data' d, p.id pid, p.doc->>'lat' plat, p.doc->>'lng' plng, pn.id pin_id, (pn.doc->>'lat')::float lat, (pn.doc->>'lng')::float lng, pn.doc->>'title' title
  FROM scraped_projects s JOIN project_submissions sub ON sub.id = s.doc->>'submission_id' JOIN projects p ON p.id = sub.doc->>'published_project_id'
  JOIN pins pn ON pn.id = p.doc->>'pin_id' WHERE pn.doc->>'number' = $1 AND pn.doc->>'source' = 'intake'`, [String(num)])).rows[0];
const plan = [];
for (const m of MOVES) {
  const r = await row(m.num);
  if (!r) { console.log(`#${m.num}: not a live scraped-data pin - skipped`); continue; }
  const to = m.ref ? await row(m.ref) : null;
  const lat = to ? to.lat : m.lat, lng = to ? to.lng : m.lng;
  plan.push({ r, lat, lng, why: m.why });
  console.log(`#${m.num} ${r.title}: ${r.lat},${r.lng} → ${lat},${lng}`);
}
if (!APPLY) { console.log('Dry run.'); await db.end(); process.exit(0); }
writeFileSync(path.join(BK, `before-${RUN.replace(/[:.]/g, '-')}.json`), JSON.stringify(plan.map(({ r }) => ({ sid: r.sid, pid: r.pid, pin_id: r.pin_id, pin: { lat: r.lat, lng: r.lng }, project: { lat: r.plat, lng: r.plng }, data: r.d }))));
const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
for (const { r, lat, lng, why } of plan) {
  await db.query('BEGIN');
  await db.query(`UPDATE pins SET doc = doc || jsonb_build_object('lat', $2::float, 'lng', $3::float, 'updated_at', $4::text) WHERE id = $1`, [r.pin_id, lat, lng, RUN]);
  await db.query(`UPDATE projects SET doc = doc || jsonb_build_object('lat', $2::float, 'lng', $3::float) WHERE id = $1`, [r.pid, lat, lng]);
  await db.query(`UPDATE scraped_projects SET doc = doc || jsonb_build_object('data', $2::jsonb, 'live_pin_check', $3::jsonb) WHERE id = $1`,
    [r.sid, JSON.stringify({ ...r.d, lat, lng, pin_check: 'verified', pin_reason: why }), JSON.stringify({ moved_at: RUN, from: { lat: r.lat, lng: r.lng }, to: { lat, lng }, manual: why })]);
  await db.query('COMMIT');
  appendFileSync(LOG, [r.sid, r.d.project_name, 'pin.lat,lng (live map)', `${r.lat},${r.lng}`, `${lat},${lng}`, why, 'checked_by_hand_google_maps', 'high', RUN, 'saved'].map(q).join(',') + '\n');
}
console.log(`Moved ${plan.length} pins.`);
await db.end();
