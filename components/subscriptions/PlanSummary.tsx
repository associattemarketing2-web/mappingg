'use client';

import { useEffect, useState } from 'react';
import './subscriptions.css';
import type { MySubscription } from '@/lib/subscriptions/summary';

// Compact "Your plan" card for the existing dashboards (developer dashboard tab,
// channel-partner and buyer profile pages): plan, status, days left, usage and
// the role's key links. Hidden quietly if subscriptions are unavailable.

const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

export default function PlanSummary({ manageHref, onManage, links = [] }: { manageHref: string; onManage?: () => void; links?: { href: string; label: string; icon: string }[] }) {
  const [me, setMe] = useState<MySubscription | null | false | 'off'>(null);
  useEffect(() => {
    fetch('/api/subscriptions/current', { credentials: 'same-origin' })
      .then((r) => r.json().catch(() => null).then((b) => (r.ok ? setMe(b?.data || false) : setMe(b?.error?.code === 'subscriptions_disabled' ? 'off' : false))))
      .catch(() => setMe(false));
  }, []);
  if (me === false) return null;
  // Subscriptions switched off (Super admin → Subscriptions): no plan card, just
  // the links that don't belong to the subscription system (e.g. Favourites).
  if (me === 'off') {
    const plain = links.filter((l) => !/^\/pricing|\/(crm|premium|subscription|invoices)(\/|$|\?|#)/.test(l.href));
    if (!plain.length) return null;
    return <div className="sub"><div className="sub-toolbar">{plain.map((l) => <a key={l.href} className="sub-btn sm ghost" href={l.href}><i className={`fas ${l.icon}`} /> {l.label}</a>)}</div></div>;
  }
  if (me === null) return <div className="sub"><div className="sub-card"><p className="sub-muted"><i className="fas fa-spinner fa-spin" /> Loading your plan…</p></div></div>;

  const sub = me.subscription;
  const paid = !!sub && ['ACTIVE', 'PAST_DUE'].includes(sub.effective_status);
  const tone = me.status === 'PAST_DUE' ? 'bad' : paid && me.days_left <= 7 ? 'warn' : paid ? 'ok' : 'free';
  const statusText = me.status === 'PAST_DUE' ? 'Renewal due' : paid ? (sub!.cancel_at_period_end ? `Ends ${fmtDate(sub!.expires_at)}` : `Renews ${fmtDate(sub!.expires_at)}`) : 'Free plan';
  const upgrade = me.available.filter((p) => !p.is_free && p.code !== me.plan?.code).sort((a, b) => a.price_paise - b.price_paise)[0];
  const manage = onManage
    ? <button className="sub-btn sm primary" onClick={onManage}><i className="fas fa-crown" /> Manage subscription</button>
    : <a className="sub-btn sm primary" href={manageHref}><i className="fas fa-crown" /> Manage subscription</a>;

  return (
    <div className="sub">
      <section className="sub-card">
        <h2>
          <i className="fas fa-crown" style={{ color: '#b0924f' }} /> {me.plan?.name || 'Free'} plan
          <span className={`sub-badge ${tone}`}>{statusText}</span>
          <span className="sp" />
          {manage}
        </h2>
        <div className="sub-stack" style={{ gap: 12 }}>
          {paid && me.days_left <= 7 && <div className="sub-alert warn"><i className="fas fa-clock" /><span className="grow">{me.status === 'PAST_DUE' ? `Your plan ended on ${fmtDate(sub!.expires_at)} — renew to keep paid features.` : `${me.days_left} day${me.days_left === 1 ? '' : 's'} left on your plan.`}</span></div>}
          {me.usage.filter((u) => u.limit !== 0).map((u) => {
            const pct = u.limit == null ? 0 : Math.min(100, Math.round((u.used / Math.max(1, u.limit)) * 100));
            return (
              <div className="sub-meter" key={u.metric}>
                <div className="row"><span>{u.metric === 'project_access' ? 'Project details this week' : 'Property listings opened'}</span><b>{u.used}{u.limit == null ? ' · unlimited' : ` / ${u.limit}`}</b></div>
                {u.limit != null && <div className="bar"><i className={pct >= 90 ? 'hot' : ''} style={{ width: `${pct}%` }} /></div>}
                {u.limit != null && <small>{u.remaining} left{u.resetsAt ? ` · resets ${fmtDate(u.resetsAt)}` : ''}</small>}
              </div>
            );
          })}
          {me.category === 'developer' && (
            <div className="sub-meter">
              <div className="row"><span>Projects listed</span><b>{me.project_count ?? 0}{me.project_limit == null ? '' : ` / ${me.project_limit}`}</b></div>
              <small>{(me.projects || []).filter((p) => p.covered).length} on a paid plan{sub?.city ? '' : ''}</small>
            </div>
          )}
          {me.category === 'cp' && paid && sub!.city && <p className="sub-muted"><i className="fas fa-city" /> City: <b>{me.cities.find((c) => c.key === sub!.city)?.label || sub!.city}</b></p>}
          <div className="sub-toolbar">
            {links.map((l) => <a key={l.href} className="sub-btn sm ghost" href={l.href}><i className={`fas ${l.icon}`} /> {l.label}</a>)}
            {!paid && upgrade && <a className="sub-btn sm gold" href={`${manageHref}?plan=${encodeURIComponent(upgrade.code)}`}>Upgrade to {upgrade.name}</a>}
          </div>
        </div>
      </section>
    </div>
  );
}
