// One-off, idempotent update of the live channel-partner plans: Free is limited
// to one chosen city, Pro covers every city (Pro Max already does). New installs
// get this from DEFAULT_PLANS in lib/subscriptions/catalog.ts; existing
// databases keep admin-edited plans, so they need this patch.
// Taglines are only changed if they still read the old default text.
//
// Run:  node migration/patch-cp-city-limits.mjs          (dry run: shows the change)
//       node migration/patch-cp-city-limits.mjs --apply  (writes it)
import pg from 'pg'; import fs from 'fs';
const url = process.env.DATABASE_URL || fs.readFileSync('.env', 'utf8').match(/^DATABASE_URL=["']?([^"'\r\n]+)/m)[1];
const c = new pg.Client({ connectionString: url }); await c.connect();

const CHANGES = [
  { code: 'cp_free', cities: 1, oldTag: 'Browse projects — 3 project details a week', newTag: 'Browse projects — 3 project details a week in your city' },
  { code: 'cp_pro', cities: null, oldTag: '10 projects a week in your city, brochures & leads', newTag: '10 projects a week in every city, brochures & leads' },
];

const { rows } = await c.query(`SELECT code, name, tagline, limits->'cp_max_cities' AS cities FROM sub_plans WHERE code = ANY($1)`, [CHANGES.map((x) => x.code)]);
for (const ch of CHANGES) {
  const r = rows.find((x) => x.code === ch.code);
  if (!r) { console.log(`${ch.code}: not found — skipped`); continue; }
  const tag = r.tagline === ch.oldTag ? ch.newTag : r.tagline;
  console.log(`${ch.code} (${r.name}): cities ${r.cities === null ? 'all' : r.cities} → ${ch.cities === null ? 'all' : ch.cities}; tagline "${r.tagline}" → "${tag}"`);
  if (!process.argv.includes('--apply')) continue;
  await c.query(
    `UPDATE sub_plans SET limits = jsonb_set(limits, '{cp_max_cities}', $2::jsonb), tagline = $3, updated_at = now() WHERE code = $1`,
    [ch.code, JSON.stringify(ch.cities), tag],
  );
}
console.log(process.argv.includes('--apply') ? 'Applied.' : 'Dry run — add --apply to write.');
await c.end();
