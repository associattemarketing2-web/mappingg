'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatInr } from '@/lib/subscriptions/catalog';
import type { MySubscription, PublicPlan } from '@/lib/subscriptions/summary';
import type { Quote } from '@/lib/subscriptions/pricing';
import { unitLabel } from './PlanGrid';

// Checkout: plan summary → (projects / city) → coupon → server-computed price
// breakdown → Razorpay checkout → server verification. The browser only ever
// sends the plan code and choices; every amount shown comes from the server.

type QuoteRes = { kind: 'new' | 'renewal' | 'upgrade' | 'downgrade'; quantity: number; quote: Quote; coupon_error: string | null; period_start: string; current: { plan_code: string; expires_at: string | null } | null };

declare global {
  interface Window { Razorpay?: new (o: Record<string, unknown>) => { open: () => void; on: (ev: string, cb: (r: { error?: { description?: string } }) => void) => void } }
}

let scriptPromise: Promise<boolean> | null = null;
function loadRazorpay(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  if (window.Razorpay) return Promise.resolve(true);
  scriptPromise ??= new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.async = true;
    s.onload = () => resolve(!!window.Razorpay);
    s.onerror = () => { scriptPromise = null; resolve(false); };
    document.body.appendChild(s);
  });
  return scriptPromise;
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(b?.error?.message || `Request failed (${r.status})`), { code: b?.error?.code });
  return b.data as T;
}

const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const KIND_LABEL = { new: 'New subscription', renewal: 'Renewal', upgrade: 'Plan change (upgrade)', downgrade: 'Scheduled plan change' };

export default function Checkout({ plan, me, email, onClose, onDone }: { plan: PublicPlan; me: MySubscription; email: string; onClose: () => void; onDone: () => void }) {
  const isProject = plan.billing_unit === 'project';
  const needsCity = plan.limits.some((l) => l.key === 'cp_max_cities' && l.value !== null);
  const eligible = (me.projects || []).filter((p) => p.review !== 'rejected');
  const [projects, setProjects] = useState<string[]>(() => {
    const covered = (me.projects || []).filter((p) => p.covered).map((p) => p.id);
    return covered.length ? covered : eligible.slice(0, 1).map((p) => p.id);
  });
  const [city, setCity] = useState<string>(me.subscription?.city || '');
  const [coupon, setCoupon] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState('');
  const [gst, setGst] = useState({ open: false, name: '', gstin: '', address: '' });
  const [agree, setAgree] = useState(false);
  const [q, setQ] = useState<QuoteRes | null>(null);
  const [qErr, setQErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<null | { state: 'paid' | 'pending' | 'failed' | 'scheduled' | 'activated'; text: string; invoice?: string | null }>(null);
  const [payErr, setPayErr] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);

  const body = useMemo(() => ({
    plan: plan.code,
    ...(isProject ? { project_ids: projects } : {}),
    ...(needsCity && city ? { city } : {}),
    ...(appliedCoupon ? { coupon: appliedCoupon } : {}),
    ...(gst.open && (gst.name || gst.gstin) ? { billing: { name: gst.name || undefined, gstin: gst.gstin || undefined, address: gst.address || undefined } } : {}),
  }), [plan.code, isProject, projects, needsCity, city, appliedCoupon, gst]);

  const refresh = useCallback(async () => {
    if (isProject && !projects.length) { setQ(null); setQErr('Choose at least one project.'); return; }
    if (needsCity && !city) { setQ(null); setQErr('Choose the city your plan should cover.'); return; }
    setQErr('');
    try { setQ(await post<QuoteRes>('/api/subscriptions/quote', body)); } catch (e) { setQ(null); setQErr((e as Error).message); }
  }, [body, isProject, projects.length, needsCity, city]);

  useEffect(() => { const t = setTimeout(refresh, 250); return () => clearTimeout(t); }, [refresh]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', k);
    boxRef.current?.focus();
    return () => document.removeEventListener('keydown', k);
  }, [busy, onClose]);

  async function pay() {
    setBusy(true); setPayErr('');
    try {
      const r = await post<{ payment_id: string; status: 'awaiting_payment' | 'activated' | 'scheduled'; gateway?: { key: string; order_id: string; amount: number; currency: string; mode: string | null } }>('/api/subscriptions/checkout', body);
      if (r.status === 'scheduled') { setResult({ state: 'scheduled', text: `You will move to ${plan.name} when your current term ends${me.subscription?.expires_at ? ` on ${fmtDate(me.subscription.expires_at)}` : ''}. Nothing is charged now.` }); setBusy(false); return; }
      if (r.status === 'activated') { setResult({ state: 'activated', text: `${plan.name} is active — no payment was needed.` }); setBusy(false); return; }
      if (!(await loadRazorpay()) || !window.Razorpay || !r.gateway) throw new Error('Could not open the payment window. Check your connection and try again.');
      const rzp = new window.Razorpay({
        key: r.gateway.key, order_id: r.gateway.order_id, amount: r.gateway.amount, currency: r.gateway.currency,
        name: 'Mappingg', description: `${plan.name} — ${unitLabel(plan)}`, image: '/img/mappingg-icon-mark-sm.webp',
        prefill: { email }, notes: { plan: plan.code }, theme: { color: '#0f5c47' },
        handler: async (resp: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
          try {
            const v = await post<{ status: 'paid' | 'pending' | 'failed'; invoice_id?: string | null }>('/api/subscriptions/verify-payment', resp);
            if (v.status === 'paid') setResult({ state: 'paid', text: `Payment received — ${plan.name} is active.`, invoice: v.invoice_id });
            else if (v.status === 'pending') setResult({ state: 'pending', text: 'Your bank is still confirming the payment. Your plan switches on automatically as soon as it is confirmed — no need to pay again.' });
            else setResult({ state: 'failed', text: 'The payment did not go through. No money was taken for a failed payment. You can try again.' });
          } catch (e) {
            setResult({ state: 'pending', text: `We could not confirm the payment yet (${(e as Error).message}). If money was taken, your plan switches on automatically within a few minutes — please don't pay twice.` });
          } finally { setBusy(false); }
        },
        modal: {
          ondismiss: () => { setBusy(false); void post('/api/subscriptions/payment-cancelled', { payment_id: r.payment_id }).catch(() => {}); },
        },
      });
      rzp.on('payment.failed', (resp) => setPayErr(resp?.error?.description || 'The payment failed. You can try another method.'));
      rzp.open();
    } catch (e) {
      setPayErr((e as Error).message);
      setBusy(false);
    }
  }

  const quote = q?.quote;
  const paidPlan = !plan.is_free;
  const cannotPay = !quote || !agree || busy || (q?.kind !== 'downgrade' && quote.total_paise > 0 && !me.payments.configured);

  if (result) {
    const good = result.state !== 'failed';
    return (
      <div className="sub-modal" role="dialog" aria-modal="true" aria-label="Payment result">
        <div className="sub-modal-box" ref={boxRef} tabIndex={-1}>
          <div className="sub-done">
            <span className={`big${good ? '' : ' bad'}`}><i className={`fas ${result.state === 'pending' ? 'fa-hourglass-half' : good ? 'fa-check' : 'fa-xmark'}`} /></span>
            <h2>{result.state === 'paid' || result.state === 'activated' ? 'You’re all set' : result.state === 'scheduled' ? 'Change scheduled' : result.state === 'pending' ? 'Payment pending' : 'Payment failed'}</h2>
            <p className="sub-muted" style={{ maxWidth: 460 }}>{result.text}</p>
            <div className="sub-toolbar" style={{ justifyContent: 'center' }}>
              {result.invoice && <a className="sub-btn ghost" href={`/dashboard/${me.category === 'cp' ? 'agent' : me.category}/invoices/${result.invoice}`} target="_blank" rel="noopener"><i className="fas fa-file-invoice" /> View invoice</a>}
              {result.state === 'failed'
                ? <button className="sub-btn primary" onClick={() => { setResult(null); setPayErr(''); }}>Try again</button>
                : <button className="sub-btn primary" onClick={onDone}>Done</button>}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="sub-modal" role="dialog" aria-modal="true" aria-label={`Checkout — ${plan.name}`} onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="sub-modal-box" ref={boxRef} tabIndex={-1}>
        <div className="sub-modal-head">
          <h2><i className="fas fa-lock" style={{ color: '#0f5c47', marginRight: 8 }} />Checkout — {plan.name}</h2>
          <button className="sub-x" onClick={onClose} disabled={busy} aria-label="Close">×</button>
        </div>
        <div className="sub-modal-body">
          <div className="sub-stack" style={{ gap: 16 }}>
            {!me.payments.configured && paidPlan && (
              <div className="sub-alert warn"><i className="fas fa-plug-circle-exclamation" /><span className="grow"><b>Online payments are being set up.</b> You can see the exact price here; paying will be possible as soon as Mappingg switches payments on.</span></div>
            )}
            {me.payments.mode === 'test' && <div className="sub-alert info"><i className="fas fa-flask" /><span className="grow">Test mode: use Razorpay test cards/UPI — no real money is charged.</span></div>}

            <div>
              <p className="sub-muted" style={{ marginBottom: 6 }}>{plan.tagline}</p>
              <div className="sub-price"><b style={{ fontSize: 26 }}>{formatInr(plan.price_paise)}</b><span>{unitLabel(plan)}</span></div>
            </div>

            {isProject && (
              <div className="sub-field">
                <span>Projects on this plan <small>— billed per project</small></span>
                {eligible.length ? (
                  <div className="sub-picks">
                    {eligible.map((p) => {
                      const on = projects.includes(p.id);
                      return (
                        <label key={p.id} className={`sub-pick${on ? ' on' : ''}`}>
                          <input type="checkbox" checked={on} onChange={() => setProjects((cur) => (on ? cur.filter((x) => x !== p.id) : [...cur, p.id]))} />
                          <span><b>{p.title}</b><small>{[p.location, p.state, p.review === 'pending' ? 'Waiting for review' : 'Live'].filter(Boolean).join(' · ')}</small></span>
                        </label>
                      );
                    })}
                  </div>
                ) : <p className="sub-empty">Add a project in Projects Intake first, then choose it here.</p>}
              </div>
            )}

            {needsCity && (
              <label className="sub-field">
                <span>City your plan covers</span>
                <select value={city} onChange={(e) => setCity(e.target.value)} disabled={!!me.subscription?.city && me.subscription.plan_code === plan.code}>
                  <option value="">Choose a city…</option>
                  {me.cities.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
                <small>Project details outside this city need Pro Max. Changing city later goes through Mappingg support.</small>
              </label>
            )}

            <div className="sub-row">
              <label className="sub-field">
                <span>Coupon code</span>
                <input value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} placeholder="Optional" maxLength={30} />
              </label>
              <button className="sub-btn ghost" type="button" onClick={() => setAppliedCoupon(coupon.trim())} disabled={!coupon.trim() || coupon.trim() === appliedCoupon}>Apply</button>
            </div>
            {appliedCoupon && q?.coupon_error && <p className="sub-msg err">{q.coupon_error}</p>}
            {appliedCoupon && q && !q.coupon_error && quote?.discount_paise ? <p className="sub-msg">Coupon {appliedCoupon} applied.</p> : null}

            {me.tax.registered && (
              <div>
                <label className="sub-check"><input type="checkbox" checked={gst.open} onChange={(e) => setGst((g) => ({ ...g, open: e.target.checked }))} /> Add my GSTIN to the invoice (business purchase)</label>
                {gst.open && (
                  <div className="sub-form" style={{ marginTop: 10 }}>
                    <label className="sub-field"><span>Business name</span><input value={gst.name} onChange={(e) => setGst((g) => ({ ...g, name: e.target.value }))} maxLength={120} /></label>
                    <label className="sub-field"><span>GSTIN</span><input value={gst.gstin} onChange={(e) => setGst((g) => ({ ...g, gstin: e.target.value.toUpperCase() }))} maxLength={15} placeholder="27ABCDE1234F1Z5" /></label>
                    <label className="sub-field wide"><span>Billing address</span><input value={gst.address} onChange={(e) => setGst((g) => ({ ...g, address: e.target.value }))} maxLength={300} /></label>
                  </div>
                )}
              </div>
            )}

            <label className="sub-check">
              <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
              <span>I agree to the <a className="sub-link" href={me.terms_url || '/terms'} target="_blank" rel="noopener">Terms</a> and understand the plan renews only when I pay again. RERA and certification badges show verified status and are not changed by a plan.</span>
            </label>
            {payErr && <p className="sub-msg err" role="alert">{payErr}</p>}
          </div>

          <aside className="sub-summary" aria-live="polite">
            <b>{q ? KIND_LABEL[q.kind] : 'Price breakdown'}</b>
            {qErr && <p className="sub-msg err">{qErr}</p>}
            {!q && !qErr && <p className="sub-muted"><i className="fas fa-spinner fa-spin" /> Calculating…</p>}
            {quote && (
              <>
                <div className="ln"><span>{plan.name}{quote.quantity > 1 ? ` × ${quote.quantity}` : ''}</span><span>{formatInr(quote.base_paise)}</span></div>
                {quote.discount_paise > 0 && <div className="ln minus"><span>Coupon {quote.coupon_code}</span><span>− {formatInr(quote.discount_paise)}</span></div>}
                {quote.credit_paise > 0 && <div className="ln minus"><span>Credit for unused time</span><span>− {formatInr(quote.credit_paise)}</span></div>}
                {quote.tax_mode !== 'none' && (
                  <>
                    <div className="ln"><span>Taxable value</span><span>{formatInr(quote.taxable_paise)}</span></div>
                    {quote.cgst_paise > 0 && <div className="ln"><span>CGST {quote.tax_rate / 2}%</span><span>{formatInr(quote.cgst_paise)}</span></div>}
                    {quote.sgst_paise > 0 && <div className="ln"><span>SGST {quote.tax_rate / 2}%</span><span>{formatInr(quote.sgst_paise)}</span></div>}
                    {quote.igst_paise > 0 && <div className="ln"><span>IGST {quote.tax_rate}%</span><span>{formatInr(quote.igst_paise)}</span></div>}
                  </>
                )}
                <div className="ln total"><span>{q!.kind === 'downgrade' ? 'Due now' : 'Total payable'}</span><span>{q!.kind === 'downgrade' ? '₹0' : formatInr(quote.total_paise)}</span></div>
                <p className="note">
                  {quote.tax_mode === 'none' ? 'No GST is charged (Mappingg is not GST-registered).' : quote.tax_mode === 'inclusive' ? 'Price includes GST.' : 'GST is added to the plan price.'}
                  {q!.kind === 'renewal' && ` Your new term starts ${fmtDate(q!.period_start)}, when the current one ends.`}
                  {q!.kind === 'upgrade' && ' The new plan starts today.'}
                  {q!.kind === 'downgrade' && ` The change happens on ${fmtDate(q!.current?.expires_at)}.`}
                </p>
              </>
            )}
            <button className="sub-btn primary block" onClick={pay} disabled={cannotPay}>
              {busy ? <><i className="fas fa-spinner fa-spin" /> Processing…</> : q?.kind === 'downgrade' ? 'Schedule change' : quote && quote.total_paise === 0 ? 'Activate' : <><i className="fas fa-lock" /> Pay {quote ? formatInr(quote.total_paise) : ''}</>}
            </button>
            <p className="note"><i className="fas fa-shield-halved" /> Secured by Razorpay. Card and UPI details never reach Mappingg.</p>
          </aside>
        </div>
      </div>
    </div>
  );
}
