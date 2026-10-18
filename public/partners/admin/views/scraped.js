// Scraped data: projects collected from official RERA registries (MahaRERA,
// Haryana RERA - Gurugram, RERA Karnataka). Browse by city, edit, delete, and
// add the ones with a verified location to Projects (review queue / map).
import { h, esc, $, $$, formatDate, toast, confirmDialog, friendlyError } from '../../shared/lib.js';
import { ctx, refreshCounts } from '../context.js';
import { createBulk } from '../bulk.js';

const CITY_LABEL = { Mumbai: 'Mumbai', Thane: 'Thane', Kalyan_Dombivli: 'Kalyan-Dombivli', Pune: 'Pune', Gurugram: 'Gurugram', Noida: 'Noida / Greater Noida', Bengaluru: 'Bengaluru' };
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

const state = { page: 0, term: '', city: '', pin: '', cat: '', has: '', logo: '', proj: '', edited: '' };
// Page, search and filters survive a refresh of this browser tab.
const STATE_KEY = 'mg_scraped_view';
try { Object.assign(state, JSON.parse(sessionStorage.getItem(STATE_KEY) || '{}')); } catch { /* fresh view */ }
const saveState = () => { try { sessionStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch { /* not kept */ } };

// "Added data" tab: the facts added from the official registry project pages, one column per fact.
const HAS = { configurations: 'Configurations', unit_mix: 'Unit mix', carpet: 'Carpet area', total_units: 'Total units', towers: 'Towers', total_plots: 'Plots',
  land_area: 'Land area', proposed_completion: 'Proposed completion', project_cost: 'Project cost', amenities: 'Amenities', approving_authority: 'Plan approval',
  dtcp_license: 'DTCP licence', developer_website: 'Developer website', pincode: 'Pincode', full_address: 'Full address' };
const hasFact = (f, k) => k === 'carpet' ? !!(f.carpet_area || f.total_carpet_area) : Array.isArray(f[k]) ? f[k].length > 0 : f[k] != null && f[k] !== '';
const sqft = n => Number(n).toLocaleString('en-IN');
const carpetText = f => Array.isArray(f.unit_mix) && f.unit_mix.some(u => u.avg_carpet_sqft || u.carpet_sqft_per_unit)
  ? f.unit_mix.filter(u => u.avg_carpet_sqft || u.carpet_sqft_per_unit).map(u => `${u.type}: ${u.avg_carpet_sqft ? 'avg ' : ''}${sqft(u.avg_carpet_sqft || u.carpet_sqft_per_unit)} sq ft`).join(' · ')
  : f.carpet_area || f.total_carpet_area || '';
const dash = '<span class="cell-sub">—</span>';
// Complete and clean registry data (server: readyGaps in lib/scraped.ts).
const isReady = r => Array.isArray(r.ready_gaps) && !r.ready_gaps.length;

export async function renderScraped(page, params) {
  const tab = params.get('tab') || 'all';
  // A click on a summary card (…&s=1) opens exactly that list: other filters are cleared.
  if (params.get('s')) {
    Object.assign(state, { page: 0, term: '', city: '', pin: '', cat: '', has: '', logo: '', proj: '', edited: '' });
    for (const k of ['pin', 'proj', 'edited']) if (params.get(k)) state[k] = params.get(k);
    // Only once: a later re-render (bulk action, reload) keeps whatever filters are set by then.
    params.delete('s');
    try { history.replaceState(null, '', location.hash.replace(/&s=1\b/, '')); } catch { /* fine without */ }
  }
  if (params.get('city')) state.city = params.get('city');
  page.innerHTML = '<div class="muted pad">Loading scraped data…</div>';
  const [{ data, error }, facts] = await Promise.all([ctx.client.rpc('admin_scraped_list'), tab === 'data' ? ctx.client.rpc('admin_scraped_enriched') : null]);
  if (error) throw error;
  if (facts?.error) throw facts.error;
  const all = data.rows || [];
  if (!all.length) return renderEmpty(page);
  const factsById = new Map((facts?.data || []).map(x => [x.id, x]));

  const live = all.filter(r => !r.deleted), added = live.filter(r => r.submission_id), deleted = all.filter(r => r.deleted);
  const enriched = live.filter(r => r.enrichment_status === 'Pending Review');
  const base = tab === 'added' ? added : tab === 'deleted' ? deleted : tab === 'enriched' ? enriched
    : tab === 'data' ? live.filter(r => factsById.has(r.id) && isReady(r)).map(r => ({ ...r, facts: factsById.get(r.id) })) : live;

  page.innerHTML = '';
  const head = h(`<div class="page-head">
    <div><h1>Scraped data</h1><p>Official RERA registry records${data.dataset_generated ? ` · dataset ${esc(formatDate(data.dataset_generated))}` : ''}${data.imported_at ? ` · imported ${esc(formatDate(data.imported_at))}` : ''}. Nothing goes on the map until you publish it.</p></div>
    <div style="display:flex;gap:8px"><button class="btn ghost" data-a="import">Refresh from dataset</button><button class="btn ghost" data-a="csv">Export CSV</button></div></div>`);
  page.appendChild(head);
  // Each card opens the list it counts.
  const only = (k) => ['pin', 'proj', 'edited'].every((x) => (x === k ? true : !state[x])) && !state.term && !state.city && !state.cat;
  const cards = [
    [live.length, 'Scraped records', 'tab=all', tab === 'all' && only(null)],
    [live.filter(r => READY.has(r.pin_check)).length, 'Location verified · ready to add', 'tab=all&pin=ready', tab === 'all' && state.pin === 'ready' && only('pin')],
    [added.length, 'Added to Projects', 'tab=added', tab === 'added' && only(null)],
    [added.filter(r => r.project_state === 'live').length, 'Live on the map', 'tab=added&proj=live', tab === 'added' && state.proj === 'live' && only('proj')],
    [live.filter(r => r.edited).length, 'Edited by team', 'tab=all&edited=1', tab === 'all' && state.edited === '1' && only('edited')],
  ];
  page.appendChild(h(`<div class="stats">${cards.map(([n, l, q, on]) =>
    `<a class="card stat ${on ? 'on' : ''}" href="#/scraped?${q}&s=1" title="Show these records"${on ? ' aria-current="true"' : ''}><div class="v">${n.toLocaleString()}</div><div class="l">${l}</div></a>`).join('')}</div>`));
  page.appendChild(h(`<div class="tabs" role="tablist">
    <a class="tab ${tab === 'all' ? 'on' : ''}" href="#/scraped?tab=all">All scraped data<span class="n">${live.length}</span></a>
    <a class="tab ${tab === 'enriched' ? 'on' : ''}" href="#/scraped?tab=enriched" title="Facts added from the official registry project pages. Not on the map; review before adding to Projects.">Enriched — Review Pending<span class="n">${enriched.length}</span></a>
    <a class="tab ${tab === 'data' ? 'on' : ''}" href="#/scraped?tab=data" title="Only enriched records whose registry data is complete and clean, one column per fact. Check them, then add to Projects / publish.">Added data — Check &amp; go live<span class="n">${live.filter(isReady).length}</span></a>
    <a class="tab ${tab === 'added' ? 'on' : ''}" href="#/scraped?tab=added">Added to Projects<span class="n">${added.length}</span></a>
    <a class="tab ${tab === 'deleted' ? 'on' : ''}" href="#/scraped?tab=deleted">Deleted<span class="n">${deleted.length}</span></a></div>`));

  const cities = Object.keys(CITY_LABEL).map(c => [c, base.filter(r => r.city === c).length]);
  const cats = [...new Set(base.map(r => r.status_category).filter(Boolean))].sort();
  const projSelect = () => `<select class="input" style="max-width:200px" aria-label="Projects" data-f="proj"><option value="">Projects: any</option>
      ${tab === 'added' ? '' : `<option value="not" ${state.proj === 'not' ? 'selected' : ''}>Not added yet (${base.filter(r => !r.submission_id).length})</option>`}
      <option value="added" ${state.proj === 'added' ? 'selected' : ''}>Added, not live (${base.filter(r => r.submission_id && r.project_state !== 'live').length})</option>
      <option value="live" ${state.proj === 'live' ? 'selected' : ''}>Live on map (${base.filter(r => r.project_state === 'live').length})</option></select>`;
  const toolbar = h(`<div class="toolbar">
    <input class="input" type="search" placeholder="Search project, developer, RERA no., locality, pincode…" aria-label="Search" value="${esc(state.term)}">
    <select class="input" style="max-width:190px" aria-label="City" data-f="city"><option value="">All cities (${base.length})</option>
      ${cities.map(([c, n]) => `<option value="${c}" ${state.city === c ? 'selected' : ''}>${CITY_LABEL[c]} (${n})</option>`).join('')}</select>
    <select class="input" style="max-width:200px" aria-label="Location" data-f="pin"><option value="">Any location status</option><option value="ready" ${state.pin === 'ready' ? 'selected' : ''}>Ready to add (verified / by hand)</option>
      ${Object.entries(PIN).map(([k, p]) => `<option value="${k}" ${state.pin === k ? 'selected' : ''}>${p.label}</option>`).join('')}</select>
    <select class="input" style="max-width:240px" aria-label="Registry status" data-f="cat"><option value="">Any registry status</option>
      ${cats.map(c => `<option ${state.cat === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
    <select class="input" style="max-width:170px" aria-label="Edited" data-f="edited"><option value="">Edited or not</option>
      <option value="1" ${state.edited === '1' ? 'selected' : ''}>Edited by team (${base.filter(r => r.edited).length})</option></select>
    ${tab === 'added' ? projSelect() : ''}
    ${tab === 'data' ? `<select class="input" style="max-width:200px" aria-label="Added fact" data-f="has"><option value="">Any added data</option>
      ${Object.entries(HAS).map(([k, l]) => `<option value="${k}" ${state.has === k ? 'selected' : ''}>Has ${esc(l.toLowerCase())} (${base.filter(r => hasFact(r.facts.fields || {}, k)).length})</option>`).join('')}</select>
    <select class="input" style="max-width:220px" aria-label="Developer logo" data-f="logo"><option value="">Developer logo: any</option>
      <option value="yes" ${state.logo === 'yes' ? 'selected' : ''}>Logo matched (${base.filter(r => r.logo).length})</option>
      <option value="no" ${state.logo === 'no' ? 'selected' : ''}>No logo in Developers (${base.filter(r => !r.logo).length})</option></select>
    ${projSelect()}` : ''}
    <button class="btn ghost sm" type="button" data-a="selall">Select all matching</button>
  </div>`);
  if (tab === 'data') page.appendChild(h(`<p class="cell-sub" style="margin:-4px 0 10px"><b>Only complete, clean records are listed:</b> configuration, units, completion date still ahead, project cost, land area and pincode all from the registry, no conflict with the registry list, registration not lapsed / withdrawn / revoked and project not completed.
    ${(() => { const gaps = {}; live.filter(r => r.ready_gaps?.length).forEach(r => r.ready_gaps.forEach(g => { gaps[g] = (gaps[g] || 0) + 1; }));
      const n = live.filter(r => r.ready_gaps?.length).length;
      return n ? `<span title="${esc(Object.entries(gaps).sort((a, b) => b[1] - a[1]).map(([g, c]) => `${g}: ${c}`).join('\n'))}" style="text-decoration:underline dotted">${n.toLocaleString()} other enriched records are left out</span> (still in the Enriched tab). ` : ''; })()}
    The registry has no photos: add real photos before publishing. Check the developer logo and the location pin of each record.
    Facts are from the official registry project page (RERA Karnataka / HARERA / UP RERA). <b>MahaRERA (Pune / Mumbai)</b> project pages need a CAPTCHA, so those rows use the developer's own project page instead (it must show the same RERA number, the BHK types and a possession date; location pin verified; developer logo matched) — their units, land area and project cost show “Pending (MahaRERA)”. Prices are not published by RERA; “Project cost” is the cost declared to RERA. “Add to Projects” copies these facts into the project (configurations, units, towers, land area, amenities, and the rest under Additional details) — check them in the Review queue, then publish.</p>`));
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
      && (!state.edited || r.edited)
      && (!state.proj || (state.proj === 'not' ? !r.submission_id : state.proj === 'live' ? r.project_state === 'live' : r.submission_id && r.project_state !== 'live'))
      && (tab !== 'data' || ((!state.has || hasFact(r.facts.fields || {}, state.has))
        && (!state.logo || (state.logo === 'yes') === !!r.logo)))
      && (!t ||[r.project_name, r.developer_name, r.rera_number, r.locality, r.district, r.pincode, CITY_LABEL[r.city]].some(x => String(x || '').toLowerCase().includes(t))));
  };
  const draw = () => {
    bulk.attach(draw);
    const list = filtered();
    const pages = Math.max(1, Math.ceil(list.length / PAGE));
    if (state.page >= pages) state.page = 0;
    saveState();
    const shown = list.slice(state.page * PAGE, state.page * PAGE + PAGE);
    if (!list.length) { wrap.innerHTML = `<div class="pad muted" style="text-align:center;padding:48px">${base.length ? 'No matches.' : tab === 'added' ? 'Nothing added to Projects yet.' : tab === 'enriched' || tab === 'data' ? 'No enriched records waiting for review.' : 'Nothing here.'}</div>`; pager.innerHTML = ''; return; }
    wrap.innerHTML = tab === 'data'
      ? `<table class="tbl scr-data"><thead><tr><th>Logo</th><th>Project</th><th>Configurations · units</th><th>Carpet area (RERA)</th><th>Land area</th><th>Start → completion</th><th>Project cost (RERA)</th><th>Amenities</th><th>Registry status</th><th>Location pin</th><th>Projects</th></tr></thead><tbody></tbody></table>`
      : `<table class="tbl"><thead><tr><th></th><th>Project</th><th>RERA no.</th><th>Location</th><th>Registered</th><th>Registry status</th><th>Location pin</th><th>Projects</th><th>Pin no.</th></tr></thead><tbody></tbody></table>`;
    $('thead tr', wrap).prepend(bulk.headCell(shown.map(r => r.id)));
    const tb = $('tbody', wrap);
    for (const r of shown) {
      const tr = tab === 'data' ? dataRow(r) : h(`<tr class="clickable" tabindex="0">
        <td style="width:52px">${logoCell(r)}</td>
        <td><div class="cell-title">${esc(r.project_name || 'Untitled')}${r.edited ? ' <span class="tag-mini">Edited</span>' : ''}${r.enrichment_status ? ` <span class="tag-mini" title="${esc(`${r.enriched_fields} fields from the official registry · ${r.enrichment_status}${r.enrichment_review ? ` · ${r.enrichment_review} to review` : ''}`)}">Enriched</span>` : ''}</div><div class="cell-sub">${esc(r.developer_name || 'Developer not shown')}</div></td>
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

function dataRow(r) {
  const x = r.facts, f = x.fields || {};
  const units = [f.total_units != null && `${sqft(f.total_units)} units`, f.towers != null && `${f.towers} tower${f.towers === 1 ? '' : 's'}`, f.total_plots != null && `${sqft(f.total_plots)} plots`].filter(Boolean).join(' · ');
  const types = f.configurations || (Array.isArray(f.unit_mix) ? f.unit_mix.map(u => u.type).join(', ') : '') || f.project_sub_type || '';
  const amen = Array.isArray(f.amenities) ? f.amenities : [];
  // MahaRERA rows with facts from the developer's own website: registry-only facts stay visibly pending.
  const dev = x.source_type === 'developer_official_site';
  const pend = dev ? '<span class="tag-mini" title="Only on the MahaRERA project page (CAPTCHA) - not collected">Pending (MahaRERA)</span>' : dash;
  return h(`<tr class="clickable" tabindex="0">
    <td style="width:60px;text-align:center">${logoCell(r)}<div class="cell-sub" style="font-size:11px">${r.logo ? 'Matched' : 'No logo'}</div></td>
    <td><div class="cell-title">${esc(r.project_name || 'Untitled')}</div><div class="cell-sub">${esc(r.developer_name || 'Developer not shown')}</div>
      <div class="cell-sub" style="white-space:nowrap">${esc(r.rera_number || '—')} · ${esc([r.locality, CITY_LABEL[r.city]].filter(Boolean).join(', '))}</div>
      ${dev && x.source ? `<div class="cell-sub"><a href="${esc(x.source)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Developer page ↗</a> · facts from developer website</div>` : ''}</td>
    <td>${types ? esc(types) : dash}${units ? `<div class="cell-sub">${esc(units)}</div>` : dev ? `<div class="cell-sub">Units: ${pend}</div>` : ''}${f.plot_sizes ? `<div class="cell-sub">Plots: ${esc([].concat(f.plot_sizes).join(', '))}</div>` : ''}</td>
    <td class="cell-sub" style="max-width:260px">${esc(carpetText(f)) || (dev ? pend : dash)}</td>
    <td class="cell-sub">${esc(f.land_area || '') || (dev ? pend : dash)}</td>
    <td class="cell-sub" style="white-space:nowrap">${f.project_start_date || f.proposed_completion ? `${esc(f.project_start_date || '?')} → ${esc(f.proposed_completion || '?')}` : dash}${dev && f.proposed_completion ? `<div class="cell-sub" title="${esc(f.possession_text || '')}">possession, developer website</div>` : ''}</td>
    <td class="cell-sub">${esc(String(f.project_cost || '').replace(/\s*\(.*\)$/, '')) || (dev ? pend : dash)}</td>
    <td class="cell-sub" title="${esc(amen.join(', '))}">${amen.length ? `${amen.length}: ${esc(amen.slice(0, 3).join(', '))}${amen.length > 3 ? '…' : ''}` : dash}</td>
    <td class="cell-sub">${esc(f.registry_project_status || '') || dash}</td>
    <td>${pinBadge(r.pin_check)}</td>
    <td>${stateBadge(r.project_state)}</td></tr>`);
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

// Facts read from the official registry project page (migration/enrichment/scraped/apply.mjs).
const ENRICH_LABEL = { full_address: 'Full address', taluk: 'Taluk', tehsil: 'Tehsil', pincode: 'Pincode', project_description: 'Description',
  project_sub_type: 'Project sub-type', registry_project_status: 'Registry project status', configurations: 'Configurations', carpet_area: 'Carpet area',
  unit_mix: 'Unit mix', plot_sizes: 'Plot sizes', total_units: 'Total units', total_plots: 'Total plots', towers: 'Towers', land_area: 'Land area',
  total_carpet_area: 'Total carpet area', amenities: 'Amenities', project_start_date: 'Start date', proposed_completion: 'Proposed completion',
  approving_authority: 'Plan approved by', approved_plan_number: 'Approved plan no.', plan_approval_date: 'Plan approval date',
  layout_plan_approval_date: 'Layout plan approval', building_plan_approval_date: 'Building plan approval', dtcp_license: 'DTCP licence',
  project_cost: 'Project cost', water_source: 'Water source', developer_website: 'Developer website (as declared to RERA)',
  registry_promoter_name: 'Promoter (detail page)', registry_latitude: 'Registry latitude', registry_longitude: 'Registry longitude' };
function enrichmentBlock(e) {
  if (!e) return '';
  const val = (k, v) => k === 'unit_mix' ? v.map(u => `${u.type}: ${u.units} units${u.avg_carpet_sqm ? `, avg ${u.avg_carpet_sqm} sq m carpet` : u.carpet_sqm_per_unit ? `, ${u.carpet_sqm_per_unit} sq m carpet each` : ''}`).join('<br>')
    : Array.isArray(v) ? esc(v.join(', '))
    : k === 'developer_website' ? `<a href="${esc(/^https?:/i.test(v) ? v : `https://${v}`)}" target="_blank" rel="noopener nofollow">${esc(v)}</a>` : esc(String(v));
  const filled = Object.keys(e.data_filled || {});
  return `<div class="scr-enrich"><h4 style="margin:14px 0 6px">Enriched from the official registry <span class="badge warn">${esc(e.review_status || '')}</span></h4>
    <p class="cell-sub" style="margin:0 0 6px">${esc(e.verification || '')} · ${esc(formatDate(e.enriched_at))}. Not on the map — review before adding to Projects.${filled.length ? ` Blank fields filled: ${esc(filled.join(', '))}.` : ''}</p>
    <dl class="scr-facts">${Object.entries(e.fields || {}).map(([k, v]) => `<dt>${esc(ENRICH_LABEL[k] || k)}</dt><dd>${val(k, v)}</dd>`).join('')}
      ${(e.review_required || []).length ? `<dt>Needs review</dt><dd>${e.review_required.map(r => `${esc(r.field)}: current “${esc(r.current)}”, registry “${esc(r.registry)}” — ${esc(r.reason)}`).join('<br>')}</dd>` : ''}
      <dt>Sources</dt><dd>${(e.sources || []).map(u => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u.replace(/^https?:\/\//, ''))}</a>`).join('<br>')}${e.source_note ? `<div class="cell-sub">${esc(e.source_note)}</div>` : ''}</dd>
    </dl></div>`;
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
          ${doc.enrichment?.location_check ? `<dt>Location check (OpenStreetMap)</dt><dd><strong>${esc(doc.enrichment.location_check.result)}</strong> — ${esc(doc.enrichment.location_check.note || '')}</dd>` : ''}
          <dt>Registry status</dt><dd>${esc([o.status, o.status_category].filter(Boolean).join(' — ') || '—')}</dd>
          ${o.valid_up_to ? `<dt>Registration valid up to</dt><dd>${esc(o.valid_up_to)}</dd>` : ''}
          ${o.nclt_proposed_completion ? `<dt>Proposed completion (NCLT list)</dt><dd>${esc(o.nclt_proposed_completion)}</dd>` : ''}
          <dt>Extension</dt><dd>${esc(o.extension || '—')}</dd>
          <dt>Verified on</dt><dd>${esc(o.verified_on || '—')}</dd>
          <dt>Links</dt><dd>${o.project_url ? `<a href="${esc(o.project_url)}" target="_blank" rel="noopener">Registry project page</a><br>` : ''}${o.source_url ? `<a href="${esc(o.source_url)}" target="_blank" rel="noopener">Source listing</a>` : ''}</dd>
          <dt>Data notes</dt><dd class="cell-sub">${esc(o.notes || '')}</dd>
          ${doc.edited_at ? `<dt>Last edited</dt><dd>${esc(formatDate(doc.edited_at))}${doc.edited_by ? ` by ${esc(doc.edited_by)}` : ''}</dd>` : ''}
        </dl>
        ${enrichmentBlock(doc.enrichment)}
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
  const cols = ['city', 'pin_number', 'project_name', 'developer_name', 'rera_number', 'locality', 'district', 'pincode', 'lat', 'lng', 'pin_check', 'registration_date', 'status', 'status_category', 'project_type', 'verification', 'project_state', 'edited', 'enrichment_status', 'enriched_at', 'enriched_fields', 'source_url'];
  // On the "Added data" tab every added fact gets its own column too.
  const factCols = [...new Set(rows.flatMap(r => Object.keys(r.facts?.fields || {})))];
  const flat = v => v == null ? '' : Array.isArray(v) ? v.map(u => (u && typeof u === 'object' ? Object.values(u).filter(z => z != null).join(' ') : u)).join('; ') : v;
  const cell = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = [[...cols, ...factCols.map(k => `registry_${k.replace(/^registry_/, '')}`), ...(factCols.length ? ['needs_check', 'registry_source'] : [])].join(','),
    ...rows.map(r => [...cols.map(c => cell(r[c])), ...factCols.map(k => cell(flat(r.facts.fields[k]))),
      ...(factCols.length ? [cell((r.facts.review_required || []).map(c => `${c.field}: current ${c.current}, registry ${c.registry}`).join('; ')), cell(r.facts.source)] : [])].join(','))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `mappingg-scraped-data-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
}
