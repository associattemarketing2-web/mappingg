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
  const setLogo = (d: Dev, file: File) => run(d.id, async () => call('PATCH', `?id=${d.id}`, { logo: await readLogo(file) }), `${d.name} logo updated`);
  const removeLogo = (d: Dev) => run(d.id, () => call('PATCH', `?id=${d.id}`, { logo: null }), `${d.name} logo removed`);
  const rename = (d: Dev, name: string) => run(d.id, () => call('PATCH', `?id=${d.id}`, { name }), 'Name saved').then(() => setEditing(null));
  const remove = (d: Dev) => {
    if (!window.confirm(`Remove “${d.name}” from the developer list?\n\nIts ${d.projects} map project${d.projects === 1 ? '' : 's'} keep their name and logo.`)) return;
    run(d.id, () => call('DELETE', `?id=${d.id}`), `${d.name} removed`);
  };
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
                  <LogoPicker dev={d} onFile={(f) => setLogo(d, f)} disabled={busy === d.id} />
                  <div className="dvl-info">
                    {editing === d.id
                      ? <RenameForm initial={d.name} onCancel={() => setEditing(null)} onSave={(n) => rename(d, n)} />
                      : <b className="dvl-name" title={d.name}>{d.name}</b>}
                    <span className="muted dvl-sub">
                      {d.projects ? `${d.projects} project${d.projects === 1 ? '' : 's'} on the map` : 'Not on the map yet'}
                    </span>
                    {d.logo && d.projects > 0 && (
                      d.logoInUse >= d.projects
                        ? <span className="dvl-ok"><i className="fas fa-circle-check" /> Logo on every project</span>
                        : <button className="dvl-apply" disabled={busy === d.id} onClick={() => applyAll(d)}><i className="fas fa-wand-magic-sparkles" /> Logo on {d.logoInUse} of {d.projects} — use on all</button>
                    )}
                    {!d.logo && <span className="dvl-warn"><i className="fas fa-image" /> No logo — click the box to add one</span>}
                  </div>
                  <div className="dvl-actions">
                    <button className="dvl-icon" title="Rename" aria-label={`Rename ${d.name}`} onClick={() => setEditing(d.id)}><i className="fas fa-pen" /></button>
                    {d.logo && <button className="dvl-icon" title="Remove logo" aria-label={`Remove ${d.name} logo`} onClick={() => removeLogo(d)}><i className="fas fa-image" /><i className="fas fa-xmark dvl-x" /></button>}
                    <button className="dvl-icon danger" title="Remove from list" aria-label={`Remove ${d.name}`} onClick={() => remove(d)}><i className="fas fa-trash" /></button>
                  </div>
                </li>
              ))}
            </ul>
          )}
    </div>
  );
}

function LogoPicker({ dev, onFile, disabled }: { dev: { name: string; logo: string | null }; onFile: (f: File) => void; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <button type="button" className={`dvl-logo${dev.logo ? '' : ' empty'}`} disabled={disabled} onClick={() => input.current?.click()}
      title={dev.logo ? 'Change logo' : 'Add logo'} aria-label={`${dev.logo ? 'Change' : 'Add'} ${dev.name} logo`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {dev.logo ? <img src={thumb(dev.logo)} alt="" loading="lazy" /> : <i className="fas fa-plus" />}
      <span className="dvl-logo-hover"><i className="fas fa-camera" /></span>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" hidden
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(f); }} />
    </button>
  );
}

function RenameForm({ initial, onSave, onCancel }: { initial: string; onSave: (n: string) => void; onCancel: () => void }) {
  const [v, setV] = useState(initial);
  return (
    <form className="dvl-rename" onSubmit={(e) => { e.preventDefault(); if (v.trim() && v.trim() !== initial) onSave(v.trim()); else onCancel(); }}>
      <input autoFocus value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && onCancel()} aria-label="Developer name" maxLength={120} />
      <button className="adm-btn primary sm" type="submit">Save</button>
    </form>
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
