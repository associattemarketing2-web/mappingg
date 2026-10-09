'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

// Super admin → Developers: the developer directory, ONE logo per developer
// (lib/developers.ts). In the Map Editor, typing a developer's name suggests it
// from here and picking it puts this logo on the project automatically.
// Filled from the developers already on the map the first time it opens.

interface ProjectInfo {
  id: string; title: string; number: number | null; hasLogo: boolean;
  location: string; status: string; type: string; configuration: string; price: string; possession: string; hidden: boolean;
}
interface Dev {
  id: string; name: string; logo: string | null; projects: number; logoInUse: number; updated_at: string;
  list?: ProjectInfo[];
}
const STATUS: Record<string, string> = { available: 'Ready to move', under_construction: 'Under construction', construction: 'Under construction', upcoming: 'Upcoming', sold: 'Sold out' };
const statusLabel = (s: string) => STATUS[s] || s || '—';
const projName = (p: { title: string; number: number | null }) => `${p.number != null ? `#${p.number} ` : ''}${p.title}`;
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
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  // Developer cards, or one list of every project.
  const [view, setView] = useState<'cards' | 'list'>('cards');

  const load = () => call('GET').then(setRows).catch((e) => { flash(e.message, true); setRows((r) => r || []); });
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const counts = useMemo(() => ({
    all: rows?.length || 0,
    nologo: rows?.filter((r) => !r.logo).length || 0,
    mismatch: rows?.filter((r) => r.logo && r.logoInUse < r.projects).length || 0,
  }), [rows]);
  const totalProjects = (rows || []).reduce((n, r) => n + r.projects, 0);
  const s = q.trim().toLowerCase();
  const shown = (rows || []).filter((r) => {
    if (filter === 'nologo' && r.logo) return false;
    if (filter === 'mismatch' && !(r.logo && r.logoInUse < r.projects)) return false;
    // Search finds a developer by its name or by one of its project names.
    return !s || r.name.toLowerCase().includes(s) || !!r.list?.some((p) => p.title.toLowerCase().includes(s));
  });
  const openDev = rows?.find((r) => r.id === open);
  const editDev = rows?.find((r) => r.id === editing);

  return (
    <div className="dvl">
      <div className="dvl-head">
        <div>
          <h2><i className="fas fa-building" /> Developers</h2>
          <p className="muted">Click a developer to see all their projects and set the logo shown on each project.</p>
        </div>
        <button className="adm-btn primary" onClick={() => setAdding(true)}><i className="fas fa-plus" /> Add developer</button>
      </div>

      {adding && <AddCard onCancel={() => setAdding(false)} onSaved={() => { setAdding(false); flash('Developer added'); load(); }} flash={flash} />}

      <div className="dvl-bar">
        <div className="viz-toggle" role="tablist" aria-label="View">
          <button role="tab" aria-selected={view === 'cards'} className={view === 'cards' ? 'on' : ''} onClick={() => setView('cards')}>
            <i className="fas fa-building" /> Developers <span className="dvl-count">{counts.all}</span>
          </button>
          <button role="tab" aria-selected={view === 'list'} className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>
            <i className="fas fa-list" /> All projects <span className="dvl-count">{totalProjects}</span>
          </button>
        </div>
        <label className="dvl-search"><i className="fas fa-magnifying-glass" aria-hidden="true" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search developer or project…" aria-label="Search developer or project" />
        </label>
        <select className="crm-select" value={filter} onChange={(e) => setFilter(e.target.value as Filter)} aria-label="Show">
          <option value="all">Show all</option>
          <option value="nologo">No logo yet ({counts.nologo})</option>
          <option value="mismatch">Logo missing on some projects ({counts.mismatch})</option>
        </select>
      </div>

      {!rows ? <div className="adm-empty"><i className="fas fa-spinner fa-spin" /><p>Loading developers…</p></div>
        : !shown.length ? <div className="adm-empty"><i className="fas fa-building" /><p>{rows.length ? 'Nothing matches your search.' : 'No developers yet — add one, or add a developer name to a pin in the Map Editor.'}</p></div>
          : view === 'list' ? (
            <div className="table-scroll dvl-table-wrap">
              <table className="adm-table dvl-table">
                <thead><tr><th>Project</th><th>Location</th><th>Status</th><th>Price</th><th>Logo</th></tr></thead>
                {shown.filter((d) => d.list?.length).map((d) => {
                  // Searching a project name shows just the matching projects of that developer.
                  const items = s && !d.name.toLowerCase().includes(s) ? d.list!.filter((p) => p.title.toLowerCase().includes(s)) : d.list!;
                  return (
                    <tbody key={d.id}>
                      <tr className="dvl-group" onClick={() => setOpen(d.id)}>
                        <th colSpan={5}>
                          <span className={`dvl-mini${d.logo ? '' : ' empty'}`}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            {d.logo ? <img src={thumb(d.logo)} alt="" loading="lazy" /> : <i className="fas fa-image" />}
                          </span>
                          {d.name} <span className="muted">· {d.projects} project{d.projects === 1 ? '' : 's'}</span>
                          <span className="dvl-open">Open <i className="fas fa-chevron-right" /></span>
                        </th>
                      </tr>
                      {items.map((p) => (
                        <tr key={p.id} className="dvl-row" onClick={() => setOpen(d.id)}>
                          <td><b>{projName(p)}</b>{p.hidden && <small className="muted"> · hidden</small>}</td>
                          <td>{p.location || '—'}</td>
                          <td>{statusLabel(p.status)}</td>
                          <td>{p.price || '—'}</td>
                          <td>{p.hasLogo ? <span className="dvl-ok"><i className="fas fa-circle-check" /> Yes</span> : <span className="dvl-warn">Different / none</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  );
                })}
              </table>
            </div>
          ) : (
            <ul className="dvl-grid">
              {shown.map((d) => (
                <li key={d.id}>
                  <button type="button" className="dvl-card" onClick={() => setOpen(d.id)} aria-label={`Open ${d.name}`}>
                    <span className={`dvl-logo${d.logo ? '' : ' empty'}`} aria-hidden="true">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {d.logo ? <img src={thumb(d.logo)} alt="" loading="lazy" /> : <i className="fas fa-image" />}
                    </span>
                    <span className="dvl-info">
                      <b className="dvl-name" title={d.name}>{d.name}</b>
                      <span className="muted dvl-sub">{d.projects ? `${d.projects} project${d.projects === 1 ? '' : 's'}` : 'No projects on the map yet'}</span>
                      <LogoStatus dev={d} />
                    </span>
                    <i className="fas fa-chevron-right dvl-go" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}

      {openDev && !editDev && (
        <DeveloperDrawer dev={openDev} flash={flash} onClose={() => setOpen(null)} onChanged={load} onEdit={() => setEditing(openDev.id)} />
      )}

      {editDev && (
        <EditDrawer dev={editDev} flash={flash}
          onClose={() => setEditing(null)} onDone={() => { setEditing(null); load(); }} />
      )}
    </div>
  );
}

/** One line saying how the developer's logo is doing: none / on some projects / on all. */
function LogoStatus({ dev }: { dev: Dev }) {
  if (!dev.logo) return <span className="dvl-warn"><i className="fas fa-circle-exclamation" /> No logo yet</span>;
  if (!dev.projects) return <span className="dvl-ok"><i className="fas fa-circle-check" /> Logo added</span>;
  if (dev.logoInUse >= dev.projects) return <span className="dvl-ok"><i className="fas fa-circle-check" /> Logo on all projects</span>;
  return <span className="dvl-warn"><i className="fas fa-circle-exclamation" /> Logo on {dev.logoInUse} of {dev.projects} projects</span>;
}

type DevProject = ProjectInfo & { image: string | null };

/**
 * One developer: their logo at the top with one button to use it on every
 * project, then the project list. Each project can get the developer logo or
 * its own uploaded logo; tick several to do it in one go.
 */
function DeveloperDrawer({ dev, flash, onClose, onChanged, onEdit }: { dev: Dev; flash: Flash; onClose: () => void; onChanged: () => void; onEdit: () => void }) {
  const [list, setList] = useState<DevProject[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  // Which projects an uploaded logo goes on (set just before the file picker opens).
  const uploadFor = useRef<string[]>([]);
  const fileIn = useRef<HTMLInputElement>(null);
  const load = () => call('GET', `?id=${dev.id}&projects=1`).then((r: DevProject[]) => setList(r)).catch((e) => { flash(e.message, true); setList([]); });
  useEffect(() => { load(); }, [dev.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const all = list || [];
  const missing = all.filter((p) => !p.hasLogo);
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allPicked = all.length > 0 && all.every((p) => picked.has(p.id));
  const label = (ids: string[]) => (ids.length === 1 ? `“${all.find((p) => p.id === ids[0])?.title || 'this project'}”` : `${ids.length} projects`);

  async function save(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    try { await fn(); flash(done); setPicked(new Set()); await load(); onChanged(); }
    catch (e) { flash(e instanceof Error ? e.message : 'Something went wrong', true); }
    finally { setBusy(false); }
  }
  /** The developer's logo on these projects. */
  function applyDevLogo(ids: string[]) {
    const todo = ids.filter((id) => missing.some((p) => p.id === id));
    if (!todo.length) { flash('Those projects already show the developer logo'); return; }
    if (todo.length > 1 && !window.confirm(`Use the ${dev.name} logo on ${todo.length} projects?`)) return;
    save(() => call('POST', `?id=${dev.id}&action=apply`, { pins: todo }), `${dev.name} logo added to ${label(todo)}`);
  }
  function pickUpload(ids: string[]) { uploadFor.current = ids; fileIn.current?.click(); }
  async function upload(file: File) {
    const ids = uploadFor.current;
    if (!ids.length) return;
    let logo: string;
    try { logo = await readLogo(file); } catch (e) { flash(e instanceof Error ? e.message : 'Could not read image', true); return; }
    save(() => call('POST', `?id=${dev.id}&action=setlogo`, { pins: ids, logo }), `New logo added to ${label(ids)}`);
  }

  return (
    <div className="crm-drawer-overlay" onClick={() => { if (!busy) onClose(); }}>
      <aside className="crm-drawer dvl-drawer dvl-dev" role="dialog" aria-modal="true" aria-label={dev.name} onClick={(e) => e.stopPropagation()}>
        <div className="dvl-dev-head">
          <div className={`dvl-logo big${dev.logo ? '' : ' empty'}`} aria-hidden="true">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {dev.logo ? <img src={thumb(dev.logo)} alt="" /> : <i className="fas fa-image" />}
          </div>
          <div className="dvl-dev-id">
            <h3>{dev.name}</h3>
            <span className="muted">{dev.projects} project{dev.projects === 1 ? '' : 's'} on the map</span>
            <button type="button" className="adm-btn ghost sm" onClick={onEdit} disabled={busy}><i className="fas fa-pen" /> {dev.logo ? 'Edit name / logo' : 'Add logo'}</button>
          </div>
          <button type="button" className="dvl-close" onClick={onClose} aria-label="Close"><i className="fas fa-xmark" /></button>
        </div>

        {/* Step 1: the developer logo on every project, in one click. */}
        {list && all.length > 0 && (
          !dev.logo ? (
            <div className="dvl-callout warn"><i className="fas fa-circle-exclamation" /><span>This developer has no logo yet. Click <b>Add logo</b> above — then you can put it on all projects in one click.</span></div>
          ) : missing.length ? (
            <div className="dvl-callout">
              <i className="fas fa-wand-magic-sparkles" />
              <span><b>{all.length - missing.length} of {all.length}</b> projects show the {dev.name} logo.</span>
              <button type="button" className="adm-btn primary sm" disabled={busy} onClick={() => applyDevLogo(missing.map((p) => p.id))}>Use on all {missing.length} others</button>
            </div>
          ) : (
            <div className="dvl-callout ok"><i className="fas fa-circle-check" /><span>All projects show the {dev.name} logo.</span></div>
          )
        )}

        {/* Step 2: the project list — change the logo of any single project. */}
        <div className="dvl-list-head">
          <label className="dvl-pj-all">
            <input type="checkbox" disabled={!all.length || busy} checked={allPicked} onChange={(e) => setPicked(e.target.checked ? new Set(all.map((p) => p.id)) : new Set())} />
            Projects
          </label>
          <span className="muted">Tick projects to change several at once</span>
        </div>

        {!list ? <p className="muted"><i className="fas fa-spinner fa-spin" /> Loading projects…</p>
          : !all.length ? <p className="muted">No projects on the map use this developer name yet.</p>
            : (
              <ul className="dvl-pj-list">
                {all.map((p) => (
                  <li key={p.id} className={picked.has(p.id) ? 'on' : ''}>
                    <input type="checkbox" disabled={busy} checked={picked.has(p.id)} onChange={() => toggle(p.id)} aria-label={`Select ${p.title}`} />
                    <span className={`dvl-pj-img${p.image ? '' : ' empty'}`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {p.image ? <img src={p.image} alt="" loading="lazy" /> : <i className="fas fa-image" />}
                    </span>
                    <span className="dvl-pj-name">
                      <b>{projName(p)}</b>
                      <small className="muted">{[p.location, statusLabel(p.status), p.price].filter((x) => x && x !== '—').join(' · ') || '—'}</small>
                      <small className={p.hasLogo ? 'dvl-ok' : 'dvl-warn'}>{p.hasLogo ? 'Developer logo' : p.image ? 'Own logo' : 'No logo'}</small>
                    </span>
                    <span className="dvl-pj-acts">
                      {dev.logo && !p.hasLogo && (
                        <button type="button" className="adm-btn ghost sm" disabled={busy} onClick={() => applyDevLogo([p.id])} title={`Use the ${dev.name} logo`}>Use developer logo</button>
                      )}
                      <button type="button" className="adm-btn ghost sm" disabled={busy} onClick={() => pickUpload([p.id])} title="Upload a different logo for this project"><i className="fas fa-upload" /> Upload</button>
                      <a className="dvl-icon" href={`/map?pin=${encodeURIComponent(p.id)}`} target="_blank" rel="noopener" title="View on map" aria-label={`View ${p.title} on map`}><i className="fas fa-map-location-dot" /></a>
                    </span>
                  </li>
                ))}
              </ul>
            )}

        {picked.size > 0 && (
          <div className="dvl-selbar">
            <b>{picked.size} selected</b>
            {dev.logo && <button type="button" className="adm-btn primary sm" disabled={busy} onClick={() => applyDevLogo([...picked])}>Use developer logo</button>}
            <button type="button" className="adm-btn ghost sm" disabled={busy} onClick={() => pickUpload([...picked])}><i className="fas fa-upload" /> Upload one logo</button>
            <button type="button" className="adm-btn ghost sm" disabled={busy} onClick={() => setPicked(new Set())}>Clear</button>
          </div>
        )}
        <p className="muted dvl-foot"><i className="fas fa-clock-rotate-left" /> Old logos stay in each project&apos;s history (Backups), so any change can be undone.</p>

        <input ref={fileIn} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" hidden
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload(f); }} />
      </aside>
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
