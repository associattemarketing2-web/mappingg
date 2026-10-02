// Live projects: what the public map is showing right now.
import { h, esc, $, formatDate, toast } from '../../shared/lib.js';
import { ctx } from '../context.js';

export async function renderLive(page) {
  const { data: rows, error } = await ctx.client.from('projects')
    .select('id, submission_id, slug, is_live, featured, project_name, project_type, city, locality, country, price_label, configurations, rera_numbers, rera_verified_on, cover_image_url, published_at, updated_at, lat, lng, developer_name, construction_status, sales_status, possession_date_rera, possession_date_target')
    .order('published_at', { ascending: false });
  if (error) throw error;

  page.innerHTML = '';
  const head = h(`<div class="page-head">
    <div><h1>Live projects</h1><p>${rows.filter(r => r.is_live).length} on the map · ${rows.filter(r => !r.is_live).length} offline</p></div>
    <button class="btn ghost">Export CSV</button></div>`);
  $('button', head).addEventListener('click', () => exportCsv(rows));
  page.appendChild(head);

  const toolbar = h('<div class="toolbar"><input class="input" type="search" placeholder="Search live projects…" aria-label="Search"></div>');
  page.appendChild(toolbar);
  const wrap = h('<div class="card table-wrap"></div>');
  page.appendChild(wrap);

  const draw = () => {
    const term = $('input', toolbar).value.trim().toLowerCase();
    const list = rows.filter(r => !term || [r.project_name, r.city, r.locality, r.developer_name, r.slug, ...(r.rera_numbers || [])].some(x => (x || '').toLowerCase().includes(term)));
    if (!list.length) { wrap.innerHTML = `<div class="pad muted" style="text-align:center;padding:48px">${rows.length ? 'No matches.' : 'Nothing published yet.'}</div>`; return; }
    wrap.innerHTML = '<table class="tbl"><thead><tr><th></th><th>Project</th><th>Location</th><th>Price</th><th>RERA</th><th>Status</th><th>Published</th></tr></thead><tbody></tbody></table>';
    const tb = $('tbody', wrap);
    for (const r of list) {
      const tr = h(`<tr class="clickable" tabindex="0">
        <td style="width:64px">${r.cover_image_url ? `<img src="${esc(r.cover_image_url)}" alt="" style="width:56px;height:40px;object-fit:cover;border-radius:6px;display:block">` : '<div style="width:56px;height:40px;border-radius:6px;background:var(--muted-bg)"></div>'}</td>
        <td><div class="cell-title">${esc(r.project_name)}${r.featured ? ' <span class="badge info">Featured</span>' : ''}</div><div class="cell-sub">${esc(r.developer_name || '')} · /${esc(r.slug)}</div></td>
        <td>${esc([r.locality, r.city].filter(Boolean).join(', '))}<div class="cell-sub">${esc(r.country)}</div></td>
        <td class="num">${esc(r.price_label || '')}</td>
        <td class="cell-sub">${esc((r.rera_numbers || []).join(', ') || '—')}${r.rera_verified_on ? `<br>✓ ${esc(formatDate(r.rera_verified_on))}` : ''}</td>
        <td>${r.is_live ? '<span class="badge ok">Live</span>' : '<span class="badge muted">Offline</span>'}</td>
        <td class="cell-sub">${esc(formatDate(r.published_at))}</td></tr>`);
      const open = () => { if (r.submission_id) location.hash = `#/review/${r.submission_id}`; else toast('No submission linked to this project.', 'bad'); };
      tr.addEventListener('click', open);
      tr.addEventListener('keydown', e => { if (e.key === 'Enter') open(); });
      tb.appendChild(tr);
    }
  };
  $('input', toolbar).addEventListener('input', draw);
  draw();
}

function exportCsv(rows) {
  const cols = ['project_name', 'developer_name', 'project_type', 'construction_status', 'sales_status', 'locality', 'city', 'country', 'lat', 'lng',
    'price_label', 'configurations', 'rera_numbers', 'rera_verified_on', 'possession_date_rera', 'possession_date_target', 'slug', 'is_live', 'published_at'];
  const cell = v => {
    const s = Array.isArray(v) ? v.join(', ') : (v ?? '');
    return /[",\n]/.test(String(s)) ? `"${String(s).replace(/"/g, '""')}"` : String(s);
  };
  const csv = [cols.join(','), ...rows.map(r => cols.map(c => cell(r[c])).join(','))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `mappingg-live-projects-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
}
