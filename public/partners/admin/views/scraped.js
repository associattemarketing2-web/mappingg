// Scraped data: projects collected from official RERA registries (MahaRERA,
// Haryana RERA - Gurugram, RERA Karnataka). Browse by city, edit, delete, and
// add the ones with a verified location to Projects (review queue / map).
import { h, esc, $, $$, formatDate, toast, confirmDialog, friendlyError } from '../../shared/lib.js';
import { ctx, refreshCounts } from '../context.js';
import { createBulk } from '../bulk.js';

const CITY_LABEL = { Mumbai: 'Mumbai', Thane: 'Thane', Kalyan_Dombivli: 'Kalyan-Dombivli', Pune: 'Pune', Gurugram: 'Gurugram', Bengaluru: 'Bengaluru' };
const PIN = {
  verified: { label: 'Location verified', tone: 'ok', help: 'Coordinates inside the area, pincode matches, not a shared area pin.' },
  manual: { label: 'Set by hand', tone: 'info', help: 'Location placed by the team.' },
  approximate: { label: 'Approximate pin', tone: 'warn', help: 'Same point used by several developers\' projects - likely an area pin.' },
  mismatch: { label: 'Location mismatch', tone: 'bad', help: 'Coordinates outside the area or pincode belongs elsewhere.' },
  unconfirmed: { label: 'Not confirmed', tone: 'warn', help: 'No pincode to cross-check.' },
  no_coordinates: { label: 'No coordinates', tone: 'muted', help: 'The registry publishes no coordinates.' },
};
const READY = new Set(['verified', 'manual']);
const PROJECT_STATE = { live: ['Live on map', 'ok'], published: ['Published', 'ok'], in_review: ['In review queue', 'info'], submitted: ['In review queue', 'info'],
  changes_requested: ['Changes requested', 'warn'], draft: ['Draft', 'muted'], rejected: ['Rejected', 'bad'], removed: ['Removed from Projects', 'muted'] };
const PAGE = 100;
const pinBadge = k => { const p = PIN[k] || { label: k || '—', tone: 'muted', help: '' }; return `<span class="badge ${p.tone}" title="${esc(p.help)}">${esc(p.label)}</span>`; };
const stateBadge = s => { if (!s) return '<span class="cell-sub">—</span>'; const [l, t] = PROJECT_STATE[s] || [s, 'muted']; return `<span class="badge ${t}">${esc(l)}</span>`; };
const initials = s => esc(String(s || '?').replace(/[^A-Za-z0-9 ]/g, '').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?');
const logoCell = r => r.logo ? `<img class="scr-logo" src="${esc(r.logo)}" alt="" loading="lazy">` : `<span class="scr-logo none" title="No logo in Developers directory">${initials(r.developer_name)}</span>`;

const state = { page: 0, term: '', city: '', pin: '', cat: '' };

export async function renderScraped(page, params) {
  const tab = params.get('tab') || 'all';
  if (params.get('city')) state.city = params.get('city');
  page.innerHTML = '<div class="muted pad">Loading scraped data…</div>';
  const { data, error } = await ctx.client.rpc('admin_scraped_list');
  if (error) throw error;
  const all = data.rows || [];
  if (!all.length) return renderEmpty(page);

  const live = all.filter(r => !r.deleted), added = live.filter(r => r.submission_id), deleted = all.filter(r => r.deleted);
  const base = tab === 'added' ? added : tab === 'deleted' ? deleted : live;

  page.innerHTML = '';
  const head = h(`<div class="page-head">
    <div><h1>Scraped data</h1><p>Official RERA registry records${data.dataset_generated ? ` · dataset ${esc(formatDate(data.dataset_generated))}` : ''}${data.imported_at ? ` · imported ${esc(formatDate(data.imported_at))}` : ''}. Nothing goes on the map until you publish it.</p></div>
    <div style="display:flex;gap:8px"><button class="btn ghost" data-a="import">Refresh from dataset</button><button class="btn ghost" data-a="csv">Export CSV</button></div></div>`);
  page.appendChild(head);
  page.appendChild(h(`<div class="stats">
    <div class="card stat"><div class="v">${live.length.toLocaleString()}</div><div class="l">Scraped records</div></div>
    <div class="card stat"><div class="v">${live.filter(r => READY.has(r.pin_check)).length.toLocaleString()}</div><div class="l">Location verified · ready to add</div></div>
    <div class="card stat"><div class="v">${added.length.toLocaleString()}</div><div class="l">Added to Projects</div></div>
    <div class="card stat"><div class="v">${added.filter(r => r.project_state === 'live').length.toLocaleString()}</div><div class="l">Live on the map</div></div>
    <div class="card stat"><div class="v">${live.filter(r => r.edited).length.toLocaleString()}</div><div class="l">Edited by team</div></div>
  </div>`));
  page.appendChild(h(`<div class="tabs" role="tablist">
    <a class="tab ${tab === 'all' ? 'on' : ''}" href="#/scraped?tab=all">All scraped data<span class="n">${live.length}</span></a>
    <a class="tab ${tab === 'added' ? 'on' : ''}" href="#/scraped?tab=added">Added to Projects<span class="n">${added.length}</span></a>
    <a class="tab ${tab === 'deleted' ? 'on' : ''}" href="#/scraped?tab=deleted">Deleted<span class="n">${deleted.length}</span></a></div>`));

  const cities = Object.keys(CITY_LABEL).map(c => [c, base.filter(r => r.city === c).length]);
  const cats = [...new Set(base.map(r => r.status_category).filter(Boolean))].sort();
  const toolbar = h(`<div class="toolbar">
    <input class="input" type="search" placeholder="Search project, developer, RERA no., locality, pincode…" aria-label="Search" value="${esc(state.term)}">
    <select class="input" style="max-width:190px" aria-label="City" data-f="city"><option value="">All cities (${base.length})</option>
      ${cities.map(([c, n]) => `<option value="${c}" ${state.city === c ? 'selected' : ''}>${CITY_LABEL[c]} (${n})</option>`).join('')}</select>
    <select class="input" style="max-width:200px" aria-label="Location" data-f="pin"><option value="">Any location status</option><option value="ready" ${state.pin === 'ready' ? 'selected' : ''}>Ready to add (verified / by hand)</option>
      ${Object.entries(PIN).map(([k, p]) => `<option value="${k}" ${state.pin === k ? 'selected' : ''}>${p.label}</option>`).join('')}</select>
    <select class="input" style="max-width:240px" aria-label="Registry status" data-f="cat"><option value="">Any registry status</option>
      ${cats.map(c => `<option ${state.cat === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
    <button class="btn ghost sm" type="button" data-a="selall">Select all matching</button>
  </div>`);
  page.appendChild(toolbar);

  const actions = tab === 'deleted' ? [{ act: 'restore', label: 'Restore' }]
    : [{ act: 'add', label: 'Add to Projects', tone: 'primary' }, { act: 'publish', label: 'Add & publish to map' }, { act: 'delete', label: 'Delete', tone: 'danger' }];
  const bulk = createBulk({ actions, onAction: async (act, ids) => { await bulkAction(act, ids, all); renderScraped(page, params); } });
  page.appendChild(bulk.bar);
  const wrap = h('<div class="card table-wrap"></div>');
  page.appendChild(wrap);
  const pager = h('<div class="scr-pager"></div>');
  page.appendChild(pager);

  const filtered = () => {
    const t = state.term.toLowerCase();
    return base.filter(r => (!state.city || r.city === state.city)
      && (!state.pin || (state.pin === 'ready' ? READY.has(r.pin_check) : r.pin_check === state.pin))
      && (!state.cat || r.status_category === state.cat)
      && (!t || [r.project_name, r.developer_name, r.rera_number, r.locality, r.district, r.pincode, CITY_LABEL[r.city]].some(x => String(x || '').toLowerCase().includes(t))));
  };
  const draw = () => {
    bulk.attach(draw);
    const list = filtered();
    const pages = Math.max(1, Math.ceil(list.length / PAGE));
    if (state.page >= pages) state.page = 0;
    const shown = list.slice(state.page * PAGE, state.page * PAGE + PAGE);
    if (!list.length) { wrap.innerHTML = `<div class="pad muted" style="text-align:center;padding:48px">${base.length ? 'No matches.' : tab === 'added' ? 'Nothing added to Projects yet.' : 'Nothing here.'}</div>`; pager.innerHTML = ''; return; }
    wrap.innerHTML = `<table class="tbl"><thead><tr><th></th><th>Project</th><th>RERA no.</th><th>Location</th><th>Registered</th><th>Registry status</th><th>Location pin</th><th>Projects</th><th>Pin no.</th></tr></thead><tbody></tbody></table>`;
    $('thead tr', wrap).prepend(bulk.headCell(shown.map(r => r.id)));
    const tb = $('tbody', wrap);
    for (const r of shown) {
      const tr = h(`<tr class="clickable" tabindex="0">
        <td style="width:52px">${logoCell(r)}</td>
        <td><div class="cell-title">${esc(r.project_name || 'Untitled')}${r.edited ? ' <span class="tag-mini">Edited</span>' : ''}</div><div class="cell-sub">${esc(r.developer_name || 'Developer not shown')}</div></td>
        <td class="cell-sub" style="white-space:nowrap">${esc(r.rera_number || '—')}</td>
        <td>${esc([r.locality, CITY_LABEL[r.city]].filter(Boolean).join(', '))}<div class="cell-sub">${esc([r.district, r.pincode].filter(Boolean).join(' · '))}</div></td>
        <td class="cell-sub">${r.registration_date ? esc(r.registration_date) : '<span title="The registry listing shows no date">—</span>'}</td>
        <td class="cell-sub">${esc(r.status_category || r.status || '—')}</td>
        <td>${pinBadge(r.pin_check)}</td>
        <td>${stateBadge(r.project_state)}</td>
        <td class="num">${r.pin_number != null ? `<b>#${esc(r.pin_number)}</b>` : '<span class="cell-sub">—</span>'}</td></tr>`);
      tr.prepend(bulk.rowCell(r.id, r.project_name || 'record'));
      if (bulk.selected.has(r.id)) tr.classList.add('picked');
      const open = () => openEditor(r, () => renderScraped(page, params));
      tr.addEventListener('click', open);
      tr.addEventListener('keydown', e => { if (e.key === 'Enter') open(); });
      tb.appendChild(tr);
    }
    pager.innerHTML = `<span class="muted">${(state.page * PAGE + 1).toLocaleString()}–${Math.min(list.length, (state.page + 1) * PAGE).toLocaleString()} of ${list.length.toLocaleString()}</span>
      <button class="btn ghost sm" data-p="-1" ${state.page ? '' : 'disabled'}>‹ Previous</button><button class="btn ghost sm" data-p="1" ${state.page < pages - 1 ? '' : 'disabled'}>Next ›</button>`;
  };
  pager.addEventListener('click', e => { const b = e.target.closest('[data-p]'); if (!b) return; state.page += +b.dataset.p; draw(); window.scrollTo(0, 0); });
  $('input', toolbar).addEventListener('input', e => { state.term = e.target.value.trim(); state.page = 0; draw(); });
  $$('select', toolbar).forEach(s => s.addEventListener('change', () => { state[s.dataset.f] = s.value; state.page = 0; draw(); }));
  $('[data-a=selall]', toolbar).addEventListener('click', () => { filtered().forEach(r => bulk.selected.add(r.id)); draw(); });
  head.addEventListener('click', async e => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'csv') exportCsv(filtered());
    if (a === 'import') { if (await runImport()) renderScraped(page, params); }
  });
  draw();
}

async function renderEmpty(page) {
  const { data: info } = await ctx.client.rpc('admin_scraped_info');
  page.innerHTML = '';
  const el = h(`<div><div class="page-head"><div><h1>Scraped data</h1><p>Projects collected from official RERA registries.</p></div></div>
    <div class="card pad" style="max-width:640px"><h2 style="margin-top:0">Load the scraped dataset</h2>
    <p class="muted">${info ? `${info.count.toLocaleString()} records from the official registries (research date ${esc(info.research_date)}). ` : ''}They are copied into this tab only — nothing is added to Projects or the map until you choose.</p>
    ${info ? `<p class="cell-sub">${esc(info.pin_rules)}</p>` : ''}
    <button class="btn primary">Load scraped data</button></div></div>`);
  $('button', el).addEventListener('click', async () => { if (await runImport()) location.reload(); });
  page.appendChild(el);
}

async function runImport() {
  const ok = await confirmDialog({ title: 'Load / refresh scraped data?', confirmText: 'Load',
    body: 'New registry records are added. Records nobody edited are refreshed to the latest registry values; your edits, deletions and Projects links are kept.' });
  if (!ok) return false;
  toast('Loading… this can take a minute');
  const { data, error } = await ctx.client.rpc('admin_scraped_import');
  if (error) { toast(friendlyError(error), 'bad'); return false; }
  toast(`${data.added.toLocaleString()} new · ${data.refreshed.toLocaleString()} refreshed`);
  return true;
}

async function bulkAction(act, ids, all) {
  const rows = all.filter(r => ids.includes(r.id));
  const n = rows.length, s = n === 1 ? '' : 's';
  if (act === 'delete' || act === 'restore') {
    if (act === 'delete' && !(await confirmDialog({ title: `Delete ${n} record${s}?`, tone: 'danger', confirmText: 'Delete',
      body: 'They move to the Deleted tab (you can restore them). Projects already created from them are not touched.' }))) return;
    const { error } = await ctx.client.rpc('admin_scraped_delete', { p_ids: ids, p_restore: act === 'restore' });
    if (error) return toast(friendlyError(error), 'bad');
    return toast(act === 'restore' ? `Restored ${n} record${s}` : `Deleted ${n} record${s}`);
  }
  const ready = rows.filter(r => READY.has(r.pin_check) && !r.submission_id);
  const notReady = n - ready.length;
  if (!ready.length) return toast('None of the selected records can be added: only records with a verified (or hand-set) location that are not already in Projects.', 'bad');
  const publish = act === 'publish';
  const ok = await confirmDialog({ title: `${publish ? 'Add & publish' : 'Add'} ${ready.length} project${ready.length === 1 ? '' : 's'}?`, tone: publish ? 'danger' : 'primary', confirmText: publish ? 'Add & publish' : 'Add to Projects',
    body: `<p style="margin:0 0 8px">${publish ? 'They are added to Projects <b>and put on the live public map</b> right away.' : 'They go to the Review queue (status “In review”) so you can add photos, price and details before publishing.'}</p>
      <p class="cell-sub" style="margin:0">Registry data has no images, price or configuration. The pin uses the developer's logo when the developer is in Super admin → Developers.${notReady ? ` ${notReady} selected record${notReady === 1 ? ' is' : 's are'} skipped (location not verified or already added).` : ''} Duplicate RERA numbers already in Projects are skipped.</p>` });
  if (!ok) return;
  toast('Adding…');
  const { data, error } = await ctx.client.rpc('admin_scraped_add', { p_ids: ready.map(r => r.id), p_publish: publish });
  if (error) return toast(friendlyError(error), 'bad');
  await refreshCounts();
  toast(`${data.added} added to Projects${publish ? ` · ${data.published} published` : ''}${data.skipped.length ? ` · ${data.skipped.length} skipped` : ''}`, data.skipped.length ? 'bad' : 'ok');
  if (data.skipped.length || data.notes.length) {
    await confirmDialog({ title: 'Some records need attention', confirmText: 'OK',
      body: `<ul style="margin:0;padding-left:18px;max-height:300px;overflow:auto">${[...data.skipped.map(x => `${x.name}: ${x.reason}`), ...data.notes].map(t => `<li>${esc(t)}</li>`).join('')}</ul>` });
  }
}

// ------------------------------------------------------------------- editor
const FIELDS = [
  ['project_name', 'Project name'], ['developer_name', 'Developer (legal name)'], ['project_type', 'Project type'], ['rera_number', 'RERA registration no.'],
  ['status', 'Registry status'], ['locality', 'Locality / taluka'], ['district', 'District'], ['city', 'City', 'city'], ['address', 'Address'], ['pincode', 'Pincode'],
  ['lat', 'Latitude'], ['lng', 'Longitude'], ['registration_date', 'Registration date (YYYY-MM-DD)'], ['approval_date', 'Approval date (YYYY-MM-DD)'],
  ['original_completion', 'Original completion (YYYY-MM-DD)'], ['revised_completion', 'Revised completion (YYYY-MM-DD)'], ['notes', 'Notes', 'area'],
];
async function openEditor(row, onDone) {
  const { data: doc, error } = await ctx.client.rpc('admin_scraped_get', { p_id: row.id });
  if (error) return toast(friendlyError(error), 'bad');
  const d = doc.data || {}, o = doc.original || {};
  const show = v => (v == null || v === '' ? '—' : String(v));
  const field = ([k, label, kind]) => {
    const diff = show(d[k]) !== show(o[k]);
    const input = kind === 'area' ? `<textarea class="input" rows="3" name="${k}">${esc(d[k] ?? '')}</textarea>`
      : kind === 'city' ? `<select class="input" name="${k}">${Object.entries(CITY_LABEL).map(([c, l]) => `<option value="${c}" ${d[k] === c ? 'selected' : ''}>${l}</option>`).join('')}</select>`
      : `<input class="input" name="${k}" value="${esc(d[k] ?? '')}" ${k === 'rera_number' || k === 'pincode' ? 'spellcheck="false"' : ''}>`;
    return `<label class="scr-field ${kind === 'area' ? 'wide' : ''}"><span>${esc(label)}</span>${input}<small class="scr-orig" ${diff ? '' : 'hidden'}>Registry original: ${esc(show(o[k]))}</small></label>`;
  };
  const dlg = h(`<dialog class="dialog scr-dialog"><form method="dialog">
    <div class="scr-top">${logoCell(row)}<div><h3 style="margin:0">${esc(d.project_name || 'Untitled')}</h3><div class="cell-sub">${esc(o.regulator || '')} · ${esc(o.rera_number || 'no registration number')} · ${esc(CITY_LABEL[o.city] || o.city || '')}</div></div>
      <div style="margin-left:auto;display:flex;gap:6px;flex-wrap:wrap">${pinBadge(d.pin_check)} ${stateBadge(row.project_state)}${row.pin_number != null ? ` <span class="badge info">Map pin #${esc(row.pin_number)}</span>` : ''} <span class="badge ${o.verification === 'Verified' ? 'ok' : 'warn'}">${esc(o.verification || '')}</span></div></div>
    <div class="scr-grid">
      <div class="scr-fields">${FIELDS.map(field).join('')}</div>
      <div class="scr-side">
        <div class="scr-map"></div>
        <p class="cell-sub" style="margin:6px 0 0">${esc(d.pin_reason || '')} Drag the pin to correct it — that marks the location “Set by hand”.</p>
        <div class="scr-noimg">No project images in the official registry listing. Add photos in the Review queue after adding to Projects.</div>
        <dl class="scr-facts">
          <dt>Registry status</dt><dd>${esc([o.status, o.status_category].filter(Boolean).join(' — ') || '—')}</dd>
          ${o.valid_up_to ? `<dt>Registration valid up to</dt><dd>${esc(o.valid_up_to)}</dd>` : ''}
          ${o.nclt_proposed_completion ? `<dt>Proposed completion (NCLT list)</dt><dd>${esc(o.nclt_proposed_completion)}</dd>` : ''}
          <dt>Extension</dt><dd>${esc(o.extension || '—')}</dd>
          <dt>Verified on</dt><dd>${esc(o.verified_on || '—')}</dd>
          <dt>Links</dt><dd>${o.project_url ? `<a href="${esc(o.project_url)}" target="_blank" rel="noopener">Registry project page</a><br>` : ''}${o.source_url ? `<a href="${esc(o.source_url)}" target="_blank" rel="noopener">Source listing</a>` : ''}</dd>
          <dt>Data notes</dt><dd class="cell-sub">${esc(o.notes || '')}</dd>
          ${doc.edited_at ? `<dt>Last edited</dt><dd>${esc(formatDate(doc.edited_at))}${doc.edited_by ? ` by ${esc(doc.edited_by)}` : ''}</dd>` : ''}
        </dl>
      </div>
    </div>
    <div class="dialog-actions" style="justify-content:space-between">
      <div style="display:flex;gap:8px">${doc.deleted ? '<button type="button" class="btn ghost" data-a="restore">Restore</button>' : '<button type="button" class="btn danger" data-a="delete">Delete</button>'}
        ${doc.edited_at ? '<button type="button" class="btn ghost" data-a="reset">Reset to registry original</button>' : ''}</div>
      <div style="display:flex;gap:8px">
        ${row.submission_id ? `<a class="btn ghost" href="#/review/${esc(row.submission_id)}" data-a="open">Open in Review queue</a>` : `<button type="button" class="btn ghost" data-a="add" ${READY.has(d.pin_check) ? '' : 'disabled title="Only records with a verified or hand-set location"'}>Add to Projects</button>`}
        <button value="cancel" class="btn ghost" type="submit">Close</button><button type="button" class="btn primary" data-a="save">Save changes</button></div>
    </div></form></dialog>`);
  document.body.appendChild(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();

  // map: show the pin; dragging it fills lat/lng
  const latIn = $('[name=lat]', dlg), lngIn = $('[name=lng]', dlg), mapEl = $('.scr-map', dlg);
  if (window.L) {
    const has = d.lat != null && d.lng != null;
    const map = window.L.map(mapEl, { scrollWheelZoom: false }).setView(has ? [d.lat, d.lng] : [19.07, 72.88], has ? 15 : 9);
    window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
    let marker = null;
    const place = (lat, lng) => {
      if (!marker) { marker = window.L.marker([lat, lng], { draggable: true }).addTo(map); marker.on('dragend', () => { const p = marker.getLatLng(); latIn.value = p.lat.toFixed(6); lngIn.value = p.lng.toFixed(6); }); }
      else marker.setLatLng([lat, lng]);
    };
    if (has) place(d.lat, d.lng);
    map.on('click', e => { place(e.latlng.lat, e.latlng.lng); latIn.value = e.latlng.lat.toFixed(6); lngIn.value = e.latlng.lng.toFixed(6); });
    [latIn, lngIn].forEach(i => i.addEventListener('change', () => { const a = +latIn.value, b = +lngIn.value; if (a && b) { place(a, b); map.setView([a, b], 15); } }));
    setTimeout(() => map.invalidateSize(), 60);
  } else mapEl.innerHTML = '<div class="pad muted">Map unavailable</div>';

  // Moving the pin makes the record addable ("Set by hand") once saved.
  const addBtn = $('[data-a=add]', dlg);
  const pinMoved = () => { if (addBtn && latIn.value && lngIn.value && (+latIn.value !== d.lat || +lngIn.value !== d.lng)) { addBtn.disabled = false; addBtn.title = 'Saves the new location (Set by hand) and adds the project'; } };
  [latIn, lngIn].forEach(i => i.addEventListener('change', pinMoved));
  mapEl.addEventListener('mouseup', () => setTimeout(pinMoved, 50));
  const patch = () => Object.fromEntries(FIELDS.map(([k]) => [k, $(`[name=${k}]`, dlg).value]));
  dlg.addEventListener('click', async e => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a || a === 'open') { if (a === 'open') dlg.close(); return; }
    e.preventDefault();
    if (a === 'save' || a === 'add') {
      const { error } = await ctx.client.rpc('admin_scraped_update', { p_id: row.id, p_patch: patch() });
      if (error) return toast(friendlyError(error), 'bad');
      if (a === 'save') { toast('Saved'); dlg.close(); return onDone(); }
      dlg.close();
      // The server decides from the saved record (verified, or "manual" after a pin move).
      const { data: saved } = await ctx.client.rpc('admin_scraped_get', { p_id: row.id });
      await bulkAction('add', [row.id], [{ ...row, pin_check: saved?.data?.pin_check || row.pin_check }]);
      return onDone();
    }
    if (a === 'reset') {
      if (!(await confirmDialog({ title: 'Reset to the registry original?', confirmText: 'Reset', tone: 'danger', body: 'All edits to this record are discarded.' }))) return;
      await ctx.client.rpc('admin_scraped_reset', { p_id: row.id }); toast('Reset to registry values'); dlg.close(); return onDone();
    }
    if (a === 'delete' || a === 'restore') {
      if (a === 'delete' && !(await confirmDialog({ title: 'Delete this record?', tone: 'danger', confirmText: 'Delete', body: 'It moves to the Deleted tab; you can restore it.' }))) return;
      const { error } = await ctx.client.rpc('admin_scraped_delete', { p_ids: [row.id], p_restore: a === 'restore' });
      if (error) return toast(friendlyError(error), 'bad');
      toast(a === 'delete' ? 'Deleted' : 'Restored'); dlg.close(); return onDone();
    }
  });
}

function exportCsv(rows) {
  const cols = ['city', 'pin_number', 'project_name', 'developer_name', 'rera_number', 'locality', 'district', 'pincode', 'lat', 'lng', 'pin_check', 'registration_date', 'status', 'status_category', 'project_type', 'verification', 'project_state', 'edited', 'source_url'];
  const cell = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = [cols.join(','), ...rows.map(r => cols.map(c => cell(r[c])).join(','))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `mappingg-scraped-data-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
}
