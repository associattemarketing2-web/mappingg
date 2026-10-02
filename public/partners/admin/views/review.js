// Review screen: check, edit, flag, request changes, publish.
import { STATUS, completeness, publishBlockers, fieldByKey, FIELDS } from '../../shared/fields.js';
import { createForm } from '../../shared/form.js';
import { h, esc, $, toast, friendlyError, statusBadge, formatDateTime, timeAgo, confirmDialog, safeFileName, uid,
  linkUrl, whatsappUrl, copyText, fileNameFromPath } from '../../shared/lib.js';
import { ctx, setLeaveGuard, refreshCounts, previewUrl } from '../context.js';

const SOURCE = { link: 'Builder link', excel: 'Excel upload', csv: 'CSV upload', admin: 'Added by team' };
const SAVE_KEYS = [...FIELDS.filter(f => f.type !== 'pin').map(f => f.key), 'lat', 'lng'];

export async function createManualSubmission(builderId) {
  const row = { source: 'admin', status: 'in_review', country: 'India', currency: 'INR', area_unit: 'sq ft', price_unit: 'Crore' };
  if (builderId) {
    row.builder_id = builderId;
    const { data: b } = await ctx.client.from('builders').select('company_name').eq('id', builderId).single();
    if (b) row.developer_name = b.company_name;
  }
  const { data, error } = await ctx.client.from('project_submissions').insert(row).select('id').single();
  if (error) throw error;
  await refreshCounts();
  return data.id;
}

async function loadSubmission(id) {
  const { data, error } = await ctx.client.from('project_submissions')
    .select('*, builder:builders(*), link:submission_links(id, tag, token, is_active, expires_at)')
    .eq('id', id).single();
  if (error) throw error;
  return data;
}

export async function renderReview(page, id) {
  let sub = await loadSubmission(id);
  if (sub.status === 'submitted') {
    const { data } = await ctx.client.rpc('admin_set_status', { p_id: id, p_status: 'in_review', p_note: null });
    if (data) sub = { ...sub, ...data };
    refreshCounts();
  }
  const { data: builders } = await ctx.client.from('builders').select('id, company_name, code').order('company_name');

  let dirty = false;
  let busy = false;
  setLeaveGuard(async () => !dirty || await confirmDialog({ title: 'Leave without saving?', body: 'You have unsaved edits on this project.', confirmText: 'Leave', tone: 'danger' }));

  page.innerHTML = '';
  const head = h(`<div class="page-head">
    <div>
      <a class="back-link" href="#/queue">← Review queue</a>
      <h1 style="margin-top:6px">${esc(sub.project_name || 'Untitled project')}</h1>
      <div class="meta-line">
        ${statusBadge(sub.status, STATUS)}
        ${sub.has_unpublished_changes ? '<span class="badge warn">Update to a live project</span>' : ''}
        <span>${esc(sub.ref_code)}</span>
        <span>${esc(SOURCE[sub.source] || sub.source)}${sub.link?.tag ? ' · ' + esc(sub.link.tag) : ''}</span>
        ${sub.submitted_at ? `<span>Submitted ${esc(formatDateTime(sub.submitted_at))}</span>` : ''}
        ${sub.published_project_id ? `<a href="#/live">View live projects</a>` : ''}
      </div>
    </div>
  </div>`);
  page.appendChild(head);

  if (sub.builder_remarks) {
    page.appendChild(h(`<div class="card pad" style="margin-bottom:16px;border-color:#c8daf5;background:var(--info-bg)"><b>Note from builder:</b> ${esc(sub.builder_remarks)}</div>`));
  }

  const layout = h('<div class="review"><div class="review-main"></div><aside class="review-side"></aside></div>');
  page.appendChild(layout);
  const main = $('.review-main', layout);
  const side = $('.review-side', layout);

  const form = createForm(main, {
    values: sub,
    audience: 'admin',
    flaggable: true,
    flags: sub.flags || {},
    previousFlags: sub.previous_flags || {},
    client: ctx.client,
    preview: previewUrl,
    upload: async (file, key) => {
      const path = `admin/${sub.id}/${uid()}-${safeFileName(file.name)}`;
      const { error } = await ctx.client.storage.from('submission-media').upload(path, file, { contentType: file.type });
      if (error) throw error;
      return path;
    },
    onChange: () => { dirty = true; updateSide(); }
  });

  // ------------------------------------------------------------ side panel
  const actions = h(`<div class="card side-card"><h3>Actions</h3><div class="actions">
    <button class="btn primary" data-act="publish"></button>
    <div class="row">
      <button class="btn ghost" data-act="save">Save</button>
      <button class="btn warn" data-act="changes">Request changes</button>
    </div>
    <div class="row">
      ${sub.status === 'rejected' ? '<button class="btn ghost" data-act="reopen">Move back to review</button>' : '<button class="btn danger" data-act="reject">Reject</button>'}
      ${sub.published_project_id && sub.status === 'published' ? '<button class="btn danger" data-act="unpublish">Take offline</button>' : ''}
    </div>
    <p class="muted save-hint" style="margin:0;font-size:12.5px"></p>
  </div></div>`);
  side.appendChild(actions);

  const scoreCard = h('<div class="card side-card"><h3>Ready to publish?</h3><div class="score"></div><ul class="checklist" style="margin-top:12px"></ul></div>');
  side.appendChild(scoreCard);

  const b = sub.builder;
  const builderCard = h(`<div class="card side-card"><h3>Builder</h3>
    <select class="input" aria-label="Builder"><option value="">— No builder linked —</option>
      ${(builders || []).map(x => `<option value="${x.id}" ${x.id === sub.builder_id ? 'selected' : ''}>${esc(x.company_name)} (${esc(x.code)})</option>`).join('')}
    </select>
    ${b ? `<p style="margin:10px 0 0;font-size:13px">${esc(b.contact_name || '')}${b.phone ? ` · <a href="${whatsappUrl(b.phone, '')}" target="_blank" rel="noopener">${esc(b.phone)}</a>` : ''}${b.email ? `<br><a href="mailto:${esc(b.email)}">${esc(b.email)}</a>` : ''}</p>
      <p style="margin:6px 0 0"><a href="#/builders/${b.id}">Open builder & links →</a></p>` : ''}
    ${sub.media_folder_link ? `<p style="margin:10px 0 0"><a class="btn ghost sm" target="_blank" rel="noopener" href="${esc(sub.media_folder_link)}">Open media folder ↗</a></p>` : ''}
  </div>`);
  $('select', builderCard).addEventListener('change', async e => {
    const { error } = await ctx.client.from('project_submissions').update({ builder_id: e.target.value || null }).eq('id', sub.id);
    if (error) return toast(friendlyError(error), 'bad');
    toast('Builder updated');
  });
  side.appendChild(builderCard);

  const reraCard = h(`<div class="card side-card"><h3>RERA check</h3><div class="rera-body"></div></div>`);
  side.appendChild(reraCard);

  const dupeCard = h('<div class="card side-card"><h3>Possible duplicates</h3><div class="dupes muted">Checking…</div></div>');
  side.appendChild(dupeCard);

  const tlCard = h('<div class="card side-card"><h3>History</h3><ul class="timeline"></ul></div>');
  side.appendChild(tlCard);

  function current() { return { ...sub, ...form.getValues() }; }

  function updateSide() {
    const cur = current();
    const blockers = publishBlockers(cur);
    const comp = completeness(cur);
    const pubBtn = $('[data-act=publish]', actions);
    pubBtn.textContent = sub.published_project_id ? 'Publish update' : 'Approve & publish';
    pubBtn.disabled = blockers.length > 0;
    pubBtn.title = blockers.length ? `Missing: ${blockers.join(', ')}` : '';
    const nFlags = Object.keys(form.getFlags()).length;
    $('[data-act=changes]', actions).textContent = nFlags ? `Request changes (${nFlags})` : 'Request changes';
    $('.save-hint', actions).textContent = dirty ? 'You have unsaved edits.' : 'All changes saved.';

    const color = comp.pct >= 80 ? 'var(--ok)' : comp.pct >= 50 ? '#b86e00' : 'var(--bad)';
    $('.score', scoreCard).innerHTML = `<div class="ring" style="background:conic-gradient(${color} ${comp.pct}%, var(--muted-bg) 0)"><div style="background:#fff;width:42px;height:42px;border-radius:50%;display:grid;place-items:center">${comp.pct}%</div></div>
      <div style="font-size:13px"><b>Profile ${comp.pct}% complete</b><br><span class="muted">${comp.missing.length ? 'Missing: ' + esc(comp.missing.slice(0, 5).join(', ')) + (comp.missing.length > 5 ? ` +${comp.missing.length - 5} more` : '') : 'Everything is filled in.'}</span></div>`;
    const must = ['Project name', 'Project type', 'Country', 'City', 'Map pin', 'Configuration', 'Price (or Price on request)', 'RERA number (required in India)'];
    $('.checklist', scoreCard).innerHTML = must.map(m => `<li class="${blockers.includes(m) ? '' : 'ok'}">${esc(m)}</li>`).join('');

    const rera = cur.rera_numbers || [];
    const india = cur.country === 'India';
    $('.rera-body', reraCard).innerHTML = `
      <p style="margin:0 0 8px;font-size:13px">${rera.length ? rera.map(r => `<span class="tag" style="margin:0 4px 4px 0">${esc(r)}</span>`).join('') : '<span class="muted">No number added</span>'}</p>
      <p style="margin:0 0 10px;font-size:13px">${cur.rera_verified_on ? `✓ Verified on ${esc(cur.rera_verified_on)}` : '<span class="muted">Not verified yet</span>'}</p>
      <div class="btn-row">
        ${india ? '<a class="btn ghost sm" target="_blank" rel="noopener" href="https://maharera.maharashtra.gov.in/">Open MahaRERA ↗</a>' : ''}
        ${rera.length ? `<button class="btn ghost sm" data-act="verified">Mark verified today</button>` : ''}
      </div>`;
    $('[data-act=verified]', reraCard)?.addEventListener('click', () => {
      form.setValue('rera_verified_on', new Date().toISOString().slice(0, 10));
      toast('Marked as verified today. Remember to save.');
    });
  }

  async function loadTimeline() {
    const { data: ev } = await ctx.client.from('submission_events').select('*').eq('submission_id', sub.id)
      .order('created_at', { ascending: false }).limit(40);
    $('.timeline', tlCard).innerHTML = (ev || []).map(e => `<li><span class="who">${esc(describe(e))}</span><br>
      <span class="when">${esc(e.actor === 'builder' ? 'Builder' : e.actor === 'admin' ? 'Team' : 'System')} · ${esc(timeAgo(e.created_at))}</span></li>`).join('') || '<li class="muted">No history yet</li>';
  }

  async function loadDupes() {
    const { data: d, error } = await ctx.client.rpc('admin_find_duplicates', { p_id: sub.id });
    const box = $('.dupes', dupeCard);
    if (error) { box.textContent = 'Could not check.'; return; }
    if (!d || !d.length) { box.textContent = 'None found.'; return; }
    box.classList.remove('muted');
    box.innerHTML = d.map(x => `<div class="dupe"><b>${esc(x.name || 'Untitled')}</b> · ${esc(x.city || '')}<br>
      <span class="muted">${esc(x.reason)} · ${esc(x.kind)} ${esc(x.ref || '')} · ${esc(x.status)}</span>
      ${x.kind === 'submission' ? `<br><a href="#/review/${x.id}">Open</a>` : ''}</div>`).join('');
    sub._dupes = d;
  }

  async function save(quiet = false) {
    const bad = form.invalidNumbers();
    if (bad.length) { toast(`Numbers only in: ${bad.join(', ')}`, 'bad'); return false; }
    const vals = form.getValues();
    const payload = {};
    for (const k of SAVE_KEYS) payload[k] = vals[k] === undefined ? null : vals[k];
    payload.flags = form.getFlags();
    const { data, error } = await ctx.client.from('project_submissions').update(payload).eq('id', sub.id).select('*').single();
    if (error) { toast(friendlyError(error), 'bad'); return false; }
    sub = { ...sub, ...data };
    dirty = false;
    updateSide();
    loadTimeline();
    if (!quiet) toast('Saved');
    return true;
  }

  async function run(fn) {
    if (busy) return;
    busy = true;
    actions.querySelectorAll('button').forEach(b2 => b2.setAttribute('aria-disabled', 'true'));
    try { await fn(); } catch (e) { console.error(e); toast(friendlyError(e), 'bad'); }
    finally { busy = false; actions.querySelectorAll('button').forEach(b2 => b2.removeAttribute('aria-disabled')); updateSide(); }
  }

  actions.addEventListener('click', e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act || e.target.closest('[aria-disabled=true]')) return;
    if (act === 'save') run(() => save());
    if (act === 'changes') run(requestChanges);
    if (act === 'publish') run(publish);
    if (act === 'reject') run(reject);
    if (act === 'reopen') run(async () => {
      await ctx.client.rpc('admin_set_status', { p_id: sub.id, p_status: 'in_review', p_note: 'Moved back to review' });
      await refreshCounts(); rerender();
    });
    if (act === 'unpublish') run(unpublish);
  });

  function rerender() { dirty = false; setLeaveGuard(null); renderReview(page, sub.id); }

  async function requestChanges() {
    const flags = form.getFlags();
    const empty = Object.entries(flags).filter(([, v]) => !v.note).map(([k]) => fieldByKey[k]?.label || k);
    if (empty.length) { toast(`Add a note for: ${empty.join(', ')}`, 'bad'); form.focusField(Object.keys(flags).find(k => !flags[k].note)); return; }
    const res = await confirmDialog({
      title: 'Send back to the builder?',
      body: Object.keys(flags).length
        ? `<p style="margin:0 0 8px">${Object.keys(flags).length} flagged field(s):</p><ul style="margin:0;padding-left:18px">${Object.entries(flags).map(([k, v]) => `<li><b>${esc(fieldByKey[k]?.label || k)}</b>: ${esc(v.note)}</li>`).join('')}</ul>`
        : 'No fields are flagged. Write a message below to explain what is needed.',
      confirmText: 'Send back', tone: 'warn',
      input: { label: 'Message to the builder (optional)', placeholder: 'e.g. Please share the brochure and correct RERA number.' }
    });
    if (!res) return;
    if (!Object.keys(flags).length && !res.note) { toast('Flag a field or write a message.', 'bad'); return; }
    if (!(await save(true))) return;
    const { error } = await ctx.client.rpc('admin_request_changes', { p_id: sub.id, p_flags: flags, p_message: res.note || null });
    if (error) throw error;
    await refreshCounts();
    await notifyBuilder(flags, res.note);
    rerender();
  }

  async function notifyBuilder(flags, message) {
    let link = sub.link && sub.link.is_active ? sub.link : null;
    if (!link && sub.builder_id) {
      const { data: ls } = await ctx.client.from('submission_links').select('tag, token, is_active, expires_at')
        .eq('builder_id', sub.builder_id).eq('is_active', true).order('created_at', { ascending: false }).limit(1);
      link = (ls || []).find(l => !l.expires_at || new Date(l.expires_at) > new Date()) || null;
    }
    const bb = sub.builder || {};
    const lines = Object.entries(flags).map(([k, v]) => `• ${fieldByKey[k]?.label || k}: ${v.note}`);
    const text = [
      `Hi ${bb.contact_name || bb.company_name || ''},`.replace(' ,', ','),
      '',
      `Thank you for sharing ${sub.project_name || 'your project'} with Mappingg. Before we publish it, a few details need your attention:`,
      ...lines,
      message ? `\n${message}` : '',
      '',
      link ? `Please update them here: ${linkUrl(link.token)}` : 'Please reply with the corrected details.',
      '',
      'Thanks,\nTeam Mappingg'
    ].filter(x => x !== null).join('\n').replace(/\n{3,}/g, '\n\n');

    const dlg = h(`<dialog class="dialog"><form method="dialog">
      <h3>Let the builder know</h3>
      <div class="dialog-body">${link ? 'The flagged fields now show in red on their link.' : '<b>This builder has no active link.</b> Create one under Builders & links so they can fix it online, or send the details below.'}</div>
      <textarea class="input" rows="9">${esc(text)}</textarea>
      <div class="dialog-actions" style="flex-wrap:wrap">
        <button class="btn ghost" value="close">Close</button>
        <button class="btn ghost" type="button" data-copy>Copy message</button>
        ${bb.email ? `<a class="btn ghost" data-mail href="#">Email</a>` : ''}
        ${bb.phone ? `<a class="btn primary" data-wa target="_blank" rel="noopener" href="#">WhatsApp</a>` : ''}
      </div></form></dialog>`);
    document.body.appendChild(dlg);
    const ta = $('textarea', dlg);
    $('[data-copy]', dlg).addEventListener('click', async () => { await copyText(ta.value); toast('Message copied'); });
    $('[data-wa]', dlg)?.addEventListener('click', e => { e.currentTarget.href = whatsappUrl(bb.phone, ta.value); });
    $('[data-mail]', dlg)?.addEventListener('click', e => {
      e.currentTarget.href = `mailto:${bb.email}?subject=${encodeURIComponent(`Mappingg: changes needed for ${sub.project_name || 'your project'}`)}&body=${encodeURIComponent(ta.value)}`;
    });
    dlg.addEventListener('close', () => dlg.remove());
    dlg.showModal();
    await new Promise(r => dlg.addEventListener('close', r));
  }

  async function publish() {
    if (!(await save(true))) return;
    const cur = sub;
    const blockers = publishBlockers(cur);
    if (blockers.length) { toast(`Missing: ${blockers.join(', ')}`, 'bad'); return; }
    const warnings = [];
    if (cur.country === 'India' && !(cur.rera_numbers || []).length) warnings.push('No RERA number — you ticked the compliance override.');
    if ((cur.rera_numbers || []).length && !cur.rera_verified_on) warnings.push('RERA number not marked as verified.');
    if (!cur.cover_image_path) warnings.push('No cover image.');
    if (cur.price_min != null && cur.price_max != null && +cur.price_max < +cur.price_min) warnings.push('Highest price is lower than starting price — check the units.');
    if ((sub._dupes || []).length) warnings.push(`${sub._dupes.length} possible duplicate(s) found.`);
    if (Object.keys(form.getFlags()).length) warnings.push('Some fields are still flagged. Flags will be cleared.');
    const ok = await confirmDialog({
      title: sub.published_project_id ? 'Publish this update?' : 'Publish this project?',
      body: `<p style="margin:0">${sub.published_project_id ? 'The live project will be replaced with this version.' : 'It will appear on the Mappingg map right away.'}</p>
        ${warnings.length ? `<ul style="margin:10px 0 0;padding-left:18px;color:var(--warn)">${warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}`,
      confirmText: 'Publish'
    });
    if (!ok) return;
    toast('Copying images…');
    const media = await copyMedia(cur);
    const { error } = await ctx.client.rpc('admin_publish', { p_id: sub.id, p_media: media });
    if (error) throw error;
    toast('Published');
    await refreshCounts();
    rerender();
  }

  // Copy private files to the public bucket so the map can show them
  async function copyMedia(cur) {
    const map = { ...(cur.published_media || {}) };
    const all = [cur.cover_image_path, ...(cur.gallery_paths || []), cur.brochure_path, cur.rera_qr_path].filter(Boolean);
    for (const p of all) {
      if (map[p]) continue;
      const { data: blob, error: e1 } = await ctx.client.storage.from('submission-media').download(p);
      if (e1) throw new Error(`Could not read ${fileNameFromPath(p)}: ${e1.message}`);
      const dest = `${cur.id}/${p.split('/').pop()}`;
      const { error: e2 } = await ctx.client.storage.from('project-media').upload(dest, blob, { upsert: true, contentType: blob.type || undefined });
      if (e2) throw new Error(`Could not publish ${fileNameFromPath(p)}: ${e2.message}`);
      map[p] = ctx.client.storage.from('project-media').getPublicUrl(dest).data.publicUrl;
    }
    await ctx.client.from('project_submissions').update({ published_media: map }).eq('id', cur.id);
    return {
      cover_image_url: cur.cover_image_path ? map[cur.cover_image_path] : null,
      gallery_urls: (cur.gallery_paths || []).map(p => map[p]).filter(Boolean),
      brochure_url: cur.brochure_path ? map[cur.brochure_path] : null,
      rera_qr_url: cur.rera_qr_path ? map[cur.rera_qr_path] : null
    };
  }

  async function reject() {
    const res = await confirmDialog({ title: 'Reject this project?', body: 'It will not be published. You can move it back to review later.',
      confirmText: 'Reject', tone: 'danger', input: { label: 'Reason (kept in the history)', placeholder: 'e.g. Duplicate of MAP-SUB-00012' } });
    if (!res) return;
    if (dirty && !(await save(true))) return;
    const { error } = await ctx.client.rpc('admin_set_status', { p_id: sub.id, p_status: 'rejected', p_note: res.note || null });
    if (error) throw error;
    await refreshCounts();
    rerender();
  }

  async function unpublish() {
    const res = await confirmDialog({ title: 'Take this project offline?', body: 'It will disappear from the map. The data stays here and you can publish again.',
      confirmText: 'Take offline', tone: 'danger', input: { label: 'Reason', placeholder: 'e.g. Builder asked to pause' } });
    if (!res) return;
    const { error } = await ctx.client.rpc('admin_unpublish', { p_id: sub.id, p_note: res.note || null });
    if (error) throw error;
    await refreshCounts();
    rerender();
  }

  updateSide();
  loadTimeline();
  loadDupes();
}

function describe(e) {
  const d = e.details || {};
  const label = s => (STATUS[s] || { label: s }).label;
  switch (e.action) {
    case 'created': return `Created (${SOURCE[d.source] || d.source})`;
    case 'status_changed': return `${label(d.from)} → ${label(d.to)}`;
    case 'changes_requested': return `Changes requested on ${Object.keys(d.flags || {}).length} field(s)`;
    case 'published': return 'Published to the map';
    case 'unpublished': return `Taken offline${d.note ? ': ' + d.note : ''}`;
    case 'note': return `Note: ${d.note}`;
    case 'edited': {
      const keys = Object.keys(d).map(k => (k === 'lat' || k === 'lng') ? 'Map pin' : (fieldByKey[k]?.label || k.replace(/_/g, ' ')));
      const uniq = [...new Set(keys)];
      return `Edited ${uniq.slice(0, 4).join(', ')}${uniq.length > 4 ? ` +${uniq.length - 4} more` : ''}`;
    }
    default: return e.action;
  }
}
