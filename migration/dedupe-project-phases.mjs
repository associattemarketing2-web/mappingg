// Hides extra phase / tower / wing listings of the same project so each project shows once.
// Dry run by default; --apply to write; --revert to undo. Keeper = base-name listing, else most data, else lowest pin no.
import pg from 'pg'; import fs from 'fs';
const url = fs.readFileSync('.env','utf8').match(/^DATABASE_URL=["']?([^"'\r\n]+)/m)[1];
const c = new pg.Client({ connectionString: url }); await c.connect();
const TAG='dedupe-phases-2026-10-31', backupFile='migration/backup/pins-before-'+TAG+'.json';
if (process.argv.includes('--revert')) {
  const b = JSON.parse(fs.readFileSync(backupFile,'utf8'));
  for (const x of b.hidden) await c.query(`UPDATE pins SET doc = (doc - 'hidden_reason' - 'duplicate_of' - 'hidden_at') || jsonb_build_object('hidden', $2::boolean) WHERE id=$1`, [x.id, !!x.doc.hidden]);
  console.log('reverted', b.hidden.length); await c.end(); process.exit();
}
const GROUPS = [
 [17,56],[239,243],[129,385,386],[188,458],[260,261],[274,275],[279,280,286,287,288],[284,285,290],[291,311],[292,293],[301,302],
 [316,889],[318,320],[319,483],[324,327],[325,329],[333,509,658],[336,644],[343,885],[352,353],[362,831],[382,976],[419,875],
 [420,654,655],[454,689],[461,462],[463,464],[468,670],[497,550],[501,653],[516,517,518],[532,533],[540,541],[547,884],[548,905,928],
 [575,576],[586,587,588,620],[598,720],[621,622],[623,624],[657,968,969],[695,696],[699,700,701],[704,705],[707,708,709,710],
 [715,716],[721,722],[740,741],[742,743],[756,757,758],[773,920,921],[807,907],[829,830],[835,836],[837,838],[844,845],[859,960],
 [887,915],[898,899],[901,944,957],[961,962,963,964,965],[1002,1005],[1007,1016],
];
const nums = GROUPS.flat();
const r = await c.query(`SELECT id, doc FROM pins WHERE (doc->>'number')::int = ANY($1::int[]) AND NOT coalesce((doc->>'hidden')::boolean,false)`, [nums]);
const byNum = {}; for (const x of r.rows) (byNum[x.doc.number] ||= []).push(x);
const filled = d => Object.values(d).filter(v=>v!==null&&v!==''&&!(Array.isArray(v)&&!v.length)).length;
const suffix = t => /(phase|ph\b|tower|wing|block|\bw\s?\d|\b(ii|iii|iv|v)\b|[-\s]\d+\s*$|\(project)/i.test(t||'');
const toHide=[]; const log=[];
for (const g of GROUPS) {
  const rows = g.flatMap(n => byNum[n] || []);
  if (g.some(n => (byNum[n]||[]).length !== 1)) { log.push('SKIP group '+g.join('/')+' (pin number missing or shared)'); continue; }
  const keep = [...rows].sort((a,b) => (suffix(a.doc.title)-suffix(b.doc.title)) || (filled(b.doc)-filled(a.doc)) || (a.doc.number-b.doc.number))[0];
  for (const x of rows) if (x !== keep) toHide.push({...x, keep});
  log.push(`keep #${keep.doc.number} "${keep.doc.title}"  ← hide ${rows.filter(x=>x!==keep).map(x=>'#'+x.doc.number+' "'+x.doc.title+'"').join(', ')}`);
}
console.log(log.join('\n')); console.log('groups', GROUPS.length, 'to hide', toHide.length);
if (!process.argv.includes('--apply')) { await c.end(); process.exit(); }
fs.writeFileSync(backupFile, JSON.stringify({ tag:TAG, at:new Date().toISOString(), hidden: toHide.map(x=>({id:x.id, doc:x.doc, kept:x.keep.id})) }, null, 1));
const now = new Date().toISOString();
for (const x of toHide) await c.query(`UPDATE pins SET doc = doc || jsonb_build_object('hidden', true, 'hidden_reason', $2::text, 'duplicate_of', $3::text, 'hidden_at', $4::text) WHERE id=$1`, [x.id, TAG, x.keep.id, now]);
const chk = await c.query(`SELECT count(*) FROM pins WHERE doc->>'hidden_reason'=$1 AND (doc->>'hidden')::boolean`, [TAG]);
console.log('hidden now:', chk.rows[0].count, 'backup:', backupFile); await c.end();
