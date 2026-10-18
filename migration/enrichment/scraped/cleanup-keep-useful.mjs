// Scraped data clean-up (owner's decision, 18 Oct 2026): keep only records that are useful now -
//   - complete and clean ("Added data - Check & go live", original registry rule), or
//   - already added to Projects (has a submission);
// every other record is soft-deleted exactly like the admin's Delete button (deleted: true + deleted_at): it leaves
// all lists, shows in the Deleted tab, is never brought back by a re-import, and can be restored.
//   node --env-file=.env migration/enrichment/scraped/cleanup-keep-useful.mjs            dry run
//   node --env-file=.env migration/enrichment/scraped/cleanup-keep-useful.mjs --apply
//   node --env-file=.env migration/enrichment/scraped/cleanup-keep-useful.mjs --revert   restore exactly the rows of the last run
import { createJiti } from 'jiti';
import { writeFileSync, readFileSync, readdirSync, mkdirSync } from 'node:fs';
import path from 'node:path';
const STUB = process.env.REACT_STUB; // lib/developers pulls react.cache (server-only); a pass-through stub is enough here
const jiti = createJiti(process.cwd() + '/', { alias: { '@': process.cwd(), ...(STUB ? { react: STUB } : {}) } });
const { listScraped, isDevSiteFacts } = await jiti.import('./lib/scraped.ts');
const { query } = await jiti.import('./lib/pg.ts');
const DIR = path.resolve('migration/backup/scraped-cleanup'); mkdirSync(DIR, { recursive: true });
const RUN = new Date().toISOString(), LABEL = `cleanup-${RUN.slice(0, 10)}`;
const APPLY = process.argv.includes('--apply'), REVERT = process.argv.includes('--revert');

if (REVERT) {
  const f = readdirSync(DIR).filter((x) => x.startsWith('deleted-ids-')).sort().at(-1); if (!f) throw new Error('Nothing to revert');
  const ids = JSON.parse(readFileSync(path.join(DIR, f), 'utf8')).map((x) => x.id);
  const r = await query(`UPDATE scraped_projects SET doc = (doc - 'deleted_reason' - 'deleted_by') || jsonb_build_object('deleted', false, 'deleted_at', null) WHERE id = ANY($1::text[]) AND doc->>'deleted_by' LIKE 'cleanup-%'`, [ids]);
  console.log(`Restored ${r.rowCount} rows from ${f}`); process.exit(0);
}

const { rows } = await listScraped();
const live = rows.filter((r) => !r.deleted);
// "Check & go live" under the ORIGINAL rule (the rule live on mappingg.com): developer-website MahaRERA rows do not count.
const ready = (r) => Array.isArray(r.ready_gaps) && !r.ready_gaps.length && !(r.regulator_dev_site);
const devSite = new Set((await query(`SELECT id FROM scraped_projects WHERE doc->'enrichment'->>'source_type' = 'developer_official_site'`)).rows.map((x) => x.id));
const keep = (r) => (Array.isArray(r.ready_gaps) && !r.ready_gaps.length && !devSite.has(r.id)) || !!r.submission_id;
const reason = (r) => {
  const w = [];
  if (!r.rera_number) w.push('no RERA number');
  if (r.pin_check === 'mismatch') w.push('pin in the wrong place'); else if (r.pin_check === 'no_coordinates' || r.lat == null) w.push('no location');
  else if (!['verified', 'manual'].includes(r.pin_check)) w.push(`location ${r.pin_check}`);
  if (/Lapsed|Withdrawn|Revoked|Transferred|Superseded|Dereg|Abeyance/i.test(r.status_category || '')) w.push(`registration ${r.status_category}`);
  if (!r.logo) w.push('no developer logo');
  w.push(r.ready_gaps ? `not complete: ${r.ready_gaps.join(', ')}` : 'not enriched (registry details missing)');
  return w.join('; ');
};
const del = live.filter((r) => !keep(r)).map((r) => ({ id: r.id, city: r.city, rera_number: r.rera_number, project_name: r.project_name, developer_name: r.developer_name, reason: reason(r) }));
const kept = live.filter(keep);
const by = (list) => list.reduce((a, r) => ((a[r.city] = (a[r.city] || 0) + 1), a), {});
console.log({ records: live.length, keep: kept.length, keep_go_live: kept.filter((r) => !r.submission_id).length, keep_in_projects: kept.filter((r) => r.submission_id).length, delete: del.length });
console.log('keep by city', by(kept)); console.log('delete by city', by(del));
if (!APPLY) { console.log('Dry run - nothing changed.'); process.exit(0); }
writeFileSync(path.join(DIR, `deleted-ids-${RUN.replace(/[:.]/g, '-')}.json`), JSON.stringify(del));
let n = 0;
for (let i = 0; i < del.length; i += 500) {
  const chunk = del.slice(i, i + 500);
  const r = await query(`UPDATE scraped_projects s SET doc = s.doc || jsonb_build_object('deleted', true, 'deleted_at', $2::text, 'deleted_by', $3::text, 'deleted_reason', x.reason)
    FROM jsonb_to_recordset($1::jsonb) AS x(id text, reason text) WHERE s.id = x.id AND NOT coalesce((s.doc->>'deleted')::boolean, false) AND s.doc->>'submission_id' IS NULL`,
    [JSON.stringify(chunk.map(({ id, reason }) => ({ id, reason }))), RUN, LABEL]);
  n += r.rowCount;
}
console.log(`Moved ${n} rows to the Deleted tab. Undo with --revert.`);
process.exit(0);
