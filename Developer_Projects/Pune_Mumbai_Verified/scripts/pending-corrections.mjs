// Corrections to the Pune/Mumbai developer-website records found in the 18 Oct audit. DRY RUN unless --apply
// (needs the owner's approval: production write). --revert undoes the last --apply.
//   1. Shared possession dates: a page with several RERA numbers that gives ONE project-level date without naming each
//      registration -> the date is not confirmed per registration. Moved out of `proposed_completion` into
//      `project_level_possession` (kept as evidence), so the record cannot go live on it.
//   2. Pins confirmed by two official sources: the MahaRERA point lies within 0.25 km of the map point on the
//      developer's own project page -> pin_check "verified" with that reason (point itself unchanged).
//   3. Already on the live map: Mahindra Rivenza = pin #198 (no RERA no. on the pin, so "Add to Projects" would not catch
//      the duplicate) -> review_required note, which keeps both phases out of "Check & go live".
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNS = path.join(ROOT, 'cache', 'correction-runs'); mkdirSync(RUNS, { recursive: true });
const APPLY = process.argv.includes('--apply'), REVERT = process.argv.includes('--revert'), RUN = new Date().toISOString();
const url = new URL(process.env.DATABASE_URL); url.searchParams.delete('sslmode');
const db = new pg.Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } }); await db.connect();

if (REVERT) {
  const f = readdirSync(RUNS).filter((x) => x.startsWith('applied-')).sort().at(-1); if (!f) throw new Error('Nothing to revert');
  const run = JSON.parse(readFileSync(path.join(RUNS, f), 'utf8'));
  await db.query('BEGIN'); for (const u of run) await db.query('UPDATE scraped_projects SET doc = $2 WHERE id = $1', [u.id, u.before]); await db.query('COMMIT');
  console.log(`Reverted ${f}: ${run.length} rows`); await db.end(); process.exit(0);
}

const pages = new Map(); for (const f of readdirSync(path.join(ROOT, 'cache', 'pages'))) { const c = JSON.parse(readFileSync(path.join(ROOT, 'cache', 'pages', f), 'utf8')); pages.set(c.url, c.html); }
const vis = (h) => h.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const km = (a, b, c, d) => 6371 * Math.hypot(((d - b) * Math.PI / 180) * Math.cos(((a + c) / 2) * Math.PI / 180), (c - a) * Math.PI / 180);
const LIVE = { PR1261012602102: 'pin #198 "Mahindra Rivenza"', PM1261012602103: 'pin #198 "Mahindra Rivenza"' };

const rows = (await db.query(`SELECT id, doc FROM scraped_projects WHERE doc->'enrichment'->>'enriched_by' = 'pune-mumbai devsite-apply'`)).rows;
const changes = [];
for (const { id, doc } of rows) {
  const d = doc.data, e = doc.enrichment, f = e.fields, html = pages.get(f.developer_project_page) || '', notes = [];
  const next = JSON.parse(JSON.stringify(doc));
  const regs = String(f.rera_numbers_on_page || '').split(', ').filter(Boolean);
  if (f.proposed_completion && regs.length > 1) {
    const t = vis(html), yy = f.proposed_completion.slice(0, 4), y = f.proposed_completion.slice(2, 4);
    const perReg = new RegExp(`${d.rera_number}[^.]{0,60}(valid|upto|up to|completion|possession)[^.]{0,30}(${yy}|/${y})`, 'i').test(t);
    if (!perReg) {
      next.enrichment.fields.project_level_possession = f.proposed_completion;
      delete next.enrichment.fields.proposed_completion;
      next.enrichment.fields.possession_note = `The developer page gives one possession date for ${regs.length} registrations without naming ${d.rera_number}; not confirmed for this registration.`;
      notes.push(`date ${f.proposed_completion} -> project_level_possession`);
    }
  }
  if (!['verified', 'manual'].includes(d.pin_check) && d.lat != null) {
    const pts = [...html.matchAll(/!2d(7[2-4]\.\d+)!3d(1[89]\.\d+)/g)].map((m) => [Number(m[2]), Number(m[1])]);
    const near = pts.map(([la, ln]) => km(d.lat, d.lng, la, ln)).sort((a, b) => a - b)[0];
    if (near != null && near <= 0.25) {
      next.data.pin_check = 'verified';
      next.data.pin_reason = `Official MahaRERA point (declared by the promoter) is ${near.toFixed(2)} km from the map point on the developer's own project page (${f.developer_project_page}); two official sources agree. Checked ${RUN.slice(0, 10)}.`;
      next.data.pin_previous = { pin_check: d.pin_check, pin_reason: d.pin_reason };
      notes.push(`pin ${d.pin_check} -> verified (${near.toFixed(2)} km)`);
    }
  }
  if (LIVE[d.rera_number] && !(e.review_required || []).some((r) => r.field === 'already_on_map')) {
    next.enrichment.review_required = [...(e.review_required || []), { field: 'already_on_map', current: LIVE[d.rera_number], registry: d.rera_number, note: 'Project is already live; the pin has no RERA no., so Add to Projects would not detect the duplicate.' }];
    notes.push(`already live as ${LIVE[d.rera_number]} -> review_required`);
  }
  if (notes.length) changes.push({ id, rera: d.rera_number, project: d.project_name, notes: notes.join('; '), before: doc, after: next });
}
console.table(changes.map((c) => ({ rera: c.rera, project: c.project.slice(0, 34), change: c.notes })));
writeFileSync(path.join(ROOT, `pending-corrections-${RUN.slice(0, 10)}.json`), JSON.stringify(changes.map(({ before, after, ...c }) => c), null, 1));
if (!APPLY) { console.log(`Dry run - ${changes.length} rows would change. Nothing written.`); await db.end(); process.exit(0); }
writeFileSync(path.join(RUNS, `applied-${RUN.replace(/[:.]/g, '-')}.json`), JSON.stringify(changes.map((c) => ({ id: c.id, before: c.before }))));
await db.query('BEGIN'); for (const c of changes) await db.query('UPDATE scraped_projects SET doc = $2 WHERE id = $1', [c.id, c.after]); await db.query('COMMIT');
console.log(`Saved ${changes.length} rows. Revert with --revert.`); await db.end();
