// Review queue: every submission, filtered by status.
import { STATUS, completeness } from '../../shared/fields.js';
import { h, esc, $, $$, statusBadge, timeAgo } from '../../shared/lib.js';
import { ctx } from '../context.js';

const TABS = [
  { key: 'review', label: 'To review', statuses: ['submitted', 'in_review'] },
  { key: 'changes_requested', label: 'Waiting on builder', statuses: ['changes_requested'] },
  { key: 'draft', label: 'Drafts', statuses: ['draft'] },
  { key: 'published', label: 'Published', statuses: ['published'] },
  { key: 'rejected', label: 'Rejected', statuses: ['rejected'] },
  { key: 'all', label: 'All', statuses: null }
];

const SOURCE = { link: 'Builder link', excel: 'Excel', csv: 'CSV', admin: 'Added by team' };

export async function renderQueue(page, params) {
  const tabKey = params.get('tab') || 'review';
  const tab = TABS.find(t => t.key === tabKey) || TABS[0];
  const bs = (ctx.counts && ctx.counts.by_status) || {};
  const count = t => t.statuses ? t.statuses.reduce((n, s) => n + (bs[s] || 0), 0) : Object.values(bs).reduce((a, b) => a + b, 0);

  page.innerHTML = '';
  page.appendChild(h(`<div class="page-head">
    <div><h1>Review queue</h1><p>Nothing goes live until you publish it.</p></div>
    <a class="btn primary" href="#/new">+ Add project manually</a>
  </div>`));

  const c = ctx.counts || {};
  page.appendChild(h(`<div class="stats">
    <div class="card stat"><div class="v">${(bs.submitted || 0) + (bs.in_review || 0)}</div><div class="l">Waiting for review</div></div>
    <div class="card stat"><div class="v">${c.pending_updates || 0}</div><div class="l">Updates to live projects</div></div>
    <div class="card stat"><div class="v">${bs.changes_requested || 0}</div><div class="l">Waiting on builders</div></div>
    <div class="card stat"><div class="v">${c.live || 0}</div><div class="l">Live on the map</div></div>
    <div class="card stat"><div class="v">${c.active_links || 0}</div><div class="l">Active builder links</div></div>
  </div>`));

  const tabs = h('<div class="tabs" role="tablist"></div>');
  for (const t of TABS) {
    tabs.appendChild(h(`<a class="tab ${t.key === tab.key ? 'on' : ''}" role="tab" href="#/queue?tab=${t.key}">${esc(t.label)}<span class="n">${count(t)}</span></a>`));
  }
  page.appendChild(tabs);

  const toolbar = h(`<div class="toolbar">
    <input class="input" type="search" placeholder="Search project, builder, city, RERA or ref…" aria-label="Search">
    <select class="input" style="max-width:180px" aria-label="Source"><option value="">All sources</option>
      ${Object.entries(SOURCE).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
  </div>`);
  page.appendChild(toolbar);

  let q = ctx.client.from('project_submissions')
    .select('*, builder:builders(company_name, code), link:submission_links(tag)')
    .order('updated_at', { ascending: false })
    .limit(1000);
  if (tab.statuses) q = q.in('status', tab.statuses);
  const { data: rows, error } = await q;
  if (error) throw error;

  const wrap = h('<div class="card table-wrap"></div>');
  page.appendChild(wrap);

  const draw = () => {
    const term = $('input', toolbar).value.trim().toLowerCase();
    const src = $('select', toolbar).value;
    const list = rows.filter(r => (!src || r.source === src) && (!term || [
      r.project_name, r.ref_code, r.city, r.locality, r.developer_name, r.builder?.company_name, r.builder?.code, ...(r.rera_numbers || [])
    ].some(x => (x || '').toLowerCase().includes(term))));
    if (!list.length) {
      wrap.innerHTML = `<div class="pad muted" style="text-align:center;padding:48px">${rows.length ? 'No matches.' : 'Nothing here right now.'}</div>`;
      return;
    }
    wrap.innerHTML = `<table class="tbl"><thead><tr>
      <th>Project</th><th>Builder</th><th>Location</th><th>Source</th><th>Status</th><th>Complete</th><th>Updated</th>
    </tr></thead><tbody></tbody></table>`;
    const tb = $('tbody', wrap);
    for (const r of list) {
      const c2 = completeness(r);
      const flags = Object.keys(r.flags || {}).length;
      const tr = h(`<tr class="clickable" tabindex="0">
        <td><div class="cell-title">${esc(r.project_name || 'Untitled')}${r.has_unpublished_changes ? '<span class="tag-mini">Update to live</span>' : ''}</div>
            <div class="cell-sub">${esc(r.ref_code)}${(r.rera_numbers || []).length ? ' · ' + esc(r.rera_numbers.join(', ')) : ''}</div></td>
        <td><div>${esc(r.builder?.company_name || r.developer_name || '—')}</div><div class="cell-sub">${esc(r.link?.tag || r.builder?.code || '')}</div></td>
        <td>${esc([r.locality, r.city].filter(Boolean).join(', ') || '—')}<div class="cell-sub">${esc(r.country || '')}</div></td>
        <td>${esc(SOURCE[r.source] || r.source)}</td>
        <td>${statusBadge(r.status, STATUS)}${flags && r.status === 'changes_requested' ? `<div class="cell-sub">${flags} flagged</div>` : ''}</td>
        <td class="num"><span class="meter"><span style="width:${c2.pct}%"></span></span>${c2.pct}%</td>
        <td class="cell-sub">${esc(timeAgo(r.updated_at))}</td>
      </tr>`);
      const open = () => { location.hash = `#/review/${r.id}`; };
      tr.addEventListener('click', open);
      tr.addEventListener('keydown', e => { if (e.key === 'Enter') open(); });
      tb.appendChild(tr);
    }
  };
  $('input', toolbar).addEventListener('input', draw);
  $('select', toolbar).addEventListener('change', draw);
  draw();
}
