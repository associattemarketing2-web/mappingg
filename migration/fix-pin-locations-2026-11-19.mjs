// One-off (19 Nov 2026): move live pins that sit away from their project's actual site.
// Each move was checked by hand: the Google Maps place carries the project's own name and its address agrees with
// the address on record, while the stored point is in a different area.
//
//   node --env-file=.env migration/fix-pin-locations-2026-11-19.mjs          (dry run)
//   node --env-file=.env migration/fix-pin-locations-2026-11-19.mjs --apply  (backup, write)
//   node --env-file=.env migration/fix-pin-locations-2026-11-19.mjs --revert=<backup dir>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pg = require('pg');

const MOVES = [
  { id: 'ade1128e-9bfe-466a-89bb-41d9e2050539', title: 'Lodha Casa Premier', lat: 19.1799378, lng: 73.0973396, why: 'Google Maps place "Lodha Casa Premier" (Lodha Premier, Kalyan-Shil Road, Dombivli E) — matches the address on record; old point was ~10 km south' },
  { id: '188d1988-6fa0-4536-9936-131748bc45dd', title: 'Lodha Casa Belvedere', lat: 19.1785528, lng: 73.0979788, why: 'Google Maps places "CASA Belvedere F/G/L, Lodha Premier" (Premier Colony, Kalyan-Shil Road) — matches the address on record; old point was ~10 km south' },
  { id: '698b1b93-1d61-4fec-ad1e-bd3a227b7fc0', title: 'Codename BEWISE', lat: 18.479957, lng: 73.9620931, why: 'Google Maps place "Codename BeWise" in Fursungi; old point was ~2.5 km away in Hadapsar' },
  { id: '4fd0e544-2ba5-42b4-a080-b8b114b40403', title: 'Platinum Classic', lat: 19.1245186, lng: 72.8327352, why: 'Google Maps place "Platinum Classic" (Building No.14, Link Rd, D.N. Nagar, Andheri West 400053); old point was ~650 m away' },
  { id: '3c7f6535-9866-475d-ab6d-7117edfd0575', title: 'KOHINOOR REGALIA TOWERS', lat: 18.6090533, lng: 73.7461365, why: 'Google Maps place "Kohinoor Regalia Towers" (Shani Mandir Rd, Wakad); old point was the Kohinoor Avantara experience centre ~640 m away' },
];

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/, ''), ssl: { rejectUnauthorized: false }, max: 2 });
const q = (s, p) => pool.query(s, p);
const revert = process.argv.find((a) => a.startsWith('--revert='))?.slice(9);
if (revert) {
  const b = JSON.parse(readFileSync(path.join(revert, 'before.json'), 'utf8'));
  for (const p of b.pins) await q(`UPDATE pins SET doc = doc || $2::jsonb WHERE id = $1`, [p.id, JSON.stringify({ lat: p.lat, lng: p.lng })]);
  for (const p of b.projects) await q(`UPDATE projects SET doc = doc || $2::jsonb WHERE id = $1`, [p.id, JSON.stringify({ lat: p.lat, lng: p.lng, additional_details: p.additional_details })]);
  console.log('reverted', b.pins.length); await pool.end(); process.exit(0);
}
const { rows } = await q(`SELECT p.doc - 'image' - 'brochure_image' pin, pr.doc proj FROM pins p LEFT JOIN projects pr ON pr.id = p.doc->>'intake_project_id' WHERE p.doc->>'id' = ANY($1)`, [MOVES.map((m) => m.id)]);
const plans = [];
for (const m of MOVES) {
  const r = rows.find((x) => x.pin.id === m.id);
  if (!r || r.pin.title !== m.title) { console.log('skip', m.title, 'pin missing or renamed'); continue; }
  plans.push({ m, ...r });
  console.log(`#${r.pin.number} ${m.title}: ${r.pin.lat},${r.pin.lng} → ${m.lat},${m.lng}`);
}
if (!process.argv.includes('--apply')) { console.log('Dry run.'); await pool.end(); process.exit(0); }
const dir = path.resolve(`migration/backup/pg-snapshot-${new Date().toISOString().replace(/[:.]/g, '-')}-before-pin-location-fix`);
mkdirSync(dir, { recursive: true });
writeFileSync(path.join(dir, 'before.json'), JSON.stringify({ pins: plans.map((p) => p.pin), projects: plans.map((p) => p.proj).filter(Boolean) }, null, 1));
const now = new Date().toISOString(); const day = now.slice(0, 10);
for (const { m, pin, proj } of plans) {
  await q(`UPDATE pins SET doc = doc || $2::jsonb WHERE id = $1`, [pin.id, JSON.stringify({ lat: m.lat, lng: m.lng, updated_at: now })]);
  if (proj) {
    const det = [...(proj.additional_details || []), { label: 'Location corrected', value: `${day}: moved from ${pin.lat},${pin.lng} to ${m.lat},${m.lng}. ${m.why}.` }];
    await q(`UPDATE projects SET doc = doc || $2::jsonb WHERE id = $1`, [proj.id, JSON.stringify({ lat: m.lat, lng: m.lng, additional_details: det, updated_at: now })]);
  }
}
console.log(`moved ${plans.length}; backup → ${path.relative(process.cwd(), dir)}`);
await pool.end();
