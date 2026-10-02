'use client';

import { useEffect, useState } from 'react';

// A developer's own projects: a list scoped to this account (server enforces it
// via owner_user_id) plus an "Add project" form. New projects go to the admin
// review queue and appear on the public map only once approved.
interface MyProject {
  id: string;
  title: string;
  location: string;
  status: string;
  type: string;
  price: string;
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

export default function DeveloperProjects() {
  const [items, setItems] = useState<MyProject[] | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function load() {
    try {
      const r = await fetch('/api/my/projects', { credentials: 'same-origin' });
      const b = await r.json();
      setItems(Array.isArray(b.data) ? b.data : []);
    } catch { setItems([]); }
  }
  useEffect(() => { load(); }, []);

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
    try {
      const r = await fetch('/api/my/projects', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const b = await r.json();
      if (!r.ok) { setMsg({ ok: false, text: b?.error?.message || 'Could not add the project.' }); }
      else {
        setMsg({ ok: true, text: 'Submitted! Our team will review it and publish it to the map shortly.' });
        setForm({ ...EMPTY }); setOpen(false); load();
      }
    } catch { setMsg({ ok: false, text: 'Network error. Please try again.' }); }
    finally { setBusy(false); }
  }

  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const counts = {
    total: items?.length ?? 0,
    pending: items?.filter((p) => p.review === 'pending').length ?? 0,
    live: items?.filter((p) => p.review === 'live').length ?? 0,
  };

  return (
    <section className="dsh-card">
      <h2 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <i className="fas fa-location-dot" /> Your projects
        <button className="dsh-btn primary" style={{ marginLeft: 'auto', fontSize: 13 }} onClick={() => setOpen((v) => !v)}>
          <i className="fas fa-plus" /> {open ? 'Close' : 'Add project'}
        </button>
      </h2>

      <p className="dsh-empty" style={{ margin: '0 0 10px' }}>
        {counts.total} total · {counts.pending} pending review · {counts.live} live on the map
      </p>

      {msg && (
        <div className="dsh-notice" style={{ background: msg.ok ? '#e6f6ee' : '#fdecec', color: msg.ok ? '#0f7a4a' : '#b42318' }}>
          <i className={`fas ${msg.ok ? 'fa-circle-check' : 'fa-triangle-exclamation'}`} /> <span>{msg.text}</span>
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
            {busy ? 'Submitting…' : 'Submit for review'}
          </button>
          <small style={{ color: '#6b7a74' }}>
            Tip: adding latitude &amp; longitude places your project precisely on the map. Our team can also set it during review.
          </small>
        </form>
      )}

      {items === null ? (
        <p className="dsh-empty">Loading your projects…</p>
      ) : items.length === 0 ? (
        <p className="dsh-empty">You haven&apos;t added any projects yet. Click <b>Add project</b> to list your first one.</p>
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
                {p.review === 'live' && (
                  <a className="dsh-link" href={`/map?pin=${encodeURIComponent(p.id)}`}>View on map <i className="fas fa-arrow-right" /></a>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
