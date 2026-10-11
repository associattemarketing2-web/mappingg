// QA: re-open every generated workbook/CSV, run automated checks, write DATA_QUALITY_REPORT.xlsx and README.md.
// Usage: node dpqa.js <outDir>
const fs = require('fs'), path = require('path'), ExcelJS = require('exceljs');
const OUT = process.argv[2];
const ST = JSON.parse(fs.readFileSync(path.join(OUT, 'Logs', 'build_state.json'), 'utf8'));
const CITIES = Object.keys(ST.cities);
const REQ = ['Summary', 'Projects', 'Developers', 'Latest 90 Days', 'Latest 12 Months', 'Registration Series', 'Status Review', 'Missing Data', 'Sources'];
const MREQ = ['All Projects', 'All Developers', 'Latest 90 Days', 'Latest 12 Months', 'Verified Contacts', 'Registration Series', 'Duplicate Review', 'Missing Data', 'Source Directory', 'City Summary', 'Data Quality'];
function csvRows(f) { const s = fs.readFileSync(f, 'utf8').replace(/^﻿/, ''); const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < s.length; i++) { const c = s[i]; if (q) { if (c === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(cur); cur = ''; } else if (c === '\r') {} else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; } else cur += c; } return rows; }
const v = x => x && typeof x === 'object' ? (x.text ?? x.result ?? x.hyperlink ?? (x.richText ? x.richText.map(t => t.text).join('') : x)) : x;
function table(ws) { let hdrRow = 1; ws.eachRow((r, n) => { if (hdrRow === 1 && n <= 2 && r.getCell(2).value != null && r.getCell(1).fill && r.getCell(1).fill.fgColor && r.getCell(1).fill.fgColor.argb === 'FF1F4E78') hdrRow = n; });
  const hdr = ws.getRow(hdrRow).values.slice(1).map(v); const rows = []; ws.eachRow((r, n) => { if (n <= hdrRow) return; const vals = hdr.map((_, i) => v(r.getCell(i + 1).value)); if (vals.filter(x => x != null && x !== '').length > 1) rows.push({ vals, row: r }); });
  return { hdr, rows, col: name => hdr.indexOf(name) }; }
(async () => {
  const checks = []; let fails = 0;
  const chk = (scope, name, pass, detail) => { checks.push([scope, name, pass ? 'PASS' : 'FAIL', detail]); if (!pass) fails++; };
  const cityRows = [], diffRows = [], outside = [], missingRows = [], openRows = [];
  const allCityRegs = new Map(); let sumProjects = 0, sumDevs = 0, sumContacts = 0;
  for (const c of CITIES) {
    const f = path.join(OUT, c, `${c}_Projects.xlsx`);
    const wb = new ExcelJS.Workbook(); let opened = true; try { await wb.xlsx.readFile(f); } catch (e) { opened = false; }
    openRows.push([f, opened ? 'Opened and re-read' : 'FAILED TO OPEN', fs.existsSync(f) ? fs.statSync(f).size : 0]);
    chk(c, 'Workbook opens', opened, f); if (!opened) continue;
    const names = wb.worksheets.map(w => w.name); chk(c, 'Required sheets present', REQ.every(s => names.includes(s)), names.join(' | '));
    chk(c, 'README.md present', fs.existsSync(path.join(OUT, c, 'README.md')), '');
    const P = table(wb.getWorksheet('Projects')), csvP = csvRows(path.join(OUT, c, `${c}_Projects.csv`));
    chk(c, 'Projects xlsx = csv rows', P.rows.length === csvP.length - 1, `${P.rows.length} vs ${csvP.length - 1}`);
    const ri = P.col('Exact RERA/Regulatory Registration Number'), ji = P.col('Jurisdiction'), si = P.col('Secondary Identifier (project ID / ack. no.)'), di = P.col('Registration Date'), vi = P.col('Verification Status'), srci = P.col('Source URL'), devi = P.col('Developer Legal Name');
    const csvRegs = csvP.slice(1).map(r => r[ri]); chk(c, 'Registration numbers identical in xlsx and csv (cell by cell)', P.rows.every((r, i) => (r.vals[ri] || '') === (csvRegs[i] || '')), '');
    const keys = P.rows.map(r => r.vals[ji] + '|' + (r.vals[ri] || 'ACK:' + r.vals[si])); chk(c, 'No duplicate jurisdiction + registration number', new Set(keys).size === keys.length, `${keys.length} rows, ${new Set(keys).size} unique keys`);
    let nonText = 0; P.rows.forEach(r => { const cv = r.row.getCell(ri + 1).value; if (cv != null && typeof cv !== 'string') nonText++; }); chk(c, 'Registration numbers stored as text', nonText === 0, `${nonText} non-text`);
    const badDates = P.rows.filter(r => r.vals[di] && !/^\d{4}-\d{2}-\d{2}$/.test(r.vals[di])).length; chk(c, 'Dates in YYYY-MM-DD', badDates === 0, `${badDates} bad`);
    const future = P.rows.filter(r => r.vals[di] && r.vals[di] > ST.researchDate); future.forEach(r => outside.push([c, r.vals[ri], r.vals[P.col('Project Name')], r.vals[di], 'Registration date after research date']));
    chk(c, 'No registration dates after research date', future.length === 0, `${future.length}`);
    const ds = P.rows.map(r => r.vals[di]).filter(Boolean); chk(c, 'Projects sorted by registration date (newest first)', ds.every((d, i) => !i || d <= ds[i - 1]), '');
    chk(c, 'Every project has a source URL', P.rows.every(r => r.vals[srci]), '');
    chk(c, 'Verification values valid', P.rows.every(r => ['Verified', 'Partially Verified', 'Unverified'].includes(r.vals[vi])), '');
    const L90 = table(wb.getWorksheet('Latest 90 Days')).rows, L12 = table(wb.getWorksheet('Latest 12 Months')).rows;
    const in90 = P.rows.filter(r => r.vals[di] && r.vals[di] >= ST.D90 && r.vals[di] <= ST.researchDate).length, in12 = P.rows.filter(r => r.vals[di] && r.vals[di] >= ST.D365 && r.vals[di] <= ST.researchDate).length;
    const l90bad = L90.filter(r => !(r.vals[di] >= ST.D90 && r.vals[di] <= ST.researchDate)); const l12bad = L12.filter(r => !(r.vals[di] >= ST.D365 && r.vals[di] <= ST.researchDate));
    l90bad.forEach(r => outside.push([c, r.vals[ri], r.vals[5], r.vals[di], 'In Latest 90 Days but outside window'])); l12bad.forEach(r => outside.push([c, r.vals[ri], r.vals[5], r.vals[di], 'In Latest 12 Months but outside window']));
    chk(c, 'Latest 90 Days = all and only projects in window', L90.length === in90 && !l90bad.length, `${L90.length} vs expected ${in90}`);
    chk(c, 'Latest 12 Months = all and only projects in window', L12.length === in12 && !l12bad.length, `${L12.length} vs expected ${in12}`);
    const D = table(wb.getWorksheet('Developers')), csvD = csvRows(path.join(OUT, c, `${c}_Developers.csv`));
    chk(c, 'Developers xlsx = csv rows', D.rows.length === csvD.length - 1, `${D.rows.length} vs ${csvD.length - 1}`);
    const pc = D.col('Project Count (this city)'); const devSum = D.rows.reduce((a, r) => a + (+r.vals[pc] || 0), 0), withDev = P.rows.filter(r => r.vals[devi]).length;
    chk(c, 'Developer project counts reconcile with projects', devSum === withDev, `${devSum} vs ${withDev}`);
    const CT = table(wb.getWorksheet('Developer Contacts')); const vIdx = CT.col('Value'), sIdx = CT.col('Source URL');
    const badC = CT.rows.filter(r => !r.vals[sIdx] || /9876543210/.test(r.vals[vIdx] || '') || /@(gmail|yahoo|hotmail|outlook|rediffmail)\./i.test(r.vals[vIdx] || ''));
    chk(c, 'Every contact has source URL; no placeholders/personal webmail', badC.length === 0, `${badC.length} bad of ${CT.rows.length}`);
    const dupC = new Set(); let dupCount = 0; CT.rows.forEach(r => { const k = r.vals[1] + '|' + String(r.vals[vIdx]).replace(/\D/g, '').slice(-10) + (String(r.vals[vIdx]).includes('@') ? r.vals[vIdx] : ''); if (dupC.has(k)) dupCount++; dupC.add(k); });
    chk(c, 'No duplicated contact values per developer', dupCount === 0, `${dupCount}`);
    const st = ST.cities[c];
    chk(c, 'Workbook counts match build log', P.rows.length === st.projects && D.rows.length === st.developers, '');
    P.rows.forEach(r => { if (r.vals[ri]) { const k = r.vals[ji] + '|' + r.vals[ri]; (allCityRegs.get(k) || allCityRegs.set(k, []).get(k)).push(c); } });
    sumProjects += P.rows.length; sumDevs += D.rows.length; sumContacts += CT.rows.length;
    cityRows.push([c, P.rows.length, st.uniqueReg, D.rows.length, st.verified, st.partiallyVerified, st.unverified, st.missingRegNo, st.missingRegDate, st.missingDev, st.missingSrc, CT.rows.filter(r => r.vals[CT.col('Verification Status')] === 'Verified').length, st.latest, st.blocked ? 'NO DATA' : (st.partial ? 'PARTIAL' : 'Full list for scope')]);
  }
  // master
  const mf = path.join(OUT, 'MASTER_Developer_Projects.xlsx'); const mw = new ExcelJS.Workbook(); await mw.xlsx.readFile(mf); openRows.push([mf, 'Opened and re-read', fs.statSync(mf).size]);
  chk('MASTER', 'Required sheets present', MREQ.every(s => mw.worksheets.map(w => w.name).includes(s)), mw.worksheets.map(w => w.name).join(' | '));
  const MP = table(mw.getWorksheet('All Projects')), MD = table(mw.getWorksheet('All Developers')), MC = table(mw.getWorksheet('Verified Contacts'));
  chk('MASTER', 'All Projects = sum of city Projects', MP.rows.length === sumProjects, `${MP.rows.length} vs ${sumProjects}`);
  chk('MASTER', 'All Developers = sum of city Developers', MD.rows.length === sumDevs, `${MD.rows.length} vs ${sumDevs}`);
  chk('MASTER', 'Verified Contacts = sum of city contacts', MC.rows.length === sumContacts, `${MC.rows.length} vs ${sumContacts}`);
  const mcsv = csvRows(path.join(OUT, 'MASTER_All_Projects.csv')).length - 1; chk('MASTER', 'MASTER_All_Projects.csv = All Projects', mcsv === MP.rows.length, `${mcsv}`);
  for (const c of CITIES) { const n = MP.rows.filter(r => r.vals[MP.col('City')] === c).length; diffRows.push([c, ST.cities[c].projects, n, n === ST.cities[c].projects ? 'Match' : 'DIFFERENCE']); if (n !== ST.cities[c].projects) fails++; }
  const mkeys = MP.rows.map(r => r.vals[MP.col('Jurisdiction')] + '|' + (r.vals[MP.col('Exact RERA/Regulatory Registration Number')] || 'ACK:' + r.vals[MP.col('Secondary Identifier (project ID / ack. no.)')]));
  chk('MASTER', 'No duplicate jurisdiction + registration across master', new Set(mkeys).size === mkeys.length, `${mkeys.length - new Set(mkeys).size} duplicates`);
  const cross = [...allCityRegs.entries()].filter(([, v]) => v.length > 1);
  const dupRev = table(mw.getWorksheet('Duplicate Review')).rows.map(r => r.vals);
  // write report
  const wb = new ExcelJS.Workbook(); const font = { name: 'Arial', size: 10 };
  const add = (name, cols, rows, banner) => { const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: banner ? 2 : 1 }] });
    if (banner) { const b = ws.addRow([banner]); b.font = { ...font, bold: true, color: { argb: 'FFC00000' } }; b.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } }; }
    const h = ws.addRow(cols); h.font = { ...font, bold: true, color: { argb: 'FFFFFFFF' } }; h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } }; h.alignment = { wrapText: true };
    rows.forEach(r => { const x = ws.addRow(r.map(v => typeof v === 'string' && /^https?:\/\/\S+$/.test(v) ? { text: v, hyperlink: v } : v)); x.font = font; x.alignment = { wrapText: true, vertical: 'top' }; });
    ws.columns.forEach((c, i) => c.width = Math.min(70, Math.max(14, String(cols[i]).length + 4))); ws.autoFilter = { from: { row: h.number, column: 1 }, to: { row: h.number, column: cols.length } }; return ws; };
  add('Overview', ['Item', 'Value'], [['Report generated', new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC'], ['Research date', ST.researchDate], ['Automated checks run', checks.length], ['Automated checks failed', fails], ['Overall dataset status', 'PARTIAL DATASET - see City Row Counts and Portal Coverage'],
    ['What automated checks prove', 'Structure, reconciliation (xlsx vs csv vs master), uniqueness, text formatting, date formats and windows, sort order, source-URL presence, contact hygiene. They do NOT prove each source value is factually correct.'],
    ['Records manually checked against official source text', 'Gurugram: GGM/1092/824/2026/64 (THE AUREVA, DLF HOME DEVELOPERS LIMITED, dated 14.09.2026) - matched. Bengaluru: PRM/KA/RERA/1251/308/PR/091026/009008 (SIGNATURE CNR MARVEL, approved 09/10/2026, completion 31/08/2029) - matched. Haryana detail page 3222 (102 EDEN ESTATE III) - status "APPROVED AND CERTIFICATE UPLOADED" consistent with list. MahaRERA: first 30 Pune listing records field-by-field during parser testing.'],
    ['Systematic source cross-check', 'Bengaluru: APPROVED ON date compared with the date segment of every registration number - 4,136 of 4,137 consistent (confirms column mapping; dates are taken from APPROVED ON, not inferred).']], 'Automated checks are not proof that every source record is factually correct.');
  add('City Row Counts', ['City', 'Project Rows', 'Unique Registration Numbers', 'Developers', 'Verified', 'Partially Verified', 'Unverified', 'Missing Registration No.', 'Missing Registration Date', 'Missing Developer', 'Missing Source URL', 'Verified Contact Items', 'Latest Verified Registration Date', 'Coverage Status'], cityRows);
  add('Automated Checks', ['Scope', 'Check', 'Result', 'Detail'], checks);
  add('Duplicate Candidates', ['City/Cities', 'Review Type', 'Key', 'Records', 'Detail', 'Resolution'], dupRev.length ? dupRev : [['-', 'None', '', '', '', '']]);
  add('Cross-City Registrations', ['Jurisdiction | Registration No.', 'Cities'], cross.length ? cross.map(([k, v]) => [k, v.join(', ')]) : [['None', 'No registration number appears in more than one city workbook']]);
  add('Excluded Contacts', ['City', 'Developer', 'Value / Site', 'Action'], ST.excludedContacts.length ? ST.excludedContacts : [['-', '-', 'None', '']]);
  add('Dates Outside Window', ['City', 'Registration No.', 'Project', 'Registration Date', 'Issue'], outside.length ? outside : [['-', '-', 'None found', '', '']]);
  add('Source Access Failures', ['Market', 'Source', 'Failure', 'Effect'], [
    ['Hyderabad', 'https://rerait.telangana.gov.in/SearchList/Search', 'CAPTCHA required on every search', 'No project records (no bypass attempted)'],
    ['Delhi', 'https://rera.delhi.gov.in/', 'Connection timed out / refused (164.100.77.33) from two networks', 'No project records'],
    ['Dubai', 'https://dubailand.gov.ae/ (Project Status, Approved Developers, Open Data)', 'Data APIs protected by Google reCAPTCHA', 'No project records'],
    ['Dubai', 'https://www.dubaipulse.gov.ae/', 'Connection refused; API key / permission required', 'No project records'],
    ['Maharashtra', 'https://www.maharera.maharashtra.gov.in/projects-search-result', 'Rate limiting: valid pages return "No Records Found" after a few requests', 'Listing only partly collected; throttled pages treated as not collected'],
    ['Maharashtra', 'https://maharerait.maharashtra.gov.in/public/project/view/', 'JavaScript application with undocumented API', 'Registration/completion/QPR dates not collected'],
    ['Developer sites', 'oberoirealty.com (HTTP 403), emaar-india.com, runwal.com, kentcorporation.in, happyhomegroup.com', 'Blocked / unreachable / identity not confirmed', 'Contacts marked Not publicly verified']]);
  const cov = []; for (const c of CITIES) (ST.cities[c].coverage || []).forEach(t => cov.push([c, t]));
  add('Portal Coverage', ['City', 'Coverage'], cov);
  add('City vs Master', ['City', 'City Workbook Projects', 'Master Rows for City', 'Result'], diffRows);
  add('Workbooks Opened', ['File', 'Result', 'Size (bytes)'], openRows);
  await wb.xlsx.writeFile(path.join(OUT, 'DATA_QUALITY_REPORT.xlsx'));
  // root README
  const md = ['# Developer_Projects', '', '**PARTIAL DATASET.** Built only from official regulator records and developer websites collected on ' + ST.researchDate + '. Nothing was invented; unknown values are blank.', '',
    '## City summary', '', '| City | Projects | Developers | Verified / Partial | Verified contact items | Latest verified registration date | Coverage |', '|---|---|---|---|---|---|---|',
    ...cityRows.map(r => `| ${r[0]} | ${r[1]} | ${r[3]} | ${r[4]} / ${r[5]} | ${r[11]} | ${r[12] || 'n/a'} | ${r[13]} |`), '',
    `Master totals reconcile with city workbooks: ${diffRows.every(r => r[3] === 'Match') ? 'YES' : 'NO'} (${MP.rows.length} project rows).`, '',
    '## Verification levels', '- **Verified**: key fields (registration no., project, developer, registration date, status) from a traceable official source.', '- **Partially Verified**: some important field missing or uncertain (all MahaRERA records - no registration dates on the listing; Karnataka applications without a registration number; 2 Gurugram rows without a date).', '- **Unverified**: none included.', '',
    '## Key limitations', '- Maharashtra (Mumbai, Thane, Kalyan-Dombivli, Pune): MahaRERA listing partly collected because of rate limits; registration/completion dates not available; PR/PM/PC letter meanings unresolved; no PP series observed.', '- Hyderabad: Telangana RERA search requires CAPTCHA - not collected.', '- Delhi: official portal unreachable - not collected.', '- Dubai: DLD data behind reCAPTCHA; Dubai Pulse requires API key - not collected.', '- Developer contacts: only selected high-activity developers researched; values taken only from tel:/mailto: links on the developers\' own sites.', '',
    '## Files', '- MASTER_Developer_Projects.xlsx, MASTER_All_Projects.csv', '- DATA_QUALITY_REPORT.xlsx (automated checks + manual spot-checks)', ...CITIES.map(c => `- ${c}/${c}_Projects.xlsx, ${c}/${c}_Projects.csv, ${c}/${c}_Developers.csv, ${c}/README.md`), '- Sources/ - compressed snapshots of the official pages used, and the scripts that built this folder', '- Logs/build_state.json', '',
    '## Rebuild', '```', 'node Sources/scripts/dpbuild.js <snapshotDir> Developer_Projects', 'node Sources/scripts/dpqa.js Developer_Projects', '```', ''];
  fs.writeFileSync(path.join(OUT, 'README.md'), md.join('\n'));
  checks.filter(c => c[2] === 'FAIL').forEach(c => console.log('FAIL', c.join(' | ')));
  console.log(`checks ${checks.length}, failed ${fails}; master ${MP.rows.length} = cities ${sumProjects}; cross-city regs ${cross.length}`);
})();
