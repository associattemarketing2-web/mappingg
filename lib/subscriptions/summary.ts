import { DEFAULT_PLANS, FEATURES, METERS, PERIOD_LABEL, PERIOD_MONTHS, type Category } from './catalog';
import { checkUsageLimit, getEntitlements, hasFeature, limitOf, type Entitlements, type UsageState } from './entitlements';
import { getGateway } from './gateway';
import { listPlans, getPlan, getSettings, type Plan } from './store';
import { daysLeft } from './pricing';
import { CITY_OPTIONS, developerProjectCount, developerProjects, type DevProject } from './projects';
import { sql } from './db';

// The "My subscription" view model, shared by GET /api/subscriptions/current
// and the dashboard widgets. Plain JSON — safe to send to the browser (no
// secrets: only the gateway's public key id and whether it is configured).

export interface PublicPlan {
  category: Category; code: string; name: string; tagline: string; description: string; price_paise: number; billing_period: string; period_label: string;
  period_months: number; billing_unit: string; recommended: boolean; is_free: boolean; sort: number;
  features: { key: string; label: string; included: boolean }[];
  limits: { key: string; label: string; value: number | null }[];
}

export function publicPlan(p: Plan): PublicPlan {
  const defs = FEATURES.filter((f) => f.category === p.category);
  return {
    category: p.category, code: p.code, name: p.name, tagline: p.tagline, description: p.description, price_paise: p.price_paise, billing_period: p.billing_period,
    period_label: PERIOD_LABEL[p.billing_period] || '', period_months: p.period_months, billing_unit: p.billing_unit, recommended: p.recommended,
    is_free: p.is_free, sort: p.sort,
    features: defs.filter((f) => f.kind === 'flag').map((f) => ({ key: f.key, label: f.label, included: p.features[f.key] === true })),
    limits: defs.filter((f) => f.kind === 'limit').map((f) => ({ key: f.key, label: f.label, value: p.limits[f.key] === null ? null : Number(p.limits[f.key] ?? 0) })),
  };
}

/** The seeded default plans as PublicPlans — what /pricing shows if the database can't be
 *  reached, so the page never renders empty. Live (admin-edited) plans win whenever available. */
export function defaultPublicPlans(): PublicPlan[] {
  return DEFAULT_PLANS.map((p) => {
    const defs = FEATURES.filter((f) => f.category === p.category);
    return {
      category: p.category, code: p.code, name: p.name, tagline: p.tagline, description: '', price_paise: p.price_paise, billing_period: p.billing_period,
      period_label: PERIOD_LABEL[p.billing_period] || '', period_months: PERIOD_MONTHS[p.billing_period], billing_unit: p.billing_unit, recommended: !!p.recommended,
      is_free: p.price_paise === 0, sort: p.sort,
      features: defs.filter((f) => f.kind === 'flag').map((f) => ({ key: f.key, label: f.label, included: p.features[f.key] === true })),
      limits: defs.filter((f) => f.kind === 'limit').map((f) => ({ key: f.key, label: f.label, value: p.limits[f.key] === null ? null : Number(p.limits[f.key] ?? 0) })),
    };
  });
}

export async function publicCatalog(category?: Category) {
  const plans = await listPlans({ category, activeOnly: true });
  const gw = getGateway();
  return {
    plans: plans.map(publicPlan),
    payments: { configured: gw.configured(), mode: gw.mode() },
  };
}

export interface MySubscription {
  category: Category;
  enforced: boolean;
  status: string;
  plan: PublicPlan | null;
  subscription: Entitlements['subscription'];
  days_left: number;
  next_plan: { code: string; name: string } | null;
  usage: UsageState[];
  available: PublicPlan[];
  payments: { configured: boolean; mode: 'test' | 'live' | null };
  cities: typeof CITY_OPTIONS;
  projects?: (DevProject & { covered: boolean })[];
  project_count?: number;
  project_limit?: number | null;
  unread: number;
  tax: { registered: boolean; rate: number; inclusive: boolean };
  terms_url: string;
}

export async function mySubscription(user: { id: string; role: string }): Promise<MySubscription | null> {
  const ent = await getEntitlements(user);
  if (!ent.category) return null;
  const settings = await getSettings();
  const usage: UsageState[] = [];
  for (const [metric, m] of Object.entries(METERS)) {
    const def = FEATURES.find((f) => f.key === m.limit);
    if (def?.category === ent.category) usage.push(await checkUsageLimit(ent, metric));
  }
  const gw = getGateway();
  const sub = ent.subscription;
  const next = sub?.next_plan_id ? await getPlan(sub.next_plan_id) : null;
  const unread = Number((await sql(`SELECT count(*)::int AS n FROM sub_notifications WHERE user_id = $1 AND read_at IS NULL`, [user.id])).rows[0]?.n || 0);
  const out: MySubscription = {
    category: ent.category, enforced: ent.enforced, status: ent.status, plan: ent.plan ? publicPlan(ent.plan) : null, subscription: sub,
    days_left: sub ? daysLeft(sub.expires_at) : 0, next_plan: next ? { code: next.code, name: next.name } : null, usage,
    available: (await listPlans({ category: ent.category, activeOnly: true })).map(publicPlan),
    payments: { configured: gw.configured(), mode: gw.mode() }, cities: CITY_OPTIONS, unread,
    tax: { registered: settings.tax.registered, rate: settings.tax.rate, inclusive: settings.tax.inclusive }, terms_url: settings.terms_url,
  };
  if (ent.category === 'developer') {
    const projects = await developerProjects(user.id);
    out.projects = projects.map((p) => ({ ...p, covered: ent.coveredProjects.includes(p.id) }));
    out.project_count = await developerProjectCount(user.id);
    out.project_limit = limitOf(ent, 'dev_max_projects');
  }
  return out;
}

/** Feature flags for the current account, for client UIs that hide/disable controls (the server still enforces). */
export async function featureMap(user: { id: string; role: string }): Promise<Record<string, boolean>> {
  const ent = await getEntitlements(user);
  const out: Record<string, boolean> = {};
  for (const f of FEATURES) if (f.category === ent.category && f.kind === 'flag') out[f.key] = !ent.enforced || hasFeature(ent, f.key);
  return out;
}
