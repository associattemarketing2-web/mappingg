// Builder submission page — opened through a unique link: /submit/?t=TOKEN
import { BUILDER_STATUS, STATUS, submitBlockers, fieldByKey } from '../shared/fields.js';
import { createForm } from '../shared/form.js';
import { createClient, $, h, esc, toast, friendlyError, safeFileName, uid, getConfig, formatDateTime, confirmDialog } from '../shared/lib.js';

const cfg = getConfig();
const app = $('#app');
const token = new URLSearchParams(location.search).get('t') || location.hash.replace(/^#t=/, '');
let client, data, form, current = null, dirty = false, saving = false, autosaveTimer;

{
  const wa = (cfg.supportWhatsApp || '').trim();
  const mail = (cfg.supportEmail || '').trim();
  const parts = [];
  if (wa) parts.push(`WhatsApp <a href="https://wa.me/${esc(wa.replace(/\D/g, ''))}">${esc(wa)}</a>`);
  if (mail) parts.push(`email <a href="mailto:${esc(mail)}">${esc(mail)}</a>`);
  $('#foot').innerHTML = parts.length ? `Need help? ${parts.join(' or ')}` : '';
}

window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

init();

async function init() {
  if (!token) return fatal('This page needs a submission link from the Mappingg team.');
  try {
    client = createClient();
    await load();
    showList();
  } catch (e) {
    fatal(friendlyError(e));
  }
}

async function load() {
  const { data: d, error } = await client.rpc('link_open', { p_token: token });
  if (error) throw error;
  data = d;
  $('#linkId').textContent = `Link ID: ${d.link.tag}`;
}

function fatal(msg) {
  app.innerHTML = `<div class="card done"><div class="big">🔒</div><h1>We couldn't open this page</h1><p>${esc(msg)}</p></div>`;
}

// ---------------------------------------------------------------- List view
function showList() {
  stopAutosave();
  current = null; form = null; dirty = false;
  document.querySelector('.actionbar')?.remove();
  const subs = data.submissions || [];
  const b = data.builder;
  app.innerHTML = '';
  app.appendChild(h(`<section class="hero">
    <h1>Share your projects with Mappingg</h1>
    <p>Hi ${esc(b.contact_name || b.company_name)}, add your projects below. Our team checks every detail before anything goes live on the map, and we'll contact you if something needs a fix.</p>
  </section>`));
  app.appendChild(h(`<div class="steps">
    <div class="card step"><b>1. Add details</b><span>Fill what you have. Save a draft any time.</span></div>
    <div class="card step"><b>2. Submit</b><span>Send it to the Mappingg team for review.</span></div>
    <div class="card step"><b>3. Go live</b><span>We verify it and publish it on the map.</span></div>
  </div>`));

  const head = h(`<div class="list-head"><h2>Your projects (${subs.length})</h2><button class="btn primary" id="addBtn">+ Add a project</button></div>`);
  $('#addBtn', head).addEventListener('click', () => showForm(null));
  app.appendChild(head);

  const list = h('<div class="proj-list"></div>');
  if (!subs.length) {
    list.appendChild(h(`<div class="card empty">No projects yet. Tap <b>Add a project</b> to start.</div>`));
  }
  for (const s of subs) {
    const needsFix = s.status === 'changes_requested';
    const tone = (STATUS[s.status] || {}).tone || 'muted';
    const flagCount = Object.keys(s.flags || {}).length;
    const editable = ['draft', 'changes_requested', 'published'].includes(s.status);
    const card = h(`<div class="card proj ${needsFix ? 'attention' : ''}">
      <div>
        <h3>${esc(s.project_name || 'Untitled project')}</h3>
        <div class="meta">${esc([s.locality, s.city].filter(Boolean).join(', ') || 'Location not added')} · Ref ${esc(s.ref_code)} · Updated ${esc(formatDateTime(s.updated_at))}</div>
        ${needsFix ? `<div class="meta" style="color:var(--bad)">${flagCount} field${flagCount === 1 ? '' : 's'} need${flagCount === 1 ? 's' : ''} a fix</div>` : ''}
        ${s.has_unpublished_changes && s.status !== 'published' ? '<div class="meta">Live version stays until your update is approved</div>' : ''}
      </div>
      <div class="right">
        <span class="badge ${tone}">${esc(BUILDER_STATUS[s.status] || s.status)}</span>
        <button class="btn ${needsFix ? 'primary' : 'ghost'} sm">${needsFix ? 'Fix now' : editable ? (s.status === 'published' ? 'Update' : 'Edit') : 'View'}</button>
      </div>
    </div>`);
    $('button', card).addEventListener('click', () => showForm(s));
    list.appendChild(card);
  }
  app.appendChild(list);
  window.scrollTo(0, 0);
}

// ---------------------------------------------------------------- Form view
function showForm(sub) {
  current = sub;
  dirty = false;
  const status = sub?.status || 'draft';
  const editable = ['draft', 'changes_requested', 'published'].includes(status);
  const values = sub || {
    country: 'India', currency: 'INR', area_unit: 'sq ft', price_unit: 'Crore',
    developer_name: data.builder.company_name, configurations: [], rera_numbers: [],
    gallery_paths: [], additional_details: []
  };

  app.innerHTML = '';
  const top = h(`<div class="form-top">
    <button class="back" type="button">← All projects</button>
    ${sub ? `<span class="muted">Ref ${esc(sub.ref_code)}</span>` : ''}
  </div>`);
  $('.back', top).addEventListener('click', async () => {
    if (dirty && !(await confirmDialog({ title: 'Leave without saving?', body: 'Your latest changes are not saved yet.', confirmText: 'Leave', tone: 'danger' }))) return;
    dirty = false;
    await refresh();
  });
  app.appendChild(top);
  app.appendChild(h(`<h1 style="margin-bottom:16px">${esc(sub?.project_name || 'New project')}</h1>`));

  if (status === 'changes_requested') {
    const n = Object.keys(sub.flags || {}).length;
    const b = h(`<div class="banner bad"><strong>The Mappingg team needs a few changes.</strong>
      ${sub.change_request_message ? `<p>${esc(sub.change_request_message)}</p>` : ''}
      ${n ? `<p>${n} field${n === 1 ? ' is' : 's are'} marked in red below. <button class="back" type="button">Go to the first one →</button></p>` : ''}
    </div>`);
    $('button', b)?.addEventListener('click', () => form.focusField(Object.keys(sub.flags)[0]));
    app.appendChild(b);
  } else if (status === 'published') {
    app.appendChild(h(`<div class="banner ok"><strong>This project is live on Mappingg.</strong><p>You can send an update. The live version stays as it is until our team approves your changes.</p></div>`));
  } else if (status === 'submitted' || status === 'in_review') {
    app.appendChild(h(`<div class="banner info"><strong>Sent for review.</strong><p>You can't edit this project while our team is checking it. We'll let you know if anything needs a change.</p></div>`));
  } else if (status === 'rejected') {
    app.appendChild(h(`<div class="banner bad"><strong>This project was not accepted.</strong><p>Please contact the Mappingg team for details.</p></div>`));
  }

  const formRoot = h('<div></div>');
  app.appendChild(formRoot);
  form = createForm(formRoot, {
    values, audience: 'builder', readOnly: !editable,
    flags: status === 'changes_requested' ? sub.flags : {},
    client,
    upload: uploadFile,
    onChange: () => { dirty = true; setSaveState('Unsaved changes'); }
  });

  if (editable) {
    const dec = h(`<label class="card declare">
      <input type="checkbox" id="declare" ${values.declaration_accepted ? 'checked' : ''}>
      <span><b>Declaration</b><br>I confirm these details are accurate and I am authorised to share them with Mappingg.</span>
    </label>`);
    $('input', dec).addEventListener('change', () => { dirty = true; setSaveState('Unsaved changes'); });
    app.appendChild(h('<div style="height:16px"></div>'));
    app.appendChild(dec);

    if (sub && status === 'draft' && !sub.submitted_at) {
      const del = h('<div style="margin-top:16px"><button class="btn danger sm" type="button">Delete this draft</button></div>');
      $('button', del).addEventListener('click', deleteDraft);
      app.appendChild(del);
    }

    const bar = h(`<div class="actionbar"><div class="wrap">
      <span class="save-state">${sub ? 'Saved' : 'Not saved yet'}</span>
      <div class="btns">
        <button class="btn ghost" id="saveBtn" type="button">Save draft</button>
        <button class="btn primary" id="submitBtn" type="button">${status === 'published' ? 'Send update for review' : 'Submit for review'}</button>
      </div></div></div>`);
    $('#saveBtn', bar).addEventListener('click', () => save(false));
    $('#submitBtn', bar).addEventListener('click', () => save(true));
    document.querySelector('.actionbar')?.remove();
    document.body.appendChild(bar);
    startAutosave();
  } else {
    document.querySelector('.actionbar')?.remove();
  }
  window.scrollTo(0, 0);
}

function setSaveState(t) { const el = $('.save-state'); if (el) el.textContent = t; }

async function uploadFile(file, key) {
  const field = fieldByKey[key];
  if (field.accept === 'application/pdf' && file.type !== 'application/pdf') throw new Error('Please choose a PDF file.');
  if (field.accept === 'image/*' && !/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Please choose a JPG, PNG or WebP image.');
  const path = `links/${token}/${uid()}-${safeFileName(file.name)}`;
  const { error } = await client.storage.from('submission-media').upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error;
  return path;
}

async function save(submit) {
  if (saving) return;
  const values = form.getValues();
  const bad = form.invalidNumbers();
  if (bad.length) { toast(`Please enter numbers only in: ${bad.join(', ')}`, 'bad'); return; }
  values.declaration_accepted = $('#declare')?.checked || false;

  if (submit) {
    const missing = submitBlockers(values);
    if (missing.length) {
      toast(`Please complete: ${missing.join(', ')}`, 'bad');
      const firstKey = { 'Project name': 'project_name', 'Project type': 'project_type', 'Developer name': 'developer_name', 'Country': 'country', 'City': 'city' }[missing[0]]
        || (missing[0].startsWith('Location') ? 'google_maps_link' : null);
      if (firstKey) form.focusField(firstKey); else $('#declare')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const still = Object.keys(current?.flags || {}).length;
    if (!(await confirmDialog({
      title: current?.status === 'published' ? 'Send this update for review?' : 'Submit this project for review?',
      body: `You won't be able to edit it while our team checks it.${still ? ' Make sure you have fixed the fields marked in red.' : ''}`,
      confirmText: 'Submit'
    }))) return;
  }

  saving = true;
  setSaveState(submit ? 'Submitting…' : 'Saving…');
  try {
    const { data: saved, error } = await client.rpc('link_save_submission', {
      p_token: token, p_id: current?.id || null, p_data: values, p_submit: submit
    });
    if (error) throw error;
    dirty = false;
    current = saved;
    if (submit) {
      stopAutosave();
      document.querySelector('.actionbar')?.remove();
      await load();
      showDone(saved);
    } else {
      setSaveState(`Draft saved at ${new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}`);
      toast('Draft saved');
      await load();
    }
  } catch (e) {
    setSaveState('Not saved');
    toast(friendlyError(e), 'bad');
  } finally {
    saving = false;
  }
}

function showDone(sub) {
  app.innerHTML = '';
  const el = h(`<div class="card done">
    <div class="big">✅</div>
    <h1>Thank you. Your project is with our team.</h1>
    <p>Reference number <b>${esc(sub.ref_code)}</b>. We'll review it and publish it on Mappingg. If anything needs a change, we'll let you know and it will show up here.</p>
    <div style="display:flex;gap:8px;justify-content:center;margin-top:20px;flex-wrap:wrap">
      <button class="btn primary" id="another">+ Add another project</button>
      <button class="btn ghost" id="all">See all projects</button>
    </div></div>`);
  $('#another', el).addEventListener('click', () => showForm(null));
  $('#all', el).addEventListener('click', showList);
  app.appendChild(el);
  window.scrollTo(0, 0);
}

async function deleteDraft() {
  if (!(await confirmDialog({ title: 'Delete this draft?', body: 'This cannot be undone.', confirmText: 'Delete', tone: 'danger' }))) return;
  try {
    const { error } = await client.rpc('link_delete_draft', { p_token: token, p_id: current.id });
    if (error) throw error;
    dirty = false;
    toast('Draft deleted');
    await refresh();
  } catch (e) { toast(friendlyError(e), 'bad'); }
}

async function refresh() {
  try { await load(); showList(); } catch (e) { fatal(friendlyError(e)); }
}

// Save a draft automatically every 45 seconds while the builder is typing
function startAutosave() {
  stopAutosave();
  autosaveTimer = setInterval(() => {
    if (!dirty || saving || !form) return;
    const v = form.getValues();
    if (!v.project_name || form.invalidNumbers().length) return;
    save(false);
  }, 45000);
}
function stopAutosave() { clearInterval(autosaveTimer); }
