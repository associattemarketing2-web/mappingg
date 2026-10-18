// Scraped data clean-up (owner's decision, 18 Oct 2026): every record must have a verified map location, an address
// and a developer logo. After the Google Maps / OpenStreetMap / logo passes (google-locate.mjs, osm-address.mjs,
// dev-logos-*), records still missing any of the three are soft-deleted exactly like the admin's Delete button
// (deleted: true + deleted_at): they leave all lists, show in the Deleted tab, are never brought back by a re-import,
// and can be restored. Records already added to Projects (submission) are never deleted here.
//   node --env-file=.env migration/enrichment/scraped/cleanup-incomplete-location.mjs            dry run
//   node --env-file=.env migration/enrichment/scraped/cleanup-incomplete-location.mjs --apply
//   node --env-file=.env migration/enrichment/scraped/cleanup-keep-useful.mjs --revert          restores the last run
import { createJiti } from 'jiti';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
const STUB = process.env.REACT_STUB; // lib/developers pulls react.cache (server-only); a pass-through stub is enough here
const jiti = createJiti(process.cwd() + '/', { alias: { '@': process.cwd(), ...(STUB ? { react: STUB } : {}) } });
const { listScraped, PIN_OK } = await jiti.import('./lib/scraped.ts');
const { query } = await jiti.import('./lib/pg.ts');
const DIR = path.resolve('migration/backup/scraped-cleanup'); mkdirSync(DIR, { recursive: true });
const RUN = new Date().toISOString(), LABEL = `cleanup-location-${RUN.slice(0, 10)}`;
const APPLY = process.argv.includes('--apply');

const { rows } = await listScraped();
const addr = new Set((await query(`SELECT id FROM scraped_projects WHERE coalesce(doc->'data'->>'address', '') <> '' OR coalesce(doc->'enrichment'->'fields'->>'full_address', '') <> ''`)).rows.map((x) => x.id));
const live = rows.filter((r) => !r.deleted);
const gaps = (r) => [!addr.has(r.id) && 'no address', !PIN_OK.has(r.pin_check) && 'location not verified', !r.logo && 'no developer logo'].filter(Boolean);
const del = live.filter((r) => !r.submission_id && gaps(r).length)
  .map((r) => ({ id: r.id, city: r.city, rera_number: r.rera_number, project_name: r.project_name, developer_name: r.developer_name, reason: gaps(r).join('; ') }));
const keptIncomplete = live.filter((r) => r.submission_id && gaps(r).length);
const by = (list, k) => list.reduce((a, r) => ((a[r[k]] = (a[r[k]] || 0) + 1), a), {});
console.log({ records: live.length, delete: del.length, keep: live.length - del.length, kept_incomplete_in_projects: keptIncomplete.length });
console.log('delete by reason', by(del, 'reason'));
const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
writeFileSync(path.resolve('seo-doc/enrichment/scraped-project-enrichment/DELETED-INCOMPLETE-LOCATION.csv'),
  ['record_id,city,rera_number,project_name,developer_name,reason', ...del.map((r) => [r.id, r.city, r.rera_number, r.project_name, r.developer_name, r.reason].map(q).join(','))].join('\n') + '\n');
if (!APPLY) { console.log('Dry run - nothing changed.'); process.exit(0); }
writeFileSync(path.join(DIR, `deleted-ids-${RUN.replace(/[:.]/g, '-')}.json`), JSON.stringify(del));
const r = await query(`UPDATE scraped_projects s SET doc = s.doc || jsonb_build_object('deleted', true, 'deleted_at', $2::text, 'deleted_by', $3::text, 'deleted_reason', x.reason)
  FROM jsonb_to_recordset($1::jsonb) AS x(id text, reason text) WHERE s.id = x.id AND NOT coalesce((s.doc->>'deleted')::boolean, false) AND s.doc->>'submission_id' IS NULL`,
  [JSON.stringify(del.map(({ id, reason }) => ({ id, reason }))), RUN, LABEL]);
console.log(`Moved ${r.rowCount} rows to the Deleted tab. Undo with cleanup-keep-useful.mjs --revert.`);
process.exit(0);
