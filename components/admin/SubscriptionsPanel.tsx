'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CATEGORY_LABEL, FEATURES, formatInr, METERS, PERIOD_LABEL, type Category } from '@/lib/subscriptions/catalog';

// Super admin → Subscriptions (owner only). Overview, plans & features, every
// account's subscription, payments & refunds, coupons, reports, buyer service
// requests, developer media review, future prices, settings, webhooks and the
// audit log. All writes go to /api/admin/subscriptions, which validates input,
// re-checks the owner session and records each change in sub_audit.

type Flash = (m: string, e?: boolean) => void;
type Any = Record<string, any>;
const SECTIONS = [
  { key: 'overview', label: 'Dashboard', icon: 'fa-gauge-high' },
  { key: 'plans', label: 'Plans & features', icon: 'fa-layer-group' },
  { key: 'subscriptions', label: 'Subscriptions', icon: 'fa-id-card' },
  { key: 'payments', label: 'Payments', icon: 'fa-receipt' },
  { key: 'refunds', label: 'Refunds', icon: 'fa-rotate-left' },
  { key: 'coupons', label: 'Coupons', icon: 'fa-ticket' },
  { key: 'reports', label: 'Reports', icon: 'fa-chart-column' },
  { key: 'ops', label: 'Requests & media', icon: 'fa-inbox' },
  { key: 'outlook', label: 'Future prices', icon: 'fa-chart-line' },
  { key: 'settings', label: 'Settings', icon: 'fa-gear' },
  { key: 'logs', label: 'Webhooks & audit', icon: 'fa-list-check' },
] as const;
type Section = (typeof SECTIONS)[number]['key'];

const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const fmtTime = (d?: string | null) => (d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const rupees = (p?: number | string | null) => formatInr(Number(p || 0));
const tone = (s: string) => (['ACTIVE', 'paid', 'completed', 'approved', 'processed', 'activated'].includes(s) ? '#24603a' : ['FAILED', 'failed', 'EXPIRED', 'CANCELLED', 'REFUNDED', 'SUSPENDED', 'rejected', 'cancelled', 'refunded', 'error'].includes(s) ? '#a9532d' : '#8a5a0b');
const Badge = ({ s, label }: { s: string; label?: string }) => <span className="adm-badge" style={{ color: tone(s), background: '#f6f5f0', border: '1px solid #e6e2d8', padding: '2px 8px', borderRadius: 999, fontSize: 11.5, fontWeight: 700 }}>{label || s}</span>;

async function api<T = Any>(view: string, params: Record<string, string> = {}): Promise<T> {
  const q = new URLSearchParams({ view, ...params });
  const r = await fetch(`/api/admin/subscriptions?${q}`, { credentials: 'same-origin', cache: 'no-store' });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(b?.error?.message || `Could not load (${r.status})`);
  return b.data as T;
}
async function post<T = Any>(body: Any): Promise<T> {
  const r = await fetch('/api/admin/subscriptions', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(b?.error?.message || `Request failed (${r.status})`);
  return b.data as T;
}

function useView<T>(view: string, params: Record<string, string> = {}) {
  const key = JSON.stringify(params);
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState('');
  const load = useCallback(() => { setErr(''); api<T>(view, JSON.parse(key)).then(setData).catch((e) => setErr(e.message)); }, [view, key]);
  useEffect(() => { load(); }, [load]);
  return { data, err, reload: load };
}

const Loading = ({ err }: { err?: string }) => err ? <div className="adm-panel" style={{ color: '#a9532d' }}><i className="fas fa-triangle-exclamation" /> {err}</div> : <div className="adm-panel"><i className="fas fa-spinner fa-spin" /> Loading…</div>;

const Field = ({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) => (
  <div className="adm-field" style={{ marginBottom: 10 }}><label>{label}{hint && <small> — {hint}</small>}</label>{children}</div>
);

const grid = (cols = 'repeat(auto-fit, minmax(200px, 1fr))'): React.CSSProperties => ({ display: 'grid', gridTemplateColumns: cols, gap: 12 });
const scroll: React.CSSProperties = { overflowX: 'auto' };

// ---------------------------------------------------------------- overview
function Overview({ flash, go }: { flash: Flash; go: (s: Section) => void }) {
  const { data, err, reload } = useView<Any>('overview');
  const [busy, setBusy] = useState(false);
  if (!data) return <Loading err={err} />;
  const count = (c: string, s: string) => data.counts?.[c]?.[s] || 0;
  async function setEnforce(on: boolean) {
    if (!confirm(on ? 'Turn ON enforcement? Plan limits will start blocking actions for every account immediately.' : 'Turn OFF enforcement? Limits will be recorded but nothing will be blocked.')) return;
    setBusy(true);
    try { await post({ action: 'settings.update', settings: { enforce: on } }); flash(on ? 'Enforcement is on' : 'Enforcement is off'); reload(); } catch (e) { flash((e as Error).message, true); } finally { setBusy(false); }
  }
  return (
    <>
      <div className="adm-panel" style={{ borderColor: data.enforce.effective ? '#cfe3c5' : '#f0d9a6', background: data.enforce.effective ? '#f3f8f1' : '#fdf8ec' }}>
        <div className="adm-panel-head" style={{ marginBottom: 6 }}>
          <h3><i className={`fas ${data.enforce.effective ? 'fa-shield-halved' : 'fa-triangle-exclamation'}`} /> Plan limits are {data.enforce.effective ? 'ENFORCED' : 'NOT enforced yet'}</h3>
          {data.enforce.env
            ? <span className="adm-hint">Set by the SUBSCRIPTION_ENFORCE env var ({data.enforce.env}) — change it in hosting settings.</span>
            : <button className={`adm-btn ${data.enforce.effective ? 'ghost' : 'primary'}`} disabled={busy} onClick={() => setEnforce(!data.enforce.setting)}>{data.enforce.setting ? 'Turn off' : 'Turn on enforcement'}</button>}
        </div>
        <p className="adm-hint" style={{ margin: 0 }}>{data.enforce.effective ? 'Free-plan limits, paid features, CP city rules and developer listing limits are applied on every request.' : 'Usage is being recorded and dashboards show plans, but nothing is blocked. Turn this on once payments are live and you have tested a purchase.'}</p>
      </div>

      <div className="adm-cards" style={{ marginTop: 16 }}>
        {[
          { ic: 'fa-indian-rupee-sign', n: rupees(data.mrr_paise), l: 'Monthly recurring revenue (est.)' },
          { ic: 'fa-sack-dollar', n: rupees(data.revenue_30d.paid_paise - data.revenue_30d.refunded_paise), l: `Net revenue, 30 days (${data.revenue_30d.payments} payments)` },
          { ic: 'fa-hourglass-half', n: data.expiring_7d, l: 'Expiring in 7 days', go: 'subscriptions' as Section },
          { ic: 'fa-credit-card', n: data.failed_30d, l: 'Failed payments, 30 days', go: 'payments' as Section },
        ].map((s) => (
          <div className="adm-stat" key={s.l} style={{ cursor: s.go ? 'pointer' : undefined }} onClick={() => s.go && go(s.go)}>
            <div className="ic" style={{ background: '#e8f2e1', color: '#0f5c47' }}><i className={`fas ${s.ic}`} /></div>
            <div className="num" style={{ fontSize: 24 }}>{s.n}</div><div className="lbl">{s.l}</div>
          </div>
        ))}
      </div>

      <div className="adm-panel">
        <div className="adm-panel-head"><h3>Active subscriptions</h3></div>
        <div style={scroll}>
          <table className="adm-table">
            <thead><tr><th>Account type</th><th>Active</th><th>Renewal due (grace)</th><th>Suspended</th></tr></thead>
            <tbody>{(['developer', 'cp', 'buyer'] as Category[]).map((c) => <tr key={c}><td className="t-title">{CATEGORY_LABEL[c]}</td><td>{count(c, 'ACTIVE')}</td><td>{count(c, 'PAST_DUE')}</td><td>{count(c, 'SUSPENDED')}</td></tr>)}</tbody>
          </table>
        </div>
      </div>

      <div className="adm-panel">
        <div className="adm-panel-head"><h3>Setup health</h3><button className="adm-btn ghost sm" disabled={busy} onClick={async () => { setBusy(true); try { const r = await post({ action: 'cron.run' }); flash(`Lifecycle run: ${r.reminders} reminders, ${r.expired} expired, ${r.reconciled} reconciled`); reload(); } catch (e) { flash((e as Error).message, true); } finally { setBusy(false); } }}><i className="fas fa-play" /> Run lifecycle now</button></div>
        <table className="adm-table"><tbody>
          <tr><td className="t-title">Payment gateway</td><td>{data.gateway.configured ? <Badge s="ACTIVE" label={`Razorpay · ${data.gateway.mode} mode`} /> : <Badge s="FAILED" label="Not configured — add RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET" />}</td></tr>
          <tr><td className="t-title">Webhook secret</td><td>{data.gateway.webhook ? <Badge s="ACTIVE" label="Set" /> : <Badge s="FAILED" label="Missing — RAZORPAY_WEBHOOK_SECRET" />} {data.last_webhook && <span className="adm-hint">Last event {fmtTime(data.last_webhook.at)} ({data.last_webhook.event} → {data.last_webhook.outcome})</span>}</td></tr>
          <tr><td className="t-title">Scheduled job</td><td>{data.cron.configured ? <Badge s="ACTIVE" label="CRON_SECRET set" /> : <Badge s="FAILED" label="CRON_SECRET missing" />} <span className="adm-hint">Last run: {fmtTime(data.cron.last_run)}</span></td></tr>
          <tr><td className="t-title">Waiting for you</td><td><button className="adm-btn ghost sm" onClick={() => go('ops')}>{data.pending_media} media to review · {data.open_requests} buyer requests</button></td></tr>
        </tbody></table>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- plans
function PlanEditor({ plan, isNew, onSaved, onCancel, flash }: { plan: Any; isNew: boolean; onSaved: () => void; onCancel: () => void; flash: Flash }) {
  const [p, setP] = useState<Any>(() => ({ ...plan, price_rupees: String((plan.price_paise || 0) / 100) }));
  const feats = FEATURES.filter((f) => f.category === p.category);
  const metered = Object.values(METERS).map((m) => m.limit);
  async function save() {
    try {
      const body = {
        name: p.name, tagline: p.tagline, description: p.description, price_paise: Math.round(Number(p.price_rupees || 0) * 100), billing_period: p.billing_period,
        billing_unit: p.billing_unit, min_quantity: Number(p.min_quantity) || 1, max_quantity: p.max_quantity === '' || p.max_quantity == null ? null : Number(p.max_quantity),
        is_active: !!p.is_active, recommended: !!p.recommended, sort: Number(p.sort) || 0, features: p.features, limits: p.limits, limit_periods: p.limit_periods,
        ...(isNew ? { category: p.category, code: p.code } : {}),
      };
      await post(isNew ? { action: 'plan.create', plan: body } : { action: 'plan.update', id: p.id, plan: body });
      flash('Plan saved'); onSaved();
    } catch (e) { flash((e as Error).message, true); }
  }
  return (
    <div className="adm-panel">
      <div className="adm-panel-head"><h3>{isNew ? 'New plan' : `Edit ${plan.name}`}</h3><div style={{ display: 'flex', gap: 8 }}><button className="adm-btn ghost" onClick={onCancel}>Cancel</button><button className="adm-btn primary" onClick={save}>Save plan</button></div></div>
      <div style={grid()}>
        {isNew && <Field label="Account type"><select value={p.category} onChange={(e) => setP({ ...p, category: e.target.value, features: {}, limits: {} })}>{(['developer', 'cp', 'buyer'] as Category[]).map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</select></Field>}
        {isNew && <Field label="Code" hint="a–z, 0–9, _"><input value={p.code || ''} onChange={(e) => setP({ ...p, code: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })} /></Field>}
        <Field label="Name"><input value={p.name || ''} onChange={(e) => setP({ ...p, name: e.target.value })} /></Field>
        <Field label="Price (₹)" hint="0 = free plan"><input type="number" min={0} step={1} value={p.price_rupees} onChange={(e) => setP({ ...p, price_rupees: e.target.value })} /></Field>
        <Field label="Billing cycle"><select value={p.billing_period} onChange={(e) => setP({ ...p, billing_period: e.target.value })}>{Object.entries(PERIOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Billing unit"><select value={p.billing_unit} onChange={(e) => setP({ ...p, billing_unit: e.target.value })}><option value="account">Per account</option><option value="project">Per project</option></select></Field>
        {p.billing_unit === 'project' && <Field label="Min projects"><input type="number" min={1} value={p.min_quantity ?? 1} onChange={(e) => setP({ ...p, min_quantity: e.target.value })} /></Field>}
        {p.billing_unit === 'project' && <Field label="Max projects" hint="blank = no limit"><input type="number" min={1} value={p.max_quantity ?? ''} onChange={(e) => setP({ ...p, max_quantity: e.target.value })} /></Field>}
        <Field label="Display order"><input type="number" min={0} value={p.sort ?? 0} onChange={(e) => setP({ ...p, sort: e.target.value })} /></Field>
      </div>
      <Field label="Tagline"><input value={p.tagline || ''} onChange={(e) => setP({ ...p, tagline: e.target.value })} maxLength={200} /></Field>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', margin: '4px 0 14px' }}>
        <label className="adm-hint"><input type="checkbox" checked={!!p.is_active} onChange={(e) => setP({ ...p, is_active: e.target.checked })} /> Active (offered to customers)</label>
        <label className="adm-hint"><input type="checkbox" checked={!!p.recommended} onChange={(e) => setP({ ...p, recommended: e.target.checked })} /> Highlight as recommended</label>
      </div>
      <h4 style={{ margin: '6px 0 8px' }}>Limits <small className="adm-hint">— blank = unlimited</small></h4>
      <div style={grid('repeat(auto-fit, minmax(240px, 1fr))')}>
        {feats.filter((f) => f.kind === 'limit').map((f) => (
          <Field key={f.key} label={f.label}>
            <div style={{ display: 'flex', gap: 6 }}>
              <input type="number" min={0} value={p.limits?.[f.key] ?? ''} onChange={(e) => setP({ ...p, limits: { ...p.limits, [f.key]: e.target.value === '' ? null : Number(e.target.value) } })} />
              {metered.includes(f.key) && (
                <select value={p.limit_periods?.[f.key] || Object.values(METERS).find((m) => m.limit === f.key)?.period} onChange={(e) => setP({ ...p, limit_periods: { ...p.limit_periods, [f.key]: e.target.value } })} style={{ width: 120 }}>
                  <option value="week">per week</option><option value="month">per month</option><option value="lifetime">in total</option>
                </select>
              )}
            </div>
          </Field>
        ))}
      </div>
      <h4 style={{ margin: '6px 0 8px' }}>Features</h4>
      <div style={grid('repeat(auto-fit, minmax(260px, 1fr))')}>
        {feats.filter((f) => f.kind === 'flag').map((f) => (
          <label key={f.key} className="adm-hint" style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }} title={f.description}>
            <input type="checkbox" checked={p.features?.[f.key] === true} onChange={(e) => setP({ ...p, features: { ...p.features, [f.key]: e.target.checked } })} />
            <span>{f.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function Plans({ flash }: { flash: Flash }) {
  const { data, err, reload } = useView<{ plans: Any[] }>('plans');
  const [edit, setEdit] = useState<{ plan: Any; isNew: boolean } | null>(null);
  if (!data) return <Loading err={err} />;
  if (edit) return <PlanEditor plan={edit.plan} isNew={edit.isNew} flash={flash} onCancel={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />;
  return (
    <>
      <div className="adm-panel" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="adm-hint">Prices, billing cycles, features and limits are read from here on every request — changes apply immediately. Existing subscribers keep the price they paid until renewal.</span>
        <button className="adm-btn primary" onClick={() => setEdit({ isNew: true, plan: { category: 'developer', code: '', name: '', price_paise: 0, billing_period: 'month', billing_unit: 'account', is_active: false, features: {}, limits: {}, limit_periods: {}, sort: 9 } })}><i className="fas fa-plus" /> New plan</button>
      </div>
      {(['developer', 'cp', 'buyer'] as Category[]).map((c) => (
        <div className="adm-panel" key={c}>
          <div className="adm-panel-head"><h3>{CATEGORY_LABEL[c]} plans</h3></div>
          <div style={scroll}>
            <table className="adm-table">
              <thead><tr><th>Plan</th><th>Price</th><th>Billing</th><th>Key limits</th><th>Status</th><th /></tr></thead>
              <tbody>
                {data.plans.filter((p) => p.category === c).map((p) => (
                  <tr key={p.id}>
                    <td><span className="t-title">{p.name}</span>{p.recommended && <> <Badge s="ACTIVE" label="Recommended" /></>}<br /><small className="adm-hint">{p.code}</small></td>
                    <td>{p.is_free ? 'Free' : rupees(p.price_paise)}</td>
                    <td>{PERIOD_LABEL[p.billing_period as keyof typeof PERIOD_LABEL]}{p.billing_unit === 'project' ? ' · per project' : ''}</td>
                    <td><small>{Object.entries(p.limits || {}).map(([k, v]) => `${FEATURES.find((f) => f.key === k)?.label || k}: ${v === null ? '∞' : v}`).join(' · ')}</small></td>
                    <td>{p.is_active ? <Badge s="ACTIVE" label="Active" /> : <Badge s="CANCELLED" label="Inactive" />}</td>
                    <td><button className="adm-btn ghost sm" onClick={() => setEdit({ isNew: false, plan: p })}>Edit</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </>
  );
}

// ---------------------------------------------------------------- subscriptions
function Subscriptions({ flash, plans }: { flash: Flash; plans: Any[] }) {
  const [f, setF] = useState({ category: '', status: '', q: '' });
  const [applied, setApplied] = useState(f);
  const { data, err, reload } = useView<Any[]>('subscriptions', Object.fromEntries(Object.entries(applied).filter(([, v]) => v)) as Record<string, string>);
  const [act, setAct] = useState({ user: '', plan: '', months: '1', city: '', project_ids: '', reason: '' });
  const [detail, setDetail] = useState<Any | null>(null);
  async function op(id: string, opName: string, extra: Any = {}) {
    const reason = prompt('Reason (kept in the audit log):');
    if (!reason) return;
    try { await post({ action: 'sub.update', id, op: opName, reason, ...extra }); flash('Saved'); reload(); } catch (e) { flash((e as Error).message, true); }
  }
  async function activate(e: React.FormEvent) {
    e.preventDefault();
    try {
      await post({ action: 'sub.activate', ...act, months: Number(act.months), project_ids: act.project_ids.split(/[\s,]+/).filter(Boolean) });
      flash('Subscription activated'); setAct({ user: '', plan: '', months: '1', city: '', project_ids: '', reason: '' }); reload();
    } catch (e2) { flash((e2 as Error).message, true); }
  }
  async function openUser(q: string) { try { setDetail(await api('user', { q })); } catch (e) { flash((e as Error).message, true); } }
  return (
    <>
      <div className="adm-panel">
        <div className="adm-filterbar" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}><option value="">All types</option><option value="developer">Developers</option><option value="cp">Channel partners</option><option value="buyer">Buyers</option></select>
          <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            <option value="">All statuses</option><option value="ACTIVE">Active</option><option value="expiring">Expiring (7 days)</option><option value="past_due">Renewal due</option><option value="expired">Expired</option><option value="CANCELLED">Cancelled</option><option value="SUSPENDED">Suspended</option><option value="REFUNDED">Refunded</option>
          </select>
          <input placeholder="Account email" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} style={{ flex: 1, minWidth: 180 }} />
          <button className="adm-btn primary" onClick={() => setApplied(f)}>Filter</button>
        </div>
      </div>
      {!data ? <Loading err={err} /> : (
        <div className="adm-panel" style={scroll}>
          <table className="adm-table">
            <thead><tr><th>Account</th><th>Plan</th><th>Status</th><th>Expires</th><th>City / projects</th><th>Source</th><th>Actions</th></tr></thead>
            <tbody>
              {data.length ? data.map((s) => (
                <tr key={s.id}>
                  <td><button className="adm-btn ghost sm" onClick={() => openUser(s.user?.email || s.user_id)}>{s.user?.email || s.user_id}</button><br /><small className="adm-hint">{CATEGORY_LABEL[s.category as Category]}</small></td>
                  <td className="t-title">{s.plan_name}<br /><small className="adm-hint">{rupees(s.amount_paise)}</small></td>
                  <td><Badge s={s.effective_status} /></td>
                  <td>{fmtDate(s.expires_at)}{s.cancel_at_period_end && <><br /><small className="adm-hint">won’t renew</small></>}</td>
                  <td><small>{s.city || ''}{s.project_ids?.length ? `${s.project_ids.length} project(s)` : ''}</small></td>
                  <td><small>{s.source}</small></td>
                  <td>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      <button className="adm-btn ghost sm" onClick={() => { const d = prompt('Extend by how many days?', '30'); if (d) op(s.id, 'extend', { days: Number(d) }); }}>Extend</button>
                      {s.status === 'SUSPENDED' ? <button className="adm-btn ghost sm" onClick={() => op(s.id, 'resume')}>Resume</button> : ['ACTIVE', 'PAST_DUE'].includes(s.status) && <button className="adm-btn ghost sm" onClick={() => op(s.id, 'suspend')}>Suspend</button>}
                      {s.category === 'cp' && <button className="adm-btn ghost sm" onClick={() => { const c = prompt('City key (pune, mumbai, bengaluru, hyderabad, delhi, nashik, dubai):', s.city || ''); if (c) op(s.id, 'set_city', { city: c }); }}>City</button>}
                      {['ACTIVE', 'PAST_DUE', 'SUSPENDED'].includes(s.status) && <button className="adm-btn danger sm" onClick={() => op(s.id, 'cancel_now')}>Cancel</button>}
                    </div>
                  </td>
                </tr>
              )) : <tr><td colSpan={7} className="adm-hint">No subscriptions match.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {detail && (
        <div className="adm-panel">
          <div className="adm-panel-head"><h3>{detail.user.email} · {detail.user.role}</h3><button className="adm-btn ghost sm" onClick={() => setDetail(null)}>Close</button></div>
          <div style={grid('repeat(auto-fit, minmax(300px, 1fr))')}>
            <div><b>Subscriptions</b><ul className="adm-hint">{detail.subscriptions.map((s: Any) => <li key={s.id}>{s.plan_name} — {s.status} ({fmtDate(s.start_at)} → {fmtDate(s.expires_at)})</li>)}</ul></div>
            <div><b>Payments</b><ul className="adm-hint">{detail.payments.map((p: Any) => <li key={p.id}>{fmtDate(p.created_at)} · {p.plan_name} · {rupees(p.total_paise)} · {p.status}</li>)}</ul></div>
            <div><b>Usage</b><ul className="adm-hint">{detail.usage.map((u: Any) => <li key={`${u.metric}${u.period_key}`}>{u.metric} {u.period_key}: {u.n}</li>)}</ul></div>
            <div><b>History</b><ul className="adm-hint">{detail.history.slice(0, 30).map((h: Any) => <li key={h.id}>{fmtTime(h.at)} · {h.action}{h.to_plan ? ` → ${h.to_plan}` : ''} · {h.actor}</li>)}</ul></div>
          </div>
        </div>
      )}

      <form className="adm-panel" onSubmit={activate}>
        <div className="adm-panel-head"><h3>Manual activation</h3><span className="adm-hint">Complimentary plan without payment — e.g. a trial or an offline payment. Audited.</span></div>
        <div style={grid()}>
          <Field label="Account email"><input required value={act.user} onChange={(e) => setAct({ ...act, user: e.target.value })} /></Field>
          <Field label="Plan"><select required value={act.plan} onChange={(e) => setAct({ ...act, plan: e.target.value })}><option value="">Choose…</option>{plans.filter((p) => !p.is_free).map((p) => <option key={p.code} value={p.code}>{CATEGORY_LABEL[p.category as Category]} — {p.name}</option>)}</select></Field>
          <Field label="Months"><input type="number" min={1} max={36} value={act.months} onChange={(e) => setAct({ ...act, months: e.target.value })} /></Field>
          <Field label="CP city" hint="CP one-city plans"><input value={act.city} onChange={(e) => setAct({ ...act, city: e.target.value })} placeholder="pune" /></Field>
          <Field label="Developer project ids" hint="comma separated"><input value={act.project_ids} onChange={(e) => setAct({ ...act, project_ids: e.target.value })} /></Field>
          <Field label="Reason"><input required minLength={3} value={act.reason} onChange={(e) => setAct({ ...act, reason: e.target.value })} /></Field>
        </div>
        <button className="adm-btn primary">Activate</button>
      </form>
    </>
  );
}

// ---------------------------------------------------------------- payments
function Payments({ flash }: { flash: Flash }) {
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [applied, setApplied] = useState({ status: '', q: '' });
  const { data, err, reload } = useView<Any[]>('payments', Object.fromEntries(Object.entries(applied).filter(([, v]) => v)) as Record<string, string>);
  async function refund(p: Any) {
    const amt = prompt(`Refund amount in ₹ (blank = full ${rupees(p.total_paise - p.refunded_paise)}):`, '');
    if (amt === null) return;
    const reason = prompt('Reason for the refund:');
    if (!reason) return;
    const revoke = confirm('Also end the customer’s plan now? (A full refund always ends it.)');
    try {
      const r = await post({ action: 'refund', payment_id: p.id, amount_paise: amt.trim() ? Math.round(Number(amt) * 100) : null, reason, revoke });
      flash(`Refund ${r.status}: ${rupees(r.amount_paise)}`); reload();
    } catch (e) { flash((e as Error).message, true); }
  }
  async function close(p: Any) {
    const reason = prompt('Why close this unpaid order?');
    if (!reason) return;
    try { await post({ action: 'payment.mark_failed', id: p.id, reason }); flash('Order closed'); reload(); } catch (e) { flash((e as Error).message, true); }
  }
  return (
    <>
      <div className="adm-panel" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All payments</option><option value="paid">Paid</option><option value="failed">Failed</option><option value="pending">Pending</option><option value="created">Not completed</option><option value="cancelled">Cancelled</option><option value="refunded">Refunded</option><option value="partially_refunded">Part refunded</option></select>
        <input placeholder="Email, payment id or order id" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
        <button className="adm-btn primary" onClick={() => setApplied({ status, q })}>Filter</button>
      </div>
      {!data ? <Loading err={err} /> : (
        <div className="adm-panel" style={scroll}>
          <table className="adm-table">
            <thead><tr><th>Date</th><th>Account</th><th>Plan</th><th>Amount</th><th>Status</th><th>Gateway ref</th><th /></tr></thead>
            <tbody>
              {data.length ? data.map((p) => (
                <tr key={p.id}>
                  <td><small>{fmtTime(p.paid_at || p.created_at)}</small></td>
                  <td><small>{p.user?.email || p.user_id}</small></td>
                  <td>{p.plan_name}{p.quantity > 1 ? ` × ${p.quantity}` : ''}<br /><small className="adm-hint">{p.kind}{p.coupon_code ? ` · ${p.coupon_code}` : ''}</small></td>
                  <td className="t-title">{rupees(p.total_paise)}{p.refunded_paise > 0 && <><br /><small style={{ color: '#a9532d' }}>−{rupees(p.refunded_paise)}</small></>}</td>
                  <td><Badge s={p.status} />{p.failure_reason && <><br /><small className="adm-hint">{p.failure_reason}</small></>}</td>
                  <td><small>{p.gateway_payment_id || p.gateway_order_id || '—'}</small></td>
                  <td>
                    {['paid', 'partially_refunded'].includes(p.status) && p.gateway !== 'none' && <button className="adm-btn danger sm" onClick={() => refund(p)}>Refund</button>}
                    {['created', 'pending'].includes(p.status) && <button className="adm-btn ghost sm" onClick={() => close(p)}>Close</button>}
                  </td>
                </tr>
              )) : <tr><td colSpan={7} className="adm-hint">No payments.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Refunds() {
  const { data, err } = useView<Any[]>('refunds');
  if (!data) return <Loading err={err} />;
  return (
    <div className="adm-panel" style={scroll}>
      <table className="adm-table">
        <thead><tr><th>Date</th><th>Account</th><th>Plan</th><th>Refund</th><th>Status</th><th>Reason</th><th>By</th></tr></thead>
        <tbody>{data.length ? data.map((r) => <tr key={r.id}><td><small>{fmtTime(r.created_at)}</small></td><td><small>{r.user?.email}</small></td><td>{r.plan_name}</td><td className="t-title">{rupees(r.amount_paise)} <small className="adm-hint">of {rupees(r.total_paise)}</small></td><td><Badge s={r.status} /></td><td><small>{r.reason}</small></td><td><small>{r.actor}</small></td></tr>) : <tr><td colSpan={7} className="adm-hint">No refunds yet.</td></tr>}</tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------- coupons
function Coupons({ flash }: { flash: Flash }) {
  const { data, err, reload } = useView<Any[]>('coupons');
  const blank = { code: '', description: '', percent_off: '', amount_rupees: '', categories: '', plan_codes: '', max_redemptions: '', per_user_limit: '1', valid_from: '', valid_until: '', is_active: true };
  const [c, setC] = useState<Any>(blank);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      await post({ action: 'coupon.save', coupon: { ...c, percent_off: Number(c.percent_off) || 0, amount_off_paise: Math.round(Number(c.amount_rupees || 0) * 100) } });
      flash('Coupon saved'); setC(blank); reload();
    } catch (e2) { flash((e2 as Error).message, true); }
  }
  return (
    <>
      <form className="adm-panel" onSubmit={save}>
        <div className="adm-panel-head"><h3>{c.code && data?.some((x) => x.code === c.code) ? `Edit ${c.code}` : 'New coupon'}</h3></div>
        <div style={grid()}>
          <Field label="Code"><input required value={c.code} onChange={(e) => setC({ ...c, code: e.target.value.toUpperCase() })} /></Field>
          <Field label="% off"><input type="number" min={0} max={100} value={c.percent_off} onChange={(e) => setC({ ...c, percent_off: e.target.value })} /></Field>
          <Field label="₹ off"><input type="number" min={0} value={c.amount_rupees} onChange={(e) => setC({ ...c, amount_rupees: e.target.value })} /></Field>
          <Field label="Account types" hint="developer, cp, buyer — blank = all"><input value={c.categories} onChange={(e) => setC({ ...c, categories: e.target.value })} /></Field>
          <Field label="Plan codes" hint="blank = all"><input value={c.plan_codes} onChange={(e) => setC({ ...c, plan_codes: e.target.value })} /></Field>
          <Field label="Max uses" hint="blank = unlimited"><input type="number" min={0} value={c.max_redemptions} onChange={(e) => setC({ ...c, max_redemptions: e.target.value })} /></Field>
          <Field label="Uses per account"><input type="number" min={0} value={c.per_user_limit} onChange={(e) => setC({ ...c, per_user_limit: e.target.value })} /></Field>
          <Field label="Valid from"><input type="date" value={c.valid_from} onChange={(e) => setC({ ...c, valid_from: e.target.value })} /></Field>
          <Field label="Valid until"><input type="date" value={c.valid_until} onChange={(e) => setC({ ...c, valid_until: e.target.value })} /></Field>
        </div>
        <Field label="Description"><input value={c.description} onChange={(e) => setC({ ...c, description: e.target.value })} /></Field>
        <label className="adm-hint"><input type="checkbox" checked={c.is_active} onChange={(e) => setC({ ...c, is_active: e.target.checked })} /> Active</label>
        <div style={{ marginTop: 10 }}><button className="adm-btn primary">Save coupon</button></div>
      </form>
      {!data ? <Loading err={err} /> : (
        <div className="adm-panel" style={scroll}>
          <table className="adm-table">
            <thead><tr><th>Code</th><th>Discount</th><th>Applies to</th><th>Used</th><th>Valid</th><th>Status</th><th /></tr></thead>
            <tbody>{data.length ? data.map((x) => (
              <tr key={x.code}>
                <td className="t-title">{x.code}<br /><small className="adm-hint">{x.description}</small></td>
                <td>{[x.percent_off ? `${x.percent_off}%` : '', x.amount_off_paise ? rupees(x.amount_off_paise) : ''].filter(Boolean).join(' + ')}</td>
                <td><small>{[x.categories?.join(', '), x.plan_codes?.join(', ')].filter(Boolean).join(' · ') || 'All plans'}</small></td>
                <td>{x.redeemed}{x.max_redemptions != null ? ` / ${x.max_redemptions}` : ''}</td>
                <td><small>{x.valid_from ? fmtDate(x.valid_from) : 'now'} → {x.valid_until ? fmtDate(x.valid_until) : 'no end'}</small></td>
                <td>{x.is_active ? <Badge s="ACTIVE" label="Active" /> : <Badge s="CANCELLED" label="Off" />}</td>
                <td><button className="adm-btn ghost sm" onClick={() => setC({ ...x, amount_rupees: x.amount_off_paise ? String(x.amount_off_paise / 100) : '', categories: (x.categories || []).join(', '), plan_codes: (x.plan_codes || []).join(', '), max_redemptions: x.max_redemptions ?? '', valid_from: x.valid_from?.slice(0, 10) || '', valid_until: x.valid_until?.slice(0, 10) || '' })}>Edit</button></td>
              </tr>
            )) : <tr><td colSpan={7} className="adm-hint">No coupons.</td></tr>}</tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- reports
function Reports() {
  const { data, err } = useView<Any>('reports');
  const months = useMemo(() => {
    if (!data) return [];
    const by = new Map<string, Any>();
    for (const r of data.monthly) {
      const m = by.get(r.month) || { month: r.month, developer: 0, cp: 0, buyer: 0, refunded: 0, payments: 0 };
      m[r.category] += r.revenue_paise; m.refunded += r.refunded_paise; m.payments += r.payments;
      by.set(r.month, m);
    }
    return [...by.values()];
  }, [data]);
  if (!data) return <Loading err={err} />;
  const max = Math.max(1, ...months.map((m) => m.developer + m.cp + m.buyer));
  const COL: Record<string, string> = { developer: '#0f5c47', cp: '#b0924f', buyer: '#5b8db8' };
  return (
    <>
      <div className="adm-panel">
        <div className="adm-panel-head"><h3>Revenue by month (last 12)</h3><span className="adm-hint">{Object.entries(COL).map(([k, c]) => <span key={k} style={{ marginLeft: 10 }}><i className="fas fa-square" style={{ color: c }} /> {CATEGORY_LABEL[k as Category]}</span>)}</span></div>
        {months.length ? (
          <div style={scroll}>
            <table className="adm-table">
              <thead><tr><th>Month</th><th style={{ width: '45%' }} /><th>Developer</th><th>CP</th><th>Buyer</th><th>Refunded</th><th>Net</th></tr></thead>
              <tbody>{months.map((m) => {
                const total = m.developer + m.cp + m.buyer;
                return (
                  <tr key={m.month}>
                    <td className="t-title">{m.month}</td>
                    <td><div style={{ display: 'flex', height: 12, borderRadius: 6, overflow: 'hidden', background: '#f1efe8', width: `${Math.max(2, (total / max) * 100)}%` }} aria-hidden="true">{(['developer', 'cp', 'buyer'] as const).map((k) => <span key={k} style={{ width: `${total ? (m[k] / total) * 100 : 0}%`, background: COL[k] }} />)}</div></td>
                    <td>{rupees(m.developer)}</td><td>{rupees(m.cp)}</td><td>{rupees(m.buyer)}</td><td>{rupees(m.refunded)}</td><td className="t-title">{rupees(total - m.refunded)}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        ) : <p className="adm-hint">No paid subscriptions yet.</p>}
      </div>
      <div className="adm-grid2" style={grid('repeat(auto-fit, minmax(300px, 1fr))')}>
        <div className="adm-panel"><div className="adm-panel-head"><h3>Active by plan</h3></div><table className="adm-table"><tbody>{data.byPlan.length ? data.byPlan.map((p: Any) => <tr key={p.plan_code}><td>{p.plan_code}</td><td className="t-title">{p.active}</td></tr>) : <tr><td className="adm-hint">None yet.</td></tr>}</tbody></table></div>
        <div className="adm-panel"><div className="adm-panel-head"><h3>Lifecycle events</h3></div><table className="adm-table"><tbody>{data.events.length ? data.events.map((e: Any) => <tr key={`${e.month}${e.action}`}><td>{e.month}</td><td>{e.action}</td><td className="t-title">{e.n}</td></tr>) : <tr><td className="adm-hint">None yet.</td></tr>}</tbody></table></div>
        <div className="adm-panel"><div className="adm-panel-head"><h3>Coupon usage</h3></div><table className="adm-table"><tbody>{data.coupons.length ? data.coupons.map((c: Any) => <tr key={c.code}><td>{c.code}</td><td>{c.uses} uses</td><td className="t-title">{rupees(c.discount_paise)}</td></tr>) : <tr><td className="adm-hint">None yet.</td></tr>}</tbody></table></div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- requests & media
function Ops({ flash }: { flash: Flash }) {
  const { data, err, reload } = useView<{ services: Any[]; media: Any[] }>('ops');
  if (!data) return <Loading err={err} />;
  async function svc(id: string, patch: Any) { try { await post({ action: 'service.update', id, ...patch }); flash('Updated'); reload(); } catch (e) { flash((e as Error).message, true); } }
  async function media(id: string, approve: boolean) {
    const note = approve ? '' : prompt('Why is it not approved? (shown to the developer)') || '';
    if (!approve && !note) return;
    try { await post({ action: 'media.review', id, approve, note }); flash(approve ? 'Approved — now on the map' : 'Rejected'); reload(); } catch (e) { flash((e as Error).message, true); }
  }
  const TYPES: Any = { expert: 'Property expert', legal: 'Legal review', vastu: 'Vastu', portfolio: 'Portfolio review' };
  return (
    <>
      <div className="adm-panel" style={scroll}>
        <div className="adm-panel-head"><h3>Developer media to review</h3></div>
        <table className="adm-table">
          <thead><tr><th>Sent</th><th>Developer</th><th>Project</th><th>Type</th><th>File</th><th>Status</th><th /></tr></thead>
          <tbody>{data.media.length ? data.media.map((m) => (
            <tr key={m.id}>
              <td><small>{fmtTime(m.created_at)}</small></td><td><small>{m.user?.email}</small></td><td>{m.project}</td><td>{m.kind}{m.title ? ` — ${m.title}` : ''}</td>
              <td><a className="adm-btn ghost sm" href={m.url} target="_blank" rel="noopener">Open</a></td>
              <td><Badge s={m.status} />{m.note && <><br /><small className="adm-hint">{m.note}</small></>}</td>
              <td>{m.status === 'pending' && <div style={{ display: 'flex', gap: 4 }}><button className="adm-btn primary sm" onClick={() => media(m.id, true)}>Approve</button><button className="adm-btn danger sm" onClick={() => media(m.id, false)}>Reject</button></div>}</td>
            </tr>
          )) : <tr><td colSpan={7} className="adm-hint">Nothing to review.</td></tr>}</tbody>
        </table>
      </div>
      <div className="adm-panel" style={scroll}>
        <div className="adm-panel-head"><h3>Buyer Premium requests</h3><span className="adm-hint">Update the status as the call / review happens — the buyer sees it.</span></div>
        <table className="adm-table">
          <thead><tr><th>Requested</th><th>Buyer</th><th>Need</th><th>Preferred</th><th>Message</th><th>Status</th><th>Note to buyer</th></tr></thead>
          <tbody>{data.services.length ? data.services.map((s) => (
            <tr key={s.id}>
              <td><small>{fmtTime(s.created_at)}</small></td>
              <td><small>{s.user?.email}<br />{s.contact_phone}</small></td>
              <td>{TYPES[s.type] || s.type}{s.project_title && <><br /><small className="adm-hint">{s.project_title}</small></>}</td>
              <td><small>{s.preferred_date} {s.preferred_time}</small></td>
              <td><small>{s.message}</small></td>
              <td><select value={s.status} onChange={(e) => svc(s.id, { status: e.target.value })}>{['requested', 'scheduled', 'in_progress', 'completed', 'cancelled'].map((x) => <option key={x} value={x}>{x.replace('_', ' ')}</option>)}</select></td>
              <td><input defaultValue={s.admin_note} placeholder="e.g. Call on Sat 11am" onBlur={(e) => { if (e.target.value !== s.admin_note) svc(s.id, { admin_note: e.target.value }); }} /></td>
            </tr>
          )) : <tr><td colSpan={7} className="adm-hint">No requests.</td></tr>}</tbody>
        </table>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- future prices
function Outlook({ flash }: { flash: Flash }) {
  const { data, err, reload } = useView<Any[]>('outlook');
  const blank = { pin: '', expected_price: '', horizon: '', note: '', source: '' };
  const [f, setF] = useState(blank);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    try { await post({ action: 'outlook.set', pin_id: f.pin, ...f }); flash(f.expected_price ? 'Published' : 'Removed'); setF(blank); reload(); } catch (e2) { flash((e2 as Error).message, true); }
  }
  return (
    <>
      <form className="adm-panel" onSubmit={save}>
        <div className="adm-panel-head"><h3>Publish a future price</h3><span className="adm-hint">Shown to Pro Max channel partners with its source. Only publish figures you can stand behind — leave the price blank to remove one.</span></div>
        <div style={grid()}>
          <Field label="Pin number or id"><input required value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value })} /></Field>
          <Field label="Expected price"><input value={f.expected_price} onChange={(e) => setF({ ...f, expected_price: e.target.value })} placeholder="₹ 1.35 Cr onwards" /></Field>
          <Field label="When"><input value={f.horizon} onChange={(e) => setF({ ...f, horizon: e.target.value })} placeholder="From 1 Jan 2027" /></Field>
          <Field label="Source"><input value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} placeholder="Developer price list dated …" /></Field>
        </div>
        <Field label="Note"><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        <button className="adm-btn primary">Save</button>
      </form>
      {!data ? <Loading err={err} /> : (
        <div className="adm-panel" style={scroll}>
          <table className="adm-table">
            <thead><tr><th>Project</th><th>Now</th><th>Expected</th><th>When</th><th>Source</th><th>Updated</th><th /></tr></thead>
            <tbody>{data.length ? data.map((o) => <tr key={o.pin_id}><td className="t-title">#{o.number} {o.title}</td><td><small>{o.current_price}</small></td><td>{o.expected_price}</td><td><small>{o.horizon}</small></td><td><small>{o.source}</small></td><td><small>{fmtDate(o.updated_at)} · {o.updated_by}</small></td><td><button className="adm-btn ghost sm" onClick={() => setF({ pin: o.pin_id, expected_price: o.expected_price, horizon: o.horizon, note: o.note, source: o.source })}>Edit</button></td></tr>) : <tr><td colSpan={7} className="adm-hint">Nothing published.</td></tr>}</tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- settings
function Settings({ flash }: { flash: Flash }) {
  const { data, err, reload } = useView<Any>('settings');
  const [s, setS] = useState<Any | null>(null);
  useEffect(() => { if (data) setS({ ...data, reminder_text: (data.reminder_days || []).join(', ') }); }, [data]);
  if (!s) return <Loading err={err} />;
  return <SettingsForm s={s} setS={setS} flash={flash} reload={reload} />;
}

function SettingsForm({ s, setS, flash, reload }: { s: Any; setS: (v: Any) => void; flash: Flash; reload: () => void }) {
  const tax = s.tax || {};
  const setTax = (k: string, v: unknown) => setS({ ...s, tax: { ...tax, [k]: v } });
  async function save() {
    try {
      await post({ action: 'settings.update', settings: {
        enforce: !!s.enforce, grace_days: Number(s.grace_days), reminder_days: String(s.reminder_text).split(/[\s,]+/).map(Number).filter((n) => n > 0),
        pending_order_ttl_hours: Number(s.pending_order_ttl_hours), refund_window_days: Number(s.refund_window_days), invoice_prefix: s.invoice_prefix,
        terms_url: s.terms_url, support_email: s.support_email,
        tax: { registered: !!tax.registered, rate: Number(tax.rate), inclusive: !!tax.inclusive, gstin: String(tax.gstin || '').toUpperCase(), legal_name: tax.legal_name, address: tax.address, state: tax.state, state_code: tax.state_code, sac: tax.sac },
      } });
      flash('Settings saved'); reload();
    } catch (e) { flash((e as Error).message, true); }
  }
  return (
    <div className="adm-panel">
      <div className="adm-panel-head"><h3>Subscription settings</h3><button className="adm-btn primary" onClick={save}>Save settings</button></div>
      <label className="adm-hint" style={{ display: 'block', marginBottom: 14 }}><input type="checkbox" checked={!!s.enforce} onChange={(e) => setS({ ...s, enforce: e.target.checked })} /> <b>Enforce plan limits &amp; paid features</b> (the SUBSCRIPTION_ENFORCE env var overrides this if set)</label>
      <div style={grid()}>
        <Field label="Grace period (days)" hint="paid features stay on after expiry"><input type="number" min={0} max={60} value={s.grace_days} onChange={(e) => setS({ ...s, grace_days: e.target.value })} /></Field>
        <Field label="Reminder days before expiry"><input value={s.reminder_text} onChange={(e) => setS({ ...s, reminder_text: e.target.value })} placeholder="7, 1" /></Field>
        <Field label="Unpaid order expires after (hours)"><input type="number" min={1} max={168} value={s.pending_order_ttl_hours} onChange={(e) => setS({ ...s, pending_order_ttl_hours: e.target.value })} /></Field>
        <Field label="Refund window (days)" hint="for your policy text"><input type="number" min={0} value={s.refund_window_days} onChange={(e) => setS({ ...s, refund_window_days: e.target.value })} /></Field>
        <Field label="Invoice number prefix"><input value={s.invoice_prefix} onChange={(e) => setS({ ...s, invoice_prefix: e.target.value })} /></Field>
        <Field label="Terms URL"><input value={s.terms_url} onChange={(e) => setS({ ...s, terms_url: e.target.value })} /></Field>
        <Field label="Support email on invoices"><input value={s.support_email} onChange={(e) => setS({ ...s, support_email: e.target.value })} /></Field>
      </div>
      <h4 style={{ margin: '10px 0 8px' }}>GST &amp; invoicing</h4>
      <label className="adm-hint" style={{ display: 'block', marginBottom: 10 }}><input type="checkbox" checked={!!tax.registered} onChange={(e) => setTax('registered', e.target.checked)} /> Mappingg is GST-registered (charge GST and issue tax invoices)</label>
      <div style={grid()}>
        <Field label="GST rate (%)"><input type="number" min={0} max={28} value={tax.rate} onChange={(e) => setTax('rate', e.target.value)} /></Field>
        <Field label="Prices include GST?"><select value={tax.inclusive ? '1' : '0'} onChange={(e) => setTax('inclusive', e.target.value === '1')}><option value="0">No — add GST on top</option><option value="1">Yes — prices include GST</option></select></Field>
        <Field label="GSTIN"><input value={tax.gstin} onChange={(e) => setTax('gstin', e.target.value.toUpperCase())} maxLength={15} /></Field>
        <Field label="SAC code"><input value={tax.sac} onChange={(e) => setTax('sac', e.target.value)} placeholder="Confirm with your CA" /></Field>
        <Field label="Legal name"><input value={tax.legal_name} onChange={(e) => setTax('legal_name', e.target.value)} /></Field>
        <Field label="State"><input value={tax.state} onChange={(e) => setTax('state', e.target.value)} /></Field>
        <Field label="State code" hint="2 digits, e.g. 27"><input value={tax.state_code} onChange={(e) => setTax('state_code', e.target.value)} maxLength={2} /></Field>
      </div>
      <Field label="Registered address (on invoices)"><input value={tax.address} onChange={(e) => setTax('address', e.target.value)} /></Field>
    </div>
  );
}

// ---------------------------------------------------------------- logs
function Logs() {
  const hooks = useView<Any[]>('webhooks');
  const audit = useView<Any[]>('audit');
  return (
    <>
      <div className="adm-panel" style={scroll}>
        <div className="adm-panel-head"><h3>Payment webhooks</h3></div>
        {!hooks.data ? <Loading err={hooks.err} /> : (
          <table className="adm-table"><thead><tr><th>Received</th><th>Event</th><th>Outcome</th><th>Id</th></tr></thead>
            <tbody>{hooks.data.length ? hooks.data.map((h) => <tr key={h.id}><td><small>{fmtTime(h.received_at)}</small></td><td>{h.event}</td><td><Badge s={h.outcome} />{h.error && <><br /><small className="adm-hint">{h.error}</small></>}</td><td><small>{h.id}</small></td></tr>) : <tr><td colSpan={4} className="adm-hint">No webhook events received yet.</td></tr>}</tbody>
          </table>
        )}
      </div>
      <div className="adm-panel" style={scroll}>
        <div className="adm-panel-head"><h3>Audit log</h3></div>
        {!audit.data ? <Loading err={audit.err} /> : (
          <table className="adm-table"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th><th>Detail</th></tr></thead>
            <tbody>{audit.data.map((a) => <tr key={a.id}><td><small>{fmtTime(a.at)}</small></td><td><small>{a.actor}</small></td><td>{a.action}</td><td><small>{a.target_type} {a.target_id}</small></td><td><small style={{ wordBreak: 'break-word' }}>{JSON.stringify(a.detail).slice(0, 200)}</small></td></tr>)}</tbody>
          </table>
        )}
      </div>
    </>
  );
}

export default function SubscriptionsPanel({ flash }: { flash: Flash }) {
  const [sec, setSec] = useState<Section>('overview');
  const [plans, setPlans] = useState<Any[]>([]);
  useEffect(() => { api<{ plans: Any[] }>('plans').then((d) => setPlans(d.plans)).catch(() => {}); }, [sec]);
  return (
    <div>
      <div className="adm-panel" style={{ padding: 10, marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} role="tablist" aria-label="Subscriptions sections">
          {SECTIONS.map((s) => (
            <button key={s.key} role="tab" aria-selected={sec === s.key} className={`adm-btn sm ${sec === s.key ? 'primary' : 'ghost'}`} onClick={() => setSec(s.key)}>
              <i className={`fas ${s.icon}`} /> {s.label}
            </button>
          ))}
        </div>
      </div>
      {sec === 'overview' && <Overview flash={flash} go={setSec} />}
      {sec === 'plans' && <Plans flash={flash} />}
      {sec === 'subscriptions' && <Subscriptions flash={flash} plans={plans} />}
      {sec === 'payments' && <Payments flash={flash} />}
      {sec === 'refunds' && <Refunds />}
      {sec === 'coupons' && <Coupons flash={flash} />}
      {sec === 'reports' && <Reports />}
      {sec === 'ops' && <Ops flash={flash} />}
      {sec === 'outlook' && <Outlook flash={flash} />}
      {sec === 'settings' && <Settings flash={flash} />}
      {sec === 'logs' && <Logs />}
    </div>
  );
}
