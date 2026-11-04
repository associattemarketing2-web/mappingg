// READ-ONLY: how many projects each city / locality BHK and budget page would list.
//   node --experimental-transform-types --no-warnings --import ./tests/register.mjs scripts/seo-audit/facet-counts.mts
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { cityFrom, hasCityHub } from '../../lib/seo/city.ts';
import { nonProjectReason } from '../../lib/seo/project-filter.ts';
import { localitiesOf } from '../../lib/locality.ts';
import { FACETS, facetPins, MIN_FACET_PROJECTS } from '../../lib/seo/facets.ts';
const pg = createRequire(import.meta.url)('pg');
const raw = process.env.DATABASE_URL || readFileSync('.env', 'utf8').split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='))!.slice(13).replace(/^"|"$/g, '');
const u = new URL(raw); const ssl = u.searchParams.get('sslmode') !== 'disable'; u.searchParams.delete('sslmode');
const c = new pg.Client({ connectionString: u.toString(), ssl });
await c.connect();
await c.query('BEGIN READ ONLY');
const rows = (await c.query(`select doc - 'image' - 'brochure_image' - 'images' as d from pins where coalesce(doc->>'hidden','false') <> 'true'`)).rows.map((r: any) => r.d);
await c.query('ROLLBACK'); await c.end();
const pins = rows.filter((p: any) => !nonProjectReason(p));
const byCity = new Map<string, any[]>();
for (const p of pins) { const k = cityFrom(p.location, p.lat, p.lng); if (hasCityHub(k)) byCity.set(k, [...(byCity.get(k) || []), p]); }
const statuses = new Map<string, number>(); for (const p of pins) statuses.set(p.status, (statuses.get(p.status) || 0) + 1);
console.log('pins', pins.length, 'statuses', Object.fromEntries(statuses));
for (const [city, list] of byCity) {
  console.log(`\n${city} (${list.length}):`, FACETS.map((f) => `${f.slug}=${facetPins(list, f).length}`).join('  '));
  const locs = new Map<string, any[]>();
  for (const p of list) for (const l of localitiesOf(p.location)) locs.set(l, [...(locs.get(l) || []), p]);
  for (const [l, lp] of [...locs].sort((a, b) => b[1].length - a[1].length).slice(0, 12)) {
    const ok = FACETS.map((f) => [f.short, facetPins(lp, f).length] as const).filter(([, n]) => n >= MIN_FACET_PROJECTS);
    console.log(`  ${l} (${lp.length}):`, ok.map(([s, n]) => `${s}=${n}`).join(' '));
  }
}
