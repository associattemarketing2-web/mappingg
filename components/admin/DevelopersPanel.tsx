'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

// Super admin → Developers: the developer directory, ONE logo per developer
// (lib/developers.ts). In the Map Editor, typing a developer's name suggests it
// from here and picking it puts this logo on the project automatically.
// Filled from the developers already on the map the first time it opens.

interface Dev { id: string; name: string; logo: string | null; projects: number; logoInUse: number; updated_at: string }
type Filter = 'all' | 'nologo' | 'mismatch';
type Flash = (m: string, e?: boolean) => void;

const API = '/api/admin/developers';
const thumb = (src: string) => (src.startsWith('/api/media/') ? `${src}&w=160` : src);

/** Reads an image file, scaled down to at most 512 px, as a data: URL (PNG keeps transparency). */
function readLogo(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpe?g|webp|gif|svg\+xml)$/.test(file.type)) { reject(new Error('Choose a PNG, JPG, WebP, GIF or SVG image')); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const max = 512, k = Math.min(1, max / Math.max(img.naturalWidth || max, img.naturalHeight || max));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round((img.naturalWidth || max) * k));
      c.height = Math.max(1, Math.round((img.naturalHeight || max) * k));
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(file.type === 'image/jpeg' || file.type === 'image/jpg' ? c.toDataURL('image/jpeg', 0.9) : c.toDataURL('image/png'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That image could not be read')); };
    img.src = url;
  });
}

async function call(method: string, query = '', body?: unknown) {
  const res = await fetch(API + query, { method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const b = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(b?.error?.message || 'Something went wrong');
  return b?.data;
}

export default function DevelopersPanel({ flash }: { flash: Flash }) {
  const [rows, setRows] = useState<Dev[] | null>(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  const load = () => call('GET').then(setRows).catch((e) => { flash(e.message, true); setRows((r) => r || []); });
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const counts = useMemo(() => ({
    all: rows?.length || 0,
    nologo: rows?.filter((r) => !r.logo).length || 0,
    mismatch: rows?.filter((r) => r.logo && r.logoInUse < r.projects).length || 0,
  }), [rows]);
  const shown = (rows || []).filter((r) => {
    if (filter === 'nologo' && r.logo) return false;
    if (filter === 'mismatch' && !(r.logo && r.logoInUse < r.projects)) return false;
    const s = q.trim().toLowerCase();
    return !s || r.name.toLowerCase().includes(s);
  });

  async function run(id: string, fn: () => Promise<unknown>, done: string) {
    setBusy(id);
    try { await fn(); flash(done); await load(); } catch (e) { flash(e instanceof Error ? e.message : 'Something went wrong', true); } finally { setBusy(null); }
  }
  const applyAll = (d: Dev) => {
    const n = d.projects - d.logoInUse;
    if (!window.confirm(`Put this logo on ${n} more ${d.name} project${n === 1 ? '' : 's'} on the map?\n\nOld pictures stay in each pin's history (Backups), so this can be undone.`)) return;
    run(d.id, async () => { const r = await call('POST', `?id=${d.id}&action=apply`); return r; }, `Logo now on all ${d.projects} ${d.name} projects`);
  };

  return (
    <div className="dvl">
      <div className="dvl-head">
        <div>
          <h2><i className="fas fa-building" /> Developers &amp; logos</h2>
          <p className="muted">One logo per developer. In the Map Editor, start typing a developer&apos;s name and pick it — their logo is added to the project automatically.</p>
        </div>
        <button className="adm-btn primary" onClick={() => setAdding(true)}><i className="fas fa-plus" /> Add developer</button>
      </div>

      {adding && <AddCard onCancel={() => setAdding(false)} onSaved={() => { setAdding(false); flash('Developer added'); load(); }} flash={flash} />}

      <div className="dvl-bar">
        <label className="dvl-search"><i className="fas fa-magnifying-glass" aria-hidden="true" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search developers…" aria-label="Search developers" />
        </label>
        <div className="viz-toggle" role="tablist" aria-label="Filter">
          {([['all', 'All'], ['nologo', 'No logo'], ['mismatch', 'Logo not on every project']] as [Filter, string][]).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={filter === k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l} <span className="dvl-count">{counts[k]}</span></button>
          ))}
        </div>
      </div>

      {!rows ? <div className="adm-empty"><i className="fas fa-spinner fa-spin" /><p>Loading developers…</p></div>
        : !shown.length ? <div className="adm-empty"><i className="fas fa-building" /><p>{rows.length ? 'No developers match.' : 'No developers yet — add one, or add a developer name to a pin in the Map Editor.'}</p></div>
          : (
            <ul className="dvl-grid">
              {shown.map((d) => (
                <li key={d.id} className={`dvl-card${busy === d.id ? ' busy' : ''}`}>
                  <div className={`dvl-logo${d.logo ? '' : ' empty'}`} aria-hidden="true">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {d.logo ? <img src={thumb(d.logo)} alt="" loading="lazy" /> : <i className="fas fa-image" />}
                  </div>
                  <div className="dvl-info">
                    <b className="dvl-name" title={d.name}>{d.name}</b>
                    <span className="muted dvl-sub">
                      {d.projects ? `${d.projects} project${d.projects === 1 ? '' : 's'} on the map` : 'Not on the map yet'}
                    </span>
                    {d.logo && d.projects > 0 && (
                      d.logoInUse >= d.projects
                        ? <span className="dvl-ok"><i className="fas fa-circle-check" /> Logo on every project</span>
                        : <button className="dvl-apply" disabled={busy === d.id} onClick={() => applyAll(d)}><i className="fas fa-wand-magic-sparkles" /> Logo on {d.logoInUse} of {d.projects} — use on all</button>
                    )}
                    {!d.logo && <span className="dvl-warn"><i className="fas fa-image" /> No logo — use Edit to add one</span>}
                  </div>
                  <button className="adm-btn ghost sm dvl-edit" disabled={busy === d.id} onClick={() => setEditing(d.id)} aria-label={`Edit ${d.name}`}><i className="fas fa-pen" /> Edit</button>
                </li>
              ))}
            </ul>
          )}

      {editing && rows?.find((r) => r.id === editing) && (
        <EditDrawer dev={rows.find((r) => r.id === editing)!} flash={flash}
          onClose={() => setEditing(null)} onDone={() => { setEditing(null); load(); }} />
      )}
    </div>
  );
}

/** Edit one developer: name, logo (change / remove) and — at the bottom — delete. */
function EditDrawer({ dev, flash, onClose, onDone }: { dev: Dev; flash: Flash; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(dev.name);
  // undefined = logo unchanged, null = remove it, string = new logo (data: URL)
  const [logo, setLogo] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const preview = logo === undefined ? (dev.logo ? thumb(dev.logo) : null) : logo;
  const changed = name.trim() !== dev.name || logo !== undefined;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { flash('Enter the developer’s name', true); return; }
    if (!changed) { onClose(); return; }
    setBusy(true);
    try {
      await call('PATCH', `?id=${dev.id}`, { ...(name.trim() !== dev.name ? { name: name.trim() } : {}), ...(logo !== undefined ? { logo } : {}) });
      flash(`${name.trim()} saved`);
      onDone();
    } catch (err) { flash(err instanceof Error ? err.message : 'Could not save', true); setBusy(false); }
  }
  async function remove() {
    if (!window.confirm(`Delete “${dev.name}” from the developer list?\n\nIts ${dev.projects} map project${dev.projects === 1 ? '' : 's'} keep their name and logo.`)) return;
    setBusy(true);
    try { await call('DELETE', `?id=${dev.id}`); flash(`${dev.name} deleted`); onDone(); } catch (err) { flash(err instanceof Error ? err.message : 'Could not delete', true); setBusy(false); }
  }

  return (
    <div className="crm-drawer-overlay" onClick={() => { if (!busy) onClose(); }}>
      <aside className="crm-drawer dvl-drawer" role="dialog" aria-modal="true" aria-label={`Edit ${dev.name}`} onClick={(e) => e.stopPropagation()}>
        <div className="crm-drawer-head">
          <h3>Edit developer</h3>
          <button type="button" className="dvl-close" onClick={onClose} aria-label="Close"><i className="fas fa-xmark" /></button>
        </div>
        <form onSubmit={save} className="dvl-form">
          <div className="adm-field">
            <label>Logo</label>
            <div className="dvl-logo-edit">
              <div className={`dvl-logo big${preview ? '' : ' empty'}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {preview ? <img src={preview} alt="" /> : <i className="fas fa-image" />}
              </div>
              <div className="dvl-logo-btns">
                <button type="button" className="adm-btn ghost sm" disabled={busy} onClick={() => input.current?.click()}>
                  <i className="fas fa-upload" /> {preview ? 'Change logo' : 'Add logo'}
                </button>
                {preview && (
                  <button type="button" className="adm-btn ghost sm" disabled={busy} onClick={() => setLogo(null)}><i className="fas fa-xmark" /> Remove logo</button>
                )}
                {logo !== undefined && <button type="button" className="dvl-undo" onClick={() => setLogo(undefined)}>Undo logo change</button>}
                <small className="muted">PNG, JPG, WebP, GIF or SVG. Used on every new project of this developer.</small>
              </div>
            </div>
            <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" hidden
              onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; try { setLogo(await readLogo(f)); } catch (err) { flash(err instanceof Error ? err.message : 'Could not read image', true); } }} />
          </div>
          <div className="adm-field">
            <label htmlFor="dvl-edit-name">Developer name</label>
            <input id="dvl-edit-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          </div>
          <p className="muted dvl-proj">{dev.projects ? `${dev.projects} project${dev.projects === 1 ? '' : 's'} on the map use this name.` : 'No projects on the map use this name yet.'}</p>
          <div className="dvl-form-actions">
            <button type="button" className="adm-btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="adm-btn primary" disabled={busy || !changed || !name.trim()}>{busy ? 'Saving…' : 'Save changes'}</button>
          </div>
        </form>
        <div className="dvl-danger">
          <div><b>Delete developer</b><span className="muted">Removes it from this list. Projects on the map are not changed.</span></div>
          <button type="button" className="adm-btn danger sm" disabled={busy} onClick={remove}><i className="fas fa-trash" /> Delete</button>
        </div>
      </aside>
    </div>
  );
}

function AddCard({ onSaved, onCancel, flash }: { onSaved: () => void; onCancel: () => void; flash: Flash }) {
  const [name, setName] = useState('');
  const [logo, setLogo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try { await call('POST', '', { name: name.trim(), logo }); onSaved(); } catch (err) { flash(err instanceof Error ? err.message : 'Could not add', true); } finally { setBusy(false); }
  }
  return (
    <form className="adm-panel dvl-add" onSubmit={save}>
      <button type="button" className={`dvl-logo${logo ? '' : ' empty'}`} onClick={() => input.current?.click()} aria-label="Choose logo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {logo ? <img src={logo} alt="" /> : <span className="dvl-logo-label"><i className="fas fa-image" />Logo</span>}
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" hidden
          onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; try { setLogo(await readLogo(f)); } catch (err) { flash(err instanceof Error ? err.message : 'Could not read image', true); } }} />
      </button>
      <div className="adm-field dvl-add-name">
        <label htmlFor="dvl-new">Developer name</label>
        <input id="dvl-new" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Kolte Patil Developers" maxLength={120} />
      </div>
      <div className="dvl-add-actions">
        <button className="adm-btn ghost" type="button" onClick={onCancel}>Cancel</button>
        <button className="adm-btn primary" type="submit" disabled={busy || !name.trim()}>{busy ? 'Saving…' : 'Add developer'}</button>
      </div>
    </form>
  );
}
