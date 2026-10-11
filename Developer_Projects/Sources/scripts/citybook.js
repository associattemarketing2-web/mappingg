// Build per-city RERA workbooks + master from cached OFFICIAL sources only.
// Usage: node citybook.js <scratchDir> <rootOutDir>
const fs = require('fs'), path = require('path');
const ExcelJS = require('exceljs');
const { parsePage } = require('./parse.js');
const lists = require('./lists.js');
const M = require('./markets.js');

const [S, ROOT] = process.argv.slice(2);
const RESEARCH_DATE = process.env.RESEARCH_DATE || '2026-10-11';
const GENERATED = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
const addDays = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const D90 = addDays(RESEARCH_DATE, -90), D365 = addDays(RESEARCH_DATE, -365);
const NPV = 'Not publicly verified';

// ---------------- official status lists (MahaRERA) ----------------
const L = lists.load(path.join(S, 'raw'));
const mhFlags = new Map();
const addF = (reg, kind, detail, src) => { if (!mhFlags.has(reg)) mhFlags.set(reg, []); mhFlags.get(reg).push({ kind, detail, src }); };
L.lapse.forEach(r => addF(r.reg_no, 'Abeyance - lapse of completion date', 'Bank account frozen; sales prohibited until compliance', L.urls.lapse));
L.qpr.forEach(r => addF(r.reg_no, 'Abeyance - QPR non-compliance', r.detail, L.urls.qpr));
L.cba.forEach(r => addF(r.reg_no, 'Abeyance - common bank account', r.detail, L.urls.cba));
L.dereg.forEach(r => addF(r.reg_no, 'Deregistered', `Planning authority: ${r.planning_authority}`, L.urls.dereg));
const nclt = new Map(L.nclt.map(r => [r.reg_no, r]));
L.nclt.forEach(r => addF(r.reg_no, 'NCLT', `Status as on 31-01-2025: ${r.status_jan2025}`, L.urls.nclt));
// Revoked search (statewide, partial)
const revDir = path.join(S, 'data', 't1_d0');
if (fs.existsSync(revDir)) for (const f of fs.readdirSync(revDir).filter(f => /^p\d+\.html$/.test(f)))
  for (const r of parsePage(fs.readFileSync(path.join(revDir, f), 'utf8'), f)) addF(r.reg_no, 'Revoked', 'Listed in MahaRERA Revoked Projects search', 'https://www.maharera.maharashtra.gov.in/projects-search-result?project_state=27&project_district=0&project_type=1&page=' + parseInt(f.slice(1)));
const MH_PRI = ['Revoked', 'Deregistered', 'Abeyance - lapse of completion date', 'Abeyance - QPR non-compliance', 'Abeyance - common bank account'];
const mhStatus = reg => { const f = mhFlags.get(reg) || []; for (const k of MH_PRI) if (f.some(x => x.kind === k)) return k; return 'Registered - no adverse list match'; };

// ---------------- series classification ----------------
function mhSeries(reg) {
  let m;
  if ((m = reg.match(/^P(\d{5})\d{6}$/))) return { prefix: 'P' + m[1], pattern: 'P + 5-digit code + 6-digit serial (12 chars)', cls: `Classic MahaRERA format; code ${m[1]} corresponds to the district in which records with this prefix are listed` };
  if ((m = reg.match(/^P([A-Z])(\d{3})(\d{3})(\d{2})(\d{5})$/))) return { prefix: 'P' + m[1], pattern: `P${m[1]} + 13 digits (15 chars)`, cls: `New MahaRERA format (P${m[1]}); observed segments: area code ${m[2]}, sub-code ${m[3]}, 2-digit block ${m[4]} (appears to be year - UNVERIFIED), serial ${m[5]}. Meaning of letter "${m[1]}" UNRESOLVED - no official documentation found` };
  return { prefix: reg.slice(0, 2), pattern: reg.replace(/\d/g, '9'), cls: 'Unrecognised pattern' };
}

// ---------------- MahaRERA records ----------------
const DIST = { 519: 'Mumbai City', 518: 'Mumbai Suburban', 517: 'Thane', 521: 'Pune' };
const mhAll = [];
const covMH = [];
for (const d of Object.keys(DIST)) {
  const dir = path.join(S, 'data', `t0_d${d}`); if (!fs.existsSync(dir)) continue;
  const meta = fs.existsSync(path.join(dir, 'meta.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'))) : {};
  const files = fs.readdirSync(dir).filter(f => /^p\d+\.html$/.test(f));
  const pages = files.map(f => parseInt(f.slice(1))).sort((a, b) => a - b);
  covMH.push({ district: DIST[d], code: d, total: meta.total, pages: meta.pages, got: pages });
  for (const f of files) {
    const p = parseInt(f.slice(1));
    for (const r of parsePage(fs.readFileSync(path.join(dir, f), 'utf8'), f)) {
      r.district_code = d; r.page = p; r.fetched = fs.statSync(path.join(dir, f)).mtime.toISOString().slice(0, 10);
      r.listing_url = `https://www.maharera.maharashtra.gov.in/projects-search-result?project_state=27&project_district=${d}&page=${p}`;
      mhAll.push(r);
    }
  }
}
function mhCity(r) {
  if (r.district_code === '519' || r.district_code === '518') return 'Mumbai';
  if (r.district_code === '521') return 'Pune';
  if (r.district_code === '517') { if (/^kalyan$/i.test(r.location)) return 'Kalyan_Dombivli'; if (/^thane$/i.test(r.location)) return 'Thane'; return null; }
  return null;
}
function mhRecord(r) {
  const s = mhSeries(r.reg_no), f = mhFlags.get(r.reg_no) || [], n = nclt.get(r.reg_no);
  const missing = ['Registration Date', 'Approval Date', 'Original Completion Date', 'Latest Progress Update Date', 'Project Type', 'Configuration', 'Total Units', 'Project Address', 'Developer Brand Name'];
  if (!n) missing.push('Latest Approved Completion Date');
  const core = [r.reg_no, r.project_name, r.promoter, r.district, r.location, r.pincode].every(Boolean);
  return {
    country: 'India', state: 'Maharashtra', city: mhCity(r), district: DIST[r.district_code], locality: r.location || '', project: r.project_name, regNo: r.reg_no,
    prefix: s.prefix, seriesPattern: s.pattern, seriesCls: s.cls, developer: r.promoter, brand: '', projectType: '', use: '', config: '',
    regDate: '', approvalDate: '', origCompletion: '', latestCompletion: n ? M.ymd(n.proposed_completion) : '', progressDate: '',
    status: mhStatus(r.reg_no), statusDetail: f.map(x => `${x.kind}: ${x.detail}`).join(' | '), constructionStatus: n ? `NCLT list status as on 31-01-2025: ${n.status_jan2025}` : '', units: '', address: '',
    detailUrl: r.detail_url, devUrl: '', sourceUrl: r.listing_url, sourceType: 'Official regulator search listing (MahaRERA)', verified: r.fetched,
    verification: core ? 'Verified' : 'Partially Verified',
    notes: `Missing (not on official listing): ${missing.join(', ')}. Extension certificate shown: ${r.has_extension_cert}.` + (n ? ' Latest completion date from official NCLT list (proposed date).' : ''),
    pincode: r.pincode, lat: r.lat, lng: r.lng, lastModified: r.last_modified, seqId: +r.portal_id, secondaryId: '', rawReg: r.reg_no, extension: r.has_extension_cert,
    statusSources: [...new Set(f.map(x => x.src))].join(' '),
  };
}
const mhRecs = []; const seen = new Set(); let mhDupes = 0; const mhExcluded = {};
for (const r of mhAll) {
  const key = 'MahaRERA|' + r.reg_no; if (seen.has(key)) { mhDupes++; continue; } seen.add(key);
  const rec = mhRecord(r);
  if (!rec.city) { mhExcluded[`${DIST[r.district_code]} / ${r.location || '(blank)'}`] = (mhExcluded[`${DIST[r.district_code]} / ${r.location || '(blank)'}`] || 0) + 1; continue; }
  mhRecs.push(rec);
}

// ---------------- Gurugram ----------------
const grgRaw = M.gurugram(path.join(S, 'other', 'haryanarera_gov_in_admincontrol_registered_projects_2.html'), fs.statSync(path.join(S, 'other', 'haryanarera_gov_in_admincontrol_registered_projects_2.html')).mtime.toISOString().slice(0, 10));
const grgRecs = grgRaw.map(r => ({
  country: 'India', state: 'Haryana', city: 'Gurugram', district: r.district, locality: r.locality, project: r.project, regNo: r.regNo,
  prefix: r.prefix, seriesPattern: r.regNo.replace(/\d/g, '9'), seriesCls: r.prefix === 'GGM' ? 'HARERA Gurugram registration certificate (GGM/<n>/<n>/<year>/<n>); year segment matches certificate DATED year' : (/legacy/.test(r.prefix) ? 'Legacy Interim RERA certificate number (<n> OF <year>)' : 'Other certificate format'),
  developer: r.developer, brand: '', projectType: '', use: '', config: '',
  regDate: r.regDate, approvalDate: '', origCompletion: '', latestCompletion: r.latestCompletion, progressDate: '',
  status: r.status, statusDetail: [r.statusRaw, r.qprNote, `Registered with: ${r.authority}`].filter(Boolean).join(' | '), constructionStatus: '', units: '', address: r.locality,
  detailUrl: r.detailUrl, devUrl: '', sourceUrl: r.sourceUrl, sourceType: 'Official regulator list (Haryana RERA - Gurugram authority, registered projects)', verified: r.fetched,
  verification: r.regDate ? 'Verified' : 'Partially Verified',
  notes: `Latest Approved Completion Date = "Registration Up-to" on HARERA list. Missing: approval date, original completion date, latest QPR date, project type, units.` + (r.regDate ? '' : ' Registration date not shown on list.'),
  pincode: '', lat: '', lng: '', lastModified: '', seqId: '', secondaryId: r.secondaryId, rawReg: r.rawReg, certUrl: r.certUrl, qprUrl: r.qprUrl, authority: r.authority,
}));

// ---------------- Bengaluru ----------------
const kaFile = path.join(S, 'other', 'ka_blr.html');
const kaRaw = M.karnataka(kaFile, fs.statSync(kaFile).mtime.toISOString().slice(0, 10), 'Bengaluru Urban');
const kaRecs = kaRaw.map(r => ({
  country: 'India', state: 'Karnataka', city: 'Bengaluru', district: r.district, locality: r.locality, project: r.project, regNo: r.regNo || '',
  prefix: r.regNo ? 'PRM/KA/RERA' : '', seriesPattern: r.regNo ? r.regNo.replace(/\d/g, '9') : '', seriesCls: r.regNo ? 'Karnataka RERA project registration: PRM/KA/RERA/<district code>/<taluk code>/PR/<date>/<serial>; date segment matches APPROVED ON date (verified for 4,136 of 4,137 records)' : 'No registration number issued',
  developer: r.developer, brand: '', projectType: r.projectType, use: /commercial/i.test(r.projectType) ? 'Commercial' : (/mixed/i.test(r.projectType) ? 'Mixed Use' : (/resid|plot|villa|apartment/i.test(r.projectType) ? 'Residential' : '')), config: '',
  regDate: r.regNo ? r.approvalDate : '', approvalDate: r.approvalDate, origCompletion: r.origCompletion, latestCompletion: r.latestCompletion, progressDate: '',
  status: r.status, statusDetail: [r.statusRaw !== r.status ? r.statusRaw : '', r.covidExt && `COVID-19 extension: ${r.covidExt}`, r.sec6Ext && `Section 6 extension: ${r.sec6Ext}`, r.furtherExt && `Further extension: ${r.furtherExt}`].filter(Boolean).join(' | '),
  constructionStatus: '', units: '', address: '',
  detailUrl: r.certUrl ? 'https://rera.karnataka.gov.in' + r.certUrl : '', devUrl: '', sourceUrl: r.sourceUrl, sourceType: 'Official regulator list (RERA Karnataka - Project Status, district Bengaluru Urban)', verified: r.fetched,
  verification: r.regNo && r.approvalDate ? 'Verified' : 'Partially Verified',
  notes: (r.regNo ? 'Registration Date = APPROVED ON (registration grant date). ' : 'Application without registration number (rejected/withdrawn). ') + 'Detail URL = official registration certificate link. Missing: latest QPR date, units, address.' + ((r.covidExt || r.sec6Ext || r.furtherExt) ? ' Extension(s) recorded - see Project Status detail.' : ''),
  pincode: '', lat: '', lng: '', lastModified: '', seqId: '', secondaryId: r.secondaryId, rawReg: r.regNo, extension: (r.covidExt || r.sec6Ext || r.furtherExt) ? 'Yes' : 'No',
}));

// ---------------- Telangana revoked (statewide) ----------------
const tgRevoked = [];
{ const h = fs.readFileSync(path.join(S, 'other', 'tg_revoked.html'), 'utf8');
  const rows = [...h.matchAll(/<tr[\s\S]*?<\/tr>/g)].map(m => [...m[0].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map(c => c[1].replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x9;/g, ' ').replace(/\s+/g, ' ').trim()));
  for (const r of rows) if (/^\d+$/.test(r[0]) && r.length >= 3 && r[1] && !/order|notice/i.test(r[1])) tgRevoked.push({ project: r[1], promoter: r[2] }); }

// ---------------- contacts ----------------
const contacts = fs.existsSync(path.join(S, 'contacts.json')) ? JSON.parse(fs.readFileSync(path.join(S, 'contacts.json'), 'utf8')) : {};
const ROLE = /^(sales|enquir|enquiry|enquiries|info|contact|connect|feedback|crm|customer|customercare|care|support|service|marketing|media|mediarelations|leasing|officeleasing|retailleasing|easylease|nri|estate|realty|corporate|investors?|investor\.relations|channelsales|fmc|cpd\.sales|service\.support|nri\.support|sobhainteriors|sobha\.restoplus|sgml)/i;
const EXCL_LOCAL = /^(careers|careersgurgaon|careersnoida|hr|vendors?|jobs)/i;
const PLACEHOLDER = /^\+?91?9876543210$/;
function devContacts(legal) {
  const c = contacts[legal]; if (!c) return null;
  const dom = c.domain.replace(/^www\./, '').split('.').slice(-2).join('.');
  const brandRoots = { 'raymondrealty.in': 'raymond.in', 'dsmaxproperties.com': 'dsgroupworld.in' };
  const out = { website: c.identity ? `https://${c.domain}/` : '', identity: c.identity, contactPage: c.contactPage || '', title: c.title || '', items: [], excluded: [] };
  if (!c.identity) return out;
  for (const e of c.emails) {
    const [local, edom] = e.email.split('@'); const ownDomain = edom.endsWith(dom) || edom.endsWith(brandRoots[c.domain.replace(/^www\./, '')] || '#');
    if (!ownDomain) { out.excluded.push(`${e.email} (third-party domain)`); continue; }
    if (EXCL_LOCAL.test(local)) { out.excluded.push(`${e.email} (recruitment/vendor address)`); continue; }
    if (!ROLE.test(local)) { out.excluded.push(`${e.email} (appears to be an individual employee address)`); continue; }
    out.items.push({ type: /sales|enquir|connect|crm|leasing/i.test(local) ? 'Sales/enquiry email' : 'Business email', value: e.email, source: e.source });
  }
  for (const p of c.phones) {
    if (PLACEHOLDER.test(p.number)) { out.excluded.push(`${p.number} (placeholder number)`); continue; }
    const norm = p.number.replace(/^\+0/, '0').replace(/^\+910(?=\d{10}$)/, '+91').replace(/^\+?0*91(?=\d{10}$)/, '+91').replace(/^(?=[6-9]\d{9}$)/, '+91');
    if (out.items.some(x => x.value.replace(/\D/g, '').slice(-10) === norm.replace(/\D/g, '').slice(-10))) continue;
    out.items.push({ type: /^\+?(91)?1800|^1800/.test(p.number) ? 'Toll-free enquiry phone' : 'Published company phone', value: norm, source: p.source, note: norm !== p.number ? `published as "${p.number}"` : (norm.replace(/\D/g, '').length < 10 ? 'local number as published (no area code)' : '') });
  }
  return out;
}

// ---------------- workbook writer ----------------
const PCOLS = ['Country', 'State/Emirate', 'City', 'District', 'Locality/Micro-market', 'Project Name', 'Exact RERA/Regulatory Registration Number', 'Registration Series/Prefix', 'Series Classification', 'Promoter/Developer Legal Name', 'Developer Brand Name', 'Project Type', 'Residential/Commercial/Mixed Use', 'Configuration, if available', 'Registration Date', 'Approval Date', 'Original Completion Date', 'Latest Approved Completion Date', 'Latest Progress Update Date', 'Project Status', 'Construction Status, if officially available', 'Total Units, if available', 'Available Project Address', 'Official Project Detail URL', 'Official Developer Detail URL', 'Source URL', 'Source Type', 'Date Verified', 'Verification Status', 'Missing Fields / Notes',
  'Status Detail (official lists)', 'Pincode', 'Latitude', 'Longitude', 'Source Last Modified (MahaRERA)', 'Portal Sequence ID', 'Secondary Identifier (project ID / acknowledgement no.)', 'Original Source Registration Text', 'Extension Indicated', 'Status Source URL(s)'];
const toRow = r => [r.country, r.state, r.city, r.district, r.locality, r.project, r.regNo, r.prefix, r.seriesCls, r.developer, r.brand, r.projectType, r.use, r.config, r.regDate, r.approvalDate, r.origCompletion, r.latestCompletion, r.progressDate, r.status, r.constructionStatus, r.units, r.address, r.detailUrl, r.devUrl, r.sourceUrl, r.sourceType, r.verified, r.verification, r.notes,
  r.statusDetail, r.pincode, r.lat, r.lng, r.lastModified, r.seqId, r.secondaryId, r.rawReg, r.extension || '', r.statusSources || ''].map(v => v === '' || v == null ? null : v);
const DEVCOLS = ['Developer ID', 'Legal Company/Promoter Name (as on RERA record)', 'Public Brand Name', 'Official Website', 'Publicly Listed Company Phone', 'Public Business Email', 'Public Sales/Enquiry Phone', 'Public Sales/Enquiry Email', 'Official Office Address', 'City and Operating Markets', 'Official Developer/RERA Registration Number', 'Related Project Names', 'Related RERA Registration Numbers', 'Project Count (this workbook)', 'Official Contact Page URL', 'Contact Source URL(s)', 'Verification Date', 'Contact Verification Status', 'Notes'];
const CCOLS = ['Developer ID', 'Legal Company/Promoter Name', 'Contact Type', 'Value', 'Source URL', 'Verification Date', 'Verification Status', 'Notes'];
const isUrl = v => typeof v === 'string' && /^https?:\/\/\S+$/.test(v);
const font = { name: 'Arial', size: 10 }, linkFont = { name: 'Arial', size: 10, color: { argb: 'FF0563C1' }, underline: true };
function addSheet(wb, name, cols, rows, opt = {}) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.addRow(cols); rows.forEach(r => ws.addRow(r.map(v => isUrl(v) ? { text: v, hyperlink: v } : v)));
  const h = ws.getRow(1); h.font = { ...font, bold: true, color: { argb: 'FFFFFFFF' } }; h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } }; h.alignment = { wrapText: true, vertical: 'middle' }; h.height = 32;
  const textCols = new Set(cols.map((c, i) => /Registration Number|Registration Nos|RERA Registration|Value|Pincode|Phone|Secondary Identifier|Original Source Registration/i.test(c) ? i + 1 : 0).filter(Boolean));
  const wrapCols = new Set(cols.map((c, i) => /Notes|Classification|Detail|Name|Related|Interpretation|Evidence|Description|Limitation|Value|Missing/i.test(c) ? i + 1 : 0).filter(Boolean));
  ws.columns.forEach((c, i) => { c.width = (opt.widths || {})[cols[i]] || (wrapCols.has(i + 1) ? 34 : Math.min(30, Math.max(12, cols[i].length * 0.9))); if (textCols.has(i + 1)) c.numFmt = '@'; });
  ws.eachRow((row, n) => { if (n === 1) return; row.eachCell((cell, ci) => { cell.font = cell.value && cell.value.hyperlink ? linkFont : font; if (wrapCols.has(ci)) cell.alignment = { wrapText: true, vertical: 'top' }; if (textCols.has(ci)) cell.numFmt = '@'; }); });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  if (!rows.length && opt.empty) { ws.addRow([]); ws.addRow([opt.empty]).font = { ...font, italic: true, color: { argb: 'FFC00000' } }; }
  return ws;
}
function kvSheet(wb, name, lines) {
  const ws = wb.addWorksheet(name); ws.columns = [{ width: 55 }, { width: 22 }, { width: 100 }];
  for (const l of lines) { const r = ws.addRow(l.slice(0, 3).map(v => isUrl(v) ? { text: v, hyperlink: v } : v)); r.font = font; r.alignment = { wrapText: true, vertical: 'top' };
    if (l[3] === 'H') { r.font = { ...font, bold: true, color: { argb: 'FFFFFFFF' } }; r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } }; }
    if (l[3] === 'T') r.font = { ...font, size: 14, bold: true }; if (l[3] === 'W') { r.font = { ...font, bold: true, color: { argb: 'FFC00000' } }; r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } }; } }
  return ws;
}
const esc = v => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const writeCsv = (file, cols, rows) => fs.writeFileSync(file, '\uFEFF' + [cols, ...rows].map(r => r.map(esc).join(',')).join('\r\n') + '\r\n');

// ---------------- per-city config ----------------
const MH_SOURCES = [
  ['MahaRERA - Registered Projects search', 'https://www.maharera.maharashtra.gov.in/projects-search-result', 'Project listing (reg no, project, promoter, taluka, pincode, district, last modified, extension flag, detail link)', 'Public GET pagination; single rate-limited stream', 'Portal throttles automated paging ("No Records Found" for valid pages). Registration date not on listing.'],
  ['MahaRERA - Project detail (maharerait)', 'https://maharerait.maharashtra.gov.in/public/project/view/', 'Linked per project', 'Not bulk-collected (JavaScript application)', 'Holds registration date, completion dates, QPR; not collected'],
  ['MahaRERA - Promoter search', 'https://www.maharera.maharashtra.gov.in/mr/promoters-search-result', 'Promoter records', 'Not collected (time/rate limits)', ''],
  ['MahaRERA - Revoked Projects search', 'https://www.maharera.maharashtra.gov.in/projects-search-result?project_state=27&project_district=0&project_type=1', 'Revoked status', 'Public GET (partially collected)', ''],
  ['MahaRERA - Abeyance: lapse of completion date', L.urls.lapse, 'Lapsed status', 'Public HTML table, full', ''],
  ['MahaRERA - Abeyance: QPR non-compliance', L.urls.qpr, 'Abeyance status', 'Public HTML table, full', ''],
  ['MahaRERA - Abeyance: common bank account', L.urls.cba, 'Abeyance status', 'Public HTML table, full', ''],
  ['MahaRERA - Deregistered projects', L.urls.dereg, 'Deregistered status', 'Public HTML table, full', ''],
  ['MahaRERA - NCLT projects', L.urls.nclt, 'NCLT flag + proposed completion date (status as on 31-01-2025)', 'Public HTML table, full', ''],
];
const CITY = {
  Mumbai: { recs: () => mhRecs.filter(r => r.city === 'Mumbai'), regulator: 'MahaRERA (Maharashtra Real Estate Regulatory Authority)', sources: MH_SOURCES, mh: true, scope: 'MahaRERA districts Mumbai City (code 519) and Mumbai Suburban (code 518)' },
  Thane: { recs: () => mhRecs.filter(r => r.city === 'Thane'), regulator: 'MahaRERA', sources: MH_SOURCES, mh: true, scope: 'MahaRERA district Thane (code 517), records whose taluka is displayed as "Thane" on the MahaRERA listing (locality-level mapping, e.g. Mira-Bhayandar or Navi Mumbai nodes, not verified from the source). Other Thane-district talukas excluded.' },
  Kalyan_Dombivli: { recs: () => mhRecs.filter(r => r.city === 'Kalyan_Dombivli'), regulator: 'MahaRERA', sources: MH_SOURCES, mh: true, scope: 'MahaRERA district Thane (code 517), records whose taluka is displayed as "Kalyan" on the MahaRERA listing. Kalyan taluka is used as the proxy for Kalyan-Dombivli; it may include areas outside the KDMC limits (not verified per project).' },
  Pune: { recs: () => mhRecs.filter(r => r.city === 'Pune'), regulator: 'MahaRERA', sources: MH_SOURCES, mh: true, scope: 'MahaRERA district Pune (code 521), all talukas (Pune City, Haveli/PCMC, Mulshi, Maval, etc.)' },
  Gurugram: { recs: () => grgRecs, regulator: 'Haryana RERA - Gurugram authority (HARERA Gurugram)', scope: 'Projects registered with the Gurugram authority (list "registered_projects/2"; Registered With = HRERA or INTERIM RERA). Panchkula-authority records not included.',
    sources: [['Haryana RERA - Registered projects, Gurugram authority', 'https://haryanarera.gov.in/admincontrol/registered_projects/2', 'Full list: certificate no. + date, project ID, project, builder, location, validity, lapse flag, QPR/certificate links', 'Single public HTML page', 'Linked from HARERA Gurugram website'],
      ['HARERA Gurugram website', 'https://hareraggm.gov.in/en/', 'Portal home / discovery', 'Read', ''], ['HARERA Gurugram - List of Registered Projects (old certificates)', 'https://hareraggm.gov.in/en/Project_Certificate.php', '434 older certificates (2017-2021)', 'Page AJAX (fetch.php)', 'Not used as primary - subset of the Haryana RERA list'],
      ['Haryana RERA - project detail', 'https://haryanarera.gov.in/view_project/searchprojectDetail/', 'Linked per project', 'Not bulk-collected', 'Contains approval status and hearing details']] },
  Bengaluru: { recs: () => kaRecs, regulator: 'Karnataka RERA (RERA Karnataka)', scope: 'Karnataka RERA project status list filtered to district Bengaluru Urban (Bengaluru Rural not included)',
    sources: [['RERA Karnataka - Project Status (all projects)', 'https://rera.karnataka.gov.in/viewAllProjects', 'Full list for Bengaluru Urban: ack no, reg no, promoter, project, status, taluk, type, approval date, completion dates, extensions, certificate link', 'Public search form (district filter), single request', ''],
      ['RERA Karnataka - Registration certificate', 'https://rera.karnataka.gov.in/certificate?CER_NO=', 'Linked per project', 'Not bulk-collected', ''], ['RERA Karnataka - Extension status', 'https://rera.karnataka.gov.in/viewRenewalProjects', 'Extension list', 'Not collected', 'Extension dates already in project status list']] },
  Hyderabad: { recs: () => [], regulator: 'Telangana RERA (TG-RERA)', scope: 'Hyderabad metropolitan districts (Hyderabad, Rangareddy, Medchal-Malkajgiri, Sangareddy) - NOT COLLECTED',
    blocked: 'Telangana RERA registered-project search (https://rerait.telangana.gov.in/SearchList/Search) requires a CAPTCHA for every search. Automated collection was not attempted, per the no-CAPTCHA-bypass rule. No project records are included. Use manual searches or request an official export to populate.',
    sources: [['Telangana RERA - home', 'https://rera.telangana.gov.in/', 'Portal home', 'Read', ''], ['Telangana RERA - Search Registered Projects and Agents', 'https://rerait.telangana.gov.in/SearchList/Search', 'Project search', 'CAPTCHA-protected - not automated', 'Blocked for automated access'],
      ['Telangana RERA - Revoked Projects/Agents', 'https://rera.telangana.gov.in/Home/Revoked', 'Statewide revoked projects/agents (no reg nos, no district)', 'Public page', 'Included in Status Review as statewide records (city not stated)']] },
  Delhi: { recs: () => [], regulator: 'Real Estate Regulatory Authority, NCT of Delhi (Delhi RERA)', scope: 'NCT of Delhi - NOT COLLECTED',
    blocked: 'The official Delhi RERA portal (https://rera.delhi.gov.in/, IP 164.100.77.33) refused/timed out connections from both the local network and the web-fetch service on ' + RESEARCH_DATE + '. No Delhi records were collected. Haryana/UP records were NOT substituted.',
    sources: [['Delhi RERA - official portal', 'https://rera.delhi.gov.in/', 'Project and promoter lists', 'Unreachable (connection timed out / refused)', 'Retry later'], ['Delhi RERA - registered projects list (per secondary guides)', 'https://rera.delhi.gov.in/registered_promoters_list', 'Registered project list', 'Unreachable', 'URL from secondary sources; not verified']] },
  Dubai: { recs: () => [], regulator: 'Dubai Land Department (DLD) / Real Estate Regulatory Agency (RERA Dubai)', scope: 'Dubai - NOT COLLECTED', dubai: true,
    blocked: 'DLD "Real Estate Project Status", "Approved Developers" and "Real Estate Data" (open data) pages load their data through APIs protected by Google reCAPTCHA; Dubai Pulse (official open-data portal) refused connections and requires an API key/permission. No Dubai records were collected; no secondary listings were used.',
    sources: [['Dubai Land Department - home', 'https://dubailand.gov.ae/en/', 'Portal home', 'Read', ''], ['DLD - Real Estate Project Status', 'https://dubailand.gov.ae/en/eservices/real-estate-project-status-landing/real-estate-project-status', 'Project status by project number', 'reCAPTCHA-protected API', 'Not automated'],
      ['DLD - Approved Developers', 'https://dubailand.gov.ae/en/eservices/approved-developers-overview/approved-developers', 'Licensed developer verification', 'reCAPTCHA-protected API', 'Not automated'], ['DLD - Open Data (Real Estate Data)', 'https://dubailand.gov.ae/en/open-data/real-estate-data/', 'Projects/transactions open data', 'reCAPTCHA-protected API', 'Not automated'],
      ['Dubai Pulse - DLD Projects dataset', 'https://www.dubaipulse.gov.ae/data/dld-registration/dld_projects-open', 'Official open dataset', 'Connection refused; API key/permission required', 'Request access to populate']] },
};

// ---------------- MahaRERA series evidence ----------------
const allMhRegs = [...new Set(mhAll.map(r => r.reg_no))];
const listRegs = [...new Set([...L.lapse, ...L.qpr, ...L.cba, ...L.dereg, ...L.nclt].map(r => r.reg_no))];
function candidateRows() {
  const pool = [...new Set([...allMhRegs, ...listRegs])];
  const cnt = re => pool.filter(r => re.test(r)).length;
  const ex = re => pool.filter(r => re.test(r)).slice(0, 4).join(', ');
  return [
    ['PC', 'PC + 13 digits', cnt(/^PC\d{13}$/), ex(/^PC\d{13}$/), 'Observed in official MahaRERA records (registered search and deregistered list)', 'Letter meaning UNRESOLVED. Hypothesis (unverified): C = Commercial. No official MahaRERA document defining the letter was found.'],
    ['PP', 'PP + digits', cnt(/^PP\d+$/), ex(/^PP\d+$/) || 'none', 'NOT observed in any collected official record', 'No evidence that a "PP" series exists in MahaRERA numbering. May be a typo for PR or PM - confirm with the requester.'],
    ['PR', 'PR + 13 digits', cnt(/^PR\d{13}$/), ex(/^PR\d{13}$/), 'Observed - the most common prefix among the newest MahaRERA registrations', 'Letter meaning UNRESOLVED. Hypothesis (unverified): R = Residential.'],
    ['PM', 'PM + 13 digits', cnt(/^PM\d{13}$/), ex(/^PM\d{13}$/), 'Observed in newest registrations and in deregistered/abeyance lists', 'Letter meaning UNRESOLVED. Hypothesis (unverified): M = Mixed use.'],
    ['P5xxxx', 'P + 11 digits (classic)', cnt(/^P\d{11}$/), ex(/^P\d{11}$/), 'Observed - all older MahaRERA registrations (2017 onward)', 'Digits 2-6 are a district code consistent with the listing district (e.g. P51900 Mumbai City, P51800 Mumbai Suburban, P51700 Thane, P52100 Pune) - consistent across all collected records.'],
  ];
}

// ---------------- build one city ----------------
const masterRows = [], masterDevs = [], summaryAll = [];
async function buildCity(name) {
  const cfg = CITY[name]; const dir = path.join(ROOT, name); fs.mkdirSync(path.join(dir, 'Sources'), { recursive: true });
  let recs = cfg.recs().slice();
  // dedupe by jurisdiction + reg no (or secondary id when no reg no)
  const keySeen = new Set(); let dupes = 0;
  recs = recs.filter(r => { const k = r.state + '|' + (r.regNo || 'ACK:' + r.secondaryId); if (keySeen.has(k)) { dupes++; return false; } keySeen.add(k); return true; });
  // newest first: registration date desc, else portal sequence desc
  recs.sort((a, b) => (b.regDate || '').localeCompare(a.regDate || '') || (b.seqId || 0) - (a.seqId || 0) || (a.regNo || '').localeCompare(b.regNo || ''));
  // developers
  const devMap = new Map();
  recs.forEach(r => { const k = (r.developer || '').toUpperCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim(); if (!k) return; if (!devMap.has(k)) devMap.set(k, { name: r.developer, recs: [] }); devMap.get(k).recs.push(r); });
  const devList = [...devMap.values()].sort((a, b) => b.recs.length - a.recs.length || a.name.localeCompare(b.name));
  const devRows = [], contactRows = []; let verifiedContacts = 0, devWithContacts = 0;
  devList.forEach((d, i) => {
    const id = `${name.slice(0, 3).toUpperCase()}-D${String(i + 1).padStart(4, '0')}`;
    const legalKey = Object.keys(contacts).find(k => k.toUpperCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim() === d.name.toUpperCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim());
    const c = legalKey ? devContacts(legalKey) : null; const items = c ? c.items : [];
    const brandLinkNote = legalKey === 'Ten X Realty Limited' ? ' Brand link inferred from Raymond Realty site listing "Ten X" projects; legal entity not named on page.' : '';
    const status = !c ? NPV : (!c.identity ? `${NPV} (official site could not be confirmed/accessed)` : (items.length ? (brandLinkNote ? 'Partially Verified (developer website)' : 'Verified (published on developer website)') : `${NPV} (no tel:/mailto: links on site)`));
    if (items.length) { devWithContacts++; verifiedContacts += items.length; }
    const pick = t => items.filter(x => x.type === t).map(x => x.value).join('; ') || null;
    devRows.push([id, d.name, c && c.identity ? contacts[legalKey].brand : null, c && c.website || null, pick('Published company phone') || NPV, pick('Business email') || NPV, pick('Toll-free enquiry phone') || NPV, pick('Sales/enquiry email') || NPV, NPV,
      [...new Set(d.recs.map(r => r.locality).filter(Boolean))].slice(0, 8).join(', ') + ` (${name})`, null,
      d.recs.slice(0, 15).map(r => r.project).join('; ') + (d.recs.length > 15 ? ` ... (+${d.recs.length - 15})` : ''), d.recs.slice(0, 15).map(r => r.regNo || r.secondaryId).join('; ') + (d.recs.length > 15 ? ' ...' : ''), d.recs.length,
      c && c.contactPage || null, [...new Set(items.map(x => x.source))].join(' ') || null, c ? RESEARCH_DATE : null, status,
      (c && c.excluded.length ? `Excluded from directory: ${c.excluded.join('; ')}.` : '') + brandLinkNote + ' Legal name exactly as on RERA record; office address not collected.']);
    for (const it of items) contactRows.push([id, d.name, it.type, it.value, it.source, RESEARCH_DATE, brandLinkNote ? 'Partially Verified' : 'Verified (developer website)', `Published as a tel:/mailto: link on ${it.source}` + (it.note ? `; ${it.note}` : '')]);
  });
  // sheets
  const projRows = recs.map(toRow);
  const r90 = recs.filter(r => r.regDate && r.regDate >= D90), r365 = recs.filter(r => r.regDate && r.regDate >= D365);
  const statusOrder = {}; recs.forEach(r => statusOrder[r.status] = (statusOrder[r.status] || 0) + 1);
  const statusRows = recs.slice().sort((a, b) => a.status.localeCompare(b.status) || (b.regDate || '').localeCompare(a.regDate || '')).map(r => [r.status, r.regNo, r.project, r.developer, r.regDate || null, r.latestCompletion || null, r.statusDetail || null, r.statusSources || r.sourceUrl]);
  if (name === 'Hyderabad') tgRevoked.forEach(t => statusRows.push(['Revoked (Telangana statewide list - city not stated)', null, t.project, t.promoter, null, null, 'Listed on TG-RERA Revoked Projects/Agents page; no registration number or district given', 'https://rera.telangana.gov.in/Home/Revoked']));
  const missingRows = recs.map(r => { const miss = []; if (!r.regDate) miss.push('Registration date'); if (!r.developer) miss.push('Developer name'); if (!r.sourceUrl) miss.push('Source link'); if (!r.regNo) miss.push('Registration number');
    const dk = (r.developer || '').toUpperCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim(); const drow = devRows.find(x => x[1].toUpperCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim() === dk); if (!drow || /^Not publicly verified/.test(drow[17])) miss.push('Developer contact details');
    if (/no adverse list match|no lapse/i.test(r.status)) miss.push('Status unresolved beyond "registered / not flagged" (no positive official status on listing)');
    return miss.length ? [r.regNo || r.secondaryId, r.project, r.developer, miss.join('; '), r.sourceUrl] : null; }).filter(Boolean);
  // series
  const ser = {}; recs.forEach(r => { const k = r.prefix || '(none)'; const s = ser[k] || (ser[k] = { n: 0, min: '', max: '', minSeq: Infinity, maxSeq: 0, pattern: r.seriesPattern ? r.seriesPattern.replace(/9+/g, m => `9{${m.length}}`) : '', cls: r.seriesCls, ex: r.regNo });
    s.n++; if (r.regDate) { if (!s.min || r.regDate < s.min) s.min = r.regDate; if (!s.max || r.regDate > s.max) s.max = r.regDate; } if (r.seqId) { s.minSeq = Math.min(s.minSeq, r.seqId); s.maxSeq = Math.max(s.maxSeq, r.seqId); } });
  const serRows = Object.entries(ser).sort((a, b) => b[1].n - a[1].n).map(([k, s]) => [k, s.pattern, s.n, s.min || null, s.max || null, s.maxSeq ? `${s.minSeq}-${s.maxSeq}` : null, s.ex, s.cls,
    cfg.mh ? 'Pattern observed in official MahaRERA listing records; letter meanings for PR/PM/PC are UNRESOLVED (no official documentation found)' : (name === 'Bengaluru' ? 'Date segment cross-checked against official APPROVED ON dates' : 'Observed in official regulator list')]);
  // coverage
  const covRows = [];
  if (cfg.mh) {
    const codes = name === 'Mumbai' ? ['519', '518'] : (name === 'Pune' ? ['521'] : ['517']);
    for (const c of covMH.filter(x => codes.includes(x.code))) {
      const tail = c.got.filter(p => p > c.pages - 25).length;
      covRows.push([`MahaRERA registered search - district ${c.district} (code ${c.code})`, 'State=Maharashtra, District filter; results ordered by portal sequence (oldest first)', 'All dates (registration date not shown on listing)', c.pages, c.got.length, mhAll.filter(r => r.district_code === c.code).length, c.total,
        `${(100 * c.got.length / c.pages).toFixed(1)}%`, `Newest-end pages collected: ${tail} of last 25`, `${c.pages - c.got.length} pages not collected (rate limited)`, ['517'].includes(c.code) ? `Taluka split applied: ${name} only. Excluded other talukas: ${JSON.stringify(mhExcluded)}` : '']);
    }
  } else if (name === 'Gurugram') covRows.push(['Haryana RERA registered projects - Gurugram authority', 'Authority list 2 (Gurugram)', 'All dates', 1, 1, grgRaw.length, grgRaw.length, '100%', 'Single page contains full list', 'None', '6 rows have no parseable registration date']);
  else if (name === 'Bengaluru') covRows.push(['RERA Karnataka project status - Bengaluru Urban', 'District = Bengaluru Urban, sub-district = all', 'All dates', 1, 1, kaRaw.length, kaRaw.length, '100%', 'Single response contains full list', 'None', 'Bengaluru Rural district not included']);
  else covRows.push([cfg.scope, 'n/a', 'n/a', 0, 0, 0, null, '0%', 'n/a', cfg.blocked, '']);
  // summary
  const devCount = devList.length, newest = recs.find(r => r.regDate), statusLines = Object.entries(statusOrder).sort((a, b) => b[1] - a[1]);
  const lines = [[`${name.replace('_', '-')} - Latest RERA Projects & Developers`, '', '', 'T'],
    [recs.length ? (cfg.mh ? 'PARTIAL - registered-project listing only partly collected (portal rate limits); registration dates not available from the listing.' : 'Official list collected in full for the stated scope (see Coverage).') : 'NO PROJECT RECORDS - official source not accessible without bypassing CAPTCHA / not reachable. See Coverage.', '', '', 'W'],
    ['Research date', RESEARCH_DATE, 'Latest-90-days window starts ' + D90 + '; 12-month window starts ' + D365], ['Workbook generated', GENERATED, ''], ['Regulator', cfg.regulator, ''], ['Geographic scope', '', cfg.scope], ['', '', ''],
    ['Totals', '', '', 'H'], ['Total project records', recs.length, 'Deduplicated on jurisdiction + exact registration number' + (dupes ? ` (${dupes} duplicates removed)` : '')],
    ['Records with a registration number', recs.filter(r => r.regNo).length, ''], ['New registrations - last 90 days', cfg.mh ? 'n/a' : r90.length, cfg.mh ? 'Registration date not available from MahaRERA listing - see "Newest by Portal Order"' : 'Registration Date >= ' + D90],
    ['New registrations - last 12 months', cfg.mh ? 'n/a' : r365.length, cfg.mh ? 'As above' : 'Registration Date >= ' + D365], ['Latest registration date found', newest ? newest.regDate : (cfg.mh ? 'n/a' : '-'), newest ? `${newest.regNo} - ${newest.project}` : ''],
    ['Unique developers/promoters', devCount, 'Exact legal names; similar names NOT merged'], ['Developers with verified public business contacts', devWithContacts, 'Contacts researched only for selected high-activity developers'], ['Verified public business contact items', verifiedContacts, 'Phones/emails published as tel:/mailto: links on the developer\'s own website'],
    ['Records Verified / Partially Verified', `${recs.filter(r => r.verification === 'Verified').length} / ${recs.filter(r => r.verification === 'Partially Verified').length}`, 'Unverified records are never included'], ['Records with missing data', missingRows.length, 'See Missing Data sheet'], ['', '', ''],
    ['Status breakdown (as officially reported / derived)', '', '', 'H'], ...statusLines.map(([k, v]) => [k, v, '']), ['', '', ''], ['Coverage limitations', '', '', 'H'],
    ...(cfg.blocked ? [[cfg.blocked, '', '']] : []),
    ...(cfg.mh ? [['MahaRERA listing gives no registration, approval or completion dates; these are blank (not guessed). "Newest" = highest portal sequence ID, which tracks application order, not necessarily approval date.', '', ''], ['Status is derived by matching registration numbers against MahaRERA official lists (abeyance, deregistered, NCLT, revoked - revoked search partially collected).', '', ''], ['PR/PM/PC letter meanings are unresolved; no "PP" series was observed. See Registration Series and PC-PP Candidate Patterns.', '', '']] : []),
    ...(name === 'Gurugram' ? [['"Latest Approved Completion Date" is the HARERA "Registration Up-to" date. Original completion dates and QPR dates are not on the list.', '', '']] : []),
    ...(name === 'Bengaluru' ? [['Registration Date = APPROVED ON. QPR dates not collected. 288 rows are rejected/withdrawn applications without a registration number (kept for status review, flagged).', '', '']] : []),
    ['Developer contact details collected only for a small set of high-activity developers; all others are "Not publicly verified".', '', ''], ['', '', ''], ['How to refresh', '', '', 'H'], ['See README.txt in this folder.', '', '']];
  // workbook
  const wb = new ExcelJS.Workbook(); wb.creator = 'RERA research'; wb.created = new Date();
  kvSheet(wb, 'Research Summary', lines);
  addSheet(wb, 'Projects', PCOLS, projRows, { empty: cfg.blocked ? 'No records: ' + cfg.blocked : 'No records collected.', widths: { 'Project Name': 34, 'Promoter/Developer Legal Name': 32, 'Series Classification': 40, 'Missing Fields / Notes': 50, 'Source URL': 45, 'Official Project Detail URL': 40 } });
  addSheet(wb, 'Developers', DEVCOLS, devRows, { empty: 'No developers - no project records collected.', widths: { 'Legal Company/Promoter Name (as on RERA record)': 36, 'Related Project Names': 45, 'Related RERA Registration Numbers': 40, Notes: 50 } });
  addSheet(wb, 'Developer Contacts', CCOLS, contactRows, { empty: 'No verified public business contacts for developers in this workbook.', widths: { Value: 28, 'Source URL': 45, Notes: 45 } });
  addSheet(wb, 'Latest 90 Days', PCOLS, r90.map(toRow), { empty: cfg.mh ? 'Not available: the MahaRERA registered-project listing does not show registration dates, so registrations in the last 90 days cannot be identified from verified data. See "Newest by Portal Order".' : (cfg.blocked ? 'No records: ' + cfg.blocked : `No projects with Registration Date on/after ${D90}.`) });
  addSheet(wb, 'Latest 12 Months', PCOLS, r365.map(toRow), { empty: cfg.mh ? 'Not available: registration dates are not shown on the MahaRERA listing. See "Newest by Portal Order".' : (cfg.blocked ? 'No records: ' + cfg.blocked : `No projects with Registration Date on/after ${D365}.`) });
  if (cfg.mh) addSheet(wb, 'Newest by Portal Order', PCOLS, recs.filter(r => r.seqId).sort((a, b) => b.seqId - a.seqId).slice(0, 200).map(toRow), { empty: 'No records.' });
  addSheet(wb, 'Registration Series', ['Prefix/Series', 'Pattern', 'Record Count', 'Earliest Registration Date', 'Latest Registration Date', 'Portal Sequence Range', 'Example', 'Interpretation', 'Supporting Evidence'], serRows, { empty: 'No registration numbers collected.', widths: { Interpretation: 60, 'Supporting Evidence': 50 } });
  if (cfg.mh) addSheet(wb, 'PC-PP Candidate Patterns', ['Candidate', 'Pattern', 'Count in Collected Official MahaRERA Records (all districts + status lists)', 'Examples', 'Observation', 'Interpretation Status'], candidateRows(), { widths: { Examples: 50, Observation: 45, 'Interpretation Status': 60 } });
  addSheet(wb, 'Status Review', ['Status (official / derived)', 'Registration Number', 'Project Name', 'Developer', 'Registration Date', 'Latest Approved Completion Date', 'Status Detail', 'Status Source URL'], statusRows, { empty: 'No records.' });
  addSheet(wb, 'Missing Data', ['Registration Number / ID', 'Project Name', 'Developer', 'Missing / Unresolved', 'Source URL'], missingRows, { empty: cfg.blocked ? 'Entire market missing: ' + cfg.blocked : 'No missing data.' });
  addSheet(wb, 'Sources', ['Source Name', 'Source URL', 'Record Type', 'Access Date', 'Verification / Access Method', 'Notes'], cfg.sources.map(s => [s[0], s[1], s[2], RESEARCH_DATE, s[3], s[4]]));
  addSheet(wb, 'Coverage', ['Search / Source', 'Filters Used', 'Date Range', 'Pages / Requests Required', 'Pages Collected', 'Records Collected', 'Records Reported by Portal', 'Page Coverage', 'Newest-end Coverage', 'Inaccessible / Errors / Incomplete', 'Notes'], covRows);
  const xlsx = path.join(dir, `${name}_Latest_RERA_Projects.xlsx`);
  await wb.xlsx.writeFile(xlsx);
  writeCsv(path.join(dir, `${name}_Projects.csv`), PCOLS, projRows);
  writeCsv(path.join(dir, `${name}_Developers.csv`), DEVCOLS, devRows);
  writeCsv(path.join(dir, `${name}_Developer_Contacts.csv`), CCOLS, contactRows);
  // sources snapshot list
  fs.writeFileSync(path.join(dir, 'Sources', 'sources.txt'), cfg.sources.map(s => `${s[0]}\n  ${s[1]}\n  ${s[3]}${s[4] ? ' - ' + s[4] : ''}`).join('\n\n') + '\n');
  const readme = [`${name.replace('_', '-')} - Latest RERA Projects & Developers`, '='.repeat(60), `Research date: ${RESEARCH_DATE}   Generated: ${GENERATED}`, `Regulator: ${cfg.regulator}`, `Scope: ${cfg.scope}`, '',
    `Status: ${recs.length ? (cfg.mh ? 'PARTIAL (MahaRERA listing rate-limited; no registration dates on listing)' : 'Official list collected in full for the scope') : 'NO RECORDS - ' + cfg.blocked}`, '',
    `Projects: ${recs.length}   Developers: ${devCount}   Verified contact items: ${verifiedContacts}   Latest registration date: ${newest ? newest.regDate : 'n/a'}`, '',
    'Source portals:', ...cfg.sources.map(s => `  - ${s[0]}: ${s[1]} (${s[3]})`), '',
    'Known limitations:', ...lines.filter((l, i) => i > lines.findIndex(x => x[0] === 'Coverage limitations') && i < lines.findIndex(x => x[0] === 'How to refresh') && l[0]).map(l => '  - ' + l[0]), '',
    'How to refresh:', ...(cfg.mh ? ['  - Re-run the single-stream MahaRERA crawler (tool/crawl4.js) for the last pages of each district; it is checkpointed and stops when throttled.', '  - Registration dates require the project detail pages or certificates (not automated).']
      : name === 'Gurugram' ? ['  - Download https://haryanarera.gov.in/admincontrol/registered_projects/2 (one page) and re-run the builder.'] : name === 'Bengaluru' ? ['  - Submit the Project Status search at https://rera.karnataka.gov.in/viewAllProjects with district "Bengaluru Urban" and re-run the builder.']
      : ['  - ' + cfg.blocked]), '  - Builder: node tool/citybook.js <scratchDir> C:\\Users\\Pushkar\\Documents\\Developers', '', 'Files:', `  ${name}_Latest_RERA_Projects.xlsx, ${name}_Projects.csv, ${name}_Developers.csv, ${name}_Developer_Contacts.csv, Sources/sources.txt`, ''];
  fs.writeFileSync(path.join(dir, 'README.txt'), readme.join('\r\n'));
  recs.forEach(r => masterRows.push(r)); devRows.forEach(d => masterDevs.push([name, ...d]));
  summaryAll.push({ name, file: xlsx, projects: recs.length, developers: devCount, contacts: verifiedContacts, devWithContacts, latest: newest ? newest.regDate : (cfg.mh ? 'n/a (not on listing)' : '-'), r90: cfg.mh ? 'n/a' : r90.length, r365: cfg.mh ? 'n/a' : r365.length, limitation: cfg.blocked || (cfg.mh ? 'Partial listing; no registration dates' : 'Full list for scope'), verified: recs.filter(r => r.verification === 'Verified').length, partial: recs.filter(r => r.verification === 'Partially Verified').length });
  return { projRows: projRows.length, devRows: devRows.length, contactRows: contactRows.length };
}

module.exports = { mhRecs, grgRecs, kaRecs, grgRaw, kaRaw, tgRevoked, CITY, devContacts, contacts, candidateRows, covMH, mhAll, mhExcluded, mhFlags, L, RESEARCH_DATE, D90, D365, GENERATED, mhDupes };
if (require.main === module) (async () => {
  fs.mkdirSync(ROOT, { recursive: true });
  const counts = {};
  for (const c of ['Mumbai', 'Thane', 'Kalyan_Dombivli', 'Pune', 'Gurugram', 'Bengaluru', 'Hyderabad', 'Delhi', 'Dubai']) counts[c] = await buildCity(c);
  // master
  const wb = new ExcelJS.Workbook(); wb.creator = 'RERA research';
  kvSheet(wb, 'Research Summary', [['MASTER - Developers & RERA Projects Database', '', '', 'T'], ['Consolidated from the nine city workbooks (city files are unchanged). Do not treat as complete - see per-city coverage.', '', '', 'W'], ['Research date', RESEARCH_DATE, ''], ['Generated', GENERATED, ''], ['', '', ''],
    ['City', 'Projects', 'Developers / verified contact items / latest registration date / limitation', 'H'], ...summaryAll.map(s => [s.name, s.projects, `${s.developers} developers; ${s.contacts} verified contact items; latest registration date: ${s.latest}; ${s.limitation}`]),
    ['TOTAL', summaryAll.reduce((a, s) => a + s.projects, 0), `${summaryAll.reduce((a, s) => a + s.developers, 0)} developer rows (per city; the same company may appear in several cities)`]]);
  addSheet(wb, 'All Projects', PCOLS, masterRows.map(toRow), { widths: { 'Project Name': 34, 'Promoter/Developer Legal Name': 32, 'Missing Fields / Notes': 50 } });
  addSheet(wb, 'All Developers', ['City', ...DEVCOLS], masterDevs);
  addSheet(wb, 'City Summary', ['City', 'Workbook Path', 'Projects', 'Verified', 'Partially Verified', 'Developers', 'Developers with Verified Contacts', 'Verified Contact Items', 'Latest Registration Date', 'New - Last 90 Days', 'New - Last 12 Months', 'Coverage Limitation'], summaryAll.map(s => [s.name, s.file, s.projects, s.verified, s.partial, s.developers, s.devWithContacts, s.contacts, s.latest, s.r90, s.r365, s.limitation]));
  addSheet(wb, 'PC-PP Candidate Patterns', ['Candidate', 'Pattern', 'Count in Collected Official MahaRERA Records (all districts + status lists)', 'Examples', 'Observation', 'Interpretation Status'], candidateRows());
  await wb.xlsx.writeFile(path.join(ROOT, 'MASTER_Developers_RERA_Database.xlsx'));
  writeCsv(path.join(ROOT, 'MASTER_All_Projects.csv'), PCOLS, masterRows.map(toRow));
  writeCsv(path.join(ROOT, 'MASTER_All_Developers.csv'), ['City', ...DEVCOLS], masterDevs);
  fs.writeFileSync(path.join(ROOT, 'build_summary.json'), JSON.stringify({ researchDate: RESEARCH_DATE, generated: GENERATED, cities: summaryAll, counts, mhExcluded, mhDupes }, null, 1));
  console.log(JSON.stringify(summaryAll.map(s => ({ city: s.name, projects: s.projects, devs: s.developers, contacts: s.contacts, latest: s.latest, r90: s.r90, r365: s.r365 })), null, 1));
})();
