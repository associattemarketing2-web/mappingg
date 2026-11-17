'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import './subscriptions.css';

// A channel partner's private lead book (Pro) and CRM (Pro Max): add clients,
// move them through the pipeline, follow-ups, notes timeline, CSV export, and
// future prices Mappingg published. All data comes from /api/cp/* — scoped to
// this CP on the server.

type Lead = { id: string; name: string; phone: string; email: string; pin_id: string | null; project_title: string; budget: string; requirement: string; city: string; status: string; priority: string; follow_up_at: string | null; notes: string; activity: { at: string; text: string }[]; archived: boolean; created_at: string; updated_at: string };
type PlanInfo = { can_add: boolean; crm: boolean; visibility: boolean; limit: number | null; used: number; enforced: boolean };
type Outlook = { pin_id: string; title: string; location: string; current_price: string; expected_price: string; horizon: string; note: string; source: string; updated_at: string };

const STATUSES = ['new', 'contacted', 'site_visit', 'negotiation', 'booked', 'lost'];
const LABEL: Record<string, string> = { new: 'New', contacted: 'Contacted', site_visit: 'Site visit', negotiation: 'Negotiation', booked: 'Booked', lost: 'Lost' };
const empty = { name: '', phone: '', email: '', budget: '', requirement: '', city: '', notes: '', pin_id: '' };
const fmt = (d?: string | null) => (d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '');
const toLocal = (d?: string | null) => { if (!d) return ''; const t = new Date(d); return new Date(t.getTime() - t.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };

async function call<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const r = await fetch(url, { method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(b?.error?.message || `Request failed (${r.status})`), { status: r.status });
  return b.data as T;
}

export default function CpCrm({ projects }: { projects: { id: string; title: string; location: string }[] }) {
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [plan, setPlan] = useState<PlanInfo | null>(null);
  const [archived, setArchived] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null);
  const [form, setForm] = useState(empty);
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState('');
  const [stage, setStage] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [outlook, setOutlook] = useState<Outlook[] | null | 'locked'>(null);

  const load = useCallback(async () => {
    try {
      const d = await call<{ leads: Lead[]; plan: PlanInfo }>(`/api/cp/leads${archived ? '?archived=1' : ''}`);
      setLeads(d.leads); setPlan(d.plan); setErr('');
    } catch (e) { setErr((e as Error).message); }
  }, [archived]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    call<Outlook[]>('/api/cp/future-price').then(setOutlook).catch(() => setOutlook('locked'));
  }, []);

  const shown = useMemo(() => (leads || []).filter((l) => (!stage || l.status === stage) && (!q || `${l.name} ${l.phone} ${l.email} ${l.project_title} ${l.city}`.toLowerCase().includes(q.toLowerCase()))), [leads, stage, q]);
  const counts = useMemo(() => Object.fromEntries(STATUSES.map((s) => [s, (leads || []).filter((l) => l.status === s).length])), [leads]);
  const followUps = useMemo(() => (leads || []).filter((l) => l.follow_up_at && new Date(l.follow_up_at).getTime() < Date.now() + 86_400_000 && !['booked', 'lost'].includes(l.status)), [leads]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      await call('/api/cp/leads', 'POST', { ...form, pin_id: form.pin_id || null });
      setForm(empty); setAdding(false); setMsg({ text: 'Lead added.' });
      await load();
    } catch (e2) { setMsg({ text: (e2 as Error).message, err: true }); }
  }
  async function patch(id: string, body: Record<string, unknown>, ok?: string) {
    try {
      const updated = await call<Lead>('/api/cp/leads', 'PATCH', { id, ...body });
      setLeads((ls) => (ls || []).map((l) => (l.id === id ? updated : l)));
      if (ok) setMsg({ text: ok });
    } catch (e) { setMsg({ text: (e as Error).message, err: true }); }
  }
  async function archive(id: string, restore = false) {
    try { await call(`/api/cp/leads?id=${encodeURIComponent(id)}${restore ? '&restore=1' : ''}`, 'DELETE'); await load(); } catch (e) { setMsg({ text: (e as Error).message, err: true }); }
  }

  if (err) return <div className="sub-alert bad"><i className="fas fa-triangle-exclamation" /><span className="grow">{err}</span></div>;
  if (!leads || !plan) return <p className="sub-muted"><i className="fas fa-spinner fa-spin" /> Loading your leads…</p>;

  const locked = !plan.can_add;
  return (
    <div className="sub-stack">
      {locked && (
        <div className="sub-alert warn"><i className="fas fa-lock" /><span className="grow"><b>Lead management is part of Pro and Pro Max.</b> {leads.length ? 'Your saved leads are still here to view.' : ''} Upgrade to add and track client leads.</span><a className="sub-btn sm primary" href="/dashboard/agent/subscription#plans">See plans</a></div>
      )}
      {msg && <p className={`sub-msg${msg.err ? ' err' : ''}`} role="status">{msg.text}</p>}

      {plan.crm && followUps.length > 0 && (
        <div className="sub-alert info"><i className="fas fa-bell" /><span className="grow"><b>{followUps.length} follow-up{followUps.length === 1 ? '' : 's'} due</b> — {followUps.slice(0, 3).map((l) => l.name).join(', ')}{followUps.length > 3 ? '…' : ''}</span></div>
      )}

      <section className="sub-card">
        <h2>
          <i className="fas fa-address-book" /> {archived ? 'Archived leads' : 'Your client leads'}
          <span className="sub-badge">{plan.used}{plan.limit != null ? ` / ${plan.limit}` : ''} active</span>
          <span className="sp" />
          {!archived && !locked && <button className="sub-btn sm primary" onClick={() => setAdding((v) => !v)}><i className="fas fa-plus" /> Add lead</button>}
          {plan.crm && <a className="sub-btn sm ghost" href="/api/cp/leads?format=csv"><i className="fas fa-file-csv" /> Export</a>}
          <button className="sub-btn sm ghost" onClick={() => setArchived((v) => !v)}>{archived ? 'Active leads' : 'Archived'}</button>
        </h2>

        {adding && (
          <form className="sub-form" onSubmit={add} style={{ marginBottom: 16 }}>
            <label className="sub-field"><span>Client name *</span><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={120} /></label>
            <label className="sub-field"><span>Phone / WhatsApp</span><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} maxLength={30} inputMode="tel" /></label>
            <label className="sub-field"><span>Email</span><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} maxLength={160} /></label>
            <label className="sub-field"><span>Budget</span><input value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} placeholder="e.g. 1–1.5 Cr" maxLength={80} /></label>
            <label className="sub-field"><span>Interested project</span>
              <select value={form.pin_id} onChange={(e) => setForm({ ...form, pin_id: e.target.value })}>
                <option value="">Not decided</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.title}{p.location ? ` — ${p.location}` : ''}</option>)}
              </select>
            </label>
            <label className="sub-field"><span>City / area</span><input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} maxLength={60} /></label>
            <label className="sub-field wide"><span>Requirement</span><input value={form.requirement} onChange={(e) => setForm({ ...form, requirement: e.target.value })} placeholder="e.g. 3 BHK, ready to move, near metro" maxLength={1000} /></label>
            <label className="sub-field wide"><span>Notes</span><textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} maxLength={4000} /></label>
            <div className="wide sub-toolbar"><button className="sub-btn primary" type="submit">Save lead</button><button className="sub-btn ghost" type="button" onClick={() => setAdding(false)}>Cancel</button></div>
          </form>
        )}

        {plan.crm && !archived && (
          <div className="sub-pipe" style={{ marginBottom: 14 }}>
            {STATUSES.map((s) => (
              <button key={s} className={stage === s ? 'on' : ''} onClick={() => setStage(stage === s ? '' : s)}><b>{counts[s]}</b><span>{LABEL[s]}</span></button>
            ))}
          </div>
        )}
        <div className="sub-toolbar" style={{ marginBottom: 12 }}>
          <input placeholder="Search name, phone, project…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search leads" />
          {!plan.crm && (
            <select value={stage} onChange={(e) => setStage(e.target.value)} aria-label="Status filter">
              <option value="">All statuses</option>
              {STATUSES.map((s) => <option key={s} value={s}>{LABEL[s]}</option>)}
            </select>
          )}
        </div>

        {shown.length ? (
          <div className="sub-leads">
            {shown.map((l) => (
              <article className="sub-lead" key={l.id}>
                <div className="hd">
                  <b>{l.name}</b>
                  {plan.crm && l.priority !== 'normal' && <span className={`sub-badge ${l.priority === 'high' ? 'bad' : 'free'}`}>{l.priority}</span>}
                </div>
                <div className="meta">
                  {l.phone && <span><i className="fas fa-phone" /> <a href={`tel:${l.phone}`}>{l.phone}</a></span>}
                  {l.email && <span><i className="fas fa-envelope" /> {l.email}</span>}
                  {l.project_title && <span><i className="fas fa-building" /> {l.project_title}</span>}
                  {(l.budget || l.city) && <span><i className="fas fa-indian-rupee-sign" /> {[l.budget, l.city].filter(Boolean).join(' · ')}</span>}
                  {l.requirement && <span>{l.requirement}</span>}
                  {plan.crm && l.follow_up_at && <span><i className="fas fa-bell" /> Follow up {fmt(l.follow_up_at)}</span>}
                </div>
                <div className="acts">
                  <select value={l.status} disabled={locked || archived} onChange={(e) => patch(l.id, { status: e.target.value })} aria-label="Status">
                    {STATUSES.map((s) => <option key={s} value={s}>{LABEL[s]}</option>)}
                  </select>
                  {plan.crm && !archived && (
                    <select value={l.priority} onChange={(e) => patch(l.id, { priority: e.target.value })} aria-label="Priority">
                      <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option>
                    </select>
                  )}
                  <button className="sub-btn sm ghost" onClick={() => { setOpen(open === l.id ? null : l.id); setNote(''); }}>{open === l.id ? 'Close' : 'Details'}</button>
                  {archived
                    ? <button className="sub-btn sm ghost" onClick={() => archive(l.id, true)}>Restore</button>
                    : <button className="sub-btn sm ghost" onClick={() => { if (confirm(`Archive ${l.name}? You can restore it later.`)) archive(l.id); }} disabled={locked}>Archive</button>}
                </div>
                {open === l.id && (
                  <div className="sub-stack" style={{ gap: 10, borderTop: '1px solid #efece4', paddingTop: 10 }}>
                    <label className="sub-field"><span>Notes</span><textarea defaultValue={l.notes} disabled={locked} onBlur={(e) => { if (e.target.value !== l.notes) patch(l.id, { notes: e.target.value }, 'Notes saved.'); }} /></label>
                    {plan.crm && (
                      <>
                        <label className="sub-field"><span>Next follow-up</span><input type="datetime-local" defaultValue={toLocal(l.follow_up_at)} onChange={(e) => patch(l.id, { follow_up_at: e.target.value ? new Date(e.target.value).toISOString() : null })} /></label>
                        <div className="sub-row">
                          <label className="sub-field"><span>Log an update</span><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Called — visiting Saturday" maxLength={500} /></label>
                          <button className="sub-btn ghost" disabled={!note.trim()} onClick={() => { patch(l.id, { note }); setNote(''); }}>Add</button>
                        </div>
                      </>
                    )}
                    {plan.visibility && l.activity.length > 0 && (
                      <ul className="sub-timeline">
                        {[...l.activity].reverse().slice(0, 15).map((a, i) => <li key={i}>{a.text}<br /><small>{fmt(a.at)}</small></li>)}
                      </ul>
                    )}
                  </div>
                )}
              </article>
            ))}
          </div>
        ) : <p className="sub-empty">{leads.length ? 'No leads match.' : archived ? 'No archived leads.' : 'No leads yet — add your first client.'}</p>}
      </section>

      <section className="sub-card">
        <h2><i className="fas fa-chart-line" /> Future price information <span className="sub-badge premium"><i className="fas fa-crown" /> Pro Max</span></h2>
        {outlook === 'locked' ? (
          <p className="sub-muted">Upcoming price revisions published by Mappingg (with their source) are part of Pro Max. <a className="sub-link" href="/dashboard/agent/subscription#plans">Upgrade</a></p>
        ) : outlook === null ? <p className="sub-muted"><i className="fas fa-spinner fa-spin" /> Loading…</p> : outlook.length ? (
          <ul className="sub-list">
            {outlook.map((o) => (
              <li key={o.pin_id}>
                <span className="main"><b>{o.title}</b><small>{[o.location, o.current_price && `Now: ${o.current_price}`].filter(Boolean).join(' · ')}</small><small>Source: {o.source}{o.note ? ` — ${o.note}` : ''}</small></span>
                <span style={{ textAlign: 'right' }}><b>{o.expected_price}</b><br /><small className="sub-muted">{o.horizon}</small></span>
              </li>
            ))}
          </ul>
        ) : <p className="sub-empty">No future prices have been published yet. They appear here as soon as Mappingg confirms a revision with the developer.</p>}
      </section>
    </div>
  );
}
