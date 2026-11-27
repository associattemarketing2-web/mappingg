'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { uploadFile } from './WaComposer';
import { googleFile } from '@/lib/share-embed';

// s-admin → WhatsApp → Bulk send → "Share a project".
//   SharePicker   pick a project, tick photos / brochure / plans / videos (or upload
//                 any other file) → "Create link". The link is then attached to the
//                 bulk message: every number gets its own link in place of {link}.
//   SharedLinks   every link created, how many it went to, who opened it (when,
//                 how often, on what device) and what they downloaded.
// API: /api/admin/whatsapp/share. Public page: /s/<code>/<token>.

type Flash = (m: string, e?: boolean) => void;
export type ShareKind = 'photo' | 'brochure' | 'floor_plan' | 'payment_plan' | 'video' | 'file';
interface Item { id: string; kind: ShareKind; url: string; name: string }
interface Project { pin_id: string; title: string; location?: string; developer?: string; price?: string; configuration?: string; possession?: string; logo?: string }
interface Choice { id: string; number: string; title: string; location: string; developer: string }
export interface Share {
  id: string; code: string; title: string; url: string; note: string; show_details: boolean; project: Project | null;
  items: Item[]; views: number; sent: number; opened: number; created_by?: string; created_at: string;
}
interface Recipient {
  id: string; phone: string; phone_display: string; name: string; created_at: string;
  opens: number; first_open_at?: string; last_open_at?: string; device?: string; clicks: number; downloaded?: string[];
}

const API = '/api/admin/whatsapp/share';
async function call<T>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, body ? { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { credentials: 'same-origin', cache: 'no-store' });
  const b = await r.json().catch(() => ({}));
  if (!r.ok || b.error) throw new Error(b?.error?.message || `Request failed (${r.status})`);
  return b.data as T;
}

const KIND_LABEL: Record<ShareKind, string> = { photo: 'Photo', brochure: 'Brochure', floor_plan: 'Floor plan', payment_plan: 'Payment plan', video: 'Video', file: 'File' };
const KIND_ICON: Record<ShareKind, string> = { photo: 'fa-image', brochure: 'fa-book-open', floor_plan: 'fa-ruler-combined', payment_plan: 'fa-indian-rupee-sign', video: 'fa-video', file: 'fa-file-lines' };
const thumb = (u: string) => {
  const g = googleFile(u);
  if (g && g.kind === 'file') return `https://drive.google.com/thumbnail?id=${g.id}&sz=w400`;
  return u.startsWith('/media/') || u.startsWith('/api/media/') ? `${u}${u.includes('?') ? '&' : '?'}w=240` : u;
};
const isImg = (it: Item) => it.kind === 'photo' || (it.kind === 'file' && /\.(jpe?g|png|webp|gif)(\?|$)/i.test(it.url + it.name));
const IST = { timeZone: 'Asia/Kolkata' } as const;
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', ...IST }) : '');

function copy(text: string, flash: Flash) {
  navigator.clipboard?.writeText(text).then(() => flash('Link copied'), () => flash('Copy failed — select the link and copy it', true));
}

/** Step 1: project → pick what to share → create the link. `share` is the attached link (lifted to Bulk send). */
export function SharePicker({ share, onShare, flash }: { share: Share | null; onShare: (s: Share | null) => void; flash: Flash }) {
  const [choices, setChoices] = useState<Choice[] | null>(null);
  const [q, setQ] = useState('');
  const [openList, setOpenList] = useState(false);
  const [pin, setPin] = useState<Choice | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [details, setDetails] = useState(true);
  const [note, setNote] = useState('');
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [upPct, setUpPct] = useState<number | null>(null);
  // "Paste a link": Google Drive / Docs brochure, YouTube video, any https file.
  const [linkUrl, setLinkUrl] = useState('');
  const [linkKind, setLinkKind] = useState<ShareKind>('brochure');
  const [linkName, setLinkName] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (choices || !openList) return;
    call<{ projects: Choice[] }>(`${API}?projects=1`).then((d) => setChoices(d.projects), (e) => { flash((e as Error).message, true); setChoices([]); });
  }, [openList, choices, flash]);
  useEffect(() => {
    if (!openList) return;
    const onDown = (e: PointerEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpenList(false); };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [openList]);

  const matches = useMemo(() => {
    const t = q.trim().toLowerCase().replace(/^#\s*/, '');
    const list = choices || [];
    if (!t) return list.slice(0, 40);
    // Pin number: "197" or "#197" → that pin first, then name / location / developer matches.
    const exact = /^\d+$/.test(t) ? list.filter((c) => c.number === t) : [];
    const words = t.split(/\s+/).filter(Boolean);
    const rest = list.filter((c) => !exact.includes(c) && words.every((w) => `#${c.number} ${c.number} ${c.title} ${c.location} ${c.developer}`.toLowerCase().includes(w)));
    return [...exact, ...rest].slice(0, 40);
  }, [choices, q]);

  async function choose(c: Choice) {
    setPin(c); setQ(''); setOpenList(false); setLoading(true); setItems([]); setProject(null);
    try {
      const d = await call<{ project: Project; items: Item[] }>(`${API}?pin=${encodeURIComponent(c.id)}`);
      setProject(d.project); setItems(d.items); setTitle(d.project.title);
      // Everything ticked by default; untick what should not go.
      setPicked(new Set(d.items.map((i) => i.id)));
      if (!d.items.length) flash('No photos or brochure saved for this project — upload files below, or share just the details.');
    } catch (e) { flash((e as Error).message, true); setPin(null); } finally { setLoading(false); }
  }

  function toggle(id: string) { setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }); }
  function toggleKind(photos: boolean) {
    const ids = items.filter((i) => isImg(i) === photos).map((i) => i.id);
    const all = ids.every((id) => picked.has(id));
    setPicked((s) => { const n = new Set(s); ids.forEach((id) => (all ? n.delete(id) : n.add(id))); return n; });
  }

  async function addFiles(files: FileList | null) {
    const list = Array.from(files || []);
    if (fileRef.current) fileRef.current.value = '';
    for (const f of list) {
      const kind = /^image\/(jpeg|png)$/.test(f.type) ? 'image' : /^video\/(mp4|3gpp)$/.test(f.type) ? 'video' : 'document';
      try {
        setUpPct(0);
        const url = await uploadFile(f, kind, setUpPct);
        const it: Item = { id: `up-${Math.random().toString(36).slice(2, 9)}`, kind: kind === 'image' ? 'photo' : kind === 'video' ? 'video' : /brochure/i.test(f.name) ? 'brochure' : 'file', url, name: f.name };
        setItems((x) => [...x, it]);
        setPicked((s) => new Set(s).add(it.id));
      } catch (e) { flash(`${f.name}: ${(e as Error).message}`, true); }
    }
    setUpPct(null);
  }

  function addLink() {
    const url = linkUrl.trim();
    if (!/^https?:\/\/\S+\.\S+/i.test(url)) { flash('Paste a full link starting with https://', true); return; }
    if (items.some((i) => i.url === url)) { flash('This link is already in the list', true); return; }
    const google = /(^|\.)(drive|docs)\.google\.com$/i.test((() => { try { return new URL(url).hostname; } catch { return ''; } })());
    const it: Item = {
      id: `ln-${Math.random().toString(36).slice(2, 9)}`, kind: linkKind, url,
      name: linkName.trim() || `${KIND_LABEL[linkKind]}${google ? ' (Google Drive)' : ''}`,
    };
    setItems((x) => [...x, it]);
    setPicked((s) => new Set(s).add(it.id));
    setLinkUrl(''); setLinkName('');
    if (google) flash('Added. Make sure the Google Drive file is shared as "Anyone with the link can view", or buyers will see "request access".');
  }

  async function create() {
    let chosen = items.filter((i) => picked.has(i.id));
    // A link pasted but not yet added with "Add link" is included too, so it is never lost.
    const pending = linkUrl.trim();
    if (pending) {
      if (!/^https?:\/\/\S+\.\S+/i.test(pending)) { flash('The pasted link is not a full link (https://…) — fix it or clear the box', true); return; }
      if (!chosen.some((i) => i.url === pending)) {
        chosen = [...chosen, { id: 'pending', kind: linkKind, url: pending, name: linkName.trim() || KIND_LABEL[linkKind] }];
      }
      setLinkUrl(''); setLinkName('');
    }
    if (!chosen.length && !(project && details)) { flash('Pick at least one photo, brochure or file', true); return; }
    setBusy(true);
    try {
      const d = await call<{ share: Share }>(API, {
        action: 'create', pin_id: project?.pin_id, title: title.trim() || undefined, note: note.trim() || undefined, show_details: Boolean(project) && details,
        items: chosen.map((i) => ({ kind: i.kind, url: i.url, name: i.name })),
      });
      onShare(d.share);
      flash('Link created ✓ — now add numbers and send. Each person gets their own link.');
    } catch (e) { flash((e as Error).message, true); } finally { setBusy(false); }
  }

  function reset() { onShare(null); setPin(null); setProject(null); setItems([]); setPicked(new Set()); setNote(''); setTitle(''); setDetails(true); }

  if (share) {
    return (
      <div className="wsh-done">
        <div className="wsh-done-main">
          <i className="fas fa-link" />
          <div>
            <b>{share.title}</b>
            <span className="muted">{share.items.length} file{share.items.length === 1 ? '' : 's'}{share.show_details ? ' + project details' : ''} · each number gets its own link (written as <code>{'{link}'}</code> in the message)</span>
            <span className="wsh-url">{share.url}/…</span>
          </div>
        </div>
        <div className="wsh-done-acts">
          <a className="adm-btn ghost sm" href={`/s/${share.code}`} target="_blank" rel="noreferrer"><i className="fas fa-eye" /> Preview</a>
          <button type="button" className="adm-btn ghost sm" onClick={() => copy(share.url, flash)} title="General link (opens are not tied to a number)"><i className="fas fa-copy" /> Copy</button>
          <button type="button" className="adm-btn ghost sm" onClick={reset}><i className="fas fa-xmark" /> Remove / new link</button>
        </div>
      </div>
    );
  }

  const photos = items.filter(isImg);
  const docs = items.filter((i) => !isImg(i));
  return (
    <div className="wsh">
      <div className="adm-field" ref={boxRef}>
        <label>Project</label>
        <div className="wsh-pick">
          <label className="acs-search">
            <i className="fas fa-magnifying-glass" />
            <input type="search" placeholder={pin ? `#${pin.number} ${pin.title}${pin.location ? ` — ${pin.location}` : ''}` : 'Search pin no. (e.g. 197), project name, location or developer'} value={q}
              onFocus={() => setOpenList(true)} onChange={(e) => { setQ(e.target.value); setOpenList(true); }} aria-label="Search project" />
          </label>
          {openList && (
            <ul className="wsh-list" role="listbox">
              {!choices ? <li className="muted"><i className="fas fa-spinner fa-spin" /> Loading projects…</li>
                : !matches.length ? <li className="muted">No project matches.</li>
                  : matches.map((c) => (
                    <li key={c.id}>
                      <button type="button" role="option" aria-selected={pin?.id === c.id} onClick={() => void choose(c)}>
                        <b>{c.number ? <span className="wsh-pin-no">#{c.number}</span> : null}{c.title}</b><small>{[c.location, c.developer].filter(Boolean).join(' · ')}</small>
                      </button>
                    </li>
                  ))}
            </ul>
          )}
        </div>
        <small className="muted">Or skip the project and just upload files below.</small>
      </div>

      {loading && <p className="muted"><i className="fas fa-spinner fa-spin" /> Loading photos &amp; brochure…</p>}

      {project && (
        <label className="wsh-check">
          <input type="checkbox" checked={details} onChange={(e) => setDetails(e.target.checked)} />
          <span><b>Project details</b> <small className="muted">— {[project.configuration, project.price, project.possession && `possession ${project.possession}`].filter(Boolean).join(' · ') || 'name, location, developer, RERA'}</small></span>
        </label>
      )}

      {photos.length > 0 && (
        <div className="adm-field">
          <label>Photos <small>({photos.filter((p) => picked.has(p.id)).length}/{photos.length} selected)</small>
            <button type="button" className="link-btn" onClick={() => toggleKind(true)}>{photos.every((p) => picked.has(p.id)) ? 'Select none' : 'Select all'}</button>
          </label>
          <div className="wsh-photos">
            {photos.map((p) => (
              <button key={p.id} type="button" className={`wsh-photo${picked.has(p.id) ? ' on' : ''}`} onClick={() => toggle(p.id)} aria-pressed={picked.has(p.id)} title={p.name}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={thumb(p.url)} alt={p.name} loading="lazy" referrerPolicy="no-referrer" />
                <span className="tick"><i className="fas fa-check" /></span>
              </button>
            ))}
          </div>
        </div>
      )}

      {docs.length > 0 && (
        <div className="adm-field">
          <label>Brochure, plans &amp; videos
            <button type="button" className="link-btn" onClick={() => toggleKind(false)}>{docs.every((p) => picked.has(p.id)) ? 'Select none' : 'Select all'}</button>
          </label>
          <ul className="wsh-docs">
            {docs.map((d) => (
              <li key={d.id}>
                <label className="wsh-check">
                  <input type="checkbox" checked={picked.has(d.id)} onChange={() => toggle(d.id)} />
                  <i className={`fas ${KIND_ICON[d.kind]}`} />
                  <span><b>{d.name}</b> <small className="muted">{KIND_LABEL[d.kind]}</small></span>
                  <a href={d.url} target="_blank" rel="noreferrer" className="link-btn" onClick={(e) => e.stopPropagation()}>open</a>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="adm-field">
        <label>Add other files <small>— photos (JPG/PNG), PDF / brochure, video (MP4), any document</small></label>
        <input ref={fileRef} type="file" hidden multiple onChange={(e) => void addFiles(e.target.files)} />
        <button type="button" className="adm-btn ghost sm" onClick={() => fileRef.current?.click()} disabled={upPct !== null}>
          {upPct !== null ? <><i className="fas fa-spinner fa-spin" /> Uploading {upPct}%</> : <><i className="fas fa-upload" /> Upload files</>}
        </button>
      </div>

      <div className="adm-field">
        <label>Or paste a link <small>— Google Drive / Google Docs brochure, YouTube video, or any file link</small></label>
        <div className="wsh-link-row">
          <select value={linkKind} onChange={(e) => setLinkKind(e.target.value as ShareKind)} aria-label="What is this link">
            {(['brochure', 'floor_plan', 'payment_plan', 'video', 'photo', 'file'] as ShareKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
          <input type="url" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://drive.google.com/file/d/…"
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addLink(); } }} aria-label="Link" />
          <input value={linkName} maxLength={120} onChange={(e) => setLinkName(e.target.value)} placeholder="Name (optional)" aria-label="Name"
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addLink(); } }} />
          <button type="button" className="adm-btn ghost sm" onClick={addLink} disabled={!linkUrl.trim()}><i className="fas fa-plus" /> Add link</button>
        </div>
      </div>

      {(project || items.length > 0) && (
        <>
          <div className="wsh-row">
            <div className="adm-field">
              <label>Title on the page</label>
              <input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Lodha Camelot, Kharadi" />
            </div>
            <div className="adm-field">
              <label>Note on the page <small>(optional)</small></label>
              <input value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Special launch offer till Sunday" />
            </div>
          </div>
          <button type="button" className="adm-btn primary" onClick={create} disabled={busy || upPct !== null}>
            {busy ? <i className="fas fa-spinner fa-spin" /> : <i className="fas fa-link" />} Create link
            {` (${items.filter((i) => picked.has(i.id)).length} file${items.filter((i) => picked.has(i.id)).length === 1 ? '' : 's'}${project && details ? ' + details' : ''})`}
          </button>
        </>
      )}
    </div>
  );
}

/** Every link created, and for each one: who it went to, who opened it, what they downloaded. */
export function SharedLinks({ flash, refreshKey = 0, onUse, focusId }: { flash: Flash; refreshKey?: number; onUse?: (s: Share) => void; focusId?: string | null }) {
  const [rows, setRows] = useState<Share[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  // Just sent with a link: open its "who opened" list and bring it into view.
  useEffect(() => {
    if (!focusId) return;
    setOpen(focusId);
    setTimeout(() => boxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
  }, [focusId, refreshKey]);
  const [people, setPeople] = useState<Recipient[] | null>(null);
  const [filter, setFilter] = useState<'all' | 'opened' | 'not'>('all');

  const load = useCallback(() => { call<{ shares: Share[] }>(API).then((d) => setRows(d.shares), (e) => { flash((e as Error).message, true); setRows((r) => r || []); }); }, [flash]);
  const loadPeople = useCallback((id: string) => { call<{ recipients: Recipient[] }>(`${API}?id=${id}`).then((d) => setPeople(d.recipients), (e) => flash((e as Error).message, true)); }, [flash]);
  useEffect(() => {
    load();
    const t = setInterval(() => { if (document.visibilityState === 'visible') { load(); if (open) loadPeople(open); } }, 30_000);
    return () => clearInterval(t);
  }, [load, loadPeople, open, refreshKey]);
  useEffect(() => { setPeople(null); setFilter('all'); if (open) loadPeople(open); }, [open, loadPeople]);

  async function remove(s: Share) {
    if (!window.confirm(`Delete the link "${s.title}"? Everyone who got it will see "page not found".`)) return;
    try { await call(API, { action: 'delete', id: s.id }); flash('Link deleted'); if (open === s.id) setOpen(null); load(); } catch (e) { flash((e as Error).message, true); }
  }
  function exportCsv(s: Share) {
    if (!people) return;
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['Name', 'Number', 'Opened', 'Times opened', 'First opened', 'Last opened', 'Device', 'Downloaded'].join(',')]
      .concat(people.map((p) => [p.name, p.phone_display, p.first_open_at ? 'Yes' : 'No', p.opens, when(p.first_open_at), when(p.last_open_at), p.device, (p.downloaded || []).join('; ')].map(esc).join(',')));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([`﻿${lines.join('\n')}`], { type: 'text/csv' }));
    a.download = `${s.title.replace(/[^\w-]+/g, '_')}-opens.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const shown = (people || []).filter((p) => filter === 'all' || (filter === 'opened' ? !!p.first_open_at : !p.first_open_at));
  return (
    <div className="adm-panel" ref={boxRef}>
      <div className="adm-panel-head"><h3><i className="fas fa-link" /> Project links &amp; who opened them</h3><span className="muted">Updates every 30 s. WhatsApp link previews are not counted as opens.</span></div>
      <div className="wa-table-wrap">
        <table className="wa-table">
          <thead><tr><th>Link</th><th>Sent to</th><th>Opened</th><th>Total views</th><th>Created</th><th /></tr></thead>
          <tbody>
            {!rows ? <tr><td colSpan={6} className="muted"><i className="fas fa-spinner fa-spin" /> Loading…</td></tr>
              : !rows.length ? <tr><td colSpan={6} className="muted">No project links yet. Create one above under “Share a project”.</td></tr>
                : rows.map((s) => [
                  <tr key={s.id}>
                    <td className="wa-cell-text">
                      <button type="button" className="wa-link" onClick={() => setOpen(open === s.id ? null : s.id)}>
                        <i className={`fas fa-chevron-${open === s.id ? 'down' : 'right'}`} /> {s.title}
                      </button>
                      <small className="muted"> · {s.items.length} file{s.items.length === 1 ? '' : 's'}</small>
                    </td>
                    <td>{s.sent.toLocaleString('en-IN')}</td>
                    <td>{s.sent ? <><b>{s.opened.toLocaleString('en-IN')}</b> <small className="muted">({Math.round((s.opened / s.sent) * 100)}%)</small></> : '—'}</td>
                    <td>{s.views.toLocaleString('en-IN')}</td>
                    <td>{when(s.created_at)}<small className="muted">{s.created_by ? ` · ${s.created_by.split('@')[0]}` : ''}</small></td>
                    <td className="wsh-acts">
                      {onUse && <button type="button" className="adm-btn ghost sm" onClick={() => onUse(s)} title="Attach this link to a new bulk send"><i className="fas fa-paper-plane" /> Send again</button>}
                      <a className="adm-btn ghost sm" href={`/s/${s.code}`} target="_blank" rel="noreferrer" aria-label="Preview"><i className="fas fa-eye" /></a>
                      <button type="button" className="adm-btn ghost sm" onClick={() => remove(s)} aria-label="Delete link"><i className="fas fa-trash" /></button>
                    </td>
                  </tr>,
                  open === s.id && (
                    <tr key={`${s.id}-people`} className="wa-runs"><td colSpan={6}>
                      <div className="wsh-people-tools">
                        <div className="wa-filters" role="tablist" aria-label="Filter">
                          {([['all', 'All'], ['opened', 'Opened'], ['not', 'Not opened']] as const).map(([k, l]) => (
                            <button key={k} type="button" role="tab" aria-selected={filter === k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>
                              {l}{people ? ` (${k === 'all' ? people.length : people.filter((p) => (k === 'opened') === !!p.first_open_at).length})` : ''}
                            </button>
                          ))}
                        </div>
                        <button type="button" className="adm-btn ghost sm" onClick={() => exportCsv(s)} disabled={!people?.length}><i className="fas fa-file-csv" /> Export</button>
                      </div>
                      <table className="wa-table">
                        <thead><tr><th>Name</th><th>Number</th><th>Opened?</th><th>Times</th><th>First / last opened</th><th>Device</th><th>Downloaded / clicked</th></tr></thead>
                        <tbody>
                          {!people ? <tr><td colSpan={7} className="muted"><i className="fas fa-spinner fa-spin" /> Loading…</td></tr>
                            : !shown.length ? <tr><td colSpan={7} className="muted">{people.length ? 'Nobody in this filter.' : 'Not sent to anyone yet — attach this link to a bulk send.'}</td></tr>
                              : shown.map((p) => (
                                <tr key={p.id}>
                                  <td>{p.name || <span className="muted">—</span>}</td>
                                  <td className="mono"><a href={`https://wa.me/${p.phone}`} target="_blank" rel="noreferrer">{p.phone_display}</a></td>
                                  <td>{p.first_open_at ? <span className="adm-badge ok">Opened</span> : <span className="adm-badge muted">Not yet</span>}</td>
                                  <td>{p.opens || 0}</td>
                                  <td>{p.first_open_at ? <>{when(p.first_open_at)}{p.last_open_at && p.last_open_at !== p.first_open_at ? <small className="muted"> → {when(p.last_open_at)}</small> : null}</> : '—'}</td>
                                  <td>{p.device || '—'}</td>
                                  <td className="wa-cell-text">{p.downloaded?.length ? p.downloaded.map((x) => x === 'whatsapp' ? '💬 WhatsApp chat' : x === 'project_page' ? 'Project page' : x).join(', ') : '—'}</td>
                                </tr>
                              ))}
                        </tbody>
                      </table>
                    </td></tr>
                  ),
                ])}
          </tbody>
        </table>
      </div>
    </div>
  );
}
