// Deletes today's (31 Oct 2026) same-name duplicate intake projects, the way the admin Delete does:
// Recycle bin entry first (submission + events + project + pin), pin history snapshot, then delete.
// Dry run by default; --apply to delete. Restore from Backups → Recycle bin.
import pg from 'pg'; import fs from 'fs'; import { randomUUID } from 'crypto';
const url = fs.readFileSync('.env','utf8').match(/^DATABASE_URL=["']?([^"'\r\n]+)/m)[1];
const c = new pg.Client({ connectionString: url }); await c.connect();
const NUMS = [991,992,998,1000,1003,1004,1008,1010,1011,1012,1013,1015,1017,1019,1020,1021,1025];
const pins = (await c.query(`SELECT id, doc FROM pins WHERE (doc->>'number')::int = ANY($1::int[]) AND doc->>'hidden_reason'='dedupe-same-name-2026-10-31'`, [NUMS])).rows;
const plan = [];
for (const p of pins) {
  const d = p.doc, kept = (await c.query(`SELECT doc FROM pins WHERE id=$1`, [d.duplicate_of])).rows[0]?.doc;
  if (!kept || kept.title !== d.title && !(d.number===1017)) throw new Error('keeper check failed for #'+d.number);
  const pid = d.intake_project_id;
  const project = pid ? (await c.query(`SELECT id, doc FROM projects WHERE id=$1`, [pid])).rows[0] : null;
  const subs = pid ? (await c.query(`SELECT id, doc FROM project_submissions WHERE doc->>'published_project_id'=$1`, [pid])).rows : [];
  const events = subs.length ? (await c.query(`SELECT id, doc FROM submission_events WHERE doc->>'submission_id' = ANY($1::text[])`, [subs.map(s=>s.id)])).rows : [];
  const scraped = (await c.query(`SELECT id FROM scraped_projects WHERE doc->>'submission_id' = ANY($1::text[])`, [subs.map(s=>s.id)])).rows;
  plan.push({ p, project, subs, events, scraped, keptNo: kept.number });
  console.log(`#${d.number} ${d.title} (rera ${d.rera_number}) → keep #${kept.number} | project=${!!project} subs=${subs.length} events=${events.length} scrapedLinks=${scraped.length}`);
}
console.log('to delete', plan.length, 'of', NUMS.length);
if (!process.argv.includes('--apply')) { await c.end(); process.exit(); }
const full = (r) => ({ ...r.doc, _id: r.id });
fs.writeFileSync('migration/backup/delete-today-same-name-dups-2026-10-31.json', JSON.stringify(plan.map(x => ({ pin: full(x.p), project: x.project && full(x.project), subs: x.subs.map(full), events: x.events.map(full), scraped: x.scraped })), null, 1));
const now = new Date().toISOString();
await c.query('BEGIN');
for (const x of plan) {
  const d = x.p.doc, s = x.subs[0]?.doc || {};
  const tid = randomUUID();
  const docs = [ ...x.subs.map(r => ({ collection: 'project_submissions', doc: full(r) })), ...x.events.map(r => ({ collection: 'submission_events', doc: full(r) })),
    ...(x.project ? [{ collection: 'projects', doc: full(x.project) }] : []), { collection: 'pins', doc: full(x.p) } ];
  await c.query(`INSERT INTO trash (id, doc) VALUES ($1, $2)`, [tid, { id: tid, kind: 'intake_project', label: s.project_name || d.title,
    sub: [s.ref_code, `Duplicate of pin #${x.keptNo}`, d.location].filter(Boolean).join(' · '), docs, deleted_at: now, deleted_by: 'dedupe-2026-10-31' }]);
  const hid = randomUUID();
  await c.query(`INSERT INTO pins_history (id, doc) VALUES ($1, $2)`, [hid, { id: hid, history_id: randomUUID(), pin_id: x.p.id, operation: 'delete', row_data: x.p.doc, changed_at: now }]);
  if (x.events.length) await c.query(`DELETE FROM submission_events WHERE id = ANY($1::text[])`, [x.events.map(r=>r.id)]);
  if (x.subs.length) await c.query(`DELETE FROM project_submissions WHERE id = ANY($1::text[])`, [x.subs.map(r=>r.id)]);
  if (x.project) await c.query(`DELETE FROM projects WHERE id=$1`, [x.project.id]);
  await c.query(`DELETE FROM pins WHERE id=$1`, [x.p.id]);
}
await c.query('COMMIT');
const left = await c.query(`SELECT count(*) FROM pins WHERE (doc->>'number')::int = ANY($1::int[])`, [NUMS]);
console.log('deleted', plan.length, '| pins left with those numbers:', left.rows[0].count); await c.end();
