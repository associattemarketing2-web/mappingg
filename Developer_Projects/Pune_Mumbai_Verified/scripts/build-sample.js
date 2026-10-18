// Builds the 20 Pune + 20 Mumbai verified sample from: the DB snapshot (registry listing values), the hand-checked
// evidence (research/sample-evidence.json) and the OSM reverse-geocode cache. Checks each logo URL still loads.
// READ-ONLY for the database. Writes SAMPLE_40_Verified.xlsx and Sample_40_Records.csv.
//   NODE_PATH=<dir with exceljs>/node_modules node scripts/build-sample.js
const fs = require('fs'), path = require('path');
const ExcelJS = require('exceljs');
const C = require('./common.js');
const { styleSheet } = require('./xl.js');
const sample = require('./sample-ids.js')();

const EV = JSON.parse(fs.readFileSync(path.join(C.ROOT, 'research', 'sample-evidence.json'), 'utf8'));
const OSM = JSON.parse(fs.readFileSync(path.join(C.ROOT, 'cache', 'osm-reverse.json'), 'utf8'));
const logos = C.logoIndex(C.loadDevelopers());
const all = C.loadRecords();
const CHECKED = '2026-10-18';
const PENDING = 'pending - MahaRERA project page needs CAPTCHA/login';

// A point used by projects of DIFFERENT developers is a placeholder, not a site (phases of one project may share a point).
const ptDevs = new Map(), ptRecs = new Map();
for (const { doc: { data: d } } of all) if (d.lat != null) { const k = `${d.lat.toFixed(5)},${d.lng.toFixed(5)}`; (ptDevs.get(k) || ptDevs.set(k, new Set()).get(k)).add(C.companyKey(d.developer_name)); ptRecs.set(k, (ptRecs.get(k) || 0) + 1); }
const ptCount = new Map([...ptDevs].map(([k, v]) => [k, v.size]));
const sharedPoints = [...ptDevs].filter(([, v]) => v.size > 1).map(([k]) => ptRecs.get(k));

const devFor = (name) => Object.entries(EV.developers).find(([, v]) => v.match.includes(name));

async function checkUrl(u) {
  try {
    const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(20000) });
    const ct = r.headers.get('content-type') || ''; await r.arrayBuffer();
    return r.ok && /image|svg|octet/.test(ct) ? `loads (HTTP ${r.status}, ${ct.split(';')[0]})` : `problem (HTTP ${r.status}, ${ct.split(';')[0]})`;
  } catch (e) { return `fails (${e.cause?.code || e.message})`; }
}

(async () => {
  const logoCheck = {};
  for (const [, v] of Object.entries(EV.developers)) if (v.logo_url) { logoCheck[v.logo_url] = await checkUrl(v.logo_url); await new Promise((r) => setTimeout(r, 500)); }

  const rows = [];
  for (const { id, doc: { data: d } } of sample) {
    const [devKey, dev] = devFor(d.developer_name) || [];
    const p = EV.projects[d.rera_number] || {};
    const osm = OSM[id]?.body?.address || {};
    const osmArea = [osm.suburb || osm.neighbourhood || osm.village || osm.town || osm.hamlet, osm.city_district, osm.postcode].filter(Boolean).join(', ');
    const shared = d.lat != null && ptCount.get(`${d.lat.toFixed(5)},${d.lng.toFixed(5)}`) > 1;
    let coord_status, coord_note;
    if (d.lat == null) { coord_status = 'missing'; coord_note = 'no registry point'; }
    else if (shared) { coord_status = 'approximate_shared_point'; coord_note = 'Same point is used by other projects - a placeholder, not the project site.'; }
    else if (d.city === 'Mumbai') {
      const same = osm.postcode === d.pincode;
      coord_status = same ? 'registry_point_consistent' : 'registry_point_area_differs';
      coord_note = same ? `OSM puts the point in ${osmArea} - same pincode as the registry.` : `OSM puts the point in ${osmArea}; registry pincode ${d.pincode}. Needs a check.`;
    } else {
      coord_status = d.pin_check === 'verified' ? 'registry_point_in_declared_area' : `registry_point_${d.pin_check}`;
      coord_note = `OSM: ${osmArea}. (OSM postcodes in Pune are unreliable, so only the area name is compared.)`;
    }
    if (p.address && /Hinjawadi/i.test(p.address) && /Hinjawadi/i.test(osmArea)) { coord_status = 'registry_point_matches_official_address_locality'; coord_note += ' Official address is Hinjawadi - same area.'; }
    if (p.address && /Baner Annex/i.test(p.address)) { coord_status = 'registry_point_near_official_address'; coord_note += ' Official address: Baner Annex (Mahalunge), next to the OSM villages Nande/Sus - approximate match, not an exact site point.'; }

    const existing = logos.get(C.appKey(d.developer_name));
    const r = {
      id, city: d.city, district: d.district, locality_registry: d.locality, pincode_registry: d.pincode,
      rera_number: d.rera_number, project_name: d.project_name, developer_name_registry: d.developer_name,
      registry_listing_source: d.source_url, registry_listing_checked: d.verified_on,
      developer_brand: dev?.brand || '', developer_website: dev?.website || '', developer_identity: dev?.identity || 'not found (no official website located)',
      developer_identity_note: dev?.identity_note || '',
      logo_url: dev?.logo_url || '', logo_source_page: dev?.logo_page || '', logo_status: dev?.logo_status || 'missing',
      logo_link_check: dev?.logo_url ? logoCheck[dev.logo_url] : '', existing_logo_in_app: existing ? `yes (${existing.name}; source ${existing.source || 'not recorded'})` : 'no',
      office_address: dev?.office_address || '', office_status: dev?.office_status || 'missing', office_source: dev?.office_source || '',
      office_lat: dev?.office_lat ?? null, office_lng: dev?.office_lng ?? null,
      project_official_page: p.official_page || '', rera_on_official_page: p.rera_on_official_page || (p.official_page ? '' : 'no official page found'),
      project_address: p.address || '', project_address_status: p.address ? 'verified_official' : 'missing',
      site_lat: d.lat ?? null, site_lng: d.lng ?? null, coordinate_source: 'MahaRERA listing (promoter-declared point)', coordinate_status: coord_status, coordinate_note: coord_note,
      osm_check_url: OSM[id]?.url || '',
      bhk_published_official_site: p.bhk_published || '', bhk_registry: PENDING,
      total_units: PENDING, land_area: PENDING, project_cost: PENDING, proposed_completion: PENDING,
      secondary_sources_seen: (p.secondary || []).join(' '), notes: [p.phase_note, p.note].filter(Boolean).join(' '),
      record_status: 'partially_verified',
      record_status_reason: 'Number, name, promoter, district and pincode are from the official MahaRERA listing; registry details (units, land, cost, completion, BHK) are pending.',
      go_live_eligible: 'NO', go_live_blockers: 'No unit count; no land area; no project cost; no completion date; no registry BHK (all need the MahaRERA project page)',
      last_checked: CHECKED,
    };
    rows.push(r);
  }

  const cnt = (f, city) => rows.filter((r) => (!city || r.city === city) && f(r)).length;
  const metrics = [
    ['records in sample', (r) => true],
    ['developer has an official website we could read', (r) => !!r.developer_website],
    ['developer identity confirmed on official site', (r) => /^confirmed|developer_confirmed/.test(r.developer_identity)],
    ['project listed on official site', (r) => !!r.project_official_page],
    ['RERA number shown on official project page', (r) => r.rera_on_official_page === 'yes'],
    ['logo verified_official', (r) => r.logo_status === 'verified_official'],
    ['logo candidate (identity unconfirmed)', (r) => r.logo_status === 'candidate_unconfirmed'],
    ['logo missing', (r) => r.logo_status === 'missing'],
    ['logo already in app (any source)', (r) => r.existing_logo_in_app !== 'no'],
    ['developer office address verified', (r) => /verified_official/.test(r.office_status)],
    ['developer office coordinates', (r) => r.office_lat != null],
    ['project address from official site', (r) => !!r.project_address],
    ['site point consistent (pincode or official locality)', (r) => /consistent|matches_official|near_official|in_declared_area/.test(r.coordinate_status)],
    ['site point is a shared placeholder', (r) => r.coordinate_status === 'approximate_shared_point'],
    ['site point area differs - needs check', (r) => r.coordinate_status === 'registry_point_area_differs'],
    ['exact project-site coordinates verified', (r) => false],
    ['registry BHK / units / land / cost / completion available', (r) => false],
    ['record_status verified_official', (r) => r.record_status === 'verified_official'],
    ['record_status partially_verified', (r) => r.record_status === 'partially_verified'],
    ['go-live eligible', (r) => r.go_live_eligible === 'YES'],
  ].map(([m, f]) => ({ metric: m, Pune: cnt(f, 'Pune'), Mumbai: cnt(f, 'Mumbai'), Total: cnt(f) }));

  const wb = new ExcelJS.Workbook(); wb.created = new Date();
  const add = (n, data, note) => styleSheet(wb.addWorksheet(n), data.length ? data : [{ info: 'none' }], note);
  add('Summary', [...metrics, { metric: `points shared by different developers across all 1,719 records`, Pune: '', Mumbai: '', Total: `${sharedPoints.length} points, ${sharedPoints.reduce((a, b) => a + b, 0)} records` }],
    `Sample: newest 20 Pune + 20 Mumbai MahaRERA registrations by company promoters. Checked ${CHECKED}. No database writes.`);
  add('Sample Records', rows);
  const devRows = Object.entries(EV.developers).map(([k, v]) => ({ developer_key: k, registry_names: v.match.join(' / '), brand: v.brand, website: v.website, identity: v.identity, identity_note: v.identity_note, logo_url: v.logo_url, logo_status: v.logo_status, logo_link_check: logoCheck[v.logo_url] || '', logo_note: v.logo_note || '', office_address: v.office_address, office_status: v.office_status, office_lat: v.office_lat ?? null, office_lng: v.office_lng ?? null, phone: v.phone || '', email: v.email || '', contact_source: v.phone_source || '' }));
  add('Developers & Logos', devRows, 'Only developers with a readable official website are listed. Logos are linked, not downloaded.');
  add('Missing Data', rows.map((r) => ({ city: r.city, rera_number: r.rera_number, project_name: r.project_name, logo: r.logo_status, office: r.office_status, project_address: r.project_address_status, coordinates: r.coordinate_status, bhk_registry: 'pending', total_units: 'pending', land_area: 'pending', project_cost: 'pending', proposed_completion: 'pending' })));
  add('Rejected Sources', EV.rejected_sources);
  add('Verification Audit', rows.map((r) => ({ rera_number: r.rera_number, field: 'all', checked: r.last_checked, registry_source: r.registry_listing_source, official_site: r.developer_website, project_page: r.project_official_page, osm_check: r.osm_check_url, record_status: r.record_status })));
  await wb.xlsx.writeFile(path.join(C.ROOT, 'SAMPLE_40_Verified.xlsx'));
  C.writeCsv(path.join(C.ROOT, 'Sample_40_Records.csv'), rows);
  fs.writeFileSync(path.join(C.ROOT, 'sample_summary.json'), JSON.stringify({ checked: CHECKED, metrics, logo_checks: logoCheck, shared_points: { points: sharedPoints.length, records: sharedPoints.reduce((a, b) => a + b, 0) } }, null, 2));
  console.table(metrics); console.log(logoCheck); console.log('shared points across 1,719:', sharedPoints.length, 'records', sharedPoints.reduce((a, b) => a + b, 0));
})();
