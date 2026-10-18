// Official MahaRERA registration certificate (Form 'C') and extension certificate for live MahaRERA scraped records.
// The project page is behind a CAPTCHA, but the certificates are public on the MahaRERA website
// (www.maharera.maharashtra.gov.in/project-document?id=<portal id>&type=DocProjectCert | DocProjectExtCert, the
// "View Certificate" button of the public project search). pdftotext reads them.
//
//   node --env-file=.env migration/enrichment/scraped/maharera-cert.mjs            dry run → MAHARERA-CERTIFICATES.csv
//   node --env-file=.env migration/enrichment/scraped/maharera-cert.mjs --apply
//
// Identity: the certificate's registration number must equal the record's RERA number, else nothing is used.
// Read: registration period ("commencing from … and ending with …"), the project line (survey / plot no., place, pincode),
// the certificate date; the extension certificate's new end date when there is one.
// Written only where blank: data.registration_date, data.original_completion (certificate end date),
// data.revised_completion (extension end date), data.address (project line); enrichment.fields.full_address,
// rera_completion (latest end date), registration_certificate (URL) and, when blank, proposed_completion — with
// enrichment.field_sources[...] = maharera_certificate. Nothing else changes. One request every 2 s; PDFs are cached.

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import pg from 'pg';

const APPLY = process.argv.includes('--apply');
const DIR = path.resolve('migration/backup/scraped-enrichment-cache/maharera-cert');
const OUTDIR = path.resolve('seo-doc/enrichment/scraped-project-enrichment');
const LOG = path.join(OUTDIR, 'PROJECT-CHANGE-LOG.csv');
const RUN = new Date().toISOString();
const BASE = 'https://www.maharera.maharashtra.gov.in/project-document';
mkdirSync(DIR, { recursive: true });

const url = new URL(process.env.DATABASE_URL);
url.searchParams.delete('sslmode');
const db = new pg.Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false }, query_timeout: 180000 });
await db.connect();
const { rows } = await db.query(`SELECT id, doc->'data' d, doc->'enrichment' e FROM scraped_projects
  WHERE NOT coalesce((doc->>'deleted')::boolean, false) AND doc->'data'->>'regulator' = 'MahaRERA'`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Certificate text ('' = none), cached as .txt next to the PDF. */
async function cert(pid, type) {
  const txt = path.join(DIR, `${pid}-${type}.txt`);
  if (existsSync(txt)) return readFileSync(txt, 'utf8');
  let html = '';
  for (let i = 0; i < 3 && !html; i++) {
    // Hard 45 s limit on the whole request (a stalled body read otherwise hangs the run).
    const ac = new AbortController(), timer = setTimeout(() => ac.abort(), 45000);
    try {
      html = await Promise.race([
        fetch(`${BASE}?id=${pid}&type=${type}`, { headers: { 'User-Agent': 'Mozilla/5.0 (mappingg.com data check)' }, signal: ac.signal }).then((r) => (r.ok ? r.text() : '')),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 46000)),
      ]);
    } catch { /* retry */ } finally { clearTimeout(timer); }
    await sleep(2000);
  }
  const b64 = (html.match(/data:application\/pdf;base64,([A-Za-z0-9+/=]+)/) || [])[1];
  let text = '';
  if (b64) {
    const pdf = path.join(DIR, `${pid}-${type}.pdf`);
    writeFileSync(pdf, Buffer.from(b64, 'base64'));
    try { text = execFileSync('pdftotext', ['-layout', pdf, '-'], { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'ignore'] }); } catch { text = ''; }
  }
  writeFileSync(txt, text);
  return text;
}
const iso = (dmy) => { const m = String(dmy).match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
const blank = (v) => v == null || v === '' || (Array.isArray(v) && !v.length);

const plan = [], report = [];
for (const r of rows) {
  const d = r.d;
  const pid = d.portal_seq || (String(d.project_url || '').match(/\/view\/(\d+)/) || [])[1];
  if (!pid) { report.push([r.id, d.project_name, d.rera_number, 'no MahaRERA portal id on the record', '']); continue; }
  if (report.length % 20 === 0) console.log(`  ${report.length} / ${rows.length}`);
  const t = (await cert(pid, 'DocProjectCert')).replace(/\s+/g, ' ');
  const regNo = (t.match(/registration number\s*:\s*([A-Z0-9]+)/i) || [])[1];
  if (!t || regNo !== String(d.rera_number).trim()) { report.push([r.id, d.project_name, d.rera_number, t ? `certificate is for ${regNo || 'an unreadable number'}` : 'no certificate published', '']); continue; }
  const period = t.match(/commencing from (\d{2}\/\d{2}\/\d{4}) and ending with (\d{2}\/\d{2}\/\d{4})/i);
  // Project address: from "Plot No.:" up to the 6-digit pincode. Older certificates space out the label's letters
  // ("P l o t B e a r i n g … N o . :"), so single letters are joined first.
  const tj = t.replace(/\b(\w) (?=\w\b)/g, '$1').replace(/[�]/g, ' ');
  const pa = tj.match(/Plot\s*No\.?\s*:\s*(.{3,400}?\b\d{6})\b/i);
  const where = pa && `Survey / Plot No. ${pa[1].replace(/\s+/g, ' ').replace(/\s+,/g, ',').trim()}`;
  const x = (await cert(pid, 'DocProjectExtCert')).replace(/\s+/g, ' ');
  // Extension certificate (Form 'F'): same "commencing from … and ending with <new end date>" wording; only for this number.
  const extEnd = x && x.includes(String(d.rera_number).trim()) && (x.match(/commencing from \d{2}\/\d{2}\/\d{4} and ending with (\d{2}\/\d{2}\/\d{4})/i) || [])[1];
  const start = period && iso(period[1]), end = period && iso(period[2]), ext = extEnd && iso(extEnd);
  const latest = [end, ext].filter(Boolean).sort().at(-1);
  const src = `${BASE}?id=${pid}&type=DocProjectCert`;
  const dataAdd = {}, fAdd = {};
  if (start && blank(d.registration_date)) dataAdd.registration_date = start;
  if (end && blank(d.original_completion)) dataAdd.original_completion = end;
  if (ext && ext !== end && blank(d.revised_completion)) dataAdd.revised_completion = ext;
  if (where && blank(d.address)) dataAdd.address = `${where} (MahaRERA registration certificate)`;
  const f = r.e?.fields || {};
  if (where && blank(f.full_address)) fAdd.full_address = where;
  if (latest && blank(f.rera_completion)) fAdd.rera_completion = latest;
  if (latest && blank(f.proposed_completion)) fAdd.proposed_completion = latest.slice(0, 7);
  if (start && blank(f.project_start_date)) fAdd.project_start_date = start;
  if (blank(f.registration_certificate)) fAdd.registration_certificate = src;
  report.push([r.id, d.project_name, d.rera_number, [...Object.keys(dataAdd).map((k) => `data.${k}`), ...Object.keys(fAdd)].join(', ') || 'nothing new',
    `period ${start || '?'} → ${end || '?'}${ext ? `, extended to ${ext}` : ''}; ${where || ''}`]);
  if (Object.keys(dataAdd).length || Object.keys(fAdd).length) plan.push({ r, dataAdd, fAdd, src });
}
const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
writeFileSync(path.join(OUTDIR, 'MAHARERA-CERTIFICATES.csv'), ['record_id,project_name,rera_number,fields_added,certificate', ...report.map((x) => x.map(q).join(','))].join('\n') + '\n');
const cnt = {}; plan.forEach((p) => [...Object.keys(p.dataAdd).map((k) => `data.${k}`), ...Object.keys(p.fAdd)].forEach((k) => (cnt[k] = (cnt[k] || 0) + 1)));
console.log({ maharera_rows: rows.length, with_certificate_facts: plan.length, fields: cnt });
if (!APPLY) { console.log('Dry run - see MAHARERA-CERTIFICATES.csv'); await db.end(); process.exit(0); }

let ok = 0;
for (const { r, dataAdd, fAdd, src } of plan) {
  const e = r.e || { review_status: 'Pending Review', enriched_at: RUN, source_type: 'maharera_certificate', fields: {} };
  const enrichment = { ...e, fields: { ...e.fields, ...fAdd },
    field_sources: { ...(e.field_sources || {}), ...Object.fromEntries(Object.keys(fAdd).map((k) => [k, { url: src, source: 'maharera_certificate', at: RUN }])) } };
  const res = await db.query(`UPDATE scraped_projects SET doc = doc || jsonb_build_object('data', $2::jsonb, 'enrichment', $3::jsonb) WHERE id = $1 AND doc->'data' = $4::jsonb`,
    [r.id, JSON.stringify({ ...r.d, ...dataAdd }), JSON.stringify(enrichment), JSON.stringify(r.d)]);
  const st = res.rowCount === 1 ? 'saved' : 'skipped_changed';
  if (st === 'saved') ok++;
  appendFileSync(LOG, [...Object.entries(dataAdd).map(([k, v]) => [`data.${k}`, v]), ...Object.entries(fAdd).map(([k, v]) => [`enrichment.${k}`, v])]
    .map(([k, v]) => [r.id, r.d.project_name, k, '', v, src, 'maharera_certificate', 'high', RUN, st].map(q).join(',')).join('\n') + '\n');
}
console.log(`saved ${ok} / ${plan.length}`);
await db.end();
