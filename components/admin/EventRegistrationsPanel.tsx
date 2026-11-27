'use client';

import { useEffect, useMemo, useState } from 'react';
import { PageHead, StatCard } from './PageHead';

// Admin → CRM & Leads → Event registrations. Everyone who registered on the
// Mappingg Events landing site (the separate `mappinggevent` site, which posts
// to /api/event-registration). Read-only list with search, attendee-type
// filter and CSV export; follow-up happens on the same lead in Leads / CRM.

type Flash = (m: string, e?: boolean) => void;
interface Row {
  id: string; name: string; email: string; phone: string; attendee_type: string; city?: string; event: string;
  status: string; created_at: string; consent?: { call?: boolean; whatsapp?: boolean };
}

const TYPES: [string, 'violet' | 'blue' | 'teal' | 'amber' | 'rose'][] = [
  ['Home buyer', 'blue'], ['Investor', 'teal'], ['Developer', 'violet'], ['Channel partner', 'amber'], ['Other', 'rose'],
];
const fmt = (d: string) => (d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

export default function EventRegistrationsPanel({ flash, onOpenLeads }: { flash: Flash; onOpenLeads: () => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [type, setType] = useState('');

  const load = () => {
    setErr('');
    fetch('/api/admin/event-registrations', { credentials: 'same-origin', cache: 'no-store' })
      .then(async (r) => {
        const b = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(b?.error?.message || `Could not load (${r.status})`);
        setRows(b.data || []);
      })
      .catch((e) => setErr(e.message));
  };
  useEffect(load, []);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (rows || []).filter((r) => (!type || r.attendee_type === type)
      && (!s || [r.name, r.email, r.phone, r.city, r.event].some((v) => String(v || '').toLowerCase().includes(s))));
  }, [rows, q, type]);

  const today = new Date().toDateString();
  const todayN = (rows || []).filter((r) => new Date(r.created_at).toDateString() === today).length;

  function exportCsv() {
    if (!shown.length) return flash('Nothing to export', true);
    const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['Registered at', 'Name', 'Email', 'Mobile', 'Attendee type', 'City', 'Event', 'Status', 'Call opt-in', 'WhatsApp opt-in'];
    const lines = shown.map((r) => [fmt(r.created_at), r.name, r.email, r.phone, r.attendee_type, r.city, r.event, r.status, r.consent?.call ? 'Yes' : 'No', r.consent?.whatsapp ? 'Yes' : 'No'].map(cell).join(','));
    const blob = new Blob([[head.map(cell).join(','), ...lines].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `event-registrations-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div>
      <PageHead icon="fa-champagne-glasses" title="Event registrations" sub="Sign-ups from the Mappingg Events / app launch landing page">
        <button className="adm-btn ghost" onClick={load}><i className="fas fa-rotate" /> Refresh</button>
        <button className="adm-btn ghost" onClick={onOpenLeads}><i className="fas fa-address-book" /> Open in CRM</button>
        <button className="adm-btn" onClick={exportCsv}><i className="fas fa-file-csv" /> Export CSV</button>
      </PageHead>

      {err && <div className="adm-panel" style={{ color: '#a9532d' }}><i className="fas fa-triangle-exclamation" /> {err}</div>}
      {!rows && !err && <div className="adm-panel"><i className="fas fa-spinner fa-spin" /> Loading…</div>}

      {rows && (
        <>
          <div className="sc-row four">
            <StatCard icon="fa-ticket" tone="violet" value={rows.length} label="Total registrations" on={!type} onClick={() => setType('')} />
            <StatCard icon="fa-calendar-day" tone="green" value={todayN} label="Registered today" />
            {TYPES.slice(0, 2).map(([t, tone]) => (
              <StatCard key={t} icon="fa-user" tone={tone} value={rows.filter((r) => r.attendee_type === t).length} label={t} on={type === t} onClick={() => setType(type === t ? '' : t)} />
            ))}
          </div>

          <div className="adm-panel">
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
              <input className="crm-search" style={{ flex: '1 1 240px' }} placeholder="Search name, email, mobile, city…" value={q} onChange={(e) => setQ(e.target.value)} />
              <select className="ov-select" value={type} onChange={(e) => setType(e.target.value)}>
                <option value="">All attendee types</option>
                {TYPES.map(([t]) => <option key={t} value={t}>{t} ({rows.filter((r) => r.attendee_type === t).length})</option>)}
              </select>
            </div>
            {shown.length ? (
              <div style={{ overflowX: 'auto' }}>
                <table className="adm-table">
                  <thead><tr><th>#</th><th>Name</th><th>Email</th><th>Mobile</th><th>Attendee type</th><th>City</th><th>Event</th><th>Status</th><th>Registered</th></tr></thead>
                  <tbody>{shown.map((r, i) => (
                    <tr key={r.id}>
                      <td className="muted">{shown.length - i}</td>
                      <td><b>{r.name}</b></td>
                      <td><a href={`mailto:${r.email}`}>{r.email}</a></td>
                      <td><a href={`tel:${r.phone.replace(/\s/g, '')}`}>{r.phone}</a></td>
                      <td><span className="adm-badge">{r.attendee_type}</span></td>
                      <td>{r.city || <span className="muted">—</span>}</td>
                      <td>{r.event}</td>
                      <td><span className="adm-badge">{r.status === 'won' ? 'Booked' : r.status.replace(/_/g, ' ')}</span></td>
                      <td className="muted">{fmt(r.created_at)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            ) : <div className="adm-empty"><i className="fas fa-ticket" /><p>{rows.length ? 'No registrations match.' : 'No event registrations yet.'}</p></div>}
          </div>
        </>
      )}
    </div>
  );
}
