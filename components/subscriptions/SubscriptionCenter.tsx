'use client';

import { useCallback, useEffect, useState } from 'react';
import './subscriptions.css';
import { CATEGORY_LABEL, formatInr } from '@/lib/subscriptions/catalog';
import type { MySubscription, PublicPlan } from '@/lib/subscriptions/summary';
import PlanGrid, { PlanCompare, limitText } from './PlanGrid';
import Checkout from './Checkout';

// "My subscription": current plan, status & expiry warnings, usage, purchased
// features, plan changes (checkout), payment history, invoices and events.
// Rendered inside each existing dashboard (developer tab / CP & buyer pages).

type Payment = { id: string; kind: string; plan_name: string; quantity: number; total_paise: number; refunded_paise: number; status: string; failure_reason: string | null; created_at: string; paid_at: string | null; gateway_payment_id: string | null };
type Invoice = { id: string; number: string; status: string; issued_at: string; totals: { total_paise: number } };
type Event = { id: string; action: string; from_plan: string | null; to_plan: string | null; to_status: string | null; at: string };
type Notice = { id: string; type: string; title: string; body: string; read_at: string | null; created_at: string };

const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const STATUS_TONE: Record<string, string> = { ACTIVE: 'ok', FREE: 'free', PAST_DUE: 'warn', EXPIRED: 'bad', CANCELLED: 'bad', SUSPENDED: 'bad', REFUNDED: 'bad', PENDING: 'warn', FAILED: 'bad' };
const STATUS_LABEL: Record<string, string> = { ACTIVE: 'Active', FREE: 'Free plan', PAST_DUE: 'Renewal due', EXPIRED: 'Expired', CANCELLED: 'Cancelled', SUSPENDED: 'Suspended', REFUNDED: 'Refunded', PENDING: 'Pending', FAILED: 'Failed' };
const PAY_LABEL: Record<string, string> = { created: 'Not completed', pending: 'Pending', paid: 'Paid', failed: 'Failed', cancelled: 'Cancelled', refunded: 'Refunded', partially_refunded: 'Part refunded' };
const ACTION_LABEL: Record<string, string> = {
  activated: 'Plan activated', upgraded: 'Upgraded', renewed: 'Renewed', expired: 'Expired', past_due: 'Term ended — renewal due', cancel_requested: 'Cancelled (until term end)',
  resumed: 'Cancellation undone', downgrade_scheduled: 'Plan change scheduled', refunded: 'Refunded', admin_activated: 'Activated by Mappingg', checkout_started: 'Checkout started',
  payment_failed: 'Payment failed', city_selected: 'City selected', replaced_by_upgrade: 'Replaced by upgrade', replaced: 'Replaced', admin_extend: 'Extended by Mappingg',
  admin_cancel_now: 'Cancelled by Mappingg', admin_suspend: 'Suspended by Mappingg', admin_resume: 'Resumed by Mappingg', replaced_by_admin: 'Replaced by Mappingg',
};

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(b?.error?.message || `Could not load (${r.status})`);
  return b.data as T;
}

export default function SubscriptionCenter({ email, initialPlan, signupPlan }: { email: string; initialPlan?: string | null; signupPlan?: string | null }) {
  const [me, setMe] = useState<MySubscription | null>(null);
  const [err, setErr] = useState('');
  const [hist, setHist] = useState<{ payments: Payment[]; events: Event[] } | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [checkout, setCheckout] = useState<PublicPlan | null>(null);
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [city, setCity] = useState('');

  const load = useCallback(async () => {
    try {
      const [cur, h, inv, n] = await Promise.all([
        getJson<MySubscription>('/api/subscriptions/current'),
        getJson<{ payments: Payment[]; events: Event[] }>('/api/subscriptions/history'),
        getJson<Invoice[]>('/api/subscriptions/invoices'),
        getJson<Notice[]>('/api/subscriptions/notifications'),
      ]);
      setMe(cur); setHist(h); setInvoices(inv); setNotices(n); setErr('');
      return cur;
    } catch (e) { setErr((e as Error).message); return null; }
  }, []);

  useEffect(() => {
    load().then((cur) => {
      if (cur && initialPlan) {
        const p = cur.available.find((x) => x.code === initialPlan && !x.is_free);
        if (p) setCheckout(p);
      }
    });
  }, [load, initialPlan]);

  useEffect(() => {
    if (notices.some((n) => !n.read_at)) void fetch('/api/subscriptions/notifications', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
  }, [notices]);

  async function act(url: string, body: unknown, ok: string) {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(b?.error?.message || 'Could not save');
      setMsg({ text: ok });
      await load();
    } catch (e) { setMsg({ text: (e as Error).message, err: true }); } finally { setBusy(false); }
  }

  if (err) return <div className="sub"><div className="sub-alert bad"><i className="fas fa-triangle-exclamation" /><span className="grow">{err}</span><button className="sub-btn sm ghost" onClick={() => load()}>Retry</button></div></div>;
  if (!me) return <div className="sub"><p className="sub-muted"><i className="fas fa-spinner fa-spin" /> Loading your subscription…</p></div>;

  const sub = me.subscription;
  const status = me.status;
  const paidActive = !!sub && (sub.effective_status === 'ACTIVE' || sub.effective_status === 'PAST_DUE');
  const plan = me.plan;
  const lastPay = hist?.payments[0];
  const recentFail = lastPay && lastPay.status === 'failed' && Date.now() - new Date(lastPay.created_at).getTime() < 7 * 86_400_000;
  const lastExpired = !paidActive && hist?.events.find((e) => e.action === 'expired');
  const renewPlan = paidActive ? me.available.find((p) => p.code === (me.next_plan?.code || sub!.plan_code)) : null;
  const usage = me.usage.filter((u) => u.limit !== 0);
  // The paid plan picked on the sign-up form, still not bought (shown until they buy any paid plan).
  const pickedAtSignup = !paidActive && signupPlan ? me.available.find((p) => p.code === signupPlan && !p.is_free) : undefined;
  const cityNeeded = me.category === 'cp' && paidActive && plan?.limits.some((l) => l.key === 'cp_max_cities' && l.value !== null) && !sub?.city;

  return (
    <div className="sub">
      {pickedAtSignup && !checkout && (
        <div className="sub-alert neutral" style={{ marginBottom: 16 }}><i className="fas fa-crown" /><span className="grow">You chose <b>{pickedAtSignup.name}</b> when you signed up. You are on the Free plan until you activate it.</span><button className="sub-btn sm primary" onClick={() => setCheckout(pickedAtSignup)}>Activate {pickedAtSignup.name}</button></div>
      )}
      <div className="sub-stack">
        {/* status alerts */}
        {paidActive && sub!.effective_status === 'PAST_DUE' && (
          <div className="sub-alert bad"><i className="fas fa-circle-exclamation" /><span className="grow"><b>Renewal required.</b> Your plan ended on {fmtDate(sub!.expires_at)}. Paid features stay on until {fmtDate(sub!.grace_until)} — renew to keep them.</span>{renewPlan && <button className="sub-btn sm primary" onClick={() => setCheckout(renewPlan)}>Renew now</button>}</div>
        )}
        {paidActive && sub!.effective_status === 'ACTIVE' && me.days_left <= 7 && !sub!.cancel_at_period_end && (
          <div className="sub-alert warn"><i className="fas fa-clock" /><span className="grow"><b>Your plan ends in {me.days_left} day{me.days_left === 1 ? '' : 's'}</b> ({fmtDate(sub!.expires_at)}). Renew now — the new term starts when this one ends, so you lose nothing.</span>{renewPlan && <button className="sub-btn sm primary" onClick={() => setCheckout(renewPlan)}>Renew</button>}</div>
        )}
        {paidActive && sub!.cancel_at_period_end && (
          <div className="sub-alert neutral"><i className="fas fa-calendar-xmark" /><span className="grow">Cancelled — your plan stays active until <b>{fmtDate(sub!.expires_at)}</b>, then your account moves to Free. Nothing is deleted.</span><button className="sub-btn sm ghost" disabled={busy} onClick={() => act('/api/subscriptions/cancel', { resume: true }, 'Your plan will continue as normal.')}>Keep my plan</button></div>
        )}
        {paidActive && me.next_plan && !sub!.cancel_at_period_end && (
          <div className="sub-alert neutral"><i className="fas fa-arrow-down-wide-short" /><span className="grow">You move to <b>{me.next_plan.name}</b> on {fmtDate(sub!.expires_at)}.</span><button className="sub-btn sm ghost" disabled={busy} onClick={() => act('/api/subscriptions/cancel', { resume: true }, 'Plan change cancelled.')}>Undo</button></div>
        )}
        {recentFail && (
          <div className="sub-alert bad"><i className="fas fa-credit-card" /><span className="grow"><b>Your last payment failed</b>{lastPay!.failure_reason ? ` (${lastPay!.failure_reason})` : ''}. No money is taken for a failed payment.</span></div>
        )}
        {lastExpired && status !== 'ACTIVE' && (
          <div className="sub-alert warn"><i className="fas fa-hourglass-end" /><span className="grow"><b>Your paid plan expired</b> on {fmtDate(lastExpired.at)}. You are on the Free plan — your data is safe. Upgrade any time to unlock paid features again.</span></div>
        )}
        {cityNeeded && (
          <div className="sub-alert warn"><i className="fas fa-city" /><span className="grow"><b>Choose your plan&apos;s city</b> to start opening projects.</span>
            <select value={city} onChange={(e) => setCity(e.target.value)} className="sub-btn sm ghost" aria-label="City">
              <option value="">Choose…</option>
              {me.cities.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
            <button className="sub-btn sm primary" disabled={!city || busy} onClick={() => act('/api/subscriptions/city', { city }, 'City saved.')}>Save</button>
          </div>
        )}
        {msg && <p className={`sub-msg${msg.err ? ' err' : ''}`} role="status">{msg.text}</p>}

        {/* current plan */}
        <section className="sub-current">
          <div style={{ minWidth: 0, flex: 1 }}>
            <small>{CATEGORY_LABEL[me.category]} · current plan</small>
            <h2>{plan?.name || 'Free'} <span className="sub-badge">{STATUS_LABEL[status] || status}</span></h2>
            <p>{plan?.tagline}</p>
            <div className="sub-kv">
              <div><span>Status</span><b>{STATUS_LABEL[status] || status}</b></div>
              <div><span>Started</span><b>{paidActive ? fmtDate(sub!.start_at) : '—'}</b></div>
              <div><span>Expires</span><b>{paidActive ? fmtDate(sub!.expires_at) : 'Never (Free)'}</b></div>
              <div><span>Next renewal</span><b>{paidActive ? (sub!.cancel_at_period_end ? 'Not renewing' : fmtDate(sub!.renew_at || sub!.expires_at)) : '—'}</b></div>
              <div><span>Days remaining</span><b>{paidActive ? me.days_left : '—'}</b></div>
              {paidActive && sub!.city && <div><span>City</span><b>{me.cities.find((c) => c.key === sub!.city)?.label || sub!.city}</b></div>}
              {paidActive && sub!.billing_unit === 'project' && <div><span>Projects covered</span><b>{sub!.project_ids.length}</b></div>}
            </div>
          </div>
          <div className="acts">
            {renewPlan && <button className="sub-btn gold" onClick={() => setCheckout(renewPlan)}><i className="fas fa-rotate" /> Renew</button>}
            <a className="sub-btn ghost" href="#plans"><i className="fas fa-arrow-up-right-dots" /> {paidActive ? 'Change plan' : 'Upgrade'}</a>
            {paidActive && !sub!.cancel_at_period_end && (
              <button className="sub-btn ghost" disabled={busy} onClick={() => { if (confirm(`Cancel ${plan?.name}? It stays active until ${fmtDate(sub!.expires_at)} and won't renew.`)) act('/api/subscriptions/cancel', {}, 'Cancelled — your plan stays active until the end of the term.'); }}>Cancel plan</button>
            )}
          </div>
        </section>

        <div className="sub-grid2">
          <div className="sub-stack">
            {(usage.length > 0 || me.category === 'developer') && (
              <section className="sub-card">
                <h2><i className="fas fa-gauge-high" /> Usage</h2>
                <div className="sub-stack" style={{ gap: 14 }}>
                  {usage.map((u) => {
                    const pct = u.limit == null ? 0 : Math.min(100, Math.round((u.used / Math.max(1, u.limit)) * 100));
                    const label = u.metric === 'project_access' ? 'Project details opened this week' : u.period === 'lifetime' ? 'Property listings opened' : 'Property listings opened this month';
                    return (
                      <div className="sub-meter" key={u.metric}>
                        <div className="row"><span>{label}</span><b>{u.used}{u.limit == null ? '' : ` / ${u.limit}`}</b></div>
                        {u.limit != null && <div className="bar"><i className={pct >= 90 ? 'hot' : ''} style={{ width: `${pct}%` }} /></div>}
                        <small>{u.limit == null ? 'Unlimited on your plan.' : `${u.remaining} left${u.resetsAt ? ` · resets ${fmtDate(u.resetsAt)}` : ''}. Opening the same project again doesn’t count twice.`}</small>
                      </div>
                    );
                  })}
                  {me.category === 'developer' && (
                    <div className="sub-meter">
                      <div className="row"><span>Projects listed</span><b>{me.project_count ?? 0}{me.project_limit == null ? '' : ` / ${me.project_limit}`}</b></div>
                      {me.project_limit != null && <div className="bar"><i className={(me.project_count || 0) >= me.project_limit ? 'hot' : ''} style={{ width: `${Math.min(100, ((me.project_count || 0) / Math.max(1, me.project_limit)) * 100)}%` }} /></div>}
                      <small>{me.project_limit == null ? 'Unlimited listings on your plan.' : 'Existing projects always stay listed — the limit only applies to new ones.'}</small>
                    </div>
                  )}
                </div>
              </section>
            )}

            {me.category === 'developer' && (me.projects || []).length > 0 && (
              <section className="sub-card">
                <h2><i className="fas fa-building" /> Your projects &amp; plan coverage</h2>
                <ul className="sub-list">
                  {(me.projects || []).map((p) => (
                    <li key={p.id}>
                      <span className="main"><b>{p.title}</b><small>{[p.location, p.state, p.review === 'live' ? 'Live' : p.review === 'pending' ? 'Waiting for review' : 'Not approved'].filter(Boolean).join(' · ')}</small></span>
                      {p.covered ? <span className="sub-badge premium"><i className="fas fa-crown" /> {plan?.name}</span> : <span className="sub-badge free">Free features</span>}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="sub-card" id="plans">
              <h2><i className="fas fa-layer-group" /> {paidActive ? 'Change plan' : 'Upgrade your plan'}</h2>
              <PlanGrid
                plans={me.available}
                currentCode={plan?.code}
                cta={(p) => p.is_free
                  ? <span className="sub-btn ghost block" aria-disabled="true">{plan?.code === p.code ? 'Current plan' : 'Included free'}</span>
                  : <button className={`sub-btn ${p.recommended ? 'primary' : 'ghost'} block`} onClick={() => setCheckout(p)}>
                      {plan?.code === p.code ? (me.category === 'developer' ? 'Renew / change projects' : 'Renew') : paidActive ? `Switch to ${p.name}` : `Choose ${p.name}`}
                    </button>}
              />
              <div style={{ marginTop: 14 }}><PlanCompare plans={me.available} /></div>
            </section>
          </div>

          <div className="sub-stack">
            <section className="sub-card">
              <h2><i className="fas fa-circle-check" /> What your plan includes</h2>
              <ul className="sub-feats">
                {plan?.limits.filter((l) => !(l.value === 0 && /media|lead/.test(l.key))).map((l) => <li key={l.key} className="lim"><i className="fas fa-gauge-high" /><b>{limitText(l)}</b></li>)}
                {plan?.features.filter((f) => f.included).map((f) => <li key={f.key}><i className="fas fa-check" />{f.label}</li>)}
              </ul>
              {plan?.billing_unit === 'project' && <p className="sub-muted" style={{ marginTop: 10 }}>Project features apply to the projects on your plan; your other projects keep the Free features.</p>}
            </section>

            <section className="sub-card">
              <h2><i className="fas fa-file-invoice" /> Invoices</h2>
              {invoices.length ? (
                <ul className="sub-list">
                  {invoices.map((i) => (
                    <li key={i.id}>
                      <span className="main"><b>{i.number}</b><small>{fmtDate(i.issued_at)} · {formatInr(Number(i.totals.total_paise) || 0)}{i.status !== 'paid' ? ` · ${PAY_LABEL[i.status] || i.status}` : ''}</small></span>
                      <a className="sub-btn sm ghost" href={`/dashboard/${me.category === 'cp' ? 'agent' : me.category}/invoices/${i.id}`} target="_blank" rel="noopener"><i className="fas fa-download" /> Download</a>
                    </li>
                  ))}
                </ul>
              ) : <p className="sub-empty">No invoices yet.</p>}
            </section>

            <section className="sub-card">
              <h2><i className="fas fa-receipt" /> Payment history</h2>
              {hist?.payments.filter((p) => p.status !== 'created' || Date.now() - new Date(p.created_at).getTime() < 86_400_000).length ? (
                <ul className="sub-list">
                  {hist.payments.filter((p) => p.status !== 'created' || Date.now() - new Date(p.created_at).getTime() < 86_400_000).slice(0, 20).map((p) => (
                    <li key={p.id}>
                      <span className="main"><b>{p.plan_name}{p.quantity > 1 ? ` × ${p.quantity}` : ''}</b><small>{fmtDate(p.paid_at || p.created_at)}{p.gateway_payment_id ? ` · ${p.gateway_payment_id}` : ''}{p.status === 'failed' && p.failure_reason ? ` · ${p.failure_reason}` : ''}</small></span>
                      <span style={{ textAlign: 'right' }}><b>{formatInr(p.total_paise)}</b><br /><span className={`sub-badge ${p.status === 'paid' ? 'ok' : p.status === 'failed' ? 'bad' : 'free'}`}>{PAY_LABEL[p.status] || p.status}</span></span>
                    </li>
                  ))}
                </ul>
              ) : <p className="sub-empty">No payments yet.</p>}
            </section>

            <section className="sub-card">
              <h2><i className="fas fa-clock-rotate-left" /> Subscription history</h2>
              {hist?.events.filter((e) => e.action !== 'checkout_started').length ? (
                <ul className="sub-timeline">
                  {hist.events.filter((e) => e.action !== 'checkout_started').slice(0, 20).map((e) => (
                    <li key={e.id}><b>{ACTION_LABEL[e.action] || e.action}</b>{e.to_plan ? ` — ${me.available.find((p) => p.code === e.to_plan)?.name || e.to_plan}` : ''}<br /><small>{new Date(e.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</small></li>
                  ))}
                </ul>
              ) : <p className="sub-empty">Nothing yet.</p>}
            </section>

            {notices.length > 0 && (
              <section className="sub-card">
                <h2><i className="fas fa-bell" /> Notifications</h2>
                <ul className="sub-list">
                  {notices.slice(0, 10).map((n) => (
                    <li key={n.id}><span className="main"><b>{n.title}</b><small>{n.body}</small></span><small className="sub-muted">{fmtDate(n.created_at)}</small></li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </div>
      </div>
      {checkout && <Checkout plan={checkout} me={me} email={email} onClose={() => setCheckout(null)} onDone={() => { setCheckout(null); load(); }} />}
    </div>
  );
}
