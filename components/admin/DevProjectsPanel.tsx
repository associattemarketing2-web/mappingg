'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

// Super admin → "Developer projects": every project a developer added from their
// dashboard, who added it, and its approval state. New and edited projects stay
// off the public map until the super admin approves them here.
export interface DevProject {
  id: string; number: number | null; title: string; location: string; status: string; type: string; price: string;
  configuration: string; possession: string; developer: string; description: string; image: string; hasLocation: boolean;
  state: 'pending' | 'approved' | 'rejected'; edited: boolean; admin_edited_at?: string; admin_edited_by?: string;
  owner: { id: string; name: string; email: string; mobile: string; company: string };
  created_at: string; updated_at: string; reviewed_at: string; reviewed_by: string; review_note: string;
}

type Filter = 'pending' | 'approved' | 'rejected' | 'all';

// Full details of one project, for checking before approval (GET /api/admin/submissions?id=).
interface ProjectDetail {
  id: string; number: number | null; edited: boolean; previousAt: string;
  changes: { label: string; before: string; after: string }[] | null;
  fields: { key: string; label: string; value: string }[];
  images: { key: string; label: string; url: string }[];
  custom: { label: string; value: string }[];
  lat: number | null; lng: number | null;
}
const youTubeId = (url: string) => {
  try {
    const u = new URL(url.trim());
    if (u.hostname.replace('www.', '') === 'youtu.be') return u.pathname.slice(1).split('/')[0] || '';
    return u.searchParams.get('v') || (u.pathname.match(/\/(?:embed|shorts)\/([^/?]+)/) || [])[1] || '';
  } catch { return ''; }
};
const STATUS_LABEL: Record<string, string> = { available: 'Available', construction: 'Under construction', under_construction: 'Under construction', upcoming: 'Upcoming', sold: 'Sold out' };
const STATUS_OPTIONS = ['available', 'construction', 'upcoming', 'sold'];
const TYPE_OPTIONS = ['Residential', 'Commercial', 'Mixed-Use', 'Land Parcel', 'Plotted'];
// Fields shown as multi-line boxes in the edit form.
const LONG_FIELDS = new Set(['description', 'whats_available', 'key_usp']);
const MAX_IMAGE = 3 * 1024 * 1024;
const readImage = (file: File) => new Promise<string>((resolve, reject) => {
  if (!file.type.startsWith('image/')) { reject(new Error('Please choose an image file.')); return; }
  if (file.size > MAX_IMAGE) { reject(new Error('Image is too large — please use one under 3 MB.')); return; }
  const r = new FileReader();
  r.onload = () => resolve(String(r.result || ''));
  r.onerror = () => reject(new Error('Could not read that image.'));
  r.readAsDataURL(file);
});

const ago = (d?: string) => {
  if (!d) return '';
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};
const fullDate = (d?: string) => (d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
const ownerName = (p: DevProject) => p.owner.name || p.owner.email || 'Unknown developer';

export default function DevProjectsPanel({ flash, isOwner, onPendingChange, focus, onFocusDone }: {
  flash: (m: string, e?: boolean) => void;
  isOwner: boolean;
  onPendingChange?: (n: number) => void;
  /** Open with this project (id) or developer (owner id) in view, e.g. from a notification. */
  focus?: { projectId?: string; ownerId?: string } | null;
  onFocusDone?: () => void;
}) {
  const [items, setItems] = useState<DevProject[] | null>(null);
  const [filter, setFilter] = useState<Filter>('pending');
  const [dev, setDev] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState('');
  const [rejecting, setRejecting] = useState('');
  const [reason, setReason] = useState('');
  const [highlight, setHighlight] = useState('');
  const [review, setReview] = useState<DevProject | null>(null);
  const [info, setInfo] = useState<ProjectDetail | null>(null);
  const [infoErr, setInfoErr] = useState(false);
  // Super admin editing the project's details (corrections before / after approval).
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [customForm, setCustomForm] = useState<{ label: string; value: string }[]>([]);
  const [imgForm, setImgForm] = useState<Record<string, string | undefined>>({});
  const [saving, setSaving] = useState(false);

  function startEdit() {
    if (!info) return;
    const f: Record<string, string> = {};
    for (const x of info.fields) f[x.key] = x.value;
    if (info.lat != null) f.lat = String(info.lat);
    if (info.lng != null) f.lng = String(info.lng);
    setForm(f); setCustomForm(info.custom.map((c) => ({ ...c }))); setImgForm({}); setEditing(true);
  }
  async function pickImage(key: string, file?: File | null) {
    if (!file) return;
    try { const url = await readImage(file); setImgForm((m) => ({ ...m, [key]: url })); } catch (e) { flash(e instanceof Error ? e.message : 'Could not use that image', true); }
  }
  async function saveEdit() {
    if (!review || !info) return;
    if ((form.title || '').trim().length < 2) { flash('Please enter the project name.', true); return; }
    const num = (v?: string) => { const t = (v || '').trim(); if (!t) return null; const n = Number(t); return Number.isFinite(n) ? n : NaN; };
    const lat = num(form.lat), lng = num(form.lng);
    if (Number.isNaN(lat) || Number.isNaN(lng) || (lat != null && Math.abs(lat) > 90) || (lng != null && Math.abs(lng) > 180)) {
      flash('Latitude / longitude must be numbers (e.g. 18.5515, 73.9446).', true); return;
    }
    const values: Record<string, unknown> = {};
    for (const x of info.fields) if (x.key !== 'lat' && x.key !== 'lng') values[x.key] = (form[x.key] || '').trim();
    values.lat = lat; values.lng = lng;
    values.custom_fields = customForm.filter((c) => c.label.trim() || c.value.trim());
    for (const [k, v] of Object.entries(imgForm)) if (v !== undefined) values[k] = v;
    setSaving(true);
    try {
      const r = await fetch('/api/admin/submissions', {
        method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: review.id, values }),
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(b?.error?.message || 'Could not save');
      flash('Project details saved');
      setEditing(false);
      await load();
      openReview({ ...review, title: String(values.title || review.title) });
    } catch (e) { flash(e instanceof Error ? e.message : 'Could not save', true); } finally { setSaving(false); }
  }

  async function openReview(p: DevProject) {
    setReview(p); setInfo(null); setInfoErr(false); setRejecting(''); setReason(''); setEditing(false);
    try {
      const r = await fetch(`/api/admin/submissions?id=${encodeURIComponent(p.id)}`, { credentials: 'same-origin' });
      const b = await r.json();
      if (!r.ok) throw new Error();
      setInfo(b.data);
    } catch { setInfoErr(true); }
  }
  useEffect(() => {
    if (!review) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !editing) setReview(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [review, editing]);
  const listRef = useRef<HTMLUListElement>(null);

  async function load() {
    try {
      const r = await fetch('/api/admin/submissions', { credentials: 'same-origin' });
      const b = await r.json();
      if (!r.ok) throw new Error(b?.error?.message);
      setItems(Array.isArray(b.data) ? b.data : []);
    } catch { flash('Could not load developer projects', true); setItems((x) => x || []); }
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pending = (items || []).filter((p) => p.state === 'pending').length;
  useEffect(() => { if (items) onPendingChange?.(pending); }, [pending, items]); // eslint-disable-line react-hooks/exhaustive-deps

  // Jump to a project / developer when opened from a notification or an account.
  useEffect(() => {
    if (!focus || !items) return;
    if (focus.ownerId) { setDev(focus.ownerId); setFilter('all'); setQ(''); }
    if (focus.projectId) {
      const p = items.find((x) => x.id === focus.projectId);
      if (p) { setFilter(p.state); setDev(''); setQ(''); setHighlight(p.id); }
      else flash('That project no longer exists', true);
    }
    onFocusDone?.();
  }, [focus, items]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!highlight) return;
    const t = setTimeout(() => listRef.current?.querySelector(`[data-id="${highlight}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
    const u = setTimeout(() => setHighlight(''), 4000);
    return () => { clearTimeout(t); clearTimeout(u); };
  }, [highlight]);

  const developers = useMemo(() => {
    const m = new Map<string, { id: string; name: string; company: string; total: number; pending: number }>();
    for (const p of items || []) {
      const d = m.get(p.owner.id) || { id: p.owner.id, name: ownerName(p), company: p.owner.company || p.developer, total: 0, pending: 0 };
      d.total++; if (p.state === 'pending') d.pending++;
      m.set(p.owner.id, d);
    }
    return [...m.values()].sort((a, b) => b.pending - a.pending || b.total - a.total || a.name.localeCompare(b.name));
  }, [items]);

  const term = q.trim().toLowerCase();
  const scoped = (items || []).filter((p) => (!dev || p.owner.id === dev)
    && (!term || [p.title, p.location, p.developer, p.owner.name, p.owner.email, p.owner.company].some((x) => x.toLowerCase().includes(term))));
  const counts = {
    pending: scoped.filter((p) => p.state === 'pending').length,
    approved: scoped.filter((p) => p.state === 'approved').length,
    rejected: scoped.filter((p) => p.state === 'rejected').length,
    all: scoped.length,
  };
  // Oldest first while waiting (first come, first served); newest first otherwise.
  const list = scoped.filter((p) => filter === 'all' || p.state === filter)
    .sort((a, b) => (filter === 'pending' ? a.updated_at.localeCompare(b.updated_at) : b.updated_at.localeCompare(a.updated_at)));

  async function decide(p: DevProject, action: 'approve' | 'reject') {
    if (action === 'reject' && !reason.trim()) { flash('Please write a reason — the developer will see it.', true); return; }
    setBusy(p.id);
    try {
      const r = await fetch('/api/admin/submissions', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: p.id, action, reason: action === 'reject' ? reason.trim() : undefined }),
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(b?.error?.message || 'Failed');
      flash(action === 'approve' ? `“${p.title}” is now live on the map` : `“${p.title}” not approved — ${ownerName(p)} will see your reason`);
      setRejecting(''); setReason(''); setReview(null);
      await load();
    } catch (e) { flash(e instanceof Error ? e.message : 'Failed', true); } finally { setBusy(''); }
  }

  const TABS: [Filter, string][] = [['pending', 'Waiting approval'], ['approved', 'Live on map'], ['rejected', 'Not approved'], ['all', 'All']];

  return (
    <div className="acs">
      <div className="acs-top">
        <div>
          <h2 className="dp-title">Developer projects</h2>
          <p className="muted dp-sub">Projects developers add from their dashboard. They go live on the map only after you approve them.</p>
        </div>
        <button type="button" className="adm-btn ghost sm" onClick={load} title="Refresh"><i className="fas fa-rotate" /> <span className="acs-hide-sm">Refresh</span></button>
      </div>

      {pending > 0 && filter !== 'pending' && (
        <div className="acs-alert">
          <span className="acs-alert-ic"><i className="fas fa-map-pin" /></span>
          <div>
            <b>{pending} {pending === 1 ? 'project is' : 'projects are'} waiting for your approval</b>
            <span>They are hidden from the public map until you approve them.</span>
          </div>
          <button type="button" className="adm-btn primary sm" onClick={() => { setFilter('pending'); setDev(''); setQ(''); }}>Review now</button>
        </div>
      )}

      <section className="adm-panel acs-panel">
        <div className="acs-tabs" role="tablist" aria-label="Approval status">
          {TABS.map(([k, lbl]) => (
            <button key={k} type="button" role="tab" aria-selected={filter === k} className={`${filter === k ? 'on' : ''}${k === 'pending' && counts.pending ? ' warn' : ''}`} onClick={() => setFilter(k)}>
              {lbl} <span>{counts[k]}</span>
            </button>
          ))}
        </div>

        <div className="acs-toolbar">
          <label className="acs-search">
            <i className="fas fa-magnifying-glass" />
            <input placeholder="Search project, location or developer" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search projects" />
            {q && <button type="button" onClick={() => setQ('')} aria-label="Clear search"><i className="fas fa-xmark" /></button>}
          </label>
          <select className="crm-select" value={dev} onChange={(e) => setDev(e.target.value)} aria-label="Filter by developer">
            <option value="">All developers ({items?.length || 0})</option>
            {developers.map((d) => (
              <option key={d.id} value={d.id}>{d.name}{d.company ? ` — ${d.company}` : ''} ({d.total}{d.pending ? `, ${d.pending} waiting` : ''})</option>
            ))}
          </select>
        </div>

        {items === null ? (
          <div className="adm-empty"><i className="fas fa-spinner fa-spin" /><p>Loading projects…</p></div>
        ) : items.length === 0 ? (
          <div className="adm-empty"><i className="fas fa-map-pin" /><p>No developer has added a project yet. When they do, it will appear here for your approval.</p></div>
        ) : list.length === 0 ? (
          <div className="adm-empty">
            <i className={`fas ${filter === 'pending' ? 'fa-circle-check' : 'fa-filter'}`} />
            <p>{filter === 'pending' && !term && !dev ? 'All caught up — nothing is waiting for approval.' : 'No projects match.'}</p>
            {(term || dev) && <button className="adm-btn ghost sm" onClick={() => { setQ(''); setDev(''); }}>Show all developers</button>}
          </div>
        ) : (
          <ul className="dp-list" ref={listRef}>
            {list.map((p) => (
              <li key={p.id} data-id={p.id} className={`dp-card s-${p.state}${highlight === p.id ? ' hl' : ''}`}>
                <div className="dp-logo">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {p.image ? <img src={p.image} alt="" loading="lazy" /> : <i className="fas fa-building" />}
                </div>
                <div className="dp-main">
                  <div className="dp-head">
                    <b>{p.title || 'Untitled project'}</b>
                    {p.number != null && <span className="dp-num">#{p.number}</span>}
                    <span className={`dp-state s-${p.state}`}>
                      {p.state === 'pending' ? (p.edited ? 'Edited — waiting approval' : 'Waiting approval') : p.state === 'approved' ? 'Live on map' : 'Not approved'}
                    </span>
                  </div>
                  <p className="dp-meta">
                    {[p.type, STATUS_LABEL[p.status] || p.status, p.location].filter(Boolean).join(' · ') || 'No details'}
                  </p>
                  {(p.configuration || p.price || p.possession) && (
                    <p className="dp-meta">{[p.configuration, p.price, p.possession && `Possession ${p.possession}`].filter(Boolean).join(' · ')}</p>
                  )}
                  <p className="dp-by">
                    <i className="fas fa-user" /> Added by <b>{ownerName(p)}</b>{p.owner.company ? ` (${p.owner.company})` : ''}
                    <span title={fullDate(p.created_at)}> · {ago(p.created_at)}</span>
                    {p.edited && <span title={fullDate(p.updated_at)}> · edited {ago(p.updated_at)}</span>}
                  </p>

                  {p.state === 'pending' && !p.hasLocation && (
                    <p className="dp-warn"><i className="fas fa-triangle-exclamation" /> No map location yet — after approving, place the pin in the Map Editor so it shows on the map.</p>
                  )}
                  {p.state === 'approved' && p.reviewed_at && (
                    <p className="dp-note ok"><i className="fas fa-circle-check" /> Approved {ago(p.reviewed_at)}{p.reviewed_by ? ` by ${p.reviewed_by}` : ''}</p>
                  )}
                  {p.state === 'rejected' && (
                    <p className="dp-note bad"><i className="fas fa-circle-xmark" /> Not approved{p.reviewed_at ? ` ${ago(p.reviewed_at)}` : ''}{p.review_note ? ` — “${p.review_note}”` : ''}</p>
                  )}

                  <div className="dp-actions">
                    <button className={`adm-btn ${p.state === 'pending' ? 'primary' : 'ghost'} sm`} onClick={() => openReview(p)}>
                      <i className="fas fa-magnifying-glass" /> {p.state === 'pending' && isOwner ? 'Review details & approve' : 'View all details'}
                    </button>
                    {p.state === 'approved' && (
                      <a className="adm-btn ghost sm" href={`/map?pin=${encodeURIComponent(p.id)}`} target="_blank" rel="noopener"><i className="fas fa-arrow-up-right-from-square" /> View on map</a>
                    )}
                    {!isOwner && p.state === 'pending' && <span className="crm-meta"><i className="fas fa-lock" /> Only the super admin can approve.</span>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {review && (
        <div className="crm-drawer-overlay" onClick={() => { if (!editing) setReview(null); }}>
          <aside className="crm-drawer dp-drawer" onClick={(e) => e.stopPropagation()} aria-label={`Review: ${review.title}`}>
            <div className="dp-d-head">
              <div className="dp-logo">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {review.image ? <img src={review.image} alt="" /> : <i className="fas fa-building" />}
              </div>
              <div className="dp-d-id">
                <b>{review.title || 'Untitled project'}{review.number != null ? <span className="dp-num"> #{review.number}</span> : null}</b>
                <span className={`dp-state s-${review.state}`}>
                  {review.state === 'pending' ? (review.edited ? 'Edited — waiting approval' : 'New — waiting approval') : review.state === 'approved' ? 'Live on map' : 'Not approved'}
                </span>
                <small>Added by <b>{ownerName(review)}</b>{review.owner.company ? ` (${review.owner.company})` : ''} · {fullDate(review.created_at)}</small>
              </div>
              <button className="adm-btn ghost sm" onClick={() => { if (!editing || confirm('Discard your unsaved changes?')) setReview(null); }} aria-label="Close"><i className="fas fa-xmark" /></button>
            </div>

            <div className="acs-d-contact">
              {review.owner.email && <a className="adm-btn ghost sm" href={`mailto:${review.owner.email}`}><i className="fas fa-envelope" /> Email developer</a>}
              {review.owner.mobile && <a className="adm-btn ghost sm" href={`https://wa.me/${review.owner.mobile.replace(/\D/g, '')}`} target="_blank" rel="noopener"><i className="fab fa-whatsapp" /> WhatsApp</a>}
              {isOwner && info && !editing && <button className="adm-btn ghost sm" onClick={startEdit}><i className="fas fa-pen" /> Edit details</button>}
            </div>
            {review.admin_edited_at && !editing && (
              <p className="dp-admin-edit"><i className="fas fa-user-pen" /> Details corrected by {review.admin_edited_by || 'Mappingg'} · {fullDate(review.admin_edited_at)}</p>
            )}

            {editing && info ? (
              <div className="dp-edit">
                <p className="crm-meta">Correct anything the developer entered. Changes are saved on the project; the developer will see them in their dashboard.</p>
                {info.fields.filter((f) => f.key !== 'lat' && f.key !== 'lng').map((f) => (
                  <label key={f.key} className="dp-field">
                    <span>{f.label}{f.key === 'title' ? ' *' : ''}</span>
                    {f.key === 'status' ? (
                      <select value={form.status || ''} onChange={(e) => setForm((m) => ({ ...m, status: e.target.value }))}>
                        {[...new Set([...(form.status && !STATUS_OPTIONS.includes(form.status) ? [form.status] : []), ...STATUS_OPTIONS])].map((o) => <option key={o} value={o}>{STATUS_LABEL[o] || o}</option>)}
                      </select>
                    ) : f.key === 'type' ? (
                      <select value={form.type || ''} onChange={(e) => setForm((m) => ({ ...m, type: e.target.value }))}>
                        <option value="">—</option>
                        {[...new Set([...(form.type && !TYPE_OPTIONS.includes(form.type) ? [form.type] : []), ...TYPE_OPTIONS])].map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : LONG_FIELDS.has(f.key) ? (
                      <textarea rows={f.key === 'description' ? 4 : 2} value={form[f.key] || ''} onChange={(e) => setForm((m) => ({ ...m, [f.key]: e.target.value }))} />
                    ) : (
                      <input value={form[f.key] || ''} onChange={(e) => setForm((m) => ({ ...m, [f.key]: e.target.value }))}
                        placeholder={f.key === 'youtube_video_url' ? 'https://youtu.be/…' : ''} />
                    )}
                  </label>
                ))}

                <div className="dp-field-row">
                  <label className="dp-field"><span>Latitude</span><input inputMode="decimal" value={form.lat || ''} onChange={(e) => setForm((m) => ({ ...m, lat: e.target.value }))} placeholder="18.5515" /></label>
                  <label className="dp-field"><span>Longitude</span><input inputMode="decimal" value={form.lng || ''} onChange={(e) => setForm((m) => ({ ...m, lng: e.target.value }))} placeholder="73.9446" /></label>
                </div>
                <p className="crm-meta">Tip: right-click the place in Google Maps to copy its coordinates.</p>

                <div className="dp-field">
                  <span>Custom fields</span>
                  {customForm.map((c, i) => (
                    <div className="dp-custom" key={i}>
                      <input placeholder="Label (e.g. Clubhouse)" value={c.label} onChange={(e) => setCustomForm((l) => l.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                      <input placeholder="Value" value={c.value} onChange={(e) => setCustomForm((l) => l.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
                      <button type="button" className="adm-btn ghost sm" onClick={() => setCustomForm((l) => l.filter((_, j) => j !== i))} aria-label="Remove field"><i className="fas fa-xmark" /></button>
                    </div>
                  ))}
                  <button type="button" className="link-btn" onClick={() => setCustomForm((l) => [...l, { label: '', value: '' }])}>+ Add a field</button>
                </div>

                <div className="dp-media">
                  {info.images.map((im) => {
                    const cur = imgForm[im.key] !== undefined ? imgForm[im.key] : im.url;
                    return (
                      <figure key={im.key}>
                        {cur
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={cur} alt={im.label} />
                          : <div className="dp-noimg"><i className="fas fa-image" /></div>}
                        <figcaption>{im.label}</figcaption>
                        <div className="dp-img-btns">
                          <label className="link-btn">{cur ? 'Replace' : 'Upload'}<input type="file" accept="image/*" hidden onChange={(e) => pickImage(im.key, e.target.files?.[0])} /></label>
                          {cur && <button type="button" className="link-btn" onClick={() => setImgForm((m) => ({ ...m, [im.key]: '' }))}>Remove</button>}
                        </div>
                      </figure>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {editing ? null : infoErr ? (
              <p className="crm-meta">Could not load the project details. <button className="link-btn" onClick={() => openReview(review)}>Try again</button></p>
            ) : !info ? (
              <p className="crm-meta"><i className="fas fa-spinner fa-spin" /> Loading details…</p>
            ) : (
              <>
                {info.edited && (
                  <section className="dp-sec dp-changes">
                    <h4><i className="fas fa-code-compare" /> What the developer changed</h4>
                    {info.changes === null ? (
                      <p className="crm-meta">The earlier version isn&apos;t available for this edit — please check all details below.</p>
                    ) : info.changes.length === 0 ? (
                      <p className="crm-meta">No details changed (it was re-sent without edits).</p>
                    ) : (
                      <div className="dp-diff">
                        <div className="dp-diff-h"><span>Field</span><span>Before</span><span>Now</span></div>
                        {info.changes.map((c) => (
                          <div className="dp-diff-r" key={c.label}>
                            <span>{c.label}</span>
                            <span className="was">{c.before || <em>empty</em>}</span>
                            <span className="now">{c.after || <em>empty</em>}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                )}

                <section className="dp-sec">
                  <h4><i className="fas fa-list-check" /> Project details</h4>
                  <dl className="acs-dl">
                    {info.fields.filter((f) => f.key !== 'lat' && f.key !== 'lng' && f.key !== 'youtube_video_url').map((f) => (
                      <div key={f.key}>
                        <dt>{f.label}</dt>
                        <dd>{f.value ? (f.key === 'status' ? (STATUS_LABEL[f.value] || f.value) : f.value) : <span className="dp-missing">Not filled</span>}</dd>
                      </div>
                    ))}
                    {info.custom.map((c, i) => <div key={`c${i}`}><dt>{c.label}</dt><dd>{c.value || <span className="dp-missing">Not filled</span>}</dd></div>)}
                  </dl>
                </section>

                <section className="dp-sec">
                  <h4><i className="fas fa-location-dot" /> Map location</h4>
                  {info.lat != null && info.lng != null && !Number.isNaN(info.lat) && !Number.isNaN(info.lng) ? (
                    <>
                      <iframe
                        className="dp-map" title="Project location" loading="lazy"
                        src={`https://www.openstreetmap.org/export/embed.html?bbox=${info.lng - 0.008}%2C${info.lat - 0.005}%2C${info.lng + 0.008}%2C${info.lat + 0.005}&layer=mapnik&marker=${info.lat}%2C${info.lng}`}
                      />
                      <p className="crm-meta">
                        {info.lat.toFixed(5)}, {info.lng.toFixed(5)} ·{' '}
                        <a className="link-btn" href={`https://www.google.com/maps?q=${info.lat},${info.lng}`} target="_blank" rel="noopener">Open in Google Maps</a>
                      </p>
                    </>
                  ) : (
                    <p className="dp-warn"><i className="fas fa-triangle-exclamation" /> No map location given. After approving, place the pin in the Map Editor so it appears on the map.</p>
                  )}
                </section>

                <section className="dp-sec">
                  <h4><i className="fas fa-images" /> Photos &amp; video</h4>
                  <div className="dp-media">
                    {info.images.map((im) => (
                      <figure key={im.key}>
                        {im.url
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <a href={im.url} target="_blank" rel="noopener"><img src={im.url} alt={im.label} loading="lazy" /></a>
                          : <div className="dp-noimg"><i className="fas fa-image" /></div>}
                        <figcaption>{im.label}{im.url ? '' : ' — not added'}</figcaption>
                      </figure>
                    ))}
                    {(() => {
                      const v = info.fields.find((f) => f.key === 'youtube_video_url')?.value || '';
                      const yt = v ? youTubeId(v) : '';
                      return (
                        <figure>
                          {yt
                            // eslint-disable-next-line @next/next/no-img-element
                            ? <a href={v} target="_blank" rel="noopener" className="dp-video"><img src={`https://i.ytimg.com/vi/${yt}/hqdefault.jpg`} alt="Project video" loading="lazy" /><i className="fas fa-play" /></a>
                            : <div className="dp-noimg"><i className="fas fa-video" /></div>}
                          <figcaption>Project video{yt ? '' : v ? ' — link is not a YouTube video' : ' — not added'}</figcaption>
                        </figure>
                      );
                    })()}
                  </div>
                </section>
              </>
            )}

            {isOwner && editing && (
              <div className="dp-d-actions">
                <div className="adm-actions">
                  <button className="adm-btn primary" disabled={saving} onClick={saveEdit}>
                    <i className={`fas ${saving ? 'fa-spinner fa-spin' : 'fa-floppy-disk'}`} /> Save changes
                  </button>
                  <button className="adm-btn ghost" disabled={saving} onClick={() => setEditing(false)}>Cancel</button>
                </div>
              </div>
            )}
            {isOwner && !editing && (
              <div className="dp-d-actions">
                {rejecting === review.id ? (
                  <div className="dp-reject">
                    <textarea className="crm-notes" rows={3} autoFocus value={reason} onChange={(e) => setReason(e.target.value)}
                      placeholder="Reason the developer will see, e.g. Please add the MahaRERA number and correct the price." />
                    <div className="adm-actions">
                      <button className="adm-btn danger" disabled={busy === review.id || !reason.trim()} onClick={() => decide(review, 'reject')}>
                        {review.state === 'approved' ? 'Unpublish' : 'Don’t approve'}
                      </button>
                      <button className="adm-btn ghost" onClick={() => { setRejecting(''); setReason(''); }}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="adm-actions">
                    {review.state !== 'approved' && (
                      <button className="adm-btn primary" disabled={busy === review.id || !info} onClick={() => decide(review, 'approve')}>
                        <i className={`fas ${busy === review.id ? 'fa-spinner fa-spin' : 'fa-circle-check'}`} /> {review.state === 'rejected' ? 'Approve anyway' : 'Details are correct — approve & publish'}
                      </button>
                    )}
                    {review.state !== 'rejected' && (
                      <button className="adm-btn ghost" disabled={busy === review.id} onClick={() => { setRejecting(review.id); setReason(''); }}>
                        <i className="fas fa-circle-xmark" /> {review.state === 'approved' ? 'Unpublish' : 'Don’t approve'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
