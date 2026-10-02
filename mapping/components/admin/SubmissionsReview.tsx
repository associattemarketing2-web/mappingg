'use client';

import { useEffect, useState } from 'react';

// Super-admin review of developer-submitted projects (pending pins). Approve →
// live on the public map; Reject → kept hidden. Minimal standalone screen so it
// doesn't entangle the main admin SPA.
interface Submission {
  id: string;
  title: string;
  location: string;
  status: string;
  type: string;
  price: string;
  developer: string;
  description: string;
  lat: number | null;
  lng: number | null;
  hasLocation: boolean;
  owner: { name: string; email: string } | null;
  created_at: string;
}

export default function SubmissionsReview() {
  const [items, setItems] = useState<Submission[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState('');

  async function load() {
    try {
      const r = await fetch('/api/admin/submissions', { credentials: 'same-origin' });
      if (r.status === 401) { setErr('Not authorized.'); setItems([]); return; }
      const b = await r.json();
      setItems(Array.isArray(b.data) ? b.data : []);
    } catch { setItems([]); }
  }
  useEffect(() => { load(); }, []);

  async function act(id: string, action: 'approve' | 'reject') {
    setBusy(id);
    try {
      const r = await fetch('/api/admin/submissions', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, action }),
      });
      if (r.ok) setItems((xs) => (xs || []).filter((x) => x.id !== id));
    } finally { setBusy(null); }
  }

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '28px 20px', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <a href="/s-admin" style={{ color: '#0f5c47', textDecoration: 'none', fontWeight: 700 }}>← Admin</a>
        <h1 style={{ fontSize: 22, margin: 0, color: '#0f2e24' }}>Developer submissions</h1>
      </div>
      <p style={{ color: '#4a5a54', fontSize: 14, marginTop: 0 }}>
        Projects developers added from their dashboard. <b>Approve</b> to publish to the public map, or
        <b> Reject</b> to keep it hidden.
      </p>
      {err && <p style={{ color: '#b42318' }}>{err}</p>}

      {items === null ? (
        <p style={{ color: '#6b7a74' }}>Loading…</p>
      ) : items.length === 0 ? (
        <p style={{ color: '#6b7a74' }}>Nothing waiting for review. 🎉</p>
      ) : (
        <div style={{ display: 'grid', gap: 14 }}>
          {items.map((s) => (
            <div key={s.id} style={{ border: '1px solid #e2eae6', borderRadius: 14, padding: 16, background: '#fff' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                <b style={{ fontSize: 16, color: '#0f2e24' }}>{s.title}</b>
                <span style={{ fontSize: 12, color: '#6b7a74' }}>{[s.type, s.status].filter(Boolean).join(' · ')}</span>
              </div>
              <div style={{ fontSize: 13, color: '#4a5a54', margin: '6px 0' }}>
                {[s.location, s.price].filter(Boolean).join(' · ') || '—'}
                {s.developer ? ` · ${s.developer}` : ''}
              </div>
              {s.description && <p style={{ fontSize: 13, color: '#4a5a54', margin: '6px 0' }}>{s.description}</p>}
              <div style={{ fontSize: 12, color: '#6b7a74', marginBottom: 10 }}>
                By {s.owner ? `${s.owner.name || s.owner.email}` : 'unknown'}
                {' · '}
                {s.hasLocation
                  ? `📍 ${Number(s.lat).toFixed(4)}, ${Number(s.lng).toFixed(4)}`
                  : '⚠️ no coordinates — set its location in the Map Editor after approving, or it won’t show on the map'}
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  onClick={() => act(s.id, 'approve')}
                  disabled={busy === s.id}
                  style={{ background: '#0f5c47', color: '#fff', border: 0, borderRadius: 10, padding: '9px 16px', fontWeight: 700, cursor: 'pointer' }}
                >
                  {busy === s.id ? '…' : 'Approve & publish'}
                </button>
                <button
                  onClick={() => act(s.id, 'reject')}
                  disabled={busy === s.id}
                  style={{ background: '#fdecec', color: '#b42318', border: 0, borderRadius: 10, padding: '9px 16px', fontWeight: 700, cursor: 'pointer' }}
                >
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
