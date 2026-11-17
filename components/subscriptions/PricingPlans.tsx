import type { CSSProperties, ReactNode } from 'react';
import { formatInr } from '@/lib/subscriptions/catalog';
import type { PublicPlan } from '@/lib/subscriptions/summary';
import { limitText, unitLabel } from './PlanGrid';

// The /pricing page's plan cards and comparison table (the marketing layout:
// icon + name, big price, checklist, one highlighted "Most popular" plan). Shows
// the same plan data as PlanGrid.
// Server-only, no hooks. Dashboards keep using PlanGrid.

/** Features shown on a card before "See all"; the rest are one click away. */
const CARD_FEATURES = 6;

/** Short billing suffix next to the price, e.g. "/ month", "/ project / month". */
function perLabel(p: PublicPlan): string {
  if (p.billing_period === 'none') return '/ month';
  const period = ({ month: 'month', quarter: 'quarter', half_year: '6 months', year: 'year' } as Record<string, string>)[p.billing_period] || p.period_label;
  return `${p.billing_unit === 'project' ? '/ project ' : ''}/ ${period}`;
}

function planIcon(p: PublicPlan, i: number, count: number): string {
  if (p.is_free) return 'fas fa-seedling';
  if (p.recommended) return 'fas fa-crown';
  return i === count - 1 ? 'fas fa-layer-group' : 'fas fa-rocket';
}

export function PricingCards({ plans, cta }: { plans: PublicPlan[]; cta: (p: PublicPlan) => ReactNode }) {
  return (
    <div className="pp-cards" data-count={plans.length}>
      {plans.map((p, i) => {
        const limits = p.limits.filter((l) => !(l.value === 0 && /media|lead/.test(l.key)));
        const included = p.features.filter((f) => f.included);
        const excluded = p.features.filter((f) => !f.included).slice(0, 3);
        const shown = included.slice(0, CARD_FEATURES);
        const more = included.slice(CARD_FEATURES);
        return (
          <article key={p.code} className={`pp-card${p.recommended ? ' hot' : ''}`}>
            {p.recommended && <span className="pp-popular"><i className="fas fa-crown" aria-hidden="true" /> Most popular</span>}
            <span className="pp-card-art" aria-hidden="true" />
            <h3><i className={planIcon(p, i, plans.length)} aria-hidden="true" /> {p.name}</h3>
            <p className="pp-tag">{p.tagline}</p>
            <div className="pp-price">
              <b>{p.is_free ? '₹0' : formatInr(p.price_paise)}</b>
              <span>{perLabel(p)}</span>
            </div>
            {cta(p)}
            {limits.length > 0 && (
              <ul className="pp-limits">
                {limits.map((l) => <li key={l.key}><i className="fas fa-gauge-high" aria-hidden="true" />{limitText(l)}</li>)}
              </ul>
            )}
            <ul className="pp-checks">
              {shown.map((f) => <li key={f.key}><i className="fas fa-check" aria-hidden="true" />{f.label}</li>)}
            </ul>
            {more.length + excluded.length > 0 && (
              <details className="pp-more">
                <summary>
                  <span className="closed">{more.length ? `See all ${included.length} features` : 'What’s not included'}</span>
                  <span className="open">Show less</span>
                  <i className="fas fa-chevron-down" aria-hidden="true" />
                </summary>
                <ul className="pp-checks">
                  {more.map((f) => <li key={f.key}><i className="fas fa-check" aria-hidden="true" />{f.label}</li>)}
                  {excluded.map((f) => <li key={f.key} className="off"><i className="fas fa-xmark" aria-hidden="true" />{f.label}</li>)}
                </ul>
              </details>
            )}
          </article>
        );
      })}
    </div>
  );
}

/** Reassurance under the cards — the same promises as the "Billing, taxes & renewals" section. */
export function PricingTrust() {
  return (
    <ul className="pp-trust">
      <li><i className="fas fa-lock" aria-hidden="true" /><span><b>Secure payments</b>Processed by Razorpay</span></li>
      <li><i className="fas fa-arrow-up-right-dots" aria-hidden="true" /><span><b>Upgrade any time</b>Credit for unused days</span></li>
      <li><i className="fas fa-bell" aria-hidden="true" /><span><b>No surprise renewals</b>Reminders 7 days &amp; 1 day before</span></li>
      <li><i className="fas fa-shield-halved" aria-hidden="true" /><span><b>Nothing is deleted</b>Your data stays if a plan ends</span></li>
    </ul>
  );
}

const ICONS: [RegExp, string][] = [
  [/project(s)? you can list|listing/i, 'fas fa-layer-group'],
  [/brochure/i, 'fas fa-file-pdf'],
  [/floor plan/i, 'fas fa-vector-square'],
  [/gallery|media/i, 'fas fa-images'],
  [/video/i, 'fas fa-video'],
  [/dashboard/i, 'fas fa-chart-pie'],
  [/visibility|presentation/i, 'fas fa-eye'],
  [/promotion/i, 'fas fa-bullhorn'],
  [/rera|legal/i, 'fas fa-shield-halved'],
  [/igbc|green/i, 'fas fa-leaf'],
  [/site visit/i, 'fas fa-calendar-check'],
  [/state|cit(y|ies)/i, 'fas fa-map-location-dot'],
  [/crm|lead/i, 'fas fa-chart-simple'],
  [/price|emi|loan/i, 'fas fa-indian-rupee-sign'],
  [/compare/i, 'fas fa-code-compare'],
  [/favourite/i, 'fas fa-heart'],
  [/share/i, 'fas fa-share-nodes'],
  [/vastu/i, 'fas fa-compass'],
  [/expert/i, 'fas fa-headset'],
  [/portfolio/i, 'fas fa-briefcase'],
  [/edit|management/i, 'fas fa-pen-to-square'],
];
const iconFor = (label: string) => ICONS.find(([re]) => re.test(label))?.[1] ?? 'fas fa-circle-check';

export function PricingCompare({ plans }: { plans: PublicPlan[] }) {
  if (!plans.length) return null;
  const hot = plans.findIndex((p) => p.recommended);
  const col = (i: number) => (i === hot ? 'hot' : undefined);
  const limits = plans[0].limits;
  const features = plans[0].features;
  return (
    <div className="pp-compare">
      <div className="pp-compare-head">
        <h2>Compare every feature</h2>
        <p>Side by side, plan by plan.</p>
      </div>
      <div className="pp-table-wrap">
        <table className="pp-table" style={{ '--n': plans.length } as CSSProperties}>
          <thead>
            <tr>
              <th scope="col">Features</th>
              {plans.map((p, i) => <th key={p.code} scope="col" className={col(i)}>{p.name}</th>)}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row"><i className="fas fa-indian-rupee-sign" aria-hidden="true" />Price</th>
              {plans.map((p, i) => <td key={p.code} className={col(i)}><b>{p.is_free ? '₹0' : formatInr(p.price_paise)}</b><br /><small>{unitLabel(p)}</small></td>)}
            </tr>
            {limits.map((l) => (
              <tr key={l.key}>
                <th scope="row"><i className={iconFor(l.label)} aria-hidden="true" />{l.label}</th>
                {plans.map((p, i) => {
                  const v = p.limits.find((x) => x.key === l.key)?.value;
                  return <td key={p.code} className={col(i)}>{v === undefined ? '—' : v === null ? 'Unlimited' : v}</td>;
                })}
              </tr>
            ))}
            {features.map((f) => (
              <tr key={f.key}>
                <th scope="row"><i className={iconFor(f.label)} aria-hidden="true" />{f.label}</th>
                {plans.map((p, i) => {
                  const on = p.features.find((x) => x.key === f.key)?.included;
                  return (
                    <td key={p.code} className={col(i)}>
                      {on ? <i className="fas fa-check yes" aria-label="Included" /> : <span className="no" aria-label="Not included">—</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
