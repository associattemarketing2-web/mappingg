import pg from 'pg'; import fs from 'fs';
const url = fs.readFileSync('.env','utf8').match(/^DATABASE_URL=["']?([^"'\r\n]+)/m)[1];
const c = new pg.Client({ connectionString: url }); await c.connect();
const TAG='dedupe-same-name-2026-10-31'; const SKIP=new Set(['hanginggardens','santiagosunrise']);
const backupFile='migration/backup/pins-before-'+TAG+'.json';
const cols = await c.query(`SELECT column_name FROM information_schema.columns WHERE table_name='pins'`); console.log('cols', cols.rows.map(r=>r.column_name).join(','));
if (process.argv.includes('--revert')) {
  const b = JSON.parse(fs.readFileSync(backupFile,'utf8'));
  for (const x of b.hidden) await c.query(`UPDATE pins SET doc = (doc - 'hidden_reason' - 'duplicate_of' - 'hidden_at') || jsonb_build_object('hidden', $2::boolean) WHERE id=$1`, [x.id, !!x.doc.hidden]);
  console.log('reverted', b.hidden.length); await c.end(); process.exit(); }
const norm = `lower(regexp_replace(coalesce(doc->>'title',''),'[^a-zA-Z0-9]+','','g'))`;
const r = await c.query(`SELECT id, doc, ${norm} k FROM pins WHERE NOT coalesce((doc->>'hidden')::boolean,false) AND ${norm}<>'' AND ${norm} IN (SELECT ${norm} FROM pins WHERE NOT coalesce((doc->>'hidden')::boolean,false) GROUP BY 1 HAVING count(*)>1) ORDER BY k,(doc->>'number')::int, doc->>'created_at'`);
const groups={}; for (const x of r.rows) (groups[x.k] ||= []).push(x);
const toHide=[]; for (const [k,g] of Object.entries(groups)) { if (SKIP.has(k)) continue; const [keep,...rest]=g; for (const x of rest) toHide.push({...x, keep}); }
console.log('will hide', toHide.length); for (const x of toHide) console.log(`  hide #${x.doc.number} (${x.doc.title}, rera ${x.doc.rera_number}) → keep #${x.keep.doc.number}`);
if (!process.argv.includes('--apply')) { await c.end(); process.exit(); }
fs.writeFileSync(backupFile, JSON.stringify({ tag:TAG, at:new Date().toISOString(), hidden: toHide.map(x=>({id:x.id, doc:x.doc, kept:x.keep.id})) }, null, 1));
const now=new Date().toISOString();
for (const x of toHide) await c.query(`UPDATE pins SET doc = doc || jsonb_build_object('hidden', true, 'hidden_reason', $2::text, 'duplicate_of', $3::text, 'hidden_at', $4::text) WHERE id=$1`, [x.id, TAG, x.keep.id, now]);
const chk = await c.query(`SELECT count(*) FROM pins WHERE doc->>'hidden_reason'=$1 AND (doc->>'hidden')::boolean`, [TAG]);
console.log('hidden now:', chk.rows[0].count, 'backup:', backupFile); await c.end();
