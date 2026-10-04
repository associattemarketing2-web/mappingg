'use client';

import { useEffect, useRef, useState } from 'react';

// A developer's own projects intake — the same tabbed layout the super-admin
// intake uses (stat tiles, a filterable projects table, an add form and a bulk
// Excel/CSV upload), but every row is scoped to this account (the server enforces
// it via owner_user_id). New or edited projects go to the admin review queue and
// appear on the public map only once approved — a developer can never approve,
// publish, or see anyone else's projects here.
interface MyProject {
  id: string;
  number: number | null;
  title: string;
  location: string;
  status: string;
  type: string;
  price: string;
  configuration: string;
  description: string;
  lat: number | null;
  lng: number | null;
  review: 'pending' | 'rejected' | 'live';
  created_at: string;
  /** Why the super admin didn't approve it (shown to the developer). */
  review_note?: string;
}

const STATUSES = [
  { v: 'upcoming', l: 'Upcoming' },
  { v: 'under_construction', l: 'Under construction' },
  { v: 'available', l: 'Available' },
  { v: 'sold', l: 'Sold' },
];
const TYPES = ['Residential', 'Commercial', 'Mixed-Use', 'Land Parcel'];

const REVIEW_BADGE: Record<MyProject['review'], { label: string; bg: string; fg: string }> = {
  pending: { label: 'Pending review', bg: '#fff4e5', fg: '#9a5b00' },
  live: { label: 'Live on map', bg: '#e6f6ee', fg: '#0f7a4a' },
  rejected: { label: 'Not approved', bg: '#fdecec', fg: '#b42318' },
};

const EMPTY = { title: '', location: '', type: 'Residential', status: 'upcoming', price: '', configuration: '', description: '', lat: '', lng: '' };

// Same Excel template builders fill for the super-admin intake, so a developer
// can reuse any file prepared for Mappingg.
const TEMPLATE_URL = '/partners/templates/Mappingg_Project_Upload_Template.xlsx';

/* ------------------------- Bulk upload: parsing --------------------------- */
// Load SheetJS on demand from the same CDN the partners intake uses.
let xlsxPromise: Promise<any> | null = null;
function loadXlsx(): Promise<any> {
  if (typeof window !== 'undefined' && (window as any).XLSX) return Promise.resolve((window as any).XLSX);
  if (!xlsxPromise) {
    xlsxPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
      s.onload = () => resolve((window as any).XLSX);
      s.onerror = () => reject(new Error('reader failed'));
      document.head.appendChild(s);
    });
  }
  return xlsxPromise;
}

const normH = (s: unknown) => String(s ?? '').toLowerCase().replace(/\*/g, '').replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

// Which developer field each spreadsheet column feeds. Matches the headers in
// the Mappingg template plus common variants builders use.
const COL_ALIASES: Record<string, string[]> = {
  title: ['project name', 'project', 'name', 'title', 'project title'],
  location: ['locality area', 'locality', 'area', 'location', 'micro market', 'neighbourhood', 'neighborhood', 'town', 'city', 'full address', 'address'],
  type: ['project type', 'type', 'property type'],
  cstatus: ['construction status', 'status', 'project status'],
  sstatus: ['sales status', 'availability', 'inventory status'],
  price: ['price', 'price budget', 'budget', 'price range'],
  price_min: ['price min', 'min price', 'starting price', 'price from'],
  price_max: ['price max', 'max price', 'price to', 'upto price'],
  price_unit: ['price unit', 'unit'],
  configuration: ['configuration', 'configurations', 'bhk', 'unit types', 'typology'],
  description: ['key usps', 'key usp', 'usp', 'usps', 'highlights', 'short description', 'description', 'remarks', 'notes', 'comments'],
  lat: ['latitude', 'lat'],
  lng: ['longitude', 'lng', 'long', 'lon'],
  maps: ['google maps link', 'map link', 'google map link', 'maps link', 'location link', 'google location'],
};

function targetFor(header: unknown): string | null {
  const n = normH(header);
  if (!n) return null;
  for (const [key, aliases] of Object.entries(COL_ALIASES)) if (aliases.includes(n)) return key;
  return null;
}

function mapType(raw: unknown): string {
  const n = normH(raw);
  if (!n) return 'Residential';
  if (/(^|\b)(resi|residential)\b/.test(n)) return 'Residential';
  if (/(commercial|office|retail|shop)/.test(n)) return 'Commercial';
  if (/mixed/.test(n)) return 'Mixed-Use';
  if (/(land|plot|plotted)/.test(n)) return 'Land Parcel';
  return String(raw).trim().slice(0, 60);
}

function mapStatus(cs: unknown, ss: unknown): 'upcoming' | 'under_construction' | 'available' | 'sold' {
  const c = normH(cs), s = normH(ss);
  if (/sold/.test(s) || /sold/.test(c)) return 'sold';
  if (/under construction|(^|\b)uc\b/.test(c)) return 'under_construction';
  if (/ready to move|(^|\b)rtm\b|ready/.test(c)) return 'available';
  if (/available|few/.test(s)) return 'available';
  return 'upcoming';
}

function buildPrice(row: Record<string, unknown>): string {
  if (row.price != null && String(row.price).trim()) return String(row.price).trim().slice(0, 80);
  const min = row.price_min, max = row.price_max, unit = row.price_unit;
  if (min == null || String(min).trim() === '') return '';
  const u = unit != null && String(unit).trim() ? ` ${String(unit).trim()}` : '';
  let out = `${String(min).trim()}${u}`;
  if (max != null && String(max).trim() !== '') out += ` – ${String(max).trim()}${u}`;
  return out.slice(0, 80);
}

function parseLatLng(url: unknown): { lat: number; lng: number } | null {
  if (!url) return null;
  const s = String(url);
  const m = s.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) ||
    s.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) ||
    s.match(/[?&]q=(-?\d+\.\d+),\s*(-?\d+\.\d+)/) ||
    s.match(/(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
  if (!m) return null;
  const lat = +m[1], lng = +m[2];
  if (Number.isNaN(lat) || Number.isNaN(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

type DevProjectInput = {
  title: string; location: string; type: string; status: string;
  price: string; configuration: string; description: string; lat?: number; lng?: number;
};

// Turn a sheet (array-of-arrays) into clean, review-ready project rows.
function sheetToProjects(aoa: unknown[][]): { rows: DevProjectInput[]; skipped: number } {
  // Header row = first of the first 10 rows that maps at least 2 known columns.
  let hi = aoa.slice(0, 10).findIndex((r) => (r || []).filter((c) => targetFor(c)).length >= 2);
  if (hi < 0) hi = 0;
  const headers = (aoa[hi] || []).map((h) => targetFor(h));
  const dataRows = aoa.slice(hi + 1).filter((r) => (r || []).some((c) => c !== null && c !== undefined && String(c).trim() !== ''));

  const rows: DevProjectInput[] = [];
  let skipped = 0;
  for (const cells of dataRows) {
    const byKey: Record<string, unknown> = {};
    headers.forEach((key, i) => { if (key && byKey[key] === undefined) byKey[key] = cells[i]; });

    const title = String(byKey.title ?? '').trim().slice(0, 160);
    if (title.length < 2) { skipped++; continue; } // no name → nothing to review

    let lat: number | undefined;
    let lng: number | undefined;
    const rLat = Number(byKey.lat), rLng = Number(byKey.lng);
    if (byKey.lat != null && byKey.lng != null && !Number.isNaN(rLat) && !Number.isNaN(rLng) && Math.abs(rLat) <= 90 && Math.abs(rLng) <= 180) {
      lat = rLat; lng = rLng;
    } else {
      const p = parseLatLng(byKey.maps);
      if (p) { lat = p.lat; lng = p.lng; }
    }

    rows.push({
      title,
      location: String(byKey.location ?? '').trim().slice(0, 160),
      type: mapType(byKey.type),
      status: mapStatus(byKey.cstatus, byKey.sstatus),
      price: buildPrice(byKey),
      configuration: Array.isArray(byKey.configuration) ? byKey.configuration.join(', ').slice(0, 120) : String(byKey.configuration ?? '').trim().slice(0, 120),
      description: String(byKey.description ?? '').trim().slice(0, 4000),
      ...(lat != null ? { lat } : {}), ...(lng != null ? { lng } : {}),
    });
  }
  return { rows, skipped };
}

/* -------------------------------- Component ------------------------------- */
const FILTERS = [
  { key: 'review', label: 'To review' },
  { key: 'live', label: 'Live on map' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'all', label: 'All' },
] as const;
type FilterKey = (typeof FILTERS)[number]['key'];

const fmtWhen = (d?: string) => {
  if (!d) return '—';
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

export default function DeveloperProjects() {
  const [items, setItems] = useState<MyProject[] | null>(null);
  const [view, setView] = useState<'list' | 'form' | 'bulk'>('list');
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [q, setQ] = useState('');

  // Bulk upload state
  const [parsing, setParsing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [parsed, setParsed] = useState<{ name: string; rows: DevProjectInput[]; skipped: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    try {
      const r = await fetch('/api/my/projects', { credentials: 'same-origin' });
      const b = await r.json();
      setItems(Array.isArray(b.data) ? b.data : []);
    } catch { setItems([]); }
  }
  useEffect(() => { load(); }, []);

  function startAdd() {
    setEditId(null); setForm({ ...EMPTY }); setMsg(null); setView('form');
  }
  function startEdit(p: MyProject) {
    setEditId(p.id);
    setForm({
      title: p.title, location: p.location, type: p.type || 'Residential', status: p.status || 'upcoming',
      price: p.price, configuration: p.configuration, description: p.description,
      lat: p.lat != null ? String(p.lat) : '', lng: p.lng != null ? String(p.lng) : '',
    });
    setMsg(null); setView('form');
  }
  function startBulk() {
    setMsg(null); setParsed(null); setView('bulk');
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) { setMsg({ ok: false, text: 'Please enter a project name.' }); return; }
    setBusy(true); setMsg(null);
    const payload: Record<string, unknown> = {
      title: form.title, location: form.location, type: form.type, status: form.status,
      price: form.price, configuration: form.configuration, description: form.description,
    };
    if (form.lat && !Number.isNaN(+form.lat)) payload.lat = +form.lat;
    if (form.lng && !Number.isNaN(+form.lng)) payload.lng = +form.lng;
    if (editId) payload.id = editId;
    try {
      const r = await fetch('/api/my/projects', {
        method: editId ? 'PATCH' : 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const b = await r.json();
      if (!r.ok) { setMsg({ ok: false, text: b?.error?.message || 'Could not save the project.' }); }
      else {
        const num = b?.data?.number;
        setMsg({ ok: true, text: editId
          ? 'Saved! Your changes go back to our team for review before they appear on the map.'
          : `Submitted as project #${num ?? '—'}! Our team will review it and publish it to the map shortly.` });
        setForm({ ...EMPTY }); setEditId(null); setView('list'); load();
      }
    } catch { setMsg({ ok: false, text: 'Network error. Please try again.' }); }
    finally { setBusy(false); }
  }

  async function remove(p: MyProject) {
    if (!confirm(`Delete "${p.title}"? This can't be undone.`)) return;
    try {
      const r = await fetch(`/api/my/projects?id=${encodeURIComponent(p.id)}`, { method: 'DELETE', credentials: 'same-origin' });
      if (!r.ok) throw new Error();
      setMsg({ ok: true, text: 'Project deleted.' });
      load();
    } catch { setMsg({ ok: false, text: 'Could not delete the project.' }); }
  }

  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    setParsing(true); setMsg(null); setParsed(null);
    try {
      const XLSX = await loadXlsx();
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', cellDates: true });
      const sheetName = wb.SheetNames.find((n: string) => /^projects?$/i.test(n.trim())) || wb.SheetNames[0];
      const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: true, defval: null, blankrows: false }) as unknown[][];
      const { rows, skipped } = sheetToProjects(aoa);
      if (!rows.length) {
        setMsg({ ok: false, text: 'No projects found. Make sure the file has a "Project Name" column with rows under it.' });
      } else {
        setParsed({ name: file.name, rows, skipped });
      }
    } catch {
      setMsg({ ok: false, text: 'Could not read this file. Use the Excel template, or a .xlsx / .csv file (check your connection too).' });
    } finally { setParsing(false); }
  }

  async function submitBulk() {
    if (!parsed || !parsed.rows.length) return;
    setUploading(true); setMsg(null);
    try {
      const r = await fetch('/api/my/projects', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projects: parsed.rows }),
      });
      const b = await r.json();
      if (!r.ok) { setMsg({ ok: false, text: b?.error?.message || 'Could not upload the projects.' }); }
      else {
        const n = b?.data?.inserted ?? parsed.rows.length;
        setMsg({ ok: true, text: `Uploaded ${n} project${n === 1 ? '' : 's'}! Our team will review them before they appear on the map.` });
        setParsed(null); setView('list'); setFilter('review'); load();
      }
    } catch { setMsg({ ok: false, text: 'Network error. Please try again.' }); }
    finally { setUploading(false); }
  }

  const counts = {
    all: items?.length ?? 0,
    review: items?.filter((p) => p.review === 'pending').length ?? 0,
    live: items?.filter((p) => p.review === 'live').length ?? 0,
    rejected: items?.filter((p) => p.review === 'rejected').length ?? 0,
  };
  const tiles = [
    { icon: 'fa-hourglass-half', v: counts.review, l: 'Waiting for review' },
    { icon: 'fa-map-location-dot', v: counts.live, l: 'Live on the map' },
    { icon: 'fa-circle-xmark', v: counts.rejected, l: 'Not approved' },
    { icon: 'fa-building', v: counts.all, l: 'Your projects' },
  ];

  const term = q.trim().toLowerCase();
  const list = (items || []).filter((p) => {
    const inFilter = filter === 'all'
      || (filter === 'review' && p.review === 'pending')
      || (filter === 'live' && p.review === 'live')
      || (filter === 'rejected' && p.review === 'rejected');
    const inTerm = !term || [p.title, p.location, p.type, p.price, p.configuration].some((x) => (x || '').toLowerCase().includes(term));
    return inFilter && inTerm;
  });

  const notice = msg && (
    <div className="dsh-notice" style={{ background: msg.ok ? '#e6f6ee' : '#fdecec', color: msg.ok ? '#0f7a4a' : '#b42318' }}>
      <i className={`fas ${msg.ok ? 'fa-circle-check' : 'fa-triangle-exclamation'}`} /> <span>{msg.text}</span>
    </div>
  );

  /* ------------------------------ Add / edit ----------------------------- */
  if (view === 'form') {
    return (
      <div className="adm-panel">
        <div className="adm-panel-head">
          <h3>{editId ? 'Edit project' : 'Add project'}</h3>
          <button className="adm-btn ghost sm" onClick={() => { setView('list'); setEditId(null); }}><i className="fas fa-arrow-left" /> Back</button>
        </div>
        {notice}
        <form onSubmit={submit} className="dpf" style={{ display: 'grid', gap: 10, marginTop: 6 }}>
          <input placeholder="Project name *" value={form.title} onChange={set('title')} required maxLength={160} />
          <input placeholder="Location (e.g. Kharadi, Pune)" value={form.location} onChange={set('location')} maxLength={160} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <select value={form.type} onChange={set('type')}>{TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select>
            <select value={form.status} onChange={set('status')}>{STATUSES.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}</select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <input placeholder="Price (e.g. ₹85L onwards)" value={form.price} onChange={set('price')} maxLength={80} />
            <input placeholder="Configuration (e.g. 2 & 3 BHK)" value={form.configuration} onChange={set('configuration')} maxLength={120} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <input placeholder="Latitude (optional)" value={form.lat} onChange={set('lat')} inputMode="decimal" />
            <input placeholder="Longitude (optional)" value={form.lng} onChange={set('lng')} inputMode="decimal" />
          </div>
          <textarea placeholder="Short description" value={form.description} onChange={set('description')} rows={3} maxLength={4000} />
          <button type="submit" className="adm-btn primary" disabled={busy} style={{ width: 'fit-content' }}>
            {busy ? 'Saving…' : editId ? 'Save changes' : 'Submit for review'}
          </button>
          <small style={{ color: '#6b7a74' }}>
            Tip: adding latitude &amp; longitude places your project precisely on the map. Our team can also set it during review.
          </small>
        </form>
      </div>
    );
  }

  /* ------------------------------ Bulk upload ---------------------------- */
  if (view === 'bulk') {
    return (
      <div className="adm-panel">
        <div className="adm-panel-head">
          <h3>Bulk upload</h3>
          <button className="adm-btn ghost sm" onClick={() => { setView('list'); setParsed(null); }}><i className="fas fa-arrow-left" /> Back</button>
        </div>
        {notice}
        <p className="muted" style={{ margin: '4px 0 14px' }}>
          Import many projects from an Excel or CSV. Every project goes to our team for review before it appears on the map.
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
          <a className="adm-btn ghost" href={TEMPLATE_URL} download><i className="fas fa-download" /> Download Excel template</a>
          <label className="adm-btn primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <i className="fas fa-folder-open" /> {parsing ? 'Reading file…' : 'Choose Excel / CSV file'}
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" hidden disabled={parsing || uploading} onChange={onFile} />
          </label>
        </div>

        {parsed && (
          <div style={{ display: 'grid', gap: 10 }}>
            <p className="muted" style={{ margin: 0 }}>
              <b>{parsed.name}</b> — {parsed.rows.length} project{parsed.rows.length === 1 ? '' : 's'} ready
              {parsed.skipped ? ` · ${parsed.skipped} row${parsed.skipped === 1 ? '' : 's'} skipped (no project name)` : ''}
            </p>
            <div style={{ maxHeight: 320, overflow: 'auto', border: '1px solid #e6e3da', borderRadius: 10 }}>
              <table className="adm-table">
                <thead><tr><th>Project</th><th>Location</th><th>Type</th><th>Map pin</th></tr></thead>
                <tbody>
                  {parsed.rows.slice(0, 50).map((p, i) => (
                    <tr key={i}>
                      <td className="t-title">{p.title}</td>
                      <td>{p.location || '—'}</td>
                      <td>{p.type}</td>
                      <td><span className="adm-badge" style={{ color: p.lat != null ? '#0f7a4a' : '#9a5b00' }}>{p.lat != null ? 'On map' : 'Set on review'}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {parsed.rows.length > 50 && <p className="muted" style={{ margin: 0, padding: '8px 10px' }}>…and {parsed.rows.length - 50} more.</p>}
            </div>
            <button className="adm-btn primary" disabled={uploading} onClick={submitBulk} style={{ width: 'fit-content' }}>
              {uploading ? 'Uploading…' : `Submit ${parsed.rows.length} for review`}
            </button>
          </div>
        )}
      </div>
    );
  }

  /* -------------------------------- List --------------------------------- */
  return (
    <>
      <div className="adm-cards">
        {tiles.map((t) => (
          <div className="adm-stat" key={t.l}>
            <div className="ic"><i className={`fas ${t.icon}`} /></div>
            <b>{items === null ? '…' : t.v}</b>
            <span>{t.l}</span>
          </div>
        ))}
      </div>

      {notice}

      <div className="adm-panel" style={{ marginTop: 16 }}>
        <div className="adm-panel-head">
          <h3>Projects intake</h3>
          <div className="adm-actions">
            <button className="adm-btn ghost sm" onClick={startBulk}><i className="fas fa-file-arrow-up" /> Bulk upload</button>
            <button className="adm-btn primary sm" onClick={startAdd}><i className="fas fa-plus" /> Add project</button>
          </div>
        </div>

        <p className="muted" style={{ margin: '0 0 12px', fontSize: 13 }}>
          Nothing goes live until our team reviews &amp; publishes it. You only see your own projects here.
        </p>

        <div className="crm-stats" style={{ marginBottom: 14 }}>
          {FILTERS.map((f) => (
            <button key={f.key} className={`crm-stat${filter === f.key ? ' on' : ''}`} onClick={() => setFilter(f.key)}>
              <div className="v">{f.key === 'all' ? counts.all : counts[f.key]}</div>
              <div className="l">{f.label}</div>
            </button>
          ))}
        </div>

        <div className="crm-tools" style={{ marginBottom: 12 }}>
          <input className="crm-search" placeholder="Search project, location, type…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="adm-btn ghost sm" onClick={() => load()}><i className="fas fa-rotate" /> Refresh</button>
        </div>

        {items === null ? (
          <div className="adm-empty"><i className="fas fa-spinner fa-spin" /><p>Loading your projects…</p></div>
        ) : list.length === 0 ? (
          <div className="adm-empty">
            <i className="fas fa-location-dot" />
            <p>{counts.all === 0
              ? 'No projects yet. Click “Add project” to list your first one, or “Bulk upload” an Excel/CSV.'
              : 'No projects match this filter.'}</p>
          </div>
        ) : (
          <table className="adm-table">
            <thead><tr><th>#</th><th>Project</th><th>Location</th><th>Type</th><th>Status</th><th>Updated</th><th>Actions</th></tr></thead>
            <tbody>
              {list.map((p) => {
                const badge = REVIEW_BADGE[p.review];
                return (
                  <tr key={p.id}>
                    <td className="muted">{p.number != null ? `#${p.number}` : '—'}</td>
                    <td className="t-title">{p.title || 'Untitled'}<small>{p.price || p.configuration || ''}</small></td>
                    <td>{p.location || '—'}</td>
                    <td>{p.type || '—'}</td>
                    <td>
                      <span className="adm-badge" style={{ background: badge.bg, color: badge.fg }}>{badge.label}</span>
                      {p.review === 'rejected' && p.review_note && (
                        <small style={{ display: 'block', marginTop: 4, color: '#b42318', fontSize: 12, maxWidth: 260 }}>Reason: {p.review_note} — edit the project to send it again.</small>
                      )}
                    </td>
                    <td className="muted">{fmtWhen(p.created_at)}</td>
                    <td><div className="adm-actions">
                      {p.review === 'live' && (
                        <a className="adm-btn ghost sm" href={`/map?pin=${encodeURIComponent(p.id)}`} target="_blank" rel="noopener"><i className="fas fa-arrow-up-right-from-square" /></a>
                      )}
                      <button className="adm-btn ghost sm" onClick={() => startEdit(p)}><i className="fas fa-pen" /> Edit</button>
                      <button className="adm-btn danger sm" onClick={() => remove(p)}><i className="fas fa-trash" /></button>
                    </div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
