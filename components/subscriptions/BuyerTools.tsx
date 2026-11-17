'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import './subscriptions.css';

// Interactive buyer tools: home-loan EMI & eligibility calculator (free),
// expert / legal / vastu request booking and the portfolio manager (Premium).
// Premium writes are re-checked on the server (/api/buyer/*).

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

export function EmiCalculator() {
  const [amount, setAmount] = useState(6_000_000);
  const [rate, setRate] = useState(8.5);
  const [years, setYears] = useState(20);
  const [income, setIncome] = useState(150_000);
  const [otherEmi, setOtherEmi] = useState(0);
  const r = rate / 12 / 100;
  const n = years * 12;
  const emi = useMemo(() => (r > 0 ? (amount * r * (1 + r) ** n) / ((1 + r) ** n - 1) : amount / n), [amount, r, n]);
  const total = emi * n;
  // Lenders commonly cap all EMIs at about 50% of net monthly income (varies by lender and profile).
  const maxEmi = Math.max(0, income * 0.5 - otherEmi);
  const eligible = r > 0 ? (maxEmi * ((1 + r) ** n - 1)) / (r * (1 + r) ** n) : maxEmi * n;
  return (
    <div className="sub-tool">
      <h3><i className="fas fa-calculator" /> Home-loan EMI &amp; eligibility</h3>
      <div className="sub-emi">
        <label className="sub-field"><span>Loan amount (₹)</span><input type="number" min={100000} step={100000} value={amount} onChange={(e) => setAmount(Math.max(0, Number(e.target.value)))} /></label>
        <label className="sub-field"><span>Interest (% p.a.)</span><input type="number" min={1} max={20} step={0.05} value={rate} onChange={(e) => setRate(Math.max(0, Number(e.target.value)))} /></label>
        <label className="sub-field"><span>Tenure (years)</span><input type="number" min={1} max={30} value={years} onChange={(e) => setYears(Math.min(30, Math.max(1, Number(e.target.value))))} /></label>
        <label className="sub-field"><span>Net monthly income (₹)</span><input type="number" min={0} step={5000} value={income} onChange={(e) => setIncome(Math.max(0, Number(e.target.value)))} /></label>
        <label className="sub-field"><span>Existing EMIs (₹/month)</span><input type="number" min={0} step={1000} value={otherEmi} onChange={(e) => setOtherEmi(Math.max(0, Number(e.target.value)))} /></label>
      </div>
      <div className="sub-emi-out">
        <div><span>Monthly EMI</span><b>{inr(emi)}</b></div>
        <div><span>Total interest</span><b>{inr(total - amount)}</b></div>
        <div><span>Indicative eligibility</span><b>{inr(eligible)}</b></div>
      </div>
      <p className="sub-muted" style={{ fontSize: 12 }}>Estimates only. Eligibility assumes EMIs up to ~50% of net income; each bank decides using its own rules, your credit score and documents.</p>
    </div>
  );
}

async function call<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const r = await fetch(url, { method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(b?.error?.message || `Request failed (${r.status})`);
  return b.data as T;
}

type Req = { id: string; type: string; project_title: string; message: string; preferred_date: string; preferred_time: string; status: string; admin_note: string; created_at: string };
const TYPES: Record<string, string> = { expert: 'Property expert call', legal: 'Legal document review', vastu: 'Vastu consultation', portfolio: 'Portfolio review' };
const STATUS: Record<string, string> = { requested: 'Requested — we will call you', scheduled: 'Scheduled', in_progress: 'In progress', completed: 'Completed', cancelled: 'Cancelled' };

export function ServiceRequests({ projects, defaultPhone }: { projects: { id: string; title: string }[]; defaultPhone: string }) {
  const [list, setList] = useState<Req[] | null>(null);
  const [form, setForm] = useState({ type: 'expert', pin_id: '', message: '', preferred_date: '', preferred_time: '', contact_phone: defaultPhone });
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => call<Req[]>('/api/buyer/services').then(setList).catch(() => setList([])), []);
  useEffect(() => { load(); }, [load]);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(null);
    try {
      await call('/api/buyer/services', 'POST', form);
      setMsg({ text: 'Request sent. The Mappingg team will contact you to schedule it.' });
      setForm((f) => ({ ...f, message: '', preferred_date: '', preferred_time: '' }));
      load();
    } catch (e2) { setMsg({ text: (e2 as Error).message, err: true }); } finally { setBusy(false); }
  }
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="sub-stack" style={{ gap: 14 }}>
      <form className="sub-form" onSubmit={submit}>
        <label className="sub-field"><span>I need</span>
          <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>{Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </label>
        <label className="sub-field"><span>For project <small>(optional)</small></span>
          <select value={form.pin_id} onChange={(e) => setForm({ ...form, pin_id: e.target.value })}><option value="">General</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select>
        </label>
        <label className="sub-field"><span>Preferred date</span><input type="date" min={today} value={form.preferred_date} onChange={(e) => setForm({ ...form, preferred_date: e.target.value })} /></label>
        <label className="sub-field"><span>Preferred time</span>
          <select value={form.preferred_time} onChange={(e) => setForm({ ...form, preferred_time: e.target.value })}><option value="">Any time</option><option>Morning (10–1)</option><option>Afternoon (1–4)</option><option>Evening (4–7)</option></select>
        </label>
        <label className="sub-field"><span>Phone</span><input value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} maxLength={30} /></label>
        <label className="sub-field wide"><span>What would you like help with?</span><textarea value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} maxLength={2000} placeholder="e.g. Please check the agreement for sale before I sign" /></label>
        <div className="wide"><button className="sub-btn primary" disabled={busy}>{busy ? 'Sending…' : 'Request a call'}</button></div>
      </form>
      {msg && <p className={`sub-msg${msg.err ? ' err' : ''}`} role="status">{msg.text}</p>}
      {list && list.length > 0 && (
        <ul className="sub-list">
          {list.map((r) => (
            <li key={r.id}>
              <span className="main"><b>{TYPES[r.type] || r.type}{r.project_title ? ` — ${r.project_title}` : ''}</b><small>{new Date(r.created_at).toLocaleDateString('en-IN')}{r.preferred_date ? ` · prefers ${r.preferred_date} ${r.preferred_time}` : ''}{r.admin_note ? ` · ${r.admin_note}` : ''}</small></span>
              <span className={`sub-badge ${r.status === 'completed' ? 'ok' : r.status === 'cancelled' ? 'bad' : 'warn'}`}>{STATUS[r.status] || r.status}</span>
              {['requested', 'scheduled'].includes(r.status) && <button className="sub-btn sm ghost" onClick={async () => { await call(`/api/buyer/services?id=${encodeURIComponent(r.id)}`, 'DELETE').catch(() => {}); load(); }}>Cancel</button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type Holding = { id: string; name: string; location: string; purchase_price_paise: number; purchase_date: string; area_sqft: number | null; current_value_paise: number | null; loan_outstanding_paise: number | null; notes: string };
const blank = { name: '', location: '', purchase_price: '', purchase_date: '', area_sqft: '', current_value: '', loan_outstanding: '', notes: '' };

export function Portfolio() {
  const [list, setList] = useState<Holding[] | null>(null);
  const [form, setForm] = useState(blank);
  const [editId, setEditId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null);
  const load = useCallback(() => call<Holding[]>('/api/buyer/portfolio').then(setList).catch((e) => { setList([]); setMsg({ text: (e as Error).message, err: true }); }), []);
  useEffect(() => { load(); }, [load]);
  const totals = useMemo(() => {
    const l = list || [];
    const paid = l.reduce((a, h) => a + h.purchase_price_paise, 0);
    const now = l.reduce((a, h) => a + (h.current_value_paise ?? h.purchase_price_paise), 0);
    const loan = l.reduce((a, h) => a + (h.loan_outstanding_paise || 0), 0);
    return { paid, now, loan, equity: now - loan };
  }, [list]);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setMsg(null);
    try {
      await call('/api/buyer/portfolio', editId ? 'PATCH' : 'POST', editId ? { id: editId, ...form } : form);
      setForm(blank); setEditId(null); setMsg({ text: 'Saved.' }); load();
    } catch (e2) { setMsg({ text: (e2 as Error).message, err: true }); }
  }
  const rs = (p: number | null) => (p == null ? '—' : inr(p / 100));
  return (
    <div className="sub-stack" style={{ gap: 14 }}>
      {list && list.length > 0 && (
        <div className="sub-emi-out" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', marginTop: 0 }}>
          <div><span>Total paid</span><b>{rs(totals.paid)}</b></div>
          <div><span>Your estimate today</span><b>{rs(totals.now)}</b></div>
          <div><span>Loans outstanding</span><b>{rs(totals.loan)}</b></div>
          <div><span>Your equity</span><b>{rs(totals.equity)}</b></div>
        </div>
      )}
      {list && list.length > 0 && (
        <ul className="sub-list">
          {list.map((h) => {
            const gain = h.current_value_paise != null && h.purchase_price_paise ? Math.round(((h.current_value_paise - h.purchase_price_paise) / h.purchase_price_paise) * 1000) / 10 : null;
            return (
              <li key={h.id}>
                <span className="main"><b>{h.name}</b><small>{[h.location, h.purchase_date && `Bought ${h.purchase_date}`, h.area_sqft && `${h.area_sqft.toLocaleString('en-IN')} sq ft`].filter(Boolean).join(' · ')}</small></span>
                <span style={{ textAlign: 'right' }}><b>{rs(h.current_value_paise ?? h.purchase_price_paise)}</b><br /><small className="sub-muted">{gain != null ? `${gain >= 0 ? '+' : ''}${gain}% vs paid` : `Paid ${rs(h.purchase_price_paise)}`}</small></span>
                <span className="sub-toolbar">
                  <button className="sub-btn sm ghost" onClick={() => { setEditId(h.id); setForm({ name: h.name, location: h.location, purchase_price: h.purchase_price_paise ? String(h.purchase_price_paise / 100) : '', purchase_date: h.purchase_date, area_sqft: h.area_sqft ? String(h.area_sqft) : '', current_value: h.current_value_paise != null ? String(h.current_value_paise / 100) : '', loan_outstanding: h.loan_outstanding_paise != null ? String(h.loan_outstanding_paise / 100) : '', notes: h.notes }); }}>Edit</button>
                  <button className="sub-btn sm ghost" onClick={async () => { if (confirm(`Remove ${h.name}?`)) { await call(`/api/buyer/portfolio?id=${encodeURIComponent(h.id)}`, 'DELETE').catch(() => {}); load(); } }}>Remove</button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <form className="sub-form" onSubmit={save}>
        <label className="sub-field"><span>Property name *</span><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={160} placeholder="e.g. 2 BHK, Kharadi" /></label>
        <label className="sub-field"><span>Location</span><input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} maxLength={160} /></label>
        <label className="sub-field"><span>Purchase price (₹)</span><input inputMode="numeric" value={form.purchase_price} onChange={(e) => setForm({ ...form, purchase_price: e.target.value })} /></label>
        <label className="sub-field"><span>Purchase date</span><input type="month" value={form.purchase_date.slice(0, 7)} onChange={(e) => setForm({ ...form, purchase_date: e.target.value })} /></label>
        <label className="sub-field"><span>Carpet area (sq ft)</span><input inputMode="numeric" value={form.area_sqft} onChange={(e) => setForm({ ...form, area_sqft: e.target.value })} /></label>
        <label className="sub-field"><span>Your estimate of value today (₹)</span><input inputMode="numeric" value={form.current_value} onChange={(e) => setForm({ ...form, current_value: e.target.value })} /></label>
        <label className="sub-field"><span>Loan outstanding (₹)</span><input inputMode="numeric" value={form.loan_outstanding} onChange={(e) => setForm({ ...form, loan_outstanding: e.target.value })} /></label>
        <label className="sub-field"><span>Notes</span><input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} maxLength={2000} /></label>
        <div className="wide sub-toolbar"><button className="sub-btn primary">{editId ? 'Save changes' : 'Add property'}</button>{editId && <button type="button" className="sub-btn ghost" onClick={() => { setEditId(null); setForm(blank); }}>Cancel</button>}</div>
      </form>
      {msg && <p className={`sub-msg${msg.err ? ' err' : ''}`} role="status">{msg.text}</p>}
      <p className="sub-muted" style={{ fontSize: 12 }}>Values are your own entries — Mappingg does not value property. Ask for a portfolio review above for a conversation with our team.</p>
    </div>
  );
}
