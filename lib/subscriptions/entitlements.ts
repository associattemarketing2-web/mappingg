import { ensureSchema, iso, isAvailable, sql, tx, type Row, type Sql } from './db';
import { ENTITLED_STATUSES, FEATURE_BY_KEY, METERS, categoryForRole, type Category, type SubStatus, type UsagePeriod } from './catalog';
import { freePlanFor, getPlan, getSettings, isEnforced, type Plan } from './store';
import { periodKey, periodResetsAt } from './pricing';

// The centralised entitlement engine. Every protected route asks this module
// — never the browser — what an account may do:
//   getUserSubscription · getActivePlan · getEntitlements · checkFeatureAccess
//   checkUsageLimit · consumeUsage · getRemainingUsage · validateCityAccess
//   validateProjectAccess
// While enforcement is off (Super admin → Subscriptions → Settings), checks
// still run and usage is still recorded, but nothing is blocked: results carry
// `wouldBlock` so dashboards can show what the limits will do.

export interface Subscription {
  id: string;
  user_id: string;
  category: Category;
  plan_id: string;
  plan_code: string;
  plan_name: string;
  status: SubStatus;
  /** Status after applying the clock (expiry / grace) — what entitlements use. */
  effective_status: SubStatus;
  payment_status: string;
  billing_period: string;
  period_months: number;
  billing_unit: string;
  quantity: number;
  project_ids: string[];
  city: string | null;
  amount_paise: number;
  currency: string;
  start_at: string;
  expires_at: string | null;
  renew_at: string | null;
  grace_until: string | null;
  auto_renew: boolean;
  cancel_at_period_end: boolean;
  cancelled_at: string | null;
  next_plan_id: string | null;
  source: string;
  last_payment_id: string | null;
  created_at: string;
  updated_at: string;
}

export function effectiveStatus(r: { status: string; expires_at: unknown; grace_until: unknown }, now = Date.now()): SubStatus {
  const s = r.status as SubStatus;
  if (s !== 'ACTIVE' && s !== 'PAST_DUE') return s;
  const exp = r.expires_at ? new Date(r.expires_at as string).getTime() : Infinity;
  if (exp > now) return 'ACTIVE';
  const grace = r.grace_until ? new Date(r.grace_until as string).getTime() : exp;
  return grace > now ? 'PAST_DUE' : 'EXPIRED';
}

export function toSubscription(r: Row): Subscription {
  return {
    id: r.id, user_id: r.user_id, category: r.category, plan_id: r.plan_id, plan_code: r.plan_code, plan_name: r.plan_name,
    status: r.status, effective_status: effectiveStatus(r as { status: string; expires_at: unknown; grace_until: unknown }), payment_status: r.payment_status, billing_period: r.billing_period,
    period_months: Number(r.period_months) || 0, billing_unit: r.billing_unit, quantity: Number(r.quantity) || 1,
    project_ids: Array.isArray(r.project_ids) ? r.project_ids : [], city: r.city || null, amount_paise: Number(r.amount_paise) || 0,
    currency: r.currency, start_at: iso(r.start_at)!, expires_at: iso(r.expires_at), renew_at: iso(r.renew_at), grace_until: iso(r.grace_until),
    auto_renew: !!r.auto_renew, cancel_at_period_end: !!r.cancel_at_period_end, cancelled_at: iso(r.cancelled_at),
    next_plan_id: r.next_plan_id || null, source: r.source, last_payment_id: r.last_payment_id || null,
    created_at: iso(r.created_at)!, updated_at: iso(r.updated_at)!,
  };
}

/** The account's current (open) subscription in a category, or null when they are on Free. */
export async function getUserSubscription(userId: string, category: Category, q: Sql = sql): Promise<Subscription | null> {
  await ensureSchema();
  const r = await q(
    `SELECT * FROM subscriptions WHERE user_id = $1 AND category = $2 AND status IN ('ACTIVE','PAST_DUE','PENDING','SUSPENDED')
     ORDER BY created_at DESC LIMIT 1`,
    [userId, category],
  );
  return r.rows[0] ? toSubscription(r.rows[0]) : null;
}

/** The plan whose entitlements apply right now: the paid plan while ACTIVE / in grace, otherwise Free. */
export async function getActivePlan(userId: string, category: Category): Promise<{ plan: Plan | null; subscription: Subscription | null; status: SubStatus }> {
  const sub = await getUserSubscription(userId, category);
  if (sub && ENTITLED_STATUSES.includes(sub.effective_status)) {
    const plan = await getPlan(sub.plan_id);
    if (plan) return { plan, subscription: sub, status: sub.effective_status };
  }
  return { plan: await freePlanFor(category), subscription: sub, status: sub ? sub.effective_status : 'FREE' };
}

export interface Entitlements {
  userId: string;
  role: string;
  category: Category | null;
  enforced: boolean;
  status: SubStatus;
  plan: Plan | null;
  freePlan: Plan | null;
  subscription: Subscription | null;
  /** Developer per-project plans: the projects the paid plan covers. */
  coveredProjects: string[];
  city: string | null;
}

// Short per-process cache: every map open checks entitlements; activation,
// expiry and admin changes call forgetEntitlements().
const g = globalThis as unknown as { __subEnt?: Map<string, { v: Entitlements; exp: number }> };
const cache: Map<string, { v: Entitlements; exp: number }> = g.__subEnt || (g.__subEnt = new Map());
const ENT_TTL = 15_000;

export function forgetEntitlements(userId?: string) {
  if (userId) cache.delete(userId); else cache.clear();
}

/** Everything the engine knows about what this account may do. Staff / unknown roles get category null. */
export async function getEntitlements(user: { id: string; role: string }): Promise<Entitlements> {
  const category = categoryForRole(user.role);
  const empty: Entitlements = { userId: user.id, role: user.role, category, enforced: false, status: 'FREE', plan: null, freePlan: null, subscription: null, coveredProjects: [], city: null };
  if (!category || !isAvailable()) return empty;
  const hit = cache.get(user.id);
  if (hit && hit.exp > Date.now() && hit.v.role === user.role) return hit.v;
  const [{ plan, subscription, status }, enforced, freePlan, ownCity] = await Promise.all([
    getActivePlan(user.id, category), isEnforced(), freePlanFor(category), category === 'cp' ? getCpCity(user.id) : null,
  ]);
  const entitled = !!subscription && ENTITLED_STATUSES.includes(subscription.effective_status);
  const v: Entitlements = {
    userId: user.id, role: user.role, category, enforced, status, plan, freePlan, subscription,
    coveredProjects: entitled && plan?.billing_unit === 'project' ? subscription!.project_ids : [],
    // A paid plan's own city wins; otherwise the city the CP picked on Free
    // (or, failing that, the city of a plan that has since ended).
    city: (entitled && subscription!.city) || ownCity || subscription?.city || null,
  };
  if (cache.size > 5000) cache.clear();
  cache.set(user.id, { v, exp: Date.now() + ENT_TTL });
  return v;
}

/** Developer features that apply per subscribed project (the rest are account-wide). */
export const PROJECT_SCOPED = new Set([
  'dev_brochure_upload', 'dev_floor_plan_upload', 'dev_gallery_upload', 'dev_project_editing', 'dev_rera_verification_info',
  'dev_igbc_info', 'dev_advanced_management', 'dev_site_visit_booking', 'dev_enhanced_visibility', 'dev_enhanced_presentation',
  'dev_video_highlight', 'dev_priority_promotion',
]);

export interface AccessResult {
  allowed: boolean;
  /** True when the plan would refuse this but enforcement is off. */
  wouldBlock: boolean;
  code?: 'feature_not_in_plan' | 'project_not_covered' | 'limit_reached' | 'city_not_selected' | 'city_not_allowed' | 'wrong_role';
  message?: string;
  feature?: string;
}

const ok = (): AccessResult => ({ allowed: true, wouldBlock: false });
function deny(ent: Entitlements, code: NonNullable<AccessResult['code']>, message: string, feature?: string): AccessResult {
  return ent.enforced ? { allowed: false, wouldBlock: true, code, message, feature } : { allowed: true, wouldBlock: true, code, message, feature };
}

/** Does the plan (or, for per-project features, the project's coverage) include this feature? */
export function hasFeature(ent: Entitlements, key: string, opts: { projectId?: string } = {}): boolean {
  const def = FEATURE_BY_KEY.get(key);
  if (!def || def.category !== ent.category) return false;
  const plan = ent.plan;
  if (!plan) return false;
  if (plan.features[key] !== true) return false;
  if (plan.billing_unit === 'project' && PROJECT_SCOPED.has(key)) {
    // A per-project plan unlocks project features only on the projects it covers;
    // other projects fall back to the free plan.
    if (opts.projectId && ent.coveredProjects.includes(opts.projectId)) return true;
    return ent.freePlan?.features[key] === true;
  }
  return true;
}

export function checkFeatureAccess(ent: Entitlements, key: string, opts: { projectId?: string } = {}): AccessResult {
  const def = FEATURE_BY_KEY.get(key);
  if (!ent.category || !def || def.category !== ent.category) {
    return { allowed: false, wouldBlock: true, code: 'wrong_role', message: 'This feature is not available for your account type.', feature: key };
  }
  if (hasFeature(ent, key, opts)) return ok();
  const covered = ent.plan?.billing_unit === 'project' && PROJECT_SCOPED.has(key) && ent.plan.features[key] === true;
  return covered
    ? deny(ent, 'project_not_covered', 'Add this project to your subscription to use this feature.', key)
    : deny(ent, 'feature_not_in_plan', `${def.label} is not included in your current plan. Upgrade to unlock it.`, key);
}

/** A plan limit: number, or null = unlimited. Missing = 0 (least privilege). */
export function limitOf(ent: Entitlements, key: string): number | null {
  const lim = ent.plan?.limits?.[key];
  if (lim === null) return null;
  const n = Number(lim);
  return Number.isFinite(n) ? n : 0;
}

function meterPeriod(ent: Entitlements, metric: string): UsagePeriod {
  const m = METERS[metric];
  return (ent.plan?.limit_periods?.[m.limit] as UsagePeriod) || m.period;
}

export interface UsageState {
  metric: string;
  limit: number | null;
  used: number;
  remaining: number | null;
  period: UsagePeriod;
  periodKey: string;
  resetsAt: string | null;
}

export async function checkUsageLimit(ent: Entitlements, metric: string, q: Sql = sql, now = new Date()): Promise<UsageState> {
  const m = METERS[metric];
  if (!m) throw new Error(`Unknown usage metric ${metric}`);
  const period = meterPeriod(ent, metric);
  const key = periodKey(period, now);
  const limit = limitOf(ent, m.limit);
  const r = await q(`SELECT count(*)::int AS n FROM sub_usage WHERE user_id = $1 AND metric = $2 AND period_key = $3`, [ent.userId, metric, key]);
  const used = Number(r.rows[0]?.n || 0);
  const resets = periodResetsAt(period, now);
  return { metric, limit, used, remaining: limit == null ? null : Math.max(0, limit - used), period, periodKey: key, resetsAt: resets ? resets.toISOString() : null };
}

export const getRemainingUsage = checkUsageLimit;

export interface ConsumeResult extends AccessResult {
  usage: UsageState;
  /** True when this call counted a new item (false = already counted this period, or refused). */
  counted: boolean;
}

/**
 * Count one unique `subject` (e.g. a project id) against a metered limit.
 * Idempotent per period: re-opening the same project, refreshing, other tabs or
 * repeated API calls never count twice. Serialised per account+metric with a
 * transaction-scoped advisory lock, so parallel requests can't overshoot the limit.
 */
export async function consumeUsage(ent: Entitlements, metric: string, subject: string, now = new Date()): Promise<ConsumeResult> {
  await ensureSchema();
  return tx(async (q) => {
    await q(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`sub_usage:${ent.userId}:${metric}`]);
    const state = await checkUsageLimit(ent, metric, q, now);
    const seen = await q(`SELECT 1 FROM sub_usage WHERE user_id=$1 AND metric=$2 AND period_key=$3 AND subject=$4`, [ent.userId, metric, state.periodKey, subject]);
    if (seen.rows.length) return { ...ok(), usage: state, counted: false };
    if (state.limit != null && state.used >= state.limit) {
      const label = metric === 'project_access' ? 'project details' : 'property listings';
      const when = state.period === 'week' ? ' this week' : state.period === 'month' ? ' this month' : '';
      const res = deny(ent, 'limit_reached', `You have opened ${state.used} of ${state.limit} ${label}${when} on your plan. Upgrade for more.`);
      if (!res.allowed) return { ...res, usage: state, counted: false };
      // Not enforced: record it anyway so usage reports stay accurate.
    }
    await q(`INSERT INTO sub_usage (user_id, metric, period_key, subject) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [ent.userId, metric, state.periodKey, subject]);
    const used = state.used + 1;
    const usage = { ...state, used, remaining: state.limit == null ? null : Math.max(0, state.limit - used) };
    const over = state.limit != null && state.used >= state.limit;
    return { allowed: true, wouldBlock: over, ...(over ? { code: 'limit_reached' as const } : {}), usage, counted: true };
  });
}

/** The city a channel partner chose outside a paid plan (see cp_city), or null. */
export async function getCpCity(userId: string): Promise<string | null> {
  await ensureSchema();
  const r = await sql(`SELECT city FROM cp_city WHERE user_id = $1`, [userId]);
  return (r.rows[0]?.city as string) || null;
}

/** CP city restriction: plans with cp_max_cities = 1 only open projects in the chosen city. */
export function validateCityAccess(ent: Entitlements, cityKey: string | null | undefined): AccessResult {
  if (ent.category !== 'cp') return ok();
  const max = limitOf(ent, 'cp_max_cities');
  if (max == null) return ok();
  if (!ent.city) return deny(ent, 'city_not_selected', 'Choose the city your plan covers in My subscription first.');
  if (!cityKey || cityKey !== ent.city) return deny(ent, 'city_not_allowed', 'This project is outside the city your plan covers. Upgrade your plan to open projects in every city.');
  return ok();
}

/**
 * A CP or buyer opening a project's full details: city check, then the
 * weekly/lifetime unique-project meter. Developers and staff are not metered.
 */
export async function validateProjectAccess(ent: Entitlements, pin: { id: string; cityKey?: string | null }): Promise<ConsumeResult | AccessResult> {
  if (ent.category === 'cp') {
    if (!hasFeature(ent, 'cp_project_access')) {
      const r = checkFeatureAccess(ent, 'cp_project_access');
      if (!r.allowed) return r;
    }
    const city = validateCityAccess(ent, pin.cityKey);
    if (!city.allowed) return city;
    const used = await consumeUsage(ent, 'project_access', pin.id);
    return city.wouldBlock && used.allowed ? { ...used, wouldBlock: true, code: city.code, message: city.message } : used;
  }
  if (ent.category === 'buyer') {
    if (!hasFeature(ent, 'buyer_listing_access')) {
      const r = checkFeatureAccess(ent, 'buyer_listing_access');
      if (!r.allowed) return r;
    }
    return consumeUsage(ent, 'listing_access', pin.id);
  }
  return ok();
}

/** Upgrade target suggestion for a blocked action (cheapest active plan with the feature). */
export async function suggestUpgrade(ent: Entitlements, feature?: string): Promise<{ code: string; name: string } | null> {
  if (!ent.category) return null;
  const { listPlans } = await import('./store');
  const plans = (await listPlans({ category: ent.category, activeOnly: true })).filter((p) => !p.is_free && p.id !== ent.plan?.id);
  const fit = plans.filter((p) => !feature || p.features[feature] === true).sort((a, b) => a.price_paise - b.price_paise);
  return fit[0] ? { code: fit[0].code, name: fit[0].name } : null;
}

export { getSettings };
