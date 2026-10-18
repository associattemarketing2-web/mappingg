// READ-ONLY gap report for the Pune + Mumbai scraped_projects rows (from the pre-work snapshot).
//   NODE_PATH=<dir with exceljs>/node_modules node Developer_Projects/Pune_Mumbai_Verified/scripts/gap-report.js
// Writes GAP_REPORT.xlsx and Gap_Report_Records.csv next to this folder. Never touches the database.
const fs = require('fs'), path = require('path');
const ExcelJS = require('exceljs');
const C = require('./common.js');
const { styleSheet } = require('./xl.js');

const dir = C.snapshotDir();
const recs = C.loadRecords(dir);
const logos = C.logoIndex(C.loadDevelopers(dir));
const today = new Date().toISOString().slice(0, 10);
const CLOSED = /Lapsed|Withdrawn|Revoked|Transferred|Superseded|Deregistered|Abeyance/i;
const PENDING = 'pending - MahaRERA project page needs CAPTCHA/login';

// Facts the "Check & go live" tab needs (lib/scraped.ts readyGaps). None of them is on the MahaRERA listing.
const GOLIVE_FIELDS = [
  ['configuration_bhk', (e) => e?.fields?.configurations],
  ['total_units', (e) => e?.fields?.total_units ?? e?.fields?.total_plots],
  ['land_area', (e) => e?.fields?.land_area],
  ['project_cost', (e) => e?.fields?.project_cost],
  ['proposed_completion', (e) => e?.fields?.proposed_completion],
];

const rows = [], dupRera = new Map(), dupName = new Map();
for (const { id, doc } of recs) {
  const d = doc.data, e = doc.enrichment, logo = logos.get(C.appKey(d.developer_name));
  const r = {
    id, city: d.city, district: d.district, locality: d.locality, pincode: d.pincode,
    rera_number: d.rera_number, project_name: d.project_name, developer_name: d.developer_name,
    developer_key: C.companyKey(d.developer_name), promoter_type: C.isCompany(d.developer_name) ? 'company/firm' : 'individual or unclear',
    portal_seq: d.portal_seq, registry_status: d.status_category, project_url: d.project_url, source_url: d.source_url, listing_verified_on: d.verified_on,
    lat: d.lat ?? null, lng: d.lng ?? null, location_check: d.pin_check || 'none', location_reason: d.pin_reason || '',
    address: d.address || '', existing_logo: logo ? `yes (developers: ${logo.name})` : 'no',
    existing_logo_source: logo?.source || '', logo_verified_official: 'not checked yet',
    enriched: e ? 'yes' : 'no',
  };
  for (const [k, get] of GOLIVE_FIELDS) r[k] = get(e) != null && get(e) !== '' ? 'present' : PENDING;
  const gaps = [];
  if (!e) gaps.push('not enriched (registry details pending)');
  for (const [k] of GOLIVE_FIELDS) if (r[k] !== 'present') gaps.push(`no ${k}`);
  if (!d.project_name || !d.developer_name || !d.rera_number || !d.locality) gaps.push('name/developer/RERA/locality missing');
  if (!d.pincode) gaps.push('no pincode');
  if (CLOSED.test(d.status_category || '')) gaps.push(`registry status: ${d.status_category}`);
  r.go_live_eligible = gaps.length ? 'NO' : 'YES';
  r.go_live_blockers = gaps.join('; ');
  rows.push(r);
  (dupRera.get(d.rera_number) || dupRera.set(d.rera_number, []).get(d.rera_number)).push(r);
  const nk = `${C.appKey(d.project_name)}|${r.developer_key}`;
  (dupName.get(nk) || dupName.set(nk, []).get(nk)).push(r);
}

// Duplicate review: same RERA number twice = true duplicate; same name+developer with different numbers = phases (kept, linked).
const dupRows = [];
for (const [k, list] of dupRera) if (list.length > 1) for (const r of list) dupRows.push({ type: 'same RERA number (duplicate row)', group: k, id: r.id, rera_number: r.rera_number, project_name: r.project_name, developer_name: r.developer_name, city: r.city, action: 'review: keep one' });
for (const [k, list] of dupName) if (list.length > 1 && new Set(list.map((r) => r.rera_number)).size > 1) for (const r of list) dupRows.push({ type: 'same name + developer, different RERA numbers (phases/wings?)', group: k, id: r.id, rera_number: r.rera_number, project_name: r.project_name, developer_name: r.developer_name, city: r.city, action: 'keep both; link as related phases only if the registry confirms' });

// Developers (unique companies by companyKey)
const devMap = new Map();
for (const r of rows) {
  const k = r.developer_key || '(blank)';
  const v = devMap.get(k) || { developer_key: k, names_as_published: new Set(), type: r.promoter_type, pune: 0, mumbai: 0, existing_logo: r.existing_logo, rera_numbers: [] };
  v.names_as_published.add(r.developer_name); v[r.city.toLowerCase()]++; v.rera_numbers.push(r.rera_number);
  if (v.existing_logo === 'no' && r.existing_logo !== 'no') v.existing_logo = r.existing_logo;
  devMap.set(k, v);
}
const devRows = [...devMap.values()].map((v) => ({ ...v, names_as_published: [...v.names_as_published].join(' / '), name_variants: v.names_as_published.size, projects: v.pune + v.mumbai, rera_numbers: v.rera_numbers.join(', ') })).sort((a, b) => b.projects - a.projects);
const nameVariantDevs = devRows.filter((d) => d.name_variants > 1).length;

// Summary numbers
const by = (city) => rows.filter((r) => !city || r.city === city);
const count = (list, f) => list.filter(f).length;
const summary = [];
for (const city of ['Pune', 'Mumbai', null]) {
  const L = by(city);
  summary.push({
    scope: city || 'Pune + Mumbai', records: L.length, unique_rera_numbers: new Set(L.map((r) => r.rera_number)).size,
    unique_developers: new Set(L.map((r) => r.developer_key)).size,
    company_promoters: count(L, (r) => r.promoter_type === 'company/firm'),
    location_verified_by_listing: count(L, (r) => r.location_check === 'verified'),
    location_approximate: count(L, (r) => r.location_check === 'approximate'),
    location_mismatch: count(L, (r) => r.location_check === 'mismatch'),
    no_coordinates: count(L, (r) => r.lat == null || r.lng == null),
    existing_logo_match: count(L, (r) => r.existing_logo !== 'no'),
    with_address: count(L, (r) => r.address), enriched: count(L, (r) => r.enriched === 'yes'),
    missing_bhk: count(L, (r) => r.configuration_bhk !== 'present'), missing_units: count(L, (r) => r.total_units !== 'present'),
    missing_land_area: count(L, (r) => r.land_area !== 'present'), missing_project_cost: count(L, (r) => r.project_cost !== 'present'),
    missing_completion: count(L, (r) => r.proposed_completion !== 'present'),
    closed_or_flagged_status: count(L, (r) => CLOSED.test(r.registry_status || '')),
    go_live_eligible: count(L, (r) => r.go_live_eligible === 'YES'),
  });
}

(async () => {
  const wb = new ExcelJS.Workbook(); wb.created = new Date();
  const addSheet = (name, data, note) => { const ws = wb.addWorksheet(name); styleSheet(ws, data, note); };
  const sumT = Object.keys(summary[0]).filter((k) => k !== 'scope').map((k) => ({ metric: k, Pune: summary[0][k], Mumbai: summary[1][k], 'Pune + Mumbai': summary[2][k] }));
  addSheet('Summary', [...sumT,
    { metric: 'duplicate rows (same RERA no.)', Pune: '', Mumbai: '', 'Pune + Mumbai': dupRows.filter((d) => d.type.startsWith('same RERA')).length },
    { metric: 'records in name+developer groups with >1 RERA no.', Pune: '', Mumbai: '', 'Pune + Mumbai': dupRows.filter((d) => !d.type.startsWith('same RERA')).length },
    { metric: 'developers written more than one way', Pune: '', Mumbai: '', 'Pune + Mumbai': nameVariantDevs },
    { metric: 'snapshot used', Pune: '', Mumbai: '', 'Pune + Mumbai': path.basename(dir) },
    { metric: 'report date', Pune: '', Mumbai: '', 'Pune + Mumbai': today },
  ], 'Read-only. Built from the database snapshot; no database writes. Thane and Kalyan-Dombivli are not included.');
  addSheet('All Records', rows);
  addSheet('Missing Data', rows.filter((r) => r.go_live_eligible === 'NO').map((r) => ({ id: r.id, city: r.city, rera_number: r.rera_number, project_name: r.project_name, developer_name: r.developer_name, configuration_bhk: r.configuration_bhk, total_units: r.total_units, land_area: r.land_area, project_cost: r.project_cost, proposed_completion: r.proposed_completion, address: r.address ? 'present' : 'missing', logo: r.existing_logo === 'no' ? 'missing' : 'existing (unverified)', location_check: r.location_check, go_live_blockers: r.go_live_blockers })));
  addSheet('Location Review', rows.filter((r) => r.location_check !== 'verified').map((r) => ({ id: r.id, city: r.city, district: r.district, locality: r.locality, pincode: r.pincode, rera_number: r.rera_number, project_name: r.project_name, lat: r.lat, lng: r.lng, location_check: r.location_check, location_reason: r.location_reason })));
  addSheet('Duplicate Review', dupRows.length ? dupRows : [{ type: 'none found' }]);
  addSheet('Developers', devRows);
  await wb.xlsx.writeFile(path.join(C.ROOT, 'GAP_REPORT.xlsx'));
  C.writeCsv(path.join(C.ROOT, 'Gap_Report_Records.csv'), rows);
  fs.writeFileSync(path.join(C.ROOT, 'gap_summary.json'), JSON.stringify({ snapshot: path.basename(dir), date: today, summary, duplicates: { same_rera_rows: dupRows.filter((d) => d.type.startsWith('same RERA')).length, phase_group_rows: dupRows.filter((d) => !d.type.startsWith('same RERA')).length }, developers_with_name_variants: nameVariantDevs }, null, 2));
  console.table(summary);
  console.log('duplicate review rows:', dupRows.length, '| developers written >1 way:', nameVariantDevs);
})();
