// Parse official Haryana (Gurugram) and Karnataka (Bengaluru Urban) RERA lists into normalized records.
const fs = require('fs'), path = require('path');
const cell = s => s.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#039;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const ymd = (s, sep) => { const m = (s || '').match(/(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})/); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : ''; };
const rowsOf = h => [...h.matchAll(/<tr[\s\S]*?<\/tr>/g)].map(m => ({ html: m[0], cells: [...m[0].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map(c => c[1]) }));

function gurugram(file, fetched) {
  const SRC = 'https://haryanarera.gov.in/admincontrol/registered_projects/2';
  const h = fs.readFileSync(file, 'utf8'); const out = [];
  for (const r of rowsOf(h)) {
    if (r.cells.length < 10 || !/^\d+$/.test(cell(r.cells[0]))) continue;
    const c = r.cells.map(cell);
    const raw = c[1].replace(/images\/project_completed\.jpg" > -->/g, '').trim();
    const regNo = raw.split(/\s+DATED|\s*\(|\s+Lapsed/i)[0].trim();
    const flags = raw.replace(regNo, '').replace(/DATED[-\s]+[\d.\/-]+/i, '').trim();
    const detail = (r.cells[2].match(/href="([^"]+)"/) || [])[1] || '';
    const cert = (r.cells[10] || '').match(/href="([^"]+)"/); const qpr = (r.cells[11] || '').match(/window\.open\('([^']+)'/);
    out.push({
      country: 'India', state: 'Haryana', city: 'Gurugram', district: c[6], locality: c[5], project: c[3], regNo, rawReg: raw,
      secondaryId: c[2], prefix: /^GGM\//.test(regNo) ? 'GGM' : (/^\S+ OF \d{4}$/.test(regNo) ? 'NN OF YYYY (legacy Interim RERA)' : regNo.split(/[\/ ]/)[0]), developer: c[4], authority: c[7],
      regDate: ymd((raw.match(/DATED[-\s]+([\d.\/-]+)/i) || [])[1]), approvalDate: '', origCompletion: '', latestCompletion: ymd(c[9]), latestCompletionLabel: 'Registration valid up to (HARERA list)',
      progressDate: '', qprNote: /not uploaded/i.test(c[11] || '') ? 'QPR not uploaded (per list)' : (qpr ? 'QPR link available' : ''),
      status: /lapsed/i.test(flags) ? 'Lapsed' : (/revok/i.test(flags) ? 'Revoked' : (/SUPERSEDED BY/i.test(flags) ? 'Superseded (certificate replaced)' : 'Registered (no lapse/revocation flag on list)')), statusRaw: flags, superseded: /SUPERSEDED BY/i.test(flags),
      detailUrl: detail, certUrl: cert ? cert[1] : '', qprUrl: qpr ? qpr[1] : '', sourceUrl: SRC, fetched,
    });
  }
  return out;
}

function karnataka(file, fetched, district) {
  const SRC = 'https://rera.karnataka.gov.in/viewAllProjects';
  const h = fs.readFileSync(file, 'utf8'); const out = []; let hdr;
  for (const r of rowsOf(h)) {
    const c = r.cells.map(cell);
    if (c[0] === 'S.No') { hdr = c; continue; }
    if (!/^\d+$/.test(c[0]) || c.length < 16) continue;
    const reg = c[2]; const statusNorm = (c[6].match(/^(APPROVED|REJECTED|WITHDRAWN|REVOKED|TRANSFERED)/i) || [, c[6]])[1].toUpperCase(); const regDateCode = (reg.match(/\/PR\/(\d{6})\//) || [])[1];
    const links = [...r.html.matchAll(/href="([^"]+)"/g)].map(m => m[1]).filter(u => !u.startsWith('#'));
    out.push({
      country: 'India', state: 'Karnataka', city: 'Bengaluru', district: c[7], locality: c[8], project: c[5], regNo: reg, rawReg: reg, secondaryId: c[1],
      prefix: reg.split('/').slice(0, 3).join('/'), developer: c[4], projectType: c[9],
      approvalDate: ymd(c[10]), regDate: ymd(c[10]), latestCompletion: ymd(c[11]), latestCompletionLabel: 'Proposed completion date (current)', origCompletion: ymd(c[12]),
      covidExt: c[13], sec6Ext: c[14], furtherExt: c[15], status: statusNorm, statusRaw: c[6], noRegistration: !reg,
      regDateCode, codeMatches: regDateCode ? [`20${regDateCode.slice(4, 6)}-${regDateCode.slice(2, 4)}-${regDateCode.slice(0, 2)}`, `20${regDateCode.slice(0, 2)}-${regDateCode.slice(2, 4)}-${regDateCode.slice(4, 6)}`].includes(ymd(c[10])) : null,
      detailUrl: '', certUrl: links.find(u => /cert/i.test(u)) || '', sourceUrl: SRC, sourceNote: `POST projectViewDetails, district=${district}`, fetched, cellCount: c.length, hdrCount: hdr ? hdr.length : 0,
    });
  }
  return out;
}
module.exports = { gurugram, karnataka, ymd };
if (require.main === module) {
  const dir = process.argv[2];
  const g = gurugram(path.join(dir, 'haryanarera_gov_in_admincontrol_registered_projects_2.html'), '2026-10-11');
  console.log('Gurugram', g.length, 'unique', new Set(g.map(r => r.regNo)).size, 'no regDate', g.filter(r => !r.regDate).length);
  console.log(' statuses', JSON.stringify(g.reduce((a, r) => (a[r.status] = (a[r.status] || 0) + 1, a), {})), ' raw flags', JSON.stringify([...new Set(g.map(r => r.statusRaw))].slice(0, 10)));
  console.log(' prefixes', JSON.stringify(g.reduce((a, r) => (a[r.prefix] = (a[r.prefix] || 0) + 1, a), {})), ' authorities', JSON.stringify(g.reduce((a, r) => (a[r.authority] = (a[r.authority] || 0) + 1, a), {})), ' districts', JSON.stringify(g.reduce((a, r) => (a[r.district] = (a[r.district] || 0) + 1, a), {})));
  console.log(' non RERA-GRG ids', g.filter(r => !/^RERA-GRG/.test(r.secondaryId)).slice(0, 4).map(r => r.secondaryId + ' ' + r.regNo).join(' | '));
  console.log(' newest', g.slice().sort((a, b) => b.regDate.localeCompare(a.regDate)).slice(0, 3).map(r => `${r.regDate} ${r.regNo} ${r.project}`).join(' | '));
  const k = karnataka(path.join(dir, 'ka_blr.html'), '2026-10-11', 'Bengaluru Urban');
  console.log('Bengaluru', k.length, 'unique', new Set(k.map(r => r.regNo)).size, 'cells/hdr', [...new Set(k.map(r => r.cellCount + '/' + r.hdrCount))].join(','));
  console.log(' approval date == date code in reg no:', k.filter(r => r.codeMatches === true).length, 'mismatch', k.filter(r => r.codeMatches === false).length, 'no code', k.filter(r => r.codeMatches === null).length);
  console.log(' mismatches sample', k.filter(r => r.codeMatches === false).slice(0, 3).map(r => r.regNo + ' ' + r.approvalDate).join(' | '));
  console.log(' statuses', JSON.stringify(k.reduce((a, r) => (a[r.status] = (a[r.status] || 0) + 1, a), {})));
  console.log(' newest', k.slice().sort((a, b) => b.regDate.localeCompare(a.regDate)).slice(0, 3).map(r => `${r.regDate} ${r.regNo} ${r.project}`).join(' | '));
  console.log(' cert link sample', k.filter(r => r.certUrl).length, k.find(r => r.certUrl)?.certUrl);
}
