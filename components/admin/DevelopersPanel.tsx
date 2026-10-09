'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

// Super admin → Developers: the developer directory, ONE logo per developer
// (lib/developers.ts). In the Map Editor, typing a developer's name suggests it
// from here and picking it puts this logo on the project automatically.
// Filled from the developers already on the map the first time it opens.

interface ProjectInfo {
  id: string; title: string; number: number | null; hasLogo: boolean;
  location: string; status: string; type: string; configuration: string; price: string; possession: string; hidden: boolean;
  image: string | null;
}
const FIRST = 4; // project names listed on a developer card before "+ n more"
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
  // A project to show straight away when the developer panel opens.
  const [openProject, setOpenProject] = useState<string | null>(null);
  const openDevAt = (devId: string, projectId: string | null = null) => { setOpenProject(projectId); setOpen(devId); };

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
  // Duplicate groups the admin said are different companies (remembered on this device).
  const [notDupes, setNotDupes] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem(NOT_DUPES_KEY) || '[]'); } catch { return []; } });
  const dupes = useMemo(() => likelyDuplicates(rows || []).filter((g) => !notDupes.includes(groupKey(g))), [rows, notDupes]);
  const [merging, setMerging] = useState<Dev[] | null>(null);
  const ignoreDupe = (g: Dev[]) => {
    const next = [...notDupes, groupKey(g)];
    setNotDupes(next);
    try { localStorage.setItem(NOT_DUPES_KEY, JSON.stringify(next)); } catch { /* private mode */ }
  };
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

      {rows && rows.length > 0 && (
        <div className="dvl-stats">
          <button type="button" className={`dvl-stat${filter === 'all' ? ' on' : ''}`} onClick={() => setFilter('all')}>
            <i className="fas fa-building" /><b>{counts.all}</b><span>Developers</span>
          </button>
          <div className="dvl-stat static">
            <i className="fas fa-map-pin" /><b>{totalProjects}</b><span>Projects on the map</span>
          </div>
          <button type="button" className={`dvl-stat warn${filter === 'nologo' ? ' on' : ''}`} onClick={() => setFilter('nologo')} disabled={!counts.nologo}>
            <i className="fas fa-image" /><b>{counts.nologo}</b><span>Need a logo</span>
          </button>
          <button type="button" className={`dvl-stat warn${filter === 'mismatch' ? ' on' : ''}`} onClick={() => setFilter('mismatch')} disabled={!counts.mismatch}>
            <i className="fas fa-circle-exclamation" /><b>{counts.mismatch}</b><span>Logo missing on some projects</span>
          </button>
        </div>
      )}

      {dupes.length > 0 && (
        <section className="dvl-dupes">
          <header>
            <i className="fas fa-clone" />
            <div>
              <b>Possible duplicate developers ({dupes.length})</b>
              <span className="muted">These names look like the same company. Merge them so all projects sit under one developer.</span>
            </div>
          </header>
          <ul>
            {dupes.map((g) => (
              <li key={groupKey(g)}>
                <div className="dvl-dupe-names">
                  {g.map((d, j) => (
                    <span key={d.id} className="dvl-dupe-dev">
                      {j > 0 && <i className="fas fa-arrows-left-right dvl-dupe-sep" aria-hidden="true" />}
                      <span className={`dvl-mini-logo${d.logo ? '' : ' empty'}`} aria-hidden="true">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {d.logo ? <img src={thumb(d.logo)} alt="" /> : <i className="fas fa-image" />}
                      </span>
                      <span><b>{d.name}</b><small className="muted">{d.projects} project{d.projects === 1 ? '' : 's'}</small></span>
                    </span>
                  ))}
                </div>
                <div className="dvl-dupe-acts">
                  <button type="button" className="adm-btn primary sm" onClick={() => setMerging(g)}><i className="fas fa-code-merge" /> Review &amp; merge</button>
                  <button type="button" className="adm-btn ghost sm" onClick={() => ignoreDupe(g)} title="Hide this suggestion">Not a duplicate</button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="dvl-bar dvl-tools">
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
          : (
            <ul className="dvl-cards">
              {shown.map((d) => {
                // Searching a project name lists the matching projects first.
                const all = d.list || [];
                const items = s && !d.name.toLowerCase().includes(s) ? all.filter((p) => p.title.toLowerCase().includes(s)) : all;
                const st = logoState(d);
                return (
                  <li key={d.id} className={`dvl-dcard s-${st}`}>
                    <div className="dvl-dcard-top">
                      <span className={`dvl-logo${d.logo ? '' : ' empty'}`} aria-hidden="true">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {d.logo ? <img src={thumb(d.logo)} alt="" loading="lazy" /> : <i className="fas fa-image" />}
                      </span>
                      <div className="dvl-dcard-id">
                        <b title={d.name}>{d.name}</b>
                        <span className="muted">{d.projects ? `${d.projects} project${d.projects === 1 ? '' : 's'}` : 'No projects yet'}</span>
                      </div>
                    </div>

                    <span className={`dvl-chip s-${st}`}>
                      <i className={`fas ${st === 'ok' ? 'fa-circle-check' : 'fa-circle-exclamation'}`} />
                      {st === 'none' ? 'No logo yet' : st === 'some' ? `Logo on ${d.logoInUse} of ${d.projects}` : d.projects ? 'Logo on all projects' : 'Logo added'}
                    </span>

                    {items.length > 0 ? (
                      <ul className="dvl-dcard-list">
                        {items.slice(0, FIRST).map((p) => (
                          <li key={p.id}>
                            <button type="button" onClick={() => openDevAt(d.id, p.id)} title={`${projName(p)}${p.location ? ` — ${p.location}` : ''} · click for details`}>
                              <i className={`fas ${p.hasLogo ? 'fa-circle-check ok' : 'fa-circle-exclamation warn'}`} aria-label={p.hasLogo ? 'Developer logo' : 'Different or no logo'} />
                              <span>{projName(p)}</span>
                            </button>
                          </li>
                        ))}
                        {items.length > FIRST && <li className="more"><button type="button" onClick={() => openDevAt(d.id)}>+ {items.length - FIRST} more</button></li>}
                      </ul>
                    ) : <p className="muted dvl-dcard-empty">No projects on the map use this name yet.</p>}

                    <button type="button" className="adm-btn sm dvl-dcard-btn" onClick={() => openDevAt(d.id)}>
                      View projects &amp; logos <i className="fas fa-arrow-right" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

      {openDev && !editDev && (
        <DeveloperDrawer dev={openDev} initialProject={openProject} flash={flash} onClose={() => { setOpen(null); setOpenProject(null); }} onChanged={load} onEdit={() => setEditing(openDev.id)} />
      )}

      {merging && (
        <MergeDialog group={merging} flash={flash} onClose={() => setMerging(null)} onDone={() => { setMerging(null); load(); }} />
      )}

      {editDev && (
        <EditDrawer dev={editDev} others={mergeTargets(editDev, rows || [])} flash={flash}
          onClose={() => setEditing(null)} onDone={() => { setEditing(null); load(); }} />
      )}
    </div>
  );
}

// Words too common to say two developers are the same company.
const COMMON = new Set(['the', 'shree', 'shri', 'sri', 'sai', 'new', 'pune', 'mumbai', 'group', 'developers', 'developer', 'properties', 'property', 'realty', 'builders', 'builder', 'buildcon', 'constructions', 'construction', 'infra', 'homes', 'estates', 'and', 'pvt', 'ltd', 'llp']);
const nameKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const firstWord = (s: string) => nameKey(s).split(' ').find((w) => w.length >= 3 && !COMMON.has(w)) || '';
/** Developers whose names look like the same company (same main word, e.g. “Lodha” and “Lodha Group”). */
function likelyDuplicates(rows: Dev[]): Dev[][] {
  const groups = new Map<string, Dev[]>();
  for (const r of rows) { const k = firstWord(r.name); if (k) groups.set(k, [...(groups.get(k) || []), r]); }
  return [...groups.values()].filter((g) => g.length > 1);
}
const NOT_DUPES_KEY = 'mg_dev_not_dupes';
const groupKey = (g: Dev[]) => g.map((d) => d.id).sort().join('|');

/** Other developers to merge into, likely duplicates first. */
const mergeTargets = (dev: Dev, rows: Dev[]) => {
  const k = firstWord(dev.name);
  return rows.filter((r) => r.id !== dev.id).sort((a, b) => Number(!!k && firstWord(b.name) === k) - Number(!!k && firstWord(a.name) === k) || b.projects - a.projects || a.name.localeCompare(b.name));
};

/** 'none' (no logo), 'some' (not on every project) or 'ok'. */
const logoState = (d: Dev) => (!d.logo ? 'none' : d.projects && d.logoInUse < d.projects ? 'some' : 'ok');

/** One project's information, inside the developer panel. */
function ProjectDetail({ p, dev, busy, onBack, onUseDevLogo, onUpload }: { p: DevProject; dev: Dev; busy: boolean; onBack: () => void; onUseDevLogo: () => void; onUpload: () => void }) {
  const d = p.details;
  const rows: [string, string][] = ([
    ['Developer', dev.name],
    ['Location', p.location],
    ['Status', p.status ? statusLabel(p.status) : ''],
    ['Property type', p.type],
    ['Configuration', p.configuration],
    ['Size', d?.sqft ? `${d.sqft} sq.ft` : ''],
    ['Price', p.price],
    ['Possession', p.possession],
    ['Launch', d?.launch || ''],
    ['RERA no.', d?.rera || ''],
  ] as [string, string][]).filter(([, v]) => v);
  return (
    <div className="dvl-detail">
      <button type="button" className="dvl-back" onClick={onBack}><i className="fas fa-arrow-left" /> All projects</button>
      <div className="dvl-detail-head">
        <span className={`dvl-detail-img${p.image ? '' : ' empty'}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {p.image ? <img src={p.image} alt="" /> : <i className="fas fa-image" />}
        </span>
        <div>
          <h3>{p.title}</h3>
          <span className="muted">{p.number != null ? `Project #${p.number}` : 'Project'}{p.hidden ? ' · hidden on the map' : ''}</span>
          {p.hasLogo
            ? <span className="dvl-chip s-ok"><i className="fas fa-circle-check" /> Shows the developer logo</span>
            : <span className="dvl-chip s-some"><i className="fas fa-circle-exclamation" /> {p.image ? 'Shows its own logo' : 'No logo'}</span>}
        </div>
      </div>

      <dl className="dvl-facts">
        {rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
      </dl>
      {d?.about && <p className="dvl-about">{d.about}</p>}

      <div className="dvl-detail-acts">
        {dev.logo && !p.hasLogo && <button type="button" className="adm-btn primary sm" disabled={busy} onClick={onUseDevLogo}><i className="fas fa-wand-magic-sparkles" /> Use developer logo</button>}
        <button type="button" className="adm-btn ghost sm" disabled={busy} onClick={onUpload}><i className="fas fa-upload" /> Upload a different logo</button>
        <a className="adm-btn ghost sm" href={`/map?pin=${encodeURIComponent(p.id)}`} target="_blank" rel="noopener"><i className="fas fa-map-location-dot" /> View on map</a>
        {d?.page && <a className="adm-btn ghost sm" href={d.page} target="_blank" rel="noopener"><i className="fas fa-arrow-up-right-from-square" /> Project page</a>}
      </div>
      <p className="muted dvl-foot">To change other details (price, status, possession…), edit this project in the Map Editor.</p>
    </div>
  );
}

type DevProject = ProjectInfo & { details?: { sqft: string; launch: string; rera: string; about: string; page: string | null } };

/**
 * One developer: their logo at the top with one button to use it on every
 * project, then the project list. Each project can get the developer logo or
 * its own uploaded logo; tick several to do it in one go.
 */
function DeveloperDrawer({ dev, initialProject, flash, onClose, onChanged, onEdit }: { dev: Dev; initialProject?: string | null; flash: Flash; onClose: () => void; onChanged: () => void; onEdit: () => void }) {
  const [list, setList] = useState<DevProject[] | null>(null);
  // The project whose details are shown (null = the project list).
  const [detail, setDetail] = useState<string | null>(initialProject || null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  // Which projects an uploaded logo goes on (set just before the file picker opens).
  const uploadFor = useRef<string[]>([]);
  const fileIn = useRef<HTMLInputElement>(null);
  const load = () => call('GET', `?id=${dev.id}&projects=1`).then((r: DevProject[]) => setList(r)).catch((e) => { flash(e.message, true); setList([]); });
  useEffect(() => { load(); }, [dev.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) { if (detail) setDetail(null); else onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose, detail]);

  const all = list || [];
  const shownProject = detail ? all.find((p) => p.id === detail) : undefined;
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

        {shownProject ? (
          <ProjectDetail p={shownProject} dev={dev} busy={busy} onBack={() => setDetail(null)}
            onUseDevLogo={() => applyDevLogo([shownProject.id])} onUpload={() => pickUpload([shownProject.id])} />
        ) : detail && !list ? (
          <p className="muted"><i className="fas fa-spinner fa-spin" /> Loading project…</p>
        ) : (<>
        <h4 className="dvl-step"><span>1</span> Developer logo</h4>
        {/* Step 1: the developer logo on every project, in one click. */}
        {list && !all.length && !dev.logo && (
          <div className="dvl-callout warn"><i className="fas fa-circle-exclamation" /><span>No logo yet. Click <b>Add logo</b> above.</span></div>
        )}
        {list && all.length > 0 && (
          !dev.logo ? (
            <div className="dvl-callout warn"><i className="fas fa-circle-exclamation" /><span>This developer has no logo yet. Click <b>Add logo</b> above — then you can put it on all projects in one click.</span></div>
          ) : missing.length ? (
            <div className="dvl-callout">
              <i className="fas fa-wand-magic-sparkles" />
              <span><b>{all.length - missing.length} of {all.length}</b> projects show the {dev.name} logo.</span>
              <button type="button" className="adm-btn primary sm" disabled={busy} onClick={() => applyDevLogo(missing.map((p) => p.id))}>{missing.length === 1 ? 'Use on the other 1' : `Use on all ${missing.length} others`}</button>
            </div>
          ) : (
            <div className="dvl-callout ok"><i className="fas fa-circle-check" /><span>All projects show the {dev.name} logo.</span></div>
          )
        )}

        {/* Step 2: the project list — change the logo of any single project. */}
        <h4 className="dvl-step"><span>2</span> Projects ({all.length}) <small className="muted">— change the logo of one project, or tick several</small></h4>
        <div className="dvl-list-head">
          <label className="dvl-pj-all">
            <input type="checkbox" disabled={!all.length || busy} checked={allPicked} onChange={(e) => setPicked(e.target.checked ? new Set(all.map((p) => p.id)) : new Set())} />
            Select all
          </label>
          <span className="muted">{missing.length ? `${missing.length} without the developer logo` : 'All show the developer logo'}</span>
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
                    <button type="button" className="dvl-pj-name dvl-pj-open" onClick={() => setDetail(p.id)} title="See project details">
                      <b>{projName(p)} <i className="fas fa-chevron-right" /></b>
                      <small className="muted">{[p.location, statusLabel(p.status)].filter((x) => x && x !== '—').join(' · ') || '—'}</small>
                      {p.hasLogo
                        ? <small className="dvl-ok"><i className="fas fa-circle-check" /> Developer logo</small>
                        : <span className={`dvl-pill ${p.image ? 'own' : 'none'}`}>{p.image ? 'Own logo' : 'No logo'}</span>}
                    </button>
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

        </>)}

        {!shownProject && picked.size > 0 && (
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

/** Merge a group of look-alike developers: pick the one to keep, the others move into it. */
function MergeDialog({ group, flash, onClose, onDone }: { group: Dev[]; flash: Flash; onClose: () => void; onDone: () => void }) {
  // Keep the one with the most projects by default (then the one with a logo).
  const best = [...group].sort((a, b) => b.projects - a.projects || Number(!!b.logo) - Number(!!a.logo))[0];
  const [keep, setKeep] = useState(best.id);
  const [busy, setBusy] = useState(false);
  const kept = group.find((d) => d.id === keep)!;
  const others = group.filter((d) => d.id !== keep);
  const moving = others.reduce((n, d) => n + d.projects, 0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  async function merge() {
    setBusy(true);
    try {
      let moved = 0;
      for (const d of others) moved += (await call('POST', `?id=${d.id}&action=merge`, { into: keep }))?.moved || 0;
      flash(`Merged into ${kept.name} — ${moved} project${moved === 1 ? '' : 's'} moved`);
      onDone();
    } catch (e) { flash(e instanceof Error ? e.message : 'Could not merge', true); setBusy(false); }
  }

  return (
    <div className="crm-drawer-overlay dvl-modal-wrap" onClick={() => { if (!busy) onClose(); }}>
      <div className="dvl-modal" role="dialog" aria-modal="true" aria-label="Merge duplicate developers" onClick={(e) => e.stopPropagation()}>
        <div className="crm-drawer-head">
          <h3><i className="fas fa-code-merge" /> Merge duplicates</h3>
          <button type="button" className="dvl-close" onClick={onClose} disabled={busy} aria-label="Close"><i className="fas fa-xmark" /></button>
        </div>
        <p className="dvl-modal-q">Which one should stay?</p>
        <div className="dvl-keep" role="radiogroup" aria-label="Developer to keep">
          {group.map((d) => (
            <button key={d.id} type="button" role="radio" aria-checked={keep === d.id} className={`dvl-keep-opt${keep === d.id ? ' on' : ''}`} onClick={() => setKeep(d.id)} disabled={busy}>
              <span className="dvl-keep-radio" aria-hidden="true" />
              <span className={`dvl-mini-logo big${d.logo ? '' : ' empty'}`} aria-hidden="true">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {d.logo ? <img src={thumb(d.logo)} alt="" /> : <i className="fas fa-image" />}
              </span>
              <span className="dvl-keep-txt">
                <b>{d.name}</b>
                <small className="muted">{d.projects} project{d.projects === 1 ? '' : 's'} · {d.logo ? 'has a logo' : 'no logo'}</small>
              </span>
              {keep === d.id && <span className="dvl-keep-tag">Keep</span>}
            </button>
          ))}
        </div>
        <div className="dvl-summary">
          <b>What happens</b>
          <ul>
            <li><i className="fas fa-arrow-right" /><span>{moving} project{moving === 1 ? '' : 's'} from {others.map((o) => `“${o.name}”`).join(' and ')} move to <b>“{kept.name}”</b>.</span></li>
            <li><i className="fas fa-image" /><span>{kept.logo ? `They show the “${kept.name}” logo` : others.some((o) => o.logo) ? 'The logo of the merged developer is kept' : 'No logo yet — add one after merging'} (projects with their own logo keep it).</span></li>
            <li><i className="fas fa-trash" /><span>{others.map((o) => `“${o.name}”`).join(' and ')} {others.length === 1 ? 'is' : 'are'} removed from the list.</span></li>
            <li><i className="fas fa-clock-rotate-left" /><span>Old project data stays in Backups, so this can be undone.</span></li>
          </ul>
        </div>
        <div className="dvl-form-actions">
          <button type="button" className="adm-btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="adm-btn primary" onClick={merge} disabled={busy}>
            {busy ? <><i className="fas fa-spinner fa-spin" /> Merging…</> : <>Merge into “{kept.name}”</>}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Edit one developer: name, logo (change / remove) and — at the bottom — delete. */
function EditDrawer({ dev, others, flash, onClose, onDone }: { dev: Dev; others: Dev[]; flash: Flash; onClose: () => void; onDone: () => void }) {
  const [into, setInto] = useState('');
  async function merge() {
    const target = others.find((o) => o.id === into);
    if (!target) return;
    if (!window.confirm(`Merge “${dev.name}” into “${target.name}”?\n\n• Its ${dev.projects} project${dev.projects === 1 ? '' : 's'} move to “${target.name}”.\n• Projects showing the “${dev.name}” logo get the “${target.name}” logo; projects with their own logo keep it.\n• “${dev.name}” is removed from the list.\n\nOld project data stays in Backups.`)) return;
    setBusy(true);
    try {
      const r = await call('POST', `?id=${dev.id}&action=merge`, { into });
      flash(`Merged into ${target.name} — ${r?.moved ?? 0} project${r?.moved === 1 ? '' : 's'} moved`);
      onDone();
    } catch (err) { flash(err instanceof Error ? err.message : 'Could not merge', true); setBusy(false); }
  }
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
    // A developer whose name is still on map projects is added back from them — merge is the real fix.
    if (dev.projects > 0) {
      window.alert(`“${dev.name}” still has ${dev.projects} project${dev.projects === 1 ? '' : 's'} on the map, so it would come straight back.

If it is a duplicate, use “Merge into another developer” above instead.`);
      return;
    }
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
        {others.length > 0 && (
          <div className="dvl-merge">
            <div><b><i className="fas fa-code-merge" /> Merge into another developer</b>
              <span className="muted">Created this developer twice? Move all its projects into the right one and remove this duplicate.</span></div>
            <div className="dvl-merge-row">
              <select className="crm-select" value={into} onChange={(e) => setInto(e.target.value)} disabled={busy} aria-label="Developer to keep">
                <option value="">Choose the developer to keep…</option>
                {others.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.projects} project{o.projects === 1 ? '' : 's'})</option>)}
              </select>
              <button type="button" className="adm-btn primary sm" disabled={busy || !into} onClick={merge}>Merge</button>
            </div>
          </div>
        )}
        <div className="dvl-danger">
          <div><b>Delete developer</b><span className="muted">{dev.projects ? 'Only for developers with no projects — for a duplicate, use Merge above.' : 'Removes it from this list.'}</span></div>
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
