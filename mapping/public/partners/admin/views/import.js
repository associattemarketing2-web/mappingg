// Bulk upload from Excel / CSV into the review queue.
import { FIELDS, OPTIONS, fieldByKey, optionsFor } from '../../shared/fields.js';
import { h, esc, $, $$, toast, friendlyError, normaliseMonth, parseLatLng } from '../../shared/lib.js';
import { ctx, refreshCounts } from '../context.js';
import { addBuilderDialog } from './builders.js';

const TEMPLATE_URL = '/partners/templates/Mappingg_Project_Upload_Template.xlsx';

// Import targets: every field with an Excel column, plus latitude/longitude
const TARGETS = [
  ...FIELDS.filter(f => f.excel),
  { key: 'lat', label: 'Latitude', type: 'number', aliases: ['latitude', 'lat'] },
  { key: 'lng', label: 'Longitude', type: 'number', aliases: ['longitude', 'lng', 'long', 'lon'] }
];

const norm = s => String(s ?? '').toLowerCase().replace(/\*/g, '').replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

function guessTarget(header) {
  const n = norm(header);
  if (!n) return '__ignore';
  for (const t of TARGETS) if (t.excel && norm(t.excel) === n) return t.key;
  for (const t of TARGETS) if (norm(t.label) === n || t.key.replace(/_/g, ' ') === n) return t.key;
  for (const t of TARGETS) if ((t.aliases || []).some(a => norm(a) === n)) return t.key;
  return '__extra'; // keep unknown columns as "Additional details" so nothing is lost
}

const SYNONYMS = {
  project_type: { 'mixed use': 'Mixed-Use', 'mixeduse': 'Mixed-Use', 'plotted': 'Plotted Development', 'plots': 'Plotted Development', 'plot': 'Plotted Development',
    'land': 'Land Parcel', 'resi': 'Residential', 'commercial office': 'Commercial' },
  construction_status: { 'uc': 'Under Construction', 'under-construction': 'Under Construction', 'rtm': 'Ready to Move', 'ready': 'Ready to Move',
    'ready to move in': 'Ready to Move', 'new': 'New Launch', 'launch': 'New Launch', 'pre launch': 'Upcoming', 'prelaunch': 'Upcoming', 'pre-launch': 'Upcoming' },
  sales_status: { 'sold': 'Sold Out', 'sold out': 'Sold Out', 'available': 'Available', 'few left': 'Few Units Left', 'limited': 'Few Units Left' },
  country: { 'uae': 'United Arab Emirates', 'dubai': 'United Arab Emirates', 'in': 'India', 'ind': 'India', 'uk': 'United Kingdom', 'usa': 'United States', 'us': 'United States' },
  price_unit: { 'cr': 'Crore', 'crores': 'Crore', 'l': 'Lakh', 'lac': 'Lakh', 'lacs': 'Lakh', 'lakhs': 'Lakh', 'm': 'Million', 'mn': 'Million', 'k': 'Thousand' },
  area_unit: { 'sqft': 'sq ft', 'sq.ft': 'sq ft', 'sq. ft': 'sq ft', 'square feet': 'sq ft', 'sqm': 'sq m', 'sq.m': 'sq m', 'sqyd': 'sq yd', 'sq. yd': 'sq yd' }
};

function matchOption(key, raw) {
  const v = String(raw).trim();
  if (!v) return null;
  const opts = optionsFor(fieldByKey[key]);
  const hit = opts.find(o => o.toLowerCase() === v.toLowerCase());
  if (hit) return hit;
  const syn = SYNONYMS[key]?.[v.toLowerCase()];
  return syn || null;
}

function parseConfigs(raw) {
  return [...new Set(String(raw).split(/[,;\/\n&+]|\band\b/i).map(x => x.trim()).filter(Boolean).map(x => {
    const m = /^(\d(?:\.\d)?)\s*(\+)?\s*bhk$/i.exec(x.replace(/\s+/g, ' '));
    if (m) return m[2] ? '5+ BHK' : `${m[1]} BHK`;
    const hit = OPTIONS.configurations.find(o => o.toLowerCase() === x.toLowerCase() || o.toLowerCase() + 's' === x.toLowerCase());
    return hit || x;
  }))];
}

// "1.2 Cr - 2.5 Cr" → {min:1.2, max:2.5, unit:'Crore'}
function parseAmountRange(raw) {
  const s = String(raw).replace(/,/g, '').replace(/₹|rs\.?|inr|aed|usd|\$/gi, ' ');
  const unitMatch = s.match(/\b(cr|crore|crores|l|lac|lacs|lakh|lakhs|m|mn|million|k|thousand)\b/i);
  const unit = unitMatch ? (SYNONYMS.price_unit[unitMatch[1].toLowerCase()] || (/^cr/i.test(unitMatch[1]) ? 'Crore' : /^mil/i.test(unitMatch[1]) ? 'Million' : /^th/i.test(unitMatch[1]) ? 'Thousand' : 'Lakh')) : null;
  const nums = (s.match(/\d+(?:\.\d+)?/g) || []).map(Number);
  return { min: nums[0] ?? null, max: nums.length > 1 ? nums[1] : null, unit };
}

function toBool(v) { return /^(y|yes|true|1|✓)$/i.test(String(v).trim()); }

function convertRow(cells, headers, mapping, defaults) {
  const out = { configurations: [], rera_numbers: [], additional_details: [] };
  const issues = [];
  headers.forEach((hdr, i) => {
    const target = mapping[i];
    const raw = cells[i];
    if (raw === undefined || raw === null || String(raw).trim() === '' || target === '__ignore') return;
    if (target === '__extra') { out.additional_details.push({ label: String(hdr).trim(), value: String(raw).trim() }); return; }
    const f = TARGETS.find(t => t.key === target);
    switch (f.type) {
      case 'select': {
        const m = matchOption(target, raw);
        if (m) out[target] = m;
        else if (target === 'construction_status' && matchOption('sales_status', raw)) out.sales_status = matchOption('sales_status', raw);
        else if (target === 'sales_status' && matchOption('construction_status', raw)) out.construction_status = matchOption('construction_status', raw);
        else { out[target] = String(raw).trim(); issues.push(`${f.label}: "${raw}" is not a standard option`); }
        break;
      }
      case 'multiselect': out[target] = parseConfigs(raw); break;
      case 'tags': out[target] = [...new Set(String(raw).split(/[,;\/\n\s]+/).map(x => x.trim().toUpperCase()).filter(Boolean))]; break;
      case 'checkbox': out[target] = toBool(raw); break;
      case 'month': {
        const m = normaliseMonth(raw);
        out[target] = m;
        if (m && !/^\d{4}-\d{2}$/.test(m)) issues.push(`${f.label}: "${raw}" — check the date`);
        break;
      }
      case 'number': {
        if (typeof raw === 'number') { out[target] = raw; break; }
        const r = parseAmountRange(raw);
        if (r.min == null) { issues.push(`${f.label}: "${raw}" is not a number`); break; }
        out[target] = r.min;
        if (target === 'price_min') {
          if (r.max != null && out.price_max == null) out.price_max = r.max;
          if (r.unit && !out.price_unit) out.price_unit = r.unit;
        }
        if (target === 'carpet_area_min' && r.max != null && out.carpet_area_max == null) out.carpet_area_max = r.max;
        break;
      }
      default: out[target] = String(raw).trim();
    }
  });
  if (out.google_maps_link && (out.lat == null || out.lng == null)) {
    const p = parseLatLng(out.google_maps_link);
    if (p) { out.lat = p.lat; out.lng = p.lng; }
    else issues.push('Map pin: set it during review (short Maps link)');
  }
  if (!out.country) { out.country = defaults.country || 'India'; }
  if (!out.currency) out.currency = out.country === 'United Arab Emirates' ? 'AED' : out.country === 'India' ? 'INR' : null;
  if (!out.developer_name && defaults.developer_name) out.developer_name = defaults.developer_name;
  if (!out.area_unit && (out.carpet_area_min != null)) out.area_unit = 'sq ft';
  if (out.price_min != null && !out.price_unit && out.currency === 'INR') issues.push('Price unit missing (Lakh / Crore?)');
  if (out.price_min != null && out.price_max != null && out.price_max < out.price_min) issues.push('Highest price is lower than starting price — check the units');
  if (out.lat == null) issues.push('No map pin yet');
  if (!out.city) issues.push('City missing');
  if (out.country === 'India' && !out.rera_numbers.length) issues.push('No RERA number');
  const error = !out.project_name ? 'No project name — row will be skipped' : null;
  return { data: out, issues, error };
}

export async function renderImport(page) {
  const { data: builders } = await ctx.client.from('builders').select('id, company_name, code, country').order('company_name');
  let parsed = null; // {fileName, headers, rows, source}
  let mapping = [];

  page.innerHTML = '';
  page.appendChild(h(`<div class="page-head">
    <div><h1>Bulk upload</h1><p>Upload the Excel or CSV a builder sent. Every row goes to the review queue — nothing is published.</p></div>
    <a class="btn ghost" href="${TEMPLATE_URL}" download>Download Excel template</a></div>`));

  const step1 = h(`<div class="card pad" style="padding:20px;margin-bottom:16px">
    <h2 style="margin-bottom:14px">1. Who sent this file?</h2>
    <div class="toolbar" style="margin:0">
      <select class="input" style="max-width:360px" aria-label="Builder">
        <option value="">Not from one builder (mixed / channel partner)</option>
        ${(builders || []).map(b => `<option value="${b.id}">${esc(b.company_name)} (${esc(b.code)})</option>`).join('')}
      </select>
      <button class="btn ghost" type="button" data-add>+ Add builder</button>
    </div>
    <p class="help">Linking a builder lets them see and fix these projects through their own link.</p>
    <h2 style="margin:22px 0 14px">2. Choose the file</h2>
    <label class="dropzone"><input type="file" accept=".xlsx,.xls,.csv" hidden>
      <b>Drop the Excel or CSV file here</b><br><span class="muted">or click to choose · .xlsx, .xls, .csv</span></label>
  </div>`);
  page.appendChild(step1);
  const builderSel = $('select', step1);
  $('[data-add]', step1).addEventListener('click', async () => {
    const b = await addBuilderDialog();
    if (b) { builderSel.appendChild(h(`<option value="${b.id}">${esc(b.company_name)} (${esc(b.code)})</option>`)); builderSel.value = b.id; builders.push(b); if (parsed) drawPreview(); }
  });
  builderSel.addEventListener('change', () => { if (parsed) drawPreview(); });

  const zone = $('.dropzone', step1);
  const input = $('input', zone);
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('over'); if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]); });
  input.addEventListener('change', () => { if (input.files[0]) readFile(input.files[0]); input.value = ''; });

  const mapCard = h('<div class="card pad hidden" style="padding:20px;margin-bottom:16px"></div>');
  const previewCard = h('<div class="card hidden" style="margin-bottom:16px"></div>');
  page.appendChild(mapCard);
  page.appendChild(previewCard);

  async function readFile(file) {
    if (!window.XLSX) { toast('The Excel reader did not load. Check your connection and refresh.', 'bad'); return; }
    try {
      const buf = await file.arrayBuffer();
      const wb = window.XLSX.read(buf, { type: 'array', cellDates: true });
      const sheetName = wb.SheetNames.find(n => /^projects?$/i.test(n.trim())) || wb.SheetNames[0];
      const aoa = window.XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: true, defval: null, blankrows: false });
      // header row = first row (within 10) where at least 2 columns are recognised
      let hi = aoa.slice(0, 10).findIndex(r => (r || []).filter(c => !['__extra', '__ignore'].includes(guessTarget(c))).length >= 2);
      if (hi < 0) hi = 0;
      const headers = (aoa[hi] || []).map(x => (x == null ? '' : String(x)));
      const rows = aoa.slice(hi + 1).filter(r => (r || []).some(c => c !== null && String(c).trim() !== ''));
      if (!rows.length) { toast('No project rows found under the header row.', 'bad'); return; }
      parsed = { fileName: file.name, headers, rows, source: /\.csv$/i.test(file.name) ? 'csv' : 'excel', sheetName };
      mapping = headers.map(guessTarget);
      drawMapping();
      drawPreview();
    } catch (e) {
      console.error(e);
      toast(`Could not read this file: ${friendlyError(e)}`, 'bad');
    }
  }

  function drawMapping() {
    mapCard.classList.remove('hidden');
    const optionsHtml = sel => `<option value="__ignore" ${sel === '__ignore' ? 'selected' : ''}>— Ignore this column —</option>
      <option value="__extra" ${sel === '__extra' ? 'selected' : ''}>Keep as “Additional details”</option>
      ${TARGETS.map(t => `<option value="${t.key}" ${sel === t.key ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}`;
    mapCard.innerHTML = `<h2>3. Check the columns</h2>
      <p class="muted" style="margin:4px 0 16px">${esc(parsed.fileName)} · sheet “${esc(parsed.sheetName)}” · ${parsed.rows.length} row(s). We matched the columns below. Change any that look wrong.</p>
      <div class="map-grid">${parsed.headers.map((hd, i) => `<div class="map-item"><span class="src">${esc(hd || `Column ${i + 1}`)}</span>
        <select class="input" data-i="${i}">${optionsHtml(mapping[i])}</select></div>`).join('')}</div>`;
    $$('select', mapCard).forEach(s => s.addEventListener('change', () => { mapping[+s.dataset.i] = s.value; drawPreview(); }));
  }

  async function drawPreview() {
    const b = builders.find(x => x.id === builderSel.value);
    const defaults = { country: b?.country || 'India', developer_name: b?.company_name || null };
    const result = parsed.rows.map(r => convertRow(r, parsed.headers, mapping, defaults));

    // possible duplicates against what is already in the system
    const { data: existing } = await ctx.client.from('project_submissions').select('ref_code, project_name, rera_numbers').limit(5000);
    const byName = new Map((existing || []).filter(x => x.project_name).map(x => [x.project_name.trim().toLowerCase(), x.ref_code]));
    const byRera = new Map();
    (existing || []).forEach(x => (x.rera_numbers || []).forEach(n => byRera.set(n, x.ref_code)));
    const seen = new Set();
    result.forEach(r => {
      const name = (r.data.project_name || '').trim().toLowerCase();
      const dupe = byName.get(name) || r.data.rera_numbers.map(n => byRera.get(n)).find(Boolean);
      if (dupe) r.issues.unshift(`Possible duplicate of ${dupe}`);
      if (name && seen.has(name)) r.issues.unshift('Same name appears twice in this file');
      seen.add(name);
    });

    const ok = result.filter(r => !r.error);
    previewCard.classList.remove('hidden');
    previewCard.innerHTML = `<div style="padding:20px 20px 12px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
        <div><h2>4. Preview</h2><p class="muted" style="margin:4px 0 0">${ok.length} project(s) ready · ${result.length - ok.length} skipped · notes are for your review, they don't block the upload</p></div>
        <button class="btn primary" ${ok.length ? '' : 'disabled'}>Send ${ok.length} to review queue</button></div>
      <div class="table-wrap"><table class="tbl"><thead><tr><th><input type="checkbox" checked aria-label="Select all"></th><th>#</th><th>Project</th><th>Location</th><th>Type</th><th>Price</th><th>RERA</th><th>Notes</th></tr></thead><tbody>
      ${result.map((r, i) => `<tr>
        <td><input type="checkbox" data-i="${i}" ${r.error ? 'disabled' : 'checked'} aria-label="Include row ${i + 1}"></td>
        <td class="num muted">${i + 1}</td>
        <td><div class="cell-title">${esc(r.data.project_name || '—')}</div><div class="cell-sub">${esc(r.data.developer_name || '')}</div></td>
        <td>${esc([r.data.locality, r.data.city].filter(Boolean).join(', ') || '—')}<div class="cell-sub">${esc(r.data.country || '')}${r.data.lat != null ? ' · 📍' : ''}</div></td>
        <td>${esc(r.data.project_type || '—')}<div class="cell-sub">${esc((r.data.configurations || []).join(', '))}</div></td>
        <td class="num">${r.data.price_on_request ? 'On request' : esc([r.data.price_min, r.data.price_max].filter(x => x != null).join(' – ') + ' ' + (r.data.price_unit || ''))}</td>
        <td class="cell-sub">${esc((r.data.rera_numbers || []).join(', ') || '—')}</td>
        <td>${r.error ? `<div class="row-error">${esc(r.error)}</div>` : ''}${r.issues.map(x => `<div class="row-issue">${esc(x)}</div>`).join('')}</td>
      </tr>`).join('')}</tbody></table></div>`;
    const all = $('thead input', previewCard);
    all.addEventListener('change', () => $$('tbody input:not(:disabled)', previewCard).forEach(c => { c.checked = all.checked; }));
    $('.btn.primary', previewCard).addEventListener('click', () => doImport(result));
  }

  async function doImport(result) {
    const picked = $$('tbody input:checked', previewCard).map(c => result[+c.dataset.i]).filter(r => !r.error);
    if (!picked.length) { toast('Select at least one row.', 'bad'); return; }
    const btn = $('.btn.primary', previewCard);
    btn.disabled = true;
    const batch = crypto.randomUUID();
    const builderId = builderSel.value || null;
    const rows = picked.map(r => ({ ...r.data, builder_id: builderId, source: parsed.source, status: 'submitted',
      import_batch_id: batch, submitted_at: new Date().toISOString() }));
    try {
      for (let i = 0; i < rows.length; i += 100) {
        btn.textContent = `Uploading ${Math.min(i + 100, rows.length)} of ${rows.length}…`;
        const { error } = await ctx.client.from('project_submissions').insert(rows.slice(i, i + 100), { defaultToNull: false });
        if (error) throw error;
      }
      await refreshCounts();
      mapCard.classList.add('hidden');
      previewCard.innerHTML = `<div class="pad" style="padding:36px;text-align:center">
        <div style="font-size:40px">✅</div><h2 style="margin:8px 0">${rows.length} project(s) added to the review queue</h2>
        <p class="muted">From ${esc(parsed.fileName)}. Nothing is live yet.</p>
        <a class="btn primary" href="#/queue?tab=review">Go to review queue</a></div>`;
      parsed = null;
    } catch (e) {
      btn.disabled = false; btn.textContent = 'Try again';
      toast(`Upload stopped: ${friendlyError(e)}`, 'bad');
    }
  }
}

// exported for tests
export const _test = { guessTarget, convertRow, parseAmountRange, parseConfigs };
