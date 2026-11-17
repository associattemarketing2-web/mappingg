import type { ReactNode } from 'react';
import { formatInr } from '@/lib/subscriptions/catalog';
import type { PublicPlan } from '@/lib/subscriptions/summary';

// Pricing cards + comparison table for one account type. No hooks, so it renders
// on the server (/pricing) and inside client dashboards alike. The call-to-action
// for each plan is supplied by the caller.

export const unitLabel = (p: Pick<PublicPlan, 'billing_unit' | 'billing_period' | 'period_label'>) =>
  p.billing_period === 'none' ? 'free forever' : `${p.billing_unit === 'project' ? 'per project ' : ''}${p.period_label}`;

export function limitText(l: { key: string; label: string; value: number | null }): string {
  if (l.value === null) {
    if (l.key === 'cp_max_cities') return 'All cities';
    if (l.key === 'dev_max_states') return 'Multiple states';
    return `Unlimited — ${l.label.toLowerCase()}`;
  }
  if (l.key === 'cp_weekly_project_access') return `${l.value} project details / week`;
  if (l.key === 'buyer_listing_limit') return `${l.value} property listings`;
  if (l.key === 'cp_max_cities') return `${l.value} selected cit${l.value === 1 ? 'y' : 'ies'}`;
  if (l.key === 'dev_max_projects') return `Up to ${l.value} projects listed`;
  if (l.key === 'dev_max_states') return `${l.value} state${l.value === 1 ? '' : 's'}`;
  if (l.key === 'cp_max_leads') return l.value ? `Up to ${l.value} client leads` : 'No lead manager';
  if (l.key === 'dev_media_per_project') return l.value ? `${l.value} media files per project` : 'No media uploads';
  return `${l.label}: ${l.value}`;
}

export default function PlanGrid({ plans, currentCode, cta }: { plans: PublicPlan[]; currentCode?: string | null; cta: (p: PublicPlan) => ReactNode }) {
  return (
    <div className="sub-plans">
      {plans.map((p) => {
        const included = p.features.filter((f) => f.included);
        const excluded = p.features.filter((f) => !f.included).slice(0, 3);
        return (
          <article key={p.code} className={`sub-plan${p.recommended ? ' rec' : ''}${currentCode === p.code ? ' current' : ''}`}>
            {p.recommended && <span className="sub-ribbon">★ Recommended</span>}
            <h3>
              {p.name}
              {p.is_free ? <span className="sub-badge free">Free</span> : <span className="sub-badge premium"><i className="fas fa-crown" /> Premium</span>}
              {currentCode === p.code && <span className="sub-badge ok">Your plan</span>}
            </h3>
            <p className="tag">{p.tagline}</p>
            <div className="sub-price">
              <b>{p.is_free ? '₹0' : formatInr(p.price_paise)}</b>
              <span>{unitLabel(p)}</span>
            </div>
            <ul className="sub-feats">
              {p.limits.filter((l) => !(l.value === 0 && /media|lead/.test(l.key))).map((l) => (
                <li key={l.key} className="lim"><i className="fas fa-gauge-high" aria-hidden="true" /><b>{limitText(l)}</b></li>
              ))}
              {included.map((f) => <li key={f.key}><i className="fas fa-check" aria-hidden="true" />{f.label}</li>)}
              {excluded.map((f) => <li key={f.key} className="off"><i className="fas fa-xmark" aria-hidden="true" /><span>{f.label}</span></li>)}
            </ul>
            {cta(p)}
          </article>
        );
      })}
    </div>
  );
}

/** Feature-by-feature comparison (collapsed by default). */
export function PlanCompare({ plans, open = false }: { plans: PublicPlan[]; open?: boolean }) {
  if (!plans.length) return null;
  const rows = plans[0].features.map((f) => f.key);
  const limits = plans[0].limits.map((l) => l.key);
  return (
    <details className="sub-compare" open={open}>
      <summary>Compare every feature <i className="fas fa-chevron-down" aria-hidden="true" /></summary>
      <div className="sub-table-wrap">
        <table className="sub-table">
          <thead>
            <tr><th scope="col">Feature</th>{plans.map((p) => <th key={p.code} scope="col">{p.name}</th>)}</tr>
          </thead>
          <tbody>
            <tr><td>Price</td>{plans.map((p) => <td key={p.code}><b>{p.is_free ? '₹0' : formatInr(p.price_paise)}</b><br /><small>{unitLabel(p)}</small></td>)}</tr>
            {limits.map((k) => (
              <tr key={k}>
                <td>{plans[0].limits.find((l) => l.key === k)?.label}</td>
                {plans.map((p) => { const l = p.limits.find((x) => x.key === k); return <td key={p.code}>{l ? (l.value === null ? 'Unlimited' : l.value) : '—'}</td>; })}
              </tr>
            ))}
            {rows.map((k) => (
              <tr key={k}>
                <td>{plans[0].features.find((f) => f.key === k)?.label}</td>
                {plans.map((p) => {
                  const on = p.features.find((f) => f.key === k)?.included;
                  return <td key={p.code} className={on ? 'yes' : 'no'}><i className={`fas ${on ? 'fa-circle-check' : 'fa-minus'}`} aria-label={on ? 'Included' : 'Not included'} /></td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
