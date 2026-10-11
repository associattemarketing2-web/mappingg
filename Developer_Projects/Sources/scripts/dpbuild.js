// Build Developer_Projects/ (city workbooks + master) from verified official records.
// Usage: node dpbuild.js <scratchDir> <outDir>
const fs = require('fs'), path = require('path');
const ExcelJS = require('exceljs');
const C = require('./citybook.js'); // loads + normalises official records (argv[2] = scratchDir)
const OUT = process.argv[3];
const { RESEARCH_DATE, D90, D365, GENERATED } = C;
const NPV = 'Not publicly verified';
const CITIES = ['Mumbai', 'Thane', 'Kalyan_Dombivli', 'Pune', 'Hyderabad', 'Bengaluru', 'Delhi', 'Gurugram', 'Dubai'];
const JUR = {
  Maharashtra: { jurisdiction: 'India - Maharashtra', regulator: 'MahaRERA', numType: 'MahaRERA project registration number' },
  Haryana: { jurisdiction: 'India - Haryana (Gurugram authority)', regulator: 'HARERA Gurugram', numType: 'HARERA registration certificate number' },
  Karnataka: { jurisdiction: 'India - Karnataka', regulator: 'RERA Karnataka', numType: 'Karnataka RERA project registration number' },
};

// ---------- status categories (mutually exclusive primary category) ----------
function category(r) {
  if (r.state === 'Maharashtra') return ({ 'Revoked': 'Revoked', 'Deregistered': 'Deregistered', 'Abeyance - lapse of completion date': 'Lapsed (abeyance: completion date lapsed)', 'Abeyance - QPR non-compliance': 'Abeyance (QPR non-compliance)', 'Abeyance - common bank account': 'Abeyance (common bank account)' })[r.status] || 'Registered - current status not confirmed';
  if (r.state === 'Haryana') {
    if (r.status === 'Lapsed') return 'Lapsed';
    if (/Superseded/.test(r.status)) return 'Superseded (certificate replaced)';
    if (r.latestCompletion && r.latestCompletion >= RESEARCH_DATE) return 'Registered - within registration validity (per list)';
    if (r.latestCompletion) return 'Registered - validity date passed, not flagged lapsed';
    return 'Registered - validity date not shown';
  }
  if (r.state === 'Karnataka') {
    if (r.status === 'APPROVED') return r.latestCompletion && r.latestCompletion >= RESEARCH_DATE ? 'Approved - within proposed completion date' : 'Approved - proposed completion date passed';
    return ({ REJECTED: 'Rejected (no registration)', WITHDRAWN: 'Withdrawn', REVOKED: 'Revoked', TRANSFERED: 'Transferred' })[r.status] || r.status;
  }
  return r.status;
}

// ---------- normalise records into the Developer_Projects schema ----------
function norm(r) {
  const j = JUR[r.state];
  const ext = r.extension === 'Yes' || (r.state === 'Haryana' && false);
  const notes = [];
  let verification, revised = null, validUpTo = null, ncltDate = null;
  if (r.state === 'Maharashtra') {
    verification = 'Partially Verified';
    notes.push('Verified on official MahaRERA listing: registration no., project, promoter, district, taluka, pincode.');
    notes.push('Registration/approval/completion/QPR dates and address are NOT shown on the listing - left blank.');
    notes.push('Status derived from official MahaRERA lists; the Revoked search was only partly collected.');
    if (r.latestCompletion) { ncltDate = r.latestCompletion; notes.push('Proposed completion date from official NCLT list (as on 31-01-2025) - shown separately, not as a revised completion date.'); }
    if (r.extension === 'Yes') notes.push('Listing shows an Extension Certificate.');
  } else if (r.state === 'Haryana') {
    verification = r.regDate && r.regNo ? 'Verified' : 'Partially Verified';
    validUpTo = r.latestCompletion || null;
    notes.push('Registration date = certificate "DATED" date on the official HARERA list.');
    if (validUpTo) notes.push('"Registration Valid Up To" is the HARERA "Registration Up-to" date (not labelled a completion date).');
    if (!r.regDate) notes.push('Registration date not shown on the official list.');
    notes.push('Original/revised completion and QPR dates not on list.');
  } else if (r.state === 'Karnataka') {
    verification = r.regNo && r.approvalDate ? 'Verified' : 'Partially Verified';
    if (r.latestCompletion && r.origCompletion && r.latestCompletion !== r.origCompletion) revised = r.latestCompletion;
    if (!r.regNo) notes.push('Application without registration number (rejected/withdrawn) - official record of the application only.');
    else notes.push('Registration/approval date = "APPROVED ON" on the official RERA Karnataka list (registration number date segment cross-checked, not used as the source).');
    if (r.latestCompletion && !revised) notes.push('Current proposed completion date equals the original - no revision shown.');
    if (r.extension === 'Yes') notes.push('Extension recorded on official list (see Status Detail).');
    notes.push('QPR dates and address not collected.');
  }
  return {
    country: r.country, state: r.state, city: r.city, district: r.district, locality: r.locality || null, project: r.project, regNo: r.regNo || null, prefix: r.prefix || null,
    developer: r.developer || null, brand: null, projectType: r.projectType || null, status: r.status, regDate: r.regDate || null,
    approvalDate: r.state === 'Karnataka' ? r.approvalDate || null : null, origCompletion: r.origCompletion || null, revised, progressDate: null,
    address: r.state === 'Haryana' ? r.address || null : null, projectUrl: r.detailUrl || null, devUrl: null, sourceUrl: r.sourceUrl, verification, verified: r.verified, notes: notes.join(' '),
    jurisdiction: j.jurisdiction, regulator: j.regulator, numType: j.numType, category: category(r), extension: r.extension === 'Yes' ? 'Yes' : (r.extension === 'No' ? 'No' : null),
    validUpTo, ncltDate, pincode: r.pincode || null, secondaryId: r.secondaryId || null, rawReg: r.rawReg || null, statusDetail: r.statusDetail || null, statusSources: r.statusSources || null,
    seqId: r.seqId || null, lastModified: r.lastModified || null, seriesCls: r.seriesCls, seriesPattern: r.seriesPattern,
  };
}
const ALL = { Mumbai: C.mhRecs.filter(r => r.city === 'Mumbai'), Thane: C.mhRecs.filter(r => r.city === 'Thane'), Kalyan_Dombivli: C.mhRecs.filter(r => r.city === 'Kalyan_Dombivli'), Pune: C.mhRecs.filter(r => r.city === 'Pune'),
  Gurugram: C.grgRecs, Bengaluru: C.kaRecs, Hyderabad: [], Delhi: [], Dubai: [] };

const PCOLS = ['Country', 'State/Emirate', 'City', 'District', 'Locality', 'Project Name', 'Exact RERA/Regulatory Registration Number', 'Registration Series/Prefix', 'Developer Legal Name', 'Developer Brand Name', 'Project Type', 'Project Status', 'Registration Date', 'Approval Date', 'Original Completion Date', 'Revised Completion Date', 'Latest Progress Update Date', 'Project Address', 'Official Project URL', 'Official Developer URL', 'Source URL', 'Verification Status', 'Last Verified Date', 'Data Quality Notes',
  'Jurisdiction', 'Regulator', 'Regulatory Number Type', 'Status Category (primary)', 'Extension Indicated', 'Registration Valid Up To (HARERA)', 'Proposed Completion (MahaRERA NCLT list)', 'Pincode', 'Secondary Identifier (project ID / ack. no.)', 'Original Source Registration Text', 'Status Detail (official)', 'Status Source URL(s)', 'Portal Sequence ID (MahaRERA)', 'Source Last Modified (MahaRERA)'];
const prow = p => [p.country, p.state, p.city, p.district, p.locality, p.project, p.regNo, p.prefix, p.developer, p.brand, p.projectType, p.status, p.regDate, p.approvalDate, p.origCompletion, p.revised, p.progressDate, p.address, p.projectUrl, p.devUrl, p.sourceUrl, p.verification, p.verified, p.notes,
  p.jurisdiction, p.regulator, p.numType, p.category, p.extension, p.validUpTo, p.ncltDate, p.pincode, p.secondaryId, p.rawReg, p.statusDetail, p.statusSources, p.seqId, p.lastModified];
const DCOLS = ['Developer ID', 'Legal Company Name', 'Brand Name', 'Official Website', 'Public Business Phone', 'Public Sales/Enquiry Phone', 'Public Business Email', 'Public Sales/Enquiry Email', 'Registered/Official Business Address', 'Related Projects', 'Related Registration Numbers', 'Official Contact Page', 'Contact Source URL', 'Contact Verification Status', 'Last Verified Date', 'Notes', 'Project Count (this city)', 'Name Variants on RERA Records'];
const CCOLS = ['City', 'Developer ID', 'Legal Company Name', 'Contact Type', 'Value', 'Source URL', 'Verification Status', 'Last Verified Date', 'Notes'];

// ---------- excel helpers ----------
const font = { name: 'Arial', size: 10 }, linkFont = { ...font, color: { argb: 'FF0563C1' }, underline: true };
const isUrl = v => typeof v === 'string' && /^https?:\/\/\S+$/.test(v);
const TEXT_RE = /Registration Number|Registration Numbers|Value|Phone|Pincode|Secondary Identifier|Original Source Registration|Example/i;
const WRAP_RE = /Notes|Name|Detail|Related|Interpretation|Evidence|Observation|Missing|Description|Resolution|Value|Limitation|Fields|Issue|Classification/i;
function sheet(wb, name, cols, rows, opt = {}) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: opt.banner ? 2 : 1 }] });
  if (opt.banner) { const b = ws.addRow([opt.banner]); b.font = { ...font, bold: true, color: { argb: 'FFC00000' } }; b.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } }; ws.mergeCells(1, 1, 1, Math.min(cols.length, 12)); }
  const hr = ws.addRow(cols); const hn = hr.number;
  hr.font = { ...font, bold: true, color: { argb: 'FFFFFFFF' } }; hr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } }; hr.alignment = { wrapText: true, vertical: 'middle' }; hr.height = 32;
  rows.forEach(r => ws.addRow(r.map(v => v === '' || v === undefined ? null : (isUrl(v) ? { text: v, hyperlink: v } : v))));
  const textC = new Set(), wrapC = new Set(); cols.forEach((c, i) => { if (TEXT_RE.test(c)) textC.add(i + 1); if (WRAP_RE.test(c)) wrapC.add(i + 1); });
  ws.columns.forEach((c, i) => { c.width = (opt.widths || {})[cols[i]] || (wrapC.has(i + 1) ? 34 : Math.min(28, Math.max(12, cols[i].length * 0.85))); if (textC.has(i + 1)) c.numFmt = '@'; });
  const vcol = cols.indexOf('Verification Status') + 1;
  ws.eachRow((row, n) => { if (n <= hn) return; row.eachCell({ includeEmpty: false }, (cell, ci) => {
    cell.font = cell.value && cell.value.hyperlink ? linkFont : font; if (wrapC.has(ci)) cell.alignment = { wrapText: true, vertical: 'top' }; if (textC.has(ci)) cell.numFmt = '@'; });
    if (vcol) { const v = row.getCell(vcol).value; if (v === 'Partially Verified') row.getCell(vcol).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } }; if (v === 'Unverified') row.getCell(vcol).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4CCCC' } }; }
  });
  ws.autoFilter = { from: { row: hn, column: 1 }, to: { row: hn, column: cols.length } };
  if (!rows.length && opt.empty) { const e = ws.addRow([opt.empty]); e.font = { ...font, italic: true, color: { argb: 'FFC00000' } }; }
  return ws;
}
function kv(wb, name, lines) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 2 }] }); ws.columns = [{ width: 58 }, { width: 24 }, { width: 100 }];
  lines.forEach(l => { const r = ws.addRow(l.slice(0, 3).map(v => isUrl(v) ? { text: v, hyperlink: v } : v)); r.font = font; r.alignment = { wrapText: true, vertical: 'top' };
    if (l[3] === 'T') r.font = { ...font, size: 14, bold: true }; if (l[3] === 'W') { r.font = { ...font, bold: true, color: { argb: 'FFC00000' } }; r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } }; }
    if (l[3] === 'H') { r.font = { ...font, bold: true, color: { argb: 'FFFFFFFF' } }; r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } }; } });
  return ws;
}
const esc = v => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const csv = (f, cols, rows) => fs.writeFileSync(f, '﻿' + [cols, ...rows].map(r => r.map(esc).join(',')).join('\r\n') + '\r\n');
const nkey = s => (s || '').toUpperCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();

// ---------- sources per city ----------
const SRC_FIELDS = {
  mh: [['MahaRERA Registered Projects search', 'https://www.maharera.maharashtra.gov.in/projects-search-result', 'Official regulator search listing', 'Registration no., project, promoter, district, taluka/locality, pincode, project detail URL, extension flag, last modified', 'Public GET pages; single rate-limited stream; parsed from saved HTML'],
    ['MahaRERA abeyance - lapse of completion date', C.L.urls.lapse, 'Official regulator list', 'Lapsed status', 'Full HTML table matched on exact registration no.'], ['MahaRERA abeyance - QPR non-compliance', C.L.urls.qpr, 'Official regulator list', 'Abeyance status', 'Full HTML table matched on exact registration no.'],
    ['MahaRERA abeyance - common bank account', C.L.urls.cba, 'Official regulator list', 'Abeyance status', 'Full HTML table matched on exact registration no.'], ['MahaRERA deregistered projects', C.L.urls.dereg, 'Official regulator list', 'Deregistered status', 'Full HTML table matched on exact registration no.'],
    ['MahaRERA NCLT projects', C.L.urls.nclt, 'Official regulator list', 'NCLT flag, proposed completion date (as on 31-01-2025)', 'Full HTML table matched on exact registration no.'], ['MahaRERA Revoked Projects search', 'https://www.maharera.maharashtra.gov.in/projects-search-result?project_state=27&project_district=0&project_type=1', 'Official regulator search listing', 'Revoked status', 'Public GET pages - PARTIALLY collected'],
    ['MahaRERA project detail application', 'https://maharerait.maharashtra.gov.in/public/project/view/', 'Official regulator (JavaScript app)', 'Not collected (would hold registration/completion/QPR dates)', 'Linked per project only']],
  Gurugram: [['Haryana RERA - registered projects, Gurugram authority', 'https://haryanarera.gov.in/admincontrol/registered_projects/2', 'Official regulator list', 'Certificate no. + date, project ID, project, builder, location, registration valid up to, lapse/superseded flags, detail/certificate/QPR links', 'Single public page, parsed from saved HTML'],
    ['HARERA Gurugram portal', 'https://hareraggm.gov.in/en/', 'Official regulator portal', 'Discovery only', 'Read'], ['Haryana RERA project detail', 'https://haryanarera.gov.in/view_project/searchprojectDetail/', 'Official regulator page', 'Linked per project; 1 page checked manually (approval status)', 'Spot-check']],
  Bengaluru: [['RERA Karnataka - Project Status', 'https://rera.karnataka.gov.in/viewAllProjects', 'Official regulator list', 'Ack no., registration no., promoter, project, status, district, taluk, project type, approved-on date, original & current proposed completion dates, extension dates, certificate link', 'Public search form, district = Bengaluru Urban; one response parsed from saved HTML'],
    ['RERA Karnataka - registration certificate', 'https://rera.karnataka.gov.in/certificate?CER_NO=', 'Official regulator document', 'Linked per project', 'Not bulk-collected']],
  Hyderabad: [['Telangana RERA - Search Registered Projects', 'https://rerait.telangana.gov.in/SearchList/Search', 'Official regulator search', 'None - CAPTCHA required', 'Not automated (no CAPTCHA bypass)'], ['Telangana RERA - Revoked Projects/Agents', 'https://rera.telangana.gov.in/Home/Revoked', 'Official regulator list', 'Statewide revoked projects/agents (no reg nos, no district) - Status Review only', 'Public page']],
  Delhi: [['Delhi RERA portal', 'https://rera.delhi.gov.in/', 'Official regulator portal', 'None - unreachable', 'Connection timed out / refused from two networks on ' + RESEARCH_DATE]],
  Dubai: [['DLD Real Estate Project Status', 'https://dubailand.gov.ae/en/eservices/real-estate-project-status-landing/real-estate-project-status', 'Official regulator e-service', 'None - reCAPTCHA-protected', 'Not automated'], ['DLD Approved Developers', 'https://dubailand.gov.ae/en/eservices/approved-developers-overview/approved-developers', 'Official regulator e-service', 'None - reCAPTCHA-protected', 'Not automated'],
    ['DLD Open Data - Real Estate Data', 'https://dubailand.gov.ae/en/open-data/real-estate-data/', 'Official open data', 'None - reCAPTCHA-protected API', 'Not automated'], ['Dubai Pulse - DLD projects dataset', 'https://www.dubaipulse.gov.ae/data/dld-registration/dld_projects-open', 'Official open data', 'None - connection refused; API key required', 'Request access']],
};
const DEV_SRC = ['Developer official websites (contacts)', '(per contact - see Contact Source URL)', 'Official developer website', 'Public business phone/email (tel:/mailto: links only)', 'Fetched site pages; identity confirmed by company name on page; personal/third-party/placeholder values excluded'];

// ---------- per-city build ----------
const cityOut = {}; const masterP = [], masterD = [], masterC = [], masterSeries = [], masterMissing = [], masterSources = [], dupReview = [], excludedContacts = [];
async function buildCity(city) {
  const cfg = C.CITY[city]; const dir = path.join(OUT, city); fs.mkdirSync(dir, { recursive: true });
  const mh = !!cfg.mh, blocked = cfg.blocked || null;
  let recs = ALL[city].map(norm);
  const seen = new Map(); const dropped = [];
  recs = recs.filter(p => { const k = p.jurisdiction + '|' + (p.regNo || 'ACK:' + p.secondaryId); if (seen.has(k)) { dropped.push([k, p.project, seen.get(k)]); return false; } seen.set(k, p.project); return true; });
  dropped.forEach(d => dupReview.push([city, 'Duplicate registration within city', d[0], d[2], d[1], 'Same jurisdiction + registration no. - second occurrence removed']));
  recs.sort((a, b) => (b.regDate || '').localeCompare(a.regDate || '') || (b.seqId || 0) - (a.seqId || 0) || (a.regNo || '').localeCompare(b.regNo || ''));
  // developers
  const dm = new Map(); recs.forEach(p => { if (!p.developer) return; const k = nkey(p.developer); if (!dm.has(k)) dm.set(k, { variants: {}, recs: [] }); const d = dm.get(k); d.variants[p.developer] = (d.variants[p.developer] || 0) + 1; d.recs.push(p); });
  const devs = [...dm.entries()].sort((a, b) => b[1].recs.length - a[1].recs.length || a[0].localeCompare(b[0]));
  const dRows = [], cRows = []; let devWithContacts = 0;
  devs.forEach(([k, d], i) => {
    const id = `${city.slice(0, 3).toUpperCase()}-D${String(i + 1).padStart(4, '0')}`;
    const legal = Object.entries(d.variants).sort((a, b) => b[1] - a[1])[0][0];
    const ck = Object.keys(C.contacts).find(x => nkey(x) === k); const c = ck ? C.devContacts(ck) : null; const items = c ? c.items : [];
    const tenx = ck === 'Ten X Realty Limited';
    if (c) c.excluded.forEach(e => excludedContacts.push([city, legal, e, 'Excluded']));
    if (c && !c.identity) excludedContacts.push([city, legal, `${C.contacts[ck].domain} - site not reachable / identity not confirmed`, 'No contacts taken']);
    const status = !c ? NPV : (!c.identity ? `${NPV} (official site not reachable/confirmed)` : (items.length ? (tenx ? 'Partially Verified' : 'Verified') : `${NPV} (no published tel:/mailto: links found)`));
    if (items.length) devWithContacts++;
    const pick = (t, f) => items.filter(x => f(x)).map(x => x.value).join('; ') || null;
    const brand = c && c.identity ? C.contacts[ck].brand : null;
    d.recs.forEach(p => { p.brand = brand; });
    dRows.push([id, legal, brand, c && c.website || null, pick(0, x => x.type === 'Published company phone'), pick(0, x => x.type === 'Toll-free enquiry phone'), pick(0, x => x.type === 'Business email'), pick(0, x => x.type === 'Sales/enquiry email'), null,
      d.recs.slice(0, 20).map(p => p.project).join('; ') + (d.recs.length > 20 ? ` ... (+${d.recs.length - 20} more)` : ''), d.recs.slice(0, 20).map(p => p.regNo || p.secondaryId).join('; ') + (d.recs.length > 20 ? ' ...' : ''),
      c && c.contactPage || null, [...new Set(items.map(x => x.source))].join(' ') || null, status, c ? RESEARCH_DATE : null,
      [items.length ? '' : 'Contact fields blank = not publicly verified.', tenx ? 'Brand link (Raymond Realty / Ten X) inferred from developer site listing "Ten X" projects; legal entity not named on page.' : '', 'Business address not collected.'].filter(Boolean).join(' '),
      d.recs.length, Object.keys(d.variants).length > 1 ? Object.keys(d.variants).join(' | ') : null]);
    items.forEach(it => cRows.push([city, id, legal, it.type, it.value, it.source, tenx ? 'Partially Verified' : 'Verified', RESEARCH_DATE, `Published as tel:/mailto: link on developer website${it.note ? '; ' + it.note : ''}`]));
  });
  // sheets data
  const pRows = recs.map(prow);
  const r90 = recs.filter(p => p.regDate && p.regDate >= D90 && p.regDate <= RESEARCH_DATE), r365 = recs.filter(p => p.regDate && p.regDate >= D365 && p.regDate <= RESEARCH_DATE);
  const catCount = {}; recs.forEach(p => catCount[p.category] = (catCount[p.category] || 0) + 1);
  const statusRows = recs.slice().sort((a, b) => a.category.localeCompare(b.category) || (b.regDate || '').localeCompare(a.regDate || '')).map(p => [p.category, p.status, p.extension, p.regNo || p.secondaryId, p.project, p.developer, p.regDate, p.validUpTo || p.revised || p.origCompletion, p.statusDetail, p.statusSources || p.sourceUrl, p.verified]);
  if (city === 'Hyderabad') C.tgRevoked.forEach(t => statusRows.push(['Revoked (Telangana statewide list - city not stated)', 'Revoked', null, null, t.project, t.promoter, null, null, 'Listed on TG-RERA Revoked Projects/Agents page; no registration number or district given', 'https://rera.telangana.gov.in/Home/Revoked', RESEARCH_DATE]));
  const devStatus = new Map(dRows.map(r => [nkey(r[1]), r[13]]));
  const missRows = recs.map(p => { const m = []; if (!p.regNo) m.push('Registration number'); if (!p.regDate) m.push('Registration date'); if (!p.developer) m.push('Developer'); if (!p.sourceUrl) m.push('Source URL');
    if (!p.origCompletion && !p.revised && !p.validUpTo) m.push('Completion date'); if (!p.progressDate) m.push('Latest progress update date'); if (!p.address) m.push('Project address');
    if (/not confirmed|validity date passed|completion date passed|not shown/.test(p.category)) m.push(`Status unresolved: ${p.category}`);
    if (!/^Verified|Partially Verified$/.test(devStatus.get(nkey(p.developer)) || '')) m.push('Developer public contacts');
    return [city, p.regNo || p.secondaryId, p.project, p.developer, p.verification, m.join('; '), p.sourceUrl]; });
  // registration series
  const ser = {}; recs.forEach(p => { const k = p.prefix || '(no registration number)'; const s = ser[k] || (ser[k] = { n: 0, ex: [], min: null, max: null, cls: p.seriesCls, pat: p.seriesPattern });
    s.n++; if (s.ex.length < 3 && p.regNo) s.ex.push(p.regNo); if (p.regDate) { if (!s.min || p.regDate < s.min) s.min = p.regDate; if (!s.max || p.regDate > s.max) s.max = p.regDate; } });
  const serRows = Object.entries(ser).sort((a, b) => b[1].n - a[1].n).map(([k, s]) => ['Observed in this city', k, s.pat ? s.pat.replace(/9+/g, m => `9{${m.length}}`) : null, s.n, s.ex.join(', '), s.min, s.max, s.cls,
    mh ? 'Official MahaRERA listing records (see Source URL of each example)' : (city === 'Bengaluru' ? 'Official RERA Karnataka list; date segment cross-checked against APPROVED ON' : 'Official HARERA list'), mh && /^P[A-Z]$/.test(k) ? 'UNRESOLVED' : 'Observed pattern']);
  if (mh) C.candidateRows().forEach(c => serRows.push(['PC/PP candidate analysis (all collected MahaRERA records)', c[0], c[1], c[2], c[3], null, null, c[5], c[4], /UNRESOLVED|No evidence/.test(c[5]) ? 'UNRESOLVED' : 'Observed pattern']));
  // sources
  const srcList = (mh ? SRC_FIELDS.mh : SRC_FIELDS[city]).concat(cRows.length ? [DEV_SRC] : []);
  const srcRows = srcList.map(s => [s[0], s[1], s[2], RESEARCH_DATE, s[3], s[4]]);
  // coverage text
  let coverage = [];
  if (mh) { const codes = city === 'Mumbai' ? ['519', '518'] : (city === 'Pune' ? ['521'] : ['517']);
    coverage = C.covMH.filter(c => codes.includes(c.code)).map(c => `District ${c.district}: ${c.got.length} of ${c.pages} listing pages collected (${(100 * c.got.length / c.pages).toFixed(1)}%), ${c.got.filter(p => p > c.pages - 25).length} of the newest 25 pages; portal total ${c.total} records for the whole district.`);
    if (city === 'Thane' || city === 'Kalyan_Dombivli') coverage.push(`Thane-district records split by taluka: Thane -> Thane workbook, Kalyan -> Kalyan_Dombivli workbook. Other talukas excluded: ${Object.entries(C.mhExcluded).map(([k, v]) => `${k.split(' / ')[1]} ${v}`).join(', ')}.`); }
  else if (city === 'Gurugram') coverage = ['Full official list for the Gurugram authority (1 page, ' + C.grgRaw.length + ' rows).'];
  else if (city === 'Bengaluru') coverage = ['Full official RERA Karnataka list for district Bengaluru Urban (' + C.kaRaw.length + ' rows). Bengaluru Rural not included.'];
  else coverage = [blocked];
  const partial = mh || !!blocked;
  const banner = blocked ? `NO PROJECT DATA - ${blocked}` : (mh ? 'PARTIAL DATASET - MahaRERA listing only partly collected (rate limits); registration dates not available from the listing.' : null);
  const newest = recs.find(p => p.regDate && p.verification === 'Verified');
  const verifiedContacts = cRows.filter(r => r[6] === 'Verified').length;
  const summary = [[`${city.replace('_', '-')} - Developer Projects`, '', '', 'T'], [partial ? 'PARTIAL DATASET' + (blocked ? ' - NO RECORDS AVAILABLE' : '') : 'Official list collected in full for the stated scope (not a guarantee of factual accuracy of every source value).', '', banner || '', partial ? 'W' : ''],
    ['Research date', RESEARCH_DATE, `Latest 90 Days window: ${D90} to ${RESEARCH_DATE}; Latest 12 Months window: ${D365} to ${RESEARCH_DATE}`], ['Generated', GENERATED, ''], ['Regulator', cfg.regulator, ''], ['Scope', '', cfg.scope], ['', '', ''],
    ['Counts', '', '', 'H'], ['Project records', recs.length, 'Deduplicated on jurisdiction + exact registration number'], ['Unique developers (legal names)', devs.length, 'Grouped only when identical after whitespace/case/punctuation normalisation'],
    ['Latest verified registration date', newest ? newest.regDate : 'n/a', newest ? `${newest.regNo} - ${newest.project}` : (mh ? 'MahaRERA listing shows no registration dates' : '')],
    ['Registrations in last 90 days', mh ? 'n/a' : r90.length, mh ? 'Not determinable from verified data' : ''], ['Registrations in last 12 months', mh ? 'n/a' : r365.length, mh ? 'Not determinable from verified data' : ''],
    ['Verified / Partially Verified / Unverified records', `${recs.filter(p => p.verification === 'Verified').length} / ${recs.filter(p => p.verification === 'Partially Verified').length} / 0`, mh ? 'MahaRERA records are Partially Verified: registration date and full status are unavailable' : ''],
    ['Verified public business contact items', verifiedContacts, `${cRows.length - verifiedContacts} additional partially verified; ${devWithContacts} developers with any contact`], ['Records with missing important fields', missRows.filter(r => r[5]).length, 'See Missing Data'], ['', '', ''],
    ['Status categories (primary, mutually exclusive)', '', '', 'H'], ...Object.entries(catCount).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, v, '']), ['Extension indicated (flag, overlaps categories above)', recs.filter(p => p.extension === 'Yes').length, ''],
    ['Completed (official completion status)', 'n/a', 'No collected official source states completion/OC status'], ['', '', ''],
    ['Incomplete fields', '', '', 'H'], ...['Registration Date', 'Original Completion Date', 'Latest Progress Update Date', 'Project Address', 'Developer Brand Name'].map(f => [f + ' blank', recs.filter(p => !p[{ 'Registration Date': 'regDate', 'Original Completion Date': 'origCompletion', 'Latest Progress Update Date': 'progressDate', 'Project Address': 'address', 'Developer Brand Name': 'brand' }[f]]).length, '']), ['', '', ''],
    ['Coverage limitations', '', '', 'H'], ...coverage.map(c => [c, '', '']), ...(mh ? [['PR/PM/PC letter meanings unresolved; no "PP" series observed.', '', '']] : []), ['Developer contacts researched only for selected high-activity developers.', '', '']];
  // workbook
  const wb = new ExcelJS.Workbook(); wb.creator = 'Developer_Projects build'; wb.created = new Date();
  kv(wb, 'Summary', summary);
  sheet(wb, 'Projects', PCOLS, pRows, { banner, empty: blocked ? 'No records. ' + blocked : 'No records.', widths: { 'Project Name': 34, 'Developer Legal Name': 32, 'Data Quality Notes': 60, 'Source URL': 45, 'Official Project URL': 40 } });
  sheet(wb, 'Developers', DCOLS, dRows, { banner, empty: 'No developers (no project records).', widths: { 'Legal Company Name': 36, 'Related Projects': 45, 'Related Registration Numbers': 40, Notes: 45 } });
  sheet(wb, 'Latest 90 Days', PCOLS, r90.map(prow), { banner, empty: mh ? 'Not available: MahaRERA listing shows no registration dates; no verified dates to filter.' : (blocked ? 'No records. ' + blocked : `No projects with verified registration date between ${D90} and ${RESEARCH_DATE}.`) });
  sheet(wb, 'Latest 12 Months', PCOLS, r365.map(prow), { banner, empty: mh ? 'Not available: MahaRERA listing shows no registration dates.' : (blocked ? 'No records. ' + blocked : `No projects with verified registration date between ${D365} and ${RESEARCH_DATE}.`) });
  sheet(wb, 'Registration Series', ['Section', 'Prefix/Series', 'Pattern', 'Count', 'Exact Example Numbers', 'Earliest Registration Date', 'Latest Registration Date', 'Interpretation', 'Source Evidence', 'Interpretation Status'], serRows, { empty: 'No registration numbers collected.', widths: { Interpretation: 60, 'Source Evidence': 45, 'Exact Example Numbers': 40 } });
  sheet(wb, 'Status Review', ['Status Category (primary)', 'Official Status Value', 'Extension Indicated', 'Registration Number / ID', 'Project Name', 'Developer', 'Registration Date', 'Validity / Completion Date', 'Status Detail', 'Status Source URL', 'Status Checked Date'], statusRows, { empty: blocked ? 'No records. ' + blocked : 'No records.' });
  sheet(wb, 'Missing Data', ['City', 'Registration Number / ID', 'Project Name', 'Developer', 'Verification Status', 'Missing / Unresolved', 'Source URL'], blocked ? [[city, null, null, null, null, 'ENTIRE MARKET: ' + blocked, srcList[0][1]]] : missRows.filter(r => r[5]), { widths: { 'Missing / Unresolved': 60 } });
  sheet(wb, 'Sources', ['Source Name', 'Source URL', 'Source Type', 'Access Date', 'Field(s) Supported', 'Verification Method'], srcRows, { widths: { 'Field(s) Supported': 60, 'Verification Method': 45 } });
  sheet(wb, 'Developer Contacts', CCOLS, cRows, { empty: 'No verified public business contacts for developers in this city.' });
  const xf = path.join(dir, `${city}_Projects.xlsx`); await wb.xlsx.writeFile(xf);
  csv(path.join(dir, `${city}_Projects.csv`), PCOLS, pRows);
  csv(path.join(dir, `${city}_Developers.csv`), DCOLS, dRows);
  fs.writeFileSync(path.join(dir, 'README.md'), [`# ${city.replace('_', '-')} - Developer Projects`, '', partial ? `**PARTIAL DATASET.** ${banner}` : 'Official list collected in full for the stated scope.', '',
    `- Research date: ${RESEARCH_DATE} (generated ${GENERATED})`, `- Regulator: ${cfg.regulator}`, `- Scope: ${cfg.scope}`, `- Projects: ${recs.length} | Developers: ${devs.length} | Verified contact items: ${verifiedContacts} | Latest verified registration date: ${newest ? newest.regDate : 'n/a'}`, '',
    '## Sources', ...srcList.map(s => `- ${s[0]}: ${s[1]} - ${s[4]}`), '', '## Coverage and limitations', ...coverage.map(c => '- ' + c), ...(mh ? ['- Registration/completion/QPR dates and addresses are not on the MahaRERA listing and are blank.', '- PR/PM/PC letter meanings unresolved; no PP series observed.'] : []), '- Developer contacts were researched only for selected high-activity developers.', '',
    '## Files', `- ${city}_Projects.xlsx (sheets: Summary, Projects, Developers, Latest 90 Days, Latest 12 Months, Registration Series, Status Review, Missing Data, Sources, Developer Contacts)`, `- ${city}_Projects.csv, ${city}_Developers.csv`, ''].join('\n'));
  recs.forEach(p => masterP.push(p)); dRows.forEach(r => masterD.push([city, ...r])); cRows.forEach(r => masterC.push(r)); serRows.forEach(r => masterSeries.push([city, ...r]));
  (blocked ? [[city, null, null, null, null, 'ENTIRE MARKET: ' + blocked, srcList[0][1]]] : missRows.filter(r => r[5])).forEach(r => masterMissing.push(r)); srcRows.forEach(r => masterSources.push([city, ...r]));
  cityOut[city] = { file: xf, projects: recs.length, developers: devs.length, verifiedContacts, partialContacts: cRows.length - verifiedContacts, devWithContacts, latest: newest ? newest.regDate : null, r90: mh ? null : r90.length, r365: mh ? null : r365.length,
    verified: recs.filter(p => p.verification === 'Verified').length, partiallyVerified: recs.filter(p => p.verification === 'Partially Verified').length, unverified: 0, partial, blocked, coverage, missingRegNo: recs.filter(p => !p.regNo).length, missingRegDate: recs.filter(p => !p.regDate).length,
    missingDev: recs.filter(p => !p.developer).length, missingSrc: recs.filter(p => !p.sourceUrl).length, uniqueReg: new Set(recs.filter(p => p.regNo).map(p => p.regNo)).size, dupRemoved: dropped.length, cats: catCount, outsideWindow: recs.filter(p => p.regDate && p.regDate > RESEARCH_DATE).length };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const c of CITIES) await buildCity(c);
  // duplicate review (cross-city)
  const regIdx = new Map(); masterP.forEach(p => { if (!p.regNo) return; const k = p.jurisdiction + '|' + p.regNo; (regIdx.get(k) || regIdx.set(k, []).get(k)).push(p.city); });
  for (const [k, v] of regIdx) if (v.length > 1) dupReview.push([v.join(', '), 'Same registration in more than one city workbook', k, null, null, 'Investigate']);
  const devIdx = new Map(); masterD.forEach(r => { const k = nkey(r[2]); (devIdx.get(k) || devIdx.set(k, []).get(k)).push(r[0]); });
  for (const [k, v] of devIdx) if (v.length > 1) dupReview.push([v.join(', '), 'Same developer legal name in several cities', k, null, null, 'Kept as separate city rows (same name; entity identity not otherwise verified); not merged']);
  const nameIdx = new Map(); masterP.forEach(p => { const k = p.jurisdiction + '|' + nkey(p.developer) + '|' + nkey(p.project).replace(/\s*(PHASE|PH|WING|TOWER|BLDG|BUILDING)\b.*$/, ''); (nameIdx.get(k) || nameIdx.set(k, []).get(k)).push(p); });
  let simCount = 0; for (const [k, v] of nameIdx) if (v.length > 1 && new Set(v.map(p => p.regNo || p.secondaryId)).size > 1 && simCount < 400) { simCount++; dupReview.push([[...new Set(v.map(p => p.city))].join(', '), 'Similar project name, same developer, different registration numbers', k.split('|').slice(1).join(' / '), v.map(p => `${p.regNo || p.secondaryId} (${p.project})`).slice(0, 6).join('; '), null, 'Different registrations (phases/wings/re-registrations) - NOT merged']); }
  C.grgRecs.filter(r => /SUPERSEDED/i.test(r.statusDetail || '')).forEach(r => dupReview.push(['Gurugram', 'Certificate supersession noted on official list', r.regNo, r.project, r.rawReg, 'Both certificates kept as separate official records; status shows supersession']));
  // master
  const wb = new ExcelJS.Workbook(); wb.creator = 'Developer_Projects build';
  const totals = CITIES.map(c => cityOut[c]);
  const r90 = masterP.filter(p => p.regDate && p.regDate >= D90 && p.regDate <= RESEARCH_DATE).sort((a, b) => b.regDate.localeCompare(a.regDate)), r365 = masterP.filter(p => p.regDate && p.regDate >= D365 && p.regDate <= RESEARCH_DATE).sort((a, b) => b.regDate.localeCompare(a.regDate));
  const BANNER = 'PARTIAL DATASET - Maharashtra listings partly collected; Hyderabad, Delhi and Dubai have no project records (access blocked/unreachable). See City Summary.';
  sheet(wb, 'All Projects', PCOLS, masterP.map(prow), { banner: BANNER, widths: { 'Project Name': 34, 'Developer Legal Name': 32, 'Data Quality Notes': 60 } });
  sheet(wb, 'All Developers', ['City', ...DCOLS], masterD, { banner: BANNER });
  sheet(wb, 'Latest 90 Days', PCOLS, r90.map(prow), { banner: 'Only projects with verified registration dates (Gurugram, Bengaluru). Maharashtra listing has no registration dates.' });
  sheet(wb, 'Latest 12 Months', PCOLS, r365.map(prow), { banner: 'Only projects with verified registration dates (Gurugram, Bengaluru). Maharashtra listing has no registration dates.' });
  sheet(wb, 'Verified Contacts', CCOLS, masterC, { empty: 'None.' });
  sheet(wb, 'Registration Series', ['City', 'Section', 'Prefix/Series', 'Pattern', 'Count', 'Exact Example Numbers', 'Earliest Registration Date', 'Latest Registration Date', 'Interpretation', 'Source Evidence', 'Interpretation Status'], masterSeries);
  sheet(wb, 'Duplicate Review', ['City/Cities', 'Review Type', 'Key', 'Records', 'Detail', 'Resolution'], dupReview, { empty: 'No duplicate candidates.' });
  sheet(wb, 'Missing Data', ['City', 'Registration Number / ID', 'Project Name', 'Developer', 'Verification Status', 'Missing / Unresolved', 'Source URL'], masterMissing);
  sheet(wb, 'Source Directory', ['City', 'Source Name', 'Source URL', 'Source Type', 'Access Date', 'Field(s) Supported', 'Verification Method'], masterSources);
  sheet(wb, 'City Summary', ['City', 'Jurisdiction / Regulator', 'Workbook', 'Projects', 'Unique Registration Numbers', 'Developers', 'Verified', 'Partially Verified', 'Unverified', 'Verified Contact Items', 'Latest Verified Registration Date', 'Last 90 Days', 'Last 12 Months', 'Coverage Status', 'Coverage Notes'],
    CITIES.map(c => { const o = cityOut[c]; return [c, C.CITY[c].regulator, o.file, o.projects, o.uniqueReg, o.developers, o.verified, o.partiallyVerified, o.unverified, o.verifiedContacts, o.latest, o.r90, o.r365, o.blocked ? 'NO DATA (access blocked)' : (o.partial ? 'PARTIAL' : 'Full list for scope'), o.coverage.join(' ')]; }));
  const dq = [['Check', 'Result', 'Detail']];
  dq.push(['Total project rows (master)', masterP.length, 'Sum of city workbooks: ' + totals.reduce((a, o) => a + o.projects, 0)]);
  dq.push(['Duplicate registrations across cities', [...regIdx.values()].filter(v => v.length > 1).length, 'Jurisdiction + exact registration number']);
  dq.push(['Registration dates after research date', masterP.filter(p => p.regDate && p.regDate > RESEARCH_DATE).length, '']);
  dq.push(['Records Verified / Partially Verified / Unverified', `${masterP.filter(p => p.verification === 'Verified').length} / ${masterP.filter(p => p.verification === 'Partially Verified').length} / 0`, '']);
  dq.push(['Excluded contact values', excludedContacts.length, 'See DATA_QUALITY_REPORT.xlsx']);
  dq.push(['Full QA report', 'DATA_QUALITY_REPORT.xlsx', 'Automated checks + list of manual spot-checks']);
  sheet(wb, 'Data Quality', dq[0], dq.slice(1));
  await wb.xlsx.writeFile(path.join(OUT, 'MASTER_Developer_Projects.xlsx'));
  csv(path.join(OUT, 'MASTER_All_Projects.csv'), PCOLS, masterP.map(prow));
  fs.mkdirSync(path.join(OUT, 'Logs'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'Logs', 'build_state.json'), JSON.stringify({ researchDate: RESEARCH_DATE, generated: GENERATED, D90, D365, cities: cityOut, dupReviewCount: dupReview.length, excludedContacts, mhExcluded: C.mhExcluded, mhDupes: C.mhDupes }, null, 1));
  console.log(JSON.stringify(CITIES.map(c => ({ city: c, projects: cityOut[c].projects, devs: cityOut[c].developers, vContacts: cityOut[c].verifiedContacts, latest: cityOut[c].latest, ver: cityOut[c].verified, part: cityOut[c].partiallyVerified })), null, 0));
})();
