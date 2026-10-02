// Builders and their unique submission links.
import { STATUS, BUILDER_STATUS } from '../../shared/fields.js';
import { h, esc, $, toast, friendlyError, statusBadge, formatDate, timeAgo, confirmDialog, linkUrl, whatsappUrl, copyText } from '../../shared/lib.js';
import { ctx, refreshCounts } from '../context.js';

function linkState(l) {
  if (!l.is_active) return { label: 'Switched off', tone: 'muted' };
  if (l.expires_at && new Date(l.expires_at) < new Date()) return { label: 'Expired', tone: 'bad' };
  return { label: 'Active', tone: 'ok' };
}

// Furthest step reached through this link: Sent → Opened → Draft → Submitted → Changes requested → Published
function linkStage(l, subs) {
  const mine = subs.filter(s => s.link_id === l.id);
  const has = st => mine.some(s => s.status === st);
  if (has('published')) return 'Published';
  if (has('changes_requested')) return 'Changes requested';
  if (has('submitted') || has('in_review')) return 'Submitted';
  if (has('draft')) return 'Draft started';
  if (l.first_opened_at) return 'Opened';
  return 'Sent';
}

function builderForm(b = {}) {
  return `<div class="two-col form-col">
    <label class="wide">Company name * <input class="input" name="company_name" required value="${esc(b.company_name || '')}"></label>
    <label>Contact person <input class="input" name="contact_name" value="${esc(b.contact_name || '')}"></label>
    <label>WhatsApp / phone <input class="input" name="phone" placeholder="+91 98xxxxxxxx" value="${esc(b.phone || '')}"></label>
    <label>Email <input class="input" type="email" name="email" value="${esc(b.email || '')}"></label>
    <label>City <input class="input" name="city" value="${esc(b.city || '')}"></label>
    <label class="wide">Country <input class="input" name="country" value="${esc(b.country || 'India')}"></label>
    <label class="wide">Internal notes <textarea class="input" name="notes" rows="2">${esc(b.notes || '')}</textarea></label>
  </div>`;
}

function formDialog(title, inner, submitText) {
  return new Promise(resolve => {
    const dlg = h(`<dialog class="dialog"><form method="dialog"><h3>${esc(title)}</h3>${inner}
      <div class="dialog-actions"><button class="btn ghost" value="cancel" formnovalidate>Cancel</button><button class="btn primary" value="ok">${esc(submitText)}</button></div>
    </form></dialog>`);
    document.body.appendChild(dlg);
    const form = $('form', dlg);
    dlg.addEventListener('close', () => {
      const ok = dlg.returnValue === 'ok';
      const data = Object.fromEntries(new FormData(form).entries());
      dlg.remove();
      resolve(ok ? data : null);
    });
    dlg.showModal();
  });
}

function clean(obj) {
  const o = {};
  for (const [k, v] of Object.entries(obj)) o[k] = typeof v === 'string' ? (v.trim() || null) : v;
  return o;
}

export async function addBuilderDialog() {
  const data = await formDialog('Add a builder', builderForm(), 'Add builder');
  if (!data) return null;
  if (!data.company_name?.trim()) { toast('Company name is required.', 'bad'); return null; }
  const { data: row, error } = await ctx.client.from('builders').insert(clean(data)).select('*').single();
  if (error) { toast(friendlyError(error), 'bad'); return null; }
  toast(`Added ${row.company_name} (${row.code})`);
  refreshCounts();
  return row;
}

export async function renderBuilders(page) {
  const { data: rows, error } = await ctx.client.from('builders')
    .select('*, links:submission_links(id, is_active, expires_at, last_opened_at, last_activity_at), subs:project_submissions(status)')
    .order('created_at', { ascending: false });
  if (error) throw error;

  page.innerHTML = '';
  const head = h(`<div class="page-head">
    <div><h1>Builders &amp; links</h1><p>Each builder gets a unique link. Track who opened it, who submitted and who needs a nudge.</p></div>
    <button class="btn primary">+ Add builder</button></div>`);
  $('button', head).addEventListener('click', async () => {
    const b = await addBuilderDialog();
    if (b) location.hash = `#/builders/${b.id}`;
  });
  page.appendChild(head);

  const toolbar = h('<div class="toolbar"><input class="input" type="search" placeholder="Search builders…" aria-label="Search builders"></div>');
  page.appendChild(toolbar);
  const wrap = h('<div class="card table-wrap"></div>');
  page.appendChild(wrap);

  const draw = () => {
    const term = $('input', toolbar).value.trim().toLowerCase();
    const list = rows.filter(b => !term || [b.company_name, b.code, b.contact_name, b.city, b.phone].some(x => (x || '').toLowerCase().includes(term)));
    if (!list.length) {
      wrap.innerHTML = `<div class="pad muted" style="text-align:center;padding:48px">${rows.length ? 'No matches.' : 'No builders yet. Add your first builder to create a submission link.'}</div>`;
      return;
    }
    wrap.innerHTML = '<table class="tbl"><thead><tr><th>Builder</th><th>Contact</th><th>Links</th><th>Projects</th><th>Last activity</th></tr></thead><tbody></tbody></table>';
    const tb = $('tbody', wrap);
    for (const b of list) {
      const active = b.links.filter(l => linkState(l).label === 'Active').length;
      const counts = {};
      b.subs.forEach(s => { counts[s.status] = (counts[s.status] || 0) + 1; });
      const last = b.links.map(l => l.last_activity_at || l.last_opened_at).filter(Boolean).sort().pop();
      const tr = h(`<tr class="clickable" tabindex="0">
        <td><div class="cell-title">${esc(b.company_name)}</div><div class="cell-sub">${esc(b.code)}${b.city ? ' · ' + esc(b.city) : ''}</div></td>
        <td>${esc(b.contact_name || '—')}<div class="cell-sub">${esc(b.phone || b.email || '')}</div></td>
        <td class="num">${active} active${b.links.length > active ? `<div class="cell-sub">${b.links.length - active} off/expired</div>` : ''}</td>
        <td>${b.subs.length ? Object.entries(counts).map(([s, n]) => `${statusBadge(s, STATUS)} <span class="num">${n}</span>`).join(' ') : '<span class="muted">None yet</span>'}</td>
        <td class="cell-sub">${last ? esc(timeAgo(last)) : 'Not opened yet'}</td></tr>`);
      const open = () => { location.hash = `#/builders/${b.id}`; };
      tr.addEventListener('click', open);
      tr.addEventListener('keydown', e => { if (e.key === 'Enter') open(); });
      tb.appendChild(tr);
    }
  };
  $('input', toolbar).addEventListener('input', draw);
  draw();
}

export async function renderBuilderDetail(page, id) {
  const [{ data: b, error }, { data: links }, { data: subs }] = await Promise.all([
    ctx.client.from('builders').select('*').eq('id', id).single(),
    ctx.client.from('submission_links').select('*').eq('builder_id', id).order('created_at', { ascending: false }),
    ctx.client.from('project_submissions').select('id, ref_code, project_name, city, status, source, link_id, updated_at, has_unpublished_changes').eq('builder_id', id).order('updated_at', { ascending: false })
  ]);
  if (error) throw error;

  page.innerHTML = '';
  const head = h(`<div class="page-head">
    <div><a class="back-link" href="#/builders">← Builders</a>
      <h1 style="margin-top:6px">${esc(b.company_name)}</h1>
      <div class="meta-line"><span>${esc(b.code)}</span>${b.contact_name ? `<span>${esc(b.contact_name)}</span>` : ''}${b.phone ? `<span>${esc(b.phone)}</span>` : ''}${b.email ? `<span>${esc(b.email)}</span>` : ''}${b.city ? `<span>${esc(b.city)}</span>` : ''}</div>
    </div>
    <div class="btn-row"><button class="btn ghost" data-act="edit">Edit details</button><a class="btn ghost" href="#/new?builder=${b.id}">+ Add project for them</a><button class="btn primary" data-act="newlink">+ New link</button></div>
  </div>`);
  page.appendChild(head);
  if (b.notes) page.appendChild(h(`<div class="card pad" style="margin-bottom:16px"><b>Notes:</b> ${esc(b.notes)}</div>`));

  $('[data-act=edit]', head).addEventListener('click', async () => {
    const data = await formDialog('Edit builder', builderForm(b), 'Save');
    if (!data) return;
    const { error: e } = await ctx.client.from('builders').update(clean(data)).eq('id', b.id);
    if (e) return toast(friendlyError(e), 'bad');
    toast('Saved'); renderBuilderDetail(page, id);
  });

  $('[data-act=newlink]', head).addEventListener('click', async () => {
    const data = await formDialog('Create a submission link', `<div class="form-col" style="display:flex;flex-direction:column;gap:12px">
      <label>Label (for your team) <input class="input" name="label" placeholder="e.g. Pune launches — Oct 2026"></label>
      <label>Link works for <select class="input" name="days"><option value="30">30 days</option><option value="60" selected>60 days</option><option value="90">90 days</option><option value="">No expiry</option></select></label>
    </div>`, 'Create link');
    if (!data) return;
    const row = { builder_id: b.id, label: data.label?.trim() || null, expires_at: data.days ? new Date(Date.now() + data.days * 86400000).toISOString() : null };
    const { data: l, error: e } = await ctx.client.from('submission_links').insert(row).select('*').single();
    if (e) return toast(friendlyError(e), 'bad');
    await refreshCounts();
    await shareDialog(b, l);
    renderBuilderDetail(page, id);
  });

  // ---- Links
  page.appendChild(h('<h2 style="margin:8px 0 12px">Submission links</h2>'));
  const lw = h('<div class="card table-wrap" style="margin-bottom:28px"></div>');
  page.appendChild(lw);
  if (!links.length) {
    lw.innerHTML = '<div class="pad muted" style="text-align:center;padding:36px">No links yet. Create one and send it on WhatsApp or email.</div>';
  } else {
    lw.innerHTML = '<table class="tbl"><thead><tr><th>Link ID</th><th>Status</th><th>Progress</th><th>Opened</th><th>Expires</th><th></th></tr></thead><tbody></tbody></table>';
    const tb = $('tbody', lw);
    for (const l of links) {
      const st = linkState(l);
      const tr = h(`<tr>
        <td><div class="cell-title">${esc(l.tag)}</div><div class="cell-sub">${esc(l.label || '')}</div></td>
        <td><span class="badge ${st.tone}">${st.label}</span></td>
        <td class="stage">${esc(linkStage(l, subs))}</td>
        <td class="cell-sub">${l.open_count ? `${l.open_count}× · last ${esc(timeAgo(l.last_opened_at))}` : 'Not yet'}</td>
        <td class="cell-sub">${l.expires_at ? esc(formatDate(l.expires_at)) : 'Never'}</td>
        <td><div class="btn-row" style="justify-content:flex-end">
          <button class="btn primary sm" data-a="share">Share</button>
          <button class="btn ghost sm" data-a="extend">+30 days</button>
          <button class="btn ghost sm" data-a="toggle">${l.is_active ? 'Switch off' : 'Switch on'}</button>
          <button class="btn ghost sm" data-a="regen" title="Old link stops working">New address</button>
        </div></td></tr>`);
      tr.addEventListener('click', async e => {
        const a = e.target.closest('[data-a]')?.dataset.a;
        if (!a) return;
        try {
          if (a === 'share') return shareDialog(b, l);
          if (a === 'extend') {
            const base = l.expires_at && new Date(l.expires_at) > new Date() ? new Date(l.expires_at) : new Date();
            const { error: e2 } = await ctx.client.from('submission_links').update({ expires_at: new Date(base.getTime() + 30 * 86400000).toISOString(), is_active: true }).eq('id', l.id);
            if (e2) throw e2;
            toast('Extended by 30 days');
          }
          if (a === 'toggle') {
            const { error: e2 } = await ctx.client.from('submission_links').update({ is_active: !l.is_active }).eq('id', l.id);
            if (e2) throw e2;
            toast(l.is_active ? 'Link switched off' : 'Link switched on');
          }
          if (a === 'regen') {
            if (!(await confirmDialog({ title: 'Create a new address for this link?', body: 'The old address stops working right away. Use this if the link was shared with the wrong person. Projects and drafts are kept.', confirmText: 'Create new address', tone: 'danger' }))) return;
            const { data: nl, error: e2 } = await ctx.client.rpc('admin_regenerate_link', { p_link_id: l.id });
            if (e2) throw e2;
            await shareDialog(b, nl);
          }
          await refreshCounts();
          renderBuilderDetail(page, id);
        } catch (err) { toast(friendlyError(err), 'bad'); }
      });
      tb.appendChild(tr);
    }
  }

  // ---- Projects
  page.appendChild(h(`<h2 style="margin:0 0 12px">Projects (${subs.length})</h2>`));
  const pw = h('<div class="card table-wrap"></div>');
  page.appendChild(pw);
  if (!subs.length) {
    pw.innerHTML = '<div class="pad muted" style="text-align:center;padding:36px">No projects yet.</div>';
  } else {
    pw.innerHTML = '<table class="tbl"><thead><tr><th>Project</th><th>Status</th><th>Builder sees</th><th>Updated</th></tr></thead><tbody></tbody></table>';
    const tb = $('tbody', pw);
    for (const s of subs) {
      const tr = h(`<tr class="clickable"><td><div class="cell-title">${esc(s.project_name || 'Untitled')}${s.has_unpublished_changes ? '<span class="tag-mini">Update to live</span>' : ''}</div><div class="cell-sub">${esc(s.ref_code)} · ${esc(s.city || '')}</div></td>
        <td>${statusBadge(s.status, STATUS)}</td><td class="cell-sub">${esc(BUILDER_STATUS[s.status] || '')}</td><td class="cell-sub">${esc(timeAgo(s.updated_at))}</td></tr>`);
      tr.addEventListener('click', () => { location.hash = `#/review/${s.id}`; });
      tb.appendChild(tr);
    }
  }
}

async function shareDialog(b, l) {
  const url = linkUrl(l.token);
  const text = `Hi ${b.contact_name || b.company_name},\n\nPlease share your project details with Mappingg using this link:\n${url}\n\nYou can save a draft and come back any time. Our team reviews everything before it goes live on the map.\n\nLink ID: ${l.tag}\n\nThanks,\nTeam Mappingg`;
  const dlg = h(`<dialog class="dialog"><form method="dialog">
    <h3>Share link ${esc(l.tag)}</h3>
    <div class="dialog-body">Anyone with this link can add projects for <b>${esc(b.company_name)}</b>. Send it only to the builder.</div>
    <input class="input" readonly value="${esc(url)}" aria-label="Link">
    <textarea class="input" rows="8" aria-label="Message">${esc(text)}</textarea>
    <div class="dialog-actions" style="flex-wrap:wrap">
      <button class="btn ghost" value="close">Close</button>
      <button class="btn ghost" type="button" data-c="link">Copy link</button>
      <button class="btn ghost" type="button" data-c="msg">Copy message</button>
      ${b.email ? '<a class="btn ghost" data-mail href="#">Email</a>' : ''}
      ${b.phone ? '<a class="btn primary" data-wa target="_blank" rel="noopener" href="#">WhatsApp</a>' : ''}
    </div></form></dialog>`);
  document.body.appendChild(dlg);
  const ta = $('textarea', dlg);
  $('[data-c=link]', dlg).addEventListener('click', async () => { await copyText(url); toast('Link copied'); });
  $('[data-c=msg]', dlg).addEventListener('click', async () => { await copyText(ta.value); toast('Message copied'); });
  $('[data-wa]', dlg)?.addEventListener('click', e => { e.currentTarget.href = whatsappUrl(b.phone, ta.value); });
  $('[data-mail]', dlg)?.addEventListener('click', e => { e.currentTarget.href = `mailto:${b.email}?subject=${encodeURIComponent('Share your projects with Mappingg')}&body=${encodeURIComponent(ta.value)}`; });
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();
  return new Promise(r => dlg.addEventListener('close', r));
}
