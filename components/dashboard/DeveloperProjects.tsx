'use client';

import { useEffect, useRef, useState } from 'react';

// A developer's own projects: a list scoped to this account (server enforces it
// via owner_user_id) plus an "Add project" form and a bulk Excel/CSV upload.
// New or bulk-uploaded projects go to the admin review queue and appear on the
// public map only once approved.
interface MyProject {
  id: string;
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

export default function DeveloperProjects() {
  const [items, setItems] = useState<MyProject[] | null>(null);
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Bulk upload state
  const [bulkOpen, setBulkOpen] = useState(false);
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
    setEditId(null); setForm({ ...EMPTY }); setMsg(null); setBulkOpen(false); setOpen(true);
  }
  function startEdit(p: MyProject) {
    setEditId(p.id);
    setForm({
      title: p.title, location: p.location, type: p.type || 'Residential', status: p.status || 'upcoming',
      price: p.price, configuration: p.configuration, description: p.description,
      lat: p.lat != null ? String(p.lat) : '', lng: p.lng != null ? String(p.lng) : '',
    });
    setMsg(null); setBulkOpen(false); setOpen(true);
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
        setMsg({ ok: true, text: editId
          ? 'Saved! Your changes go back to our team for review before they appear on the map.'
          : 'Submitted! Our team will review it and publish it to the map shortly.' });
        setForm({ ...EMPTY }); setOpen(false); setEditId(null); load();
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

  /* ----------------------------- Bulk upload ----------------------------- */
  function startBulk() {
    setOpen(false); setEditId(null); setMsg(null); setParsed(null); setBulkOpen((v) => !v);
  }

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
        setParsed(null); setBulkOpen(false); load();
      }
    } catch { setMsg({ ok: false, text: 'Network error. Please try again.' }); }
    finally { setUploading(false); }
  }

  const counts = {
    total: items?.length ?? 0,
    pending: items?.filter((p) => p.review === 'pending').length ?? 0,
    live: items?.filter((p) => p.review === 'live').length ?? 0,
  };

  return (
    <section className="dsh-card">
      <h2 style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <i className="fas fa-location-dot" /> Your projects
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8 }}>
          <button className="dsh-btn" style={{ fontSize: 13 }} onClick={startBulk}>
            <i className={`fas ${bulkOpen ? 'fa-xmark' : 'fa-file-arrow-up'}`} /> {bulkOpen ? 'Close' : 'Bulk upload'}
          </button>
          <button className="dsh-btn primary" style={{ fontSize: 13 }} onClick={() => (open ? setOpen(false) : startAdd())}>
            <i className={`fas ${open ? 'fa-xmark' : 'fa-plus'}`} /> {open ? 'Close' : 'Add project'}
          </button>
        </span>
      </h2>

      <p className="dsh-empty" style={{ margin: '0 0 10px' }}>
        {counts.total} total · {counts.pending} pending review · {counts.live} live on the map
      </p>

      {msg && (
        <div className="dsh-notice" style={{ background: msg.ok ? '#e6f6ee' : '#fdecec', color: msg.ok ? '#0f7a4a' : '#b42318' }}>
          <i className={`fas ${msg.ok ? 'fa-circle-check' : 'fa-triangle-exclamation'}`} /> <span>{msg.text}</span>
        </div>
      )}

      {bulkOpen && (
        <div className="dpf" style={{ display: 'grid', gap: 12, margin: '6px 0 14px', padding: 14, border: '1px solid #e6e3da', borderRadius: 12, background: '#fafaf7' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <b style={{ fontSize: 14 }}><i className="fas fa-file-excel" style={{ color: '#1d7a46', marginRight: 6 }} /> Upload many projects at once</b>
            <a className="dsh-link" href={TEMPLATE_URL} download>
              <i className="fas fa-download" /> Download Excel template
            </a>
          </div>
          <small style={{ color: '#6b7a74' }}>
            Fill the template (or export your own Excel/CSV), then upload it here. Every project goes to our team for review before it appears on the map.
          </small>

          <label className="dsh-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', width: 'fit-content' }}>
            <i className="fas fa-folder-open" /> {parsing ? 'Reading file…' : 'Choose Excel / CSV file'}
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" hidden disabled={parsing || uploading} onChange={onFile} />
          </label>

          {parsed && (
            <div style={{ display: 'grid', gap: 10 }}>
              <div className="dsh-empty" style={{ margin: 0 }}>
                <b>{parsed.name}</b> — {parsed.rows.length} project{parsed.rows.length === 1 ? '' : 's'} ready
                {parsed.skipped ? ` · ${parsed.skipped} row${parsed.skipped === 1 ? '' : 's'} skipped (no project name)` : ''}
              </div>
              <div style={{ maxHeight: 260, overflow: 'auto', border: '1px solid #e6e3da', borderRadius: 10 }}>
                <table className="dsh-bulk-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ textAlign: 'left', background: '#f1efe8' }}>
                      <th style={{ padding: '6px 10px' }}>Project</th>
                      <th style={{ padding: '6px 10px' }}>Location</th>
                      <th style={{ padding: '6px 10px' }}>Type</th>
                      <th style={{ padding: '6px 10px' }}>Pin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.rows.slice(0, 50).map((p, i) => (
                      <tr key={i} style={{ borderTop: '1px solid #eee' }}>
                        <td style={{ padding: '6px 10px' }}>{p.title}</td>
                        <td style={{ padding: '6px 10px' }}>{p.location || '—'}</td>
                        <td style={{ padding: '6px 10px' }}>{p.type}</td>
                        <td style={{ padding: '6px 10px', color: p.lat != null ? '#0f7a4a' : '#9a5b00' }}>
                          {p.lat != null ? 'On map' : 'Set on review'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {parsed.rows.length > 50 && (
                  <p className="dsh-empty" style={{ margin: 0, padding: '8px 10px' }}>…and {parsed.rows.length - 50} more.</p>
                )}
              </div>
              <button className="dsh-btn primary" disabled={uploading} onClick={submitBulk} style={{ width: 'fit-content' }}>
                {uploading ? 'Uploading…' : `Submit ${parsed.rows.length} for review`}
              </button>
            </div>
          )}
        </div>
      )}

      {open && (
        <form onSubmit={submit} className="dpf" style={{ display: 'grid', gap: 10, margin: '6px 0 14px' }}>
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
          <button type="submit" className="dsh-btn primary" disabled={busy}>
            {busy ? 'Saving…' : editId ? 'Save changes' : 'Submit for review'}
          </button>
          <small style={{ color: '#6b7a74' }}>
            Tip: adding latitude &amp; longitude places your project precisely on the map. Our team can also set it during review.
          </small>
        </form>
      )}

      {items === null ? (
        <p className="dsh-empty">Loading your projects…</p>
      ) : items.length === 0 ? (
        <p className="dsh-empty">You haven&apos;t added any projects yet. Click <b>Add project</b> to list your first one, or <b>Bulk upload</b> an Excel/CSV.</p>
      ) : (
        <ul className="dsh-projects">
          {items.map((p) => {
            const badge = REVIEW_BADGE[p.review];
            return (
              <li key={p.id}>
                <span className={`dsh-dot s-${(p.status || '').toLowerCase()}`} aria-hidden="true" />
                <div className="meta">
                  <b>{p.title}</b>
                  <small>{[p.location, p.type].filter(Boolean).join(' · ') || '—'}</small>
                </div>
                <span style={{ background: badge.bg, color: badge.fg, padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700 }}>
                  {badge.label}
                </span>
                <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                  {p.review === 'live' && (
                    <a className="dsh-link" href={`/map?pin=${encodeURIComponent(p.id)}`}>View <i className="fas fa-arrow-right" /></a>
                  )}
                  <button type="button" className="dsh-link" style={{ background: 'none', border: 0, cursor: 'pointer', padding: 0 }} onClick={() => startEdit(p)} aria-label={`Edit ${p.title}`}>
                    <i className="fas fa-pen" /> Edit
                  </button>
                  <button type="button" className="dsh-link" style={{ background: 'none', border: 0, cursor: 'pointer', padding: 0, color: '#b42318' }} onClick={() => remove(p)} aria-label={`Delete ${p.title}`}>
                    <i className="fas fa-trash" />
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
