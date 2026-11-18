import { randomUUID } from 'node:crypto';
import { DEFAULT_SETTINGS, ensureSchema, isAvailable, iso, sql, type Row, type Sql, type SubSettings } from './db';
import { CATEGORIES, FREE_PLAN_CODE, type BillingPeriod, type BillingUnit, type Category, type UsagePeriod } from './catalog';

// Read/write helpers for plans, settings, audit and history. Every function
// takes an optional `q` so callers inside a transaction pass their client.

export interface Plan {
  id: string;
  category: Category;
  code: string;
  name: string;
  tagline: string;
  description: string;
  price_paise: number;
  currency: string;
  billing_period: BillingPeriod;
  period_months: number;
  billing_unit: BillingUnit;
  min_quantity: number;
  max_quantity: number | null;
  is_free: boolean;
  is_active: boolean;
  recommended: boolean;
  sort: number;
  features: Record<string, boolean>;
  limits: Record<string, number | null>;
  limit_periods: Record<string, UsagePeriod>;
  created_at: string;
  updated_at: string;
}

export function toPlan(r: Row): Plan {
  return {
    id: r.id, category: r.category, code: r.code, name: r.name, tagline: r.tagline || '', description: r.description || '',
    price_paise: Number(r.price_paise) || 0, currency: r.currency || 'INR', billing_period: r.billing_period,
    period_months: Number(r.period_months) || 0, billing_unit: r.billing_unit, min_quantity: Number(r.min_quantity) || 1,
    max_quantity: r.max_quantity == null ? null : Number(r.max_quantity), is_free: !!r.is_free, is_active: !!r.is_active,
    recommended: !!r.recommended, sort: Number(r.sort) || 0, features: r.features || {}, limits: r.limits || {},
    limit_periods: r.limit_periods || {}, created_at: iso(r.created_at)!, updated_at: iso(r.updated_at)!,
  };
}

// ---- settings (cached briefly: read on every entitlement check) --------------
const g = globalThis as unknown as { __subSettings?: { v: SubSettings; exp: number }; __subPlans?: { v: Plan[]; exp: number } };
const SETTINGS_TTL = 30_000;

export async function getSettings(q: Sql = sql): Promise<SubSettings> {
  const hit = g.__subSettings;
  if (hit && hit.exp > Date.now() && q === sql) return hit.v;
  await ensureSchema();
  const r = await q(`SELECT value FROM sub_settings WHERE key = 'main'`);
  const stored = (r.rows[0]?.value || {}) as Partial<SubSettings>;
  const v: SubSettings = { ...DEFAULT_SETTINGS, ...stored, tax: { ...DEFAULT_SETTINGS.tax, ...(stored.tax || {}) } };
  if (q === sql) g.__subSettings = { v, exp: Date.now() + SETTINGS_TTL };
  return v;
}

export async function saveSettings(patch: Partial<SubSettings>, actor: string): Promise<SubSettings> {
  const cur = await getSettings();
  const next: SubSettings = { ...cur, ...patch, tax: { ...cur.tax, ...(patch.tax || {}) } };
  await sql(`UPDATE sub_settings SET value = $1::jsonb, updated_by = $2, updated_at = now() WHERE key = 'main'`, [JSON.stringify(next), actor]);
  g.__subSettings = undefined;
  await audit(actor, 'settings.update', 'settings', 'main', { patch });
  return next;
}

/** Env override for the master switch: '1'/'true' → on, '0'/'false' → off, unset → admin setting. */
export function envEnabled(): boolean | null {
  const env = (process.env.SUBSCRIPTIONS_ENABLED || '').trim().toLowerCase();
  if (env === '1' || env === 'true') return true;
  if (env === '0' || env === 'false') return false;
  return null;
}

/**
 * Master switch (Super admin → Subscriptions). When off, every pricing page,
 * plan link, checkout and limit disappears and the site behaves as before.
 * Never throws: any database problem counts as "off".
 */
export async function isSubscriptionsEnabled(): Promise<boolean> {
  const env = envEnabled();
  if (env !== null) return env && isAvailable();
  if (!isAvailable()) return false;
  try { return !!(await getSettings()).enabled; } catch { return false; }
}

/** Whether limits and paid features are enforced (admin switch; env SUBSCRIPTION_ENFORCE=1/0 overrides). Always off while subscriptions are disabled. */
export async function isEnforced(): Promise<boolean> {
  if (!(await isSubscriptionsEnabled())) return false;
  const env = (process.env.SUBSCRIPTION_ENFORCE || '').trim();
  if (env === '1' || env.toLowerCase() === 'true') return true;
  if (env === '0' || env.toLowerCase() === 'false') return false;
  return !!(await getSettings()).enforce;
}

export function clearCaches() {
  g.__subSettings = undefined;
  g.__subPlans = undefined;
}

// ---- plans --------------------------------------------------------------------
const PLANS_TTL = 30_000;

export async function listPlans(opts: { category?: Category; activeOnly?: boolean } = {}, q: Sql = sql): Promise<Plan[]> {
  let all: Plan[];
  const hit = g.__subPlans;
  if (hit && hit.exp > Date.now() && q === sql) all = hit.v;
  else {
    await ensureSchema();
    all = (await q(`SELECT * FROM sub_plans ORDER BY category, sort, price_paise`)).rows.map(toPlan);
    if (q === sql) g.__subPlans = { v: all, exp: Date.now() + PLANS_TTL };
  }
  return all.filter((p) => (!opts.category || p.category === opts.category) && (!opts.activeOnly || p.is_active));
}

export async function getPlan(idOrCode: string, q: Sql = sql): Promise<Plan | null> {
  const plans = await listPlans({}, q);
  return plans.find((p) => p.id === idOrCode || p.code === idOrCode) || null;
}

/** The category's free plan (falls back to the cheapest active plan if an admin renamed it). */
export async function freePlanFor(category: Category, q: Sql = sql): Promise<Plan | null> {
  const plans = await listPlans({ category }, q);
  return plans.find((p) => p.code === FREE_PLAN_CODE[category])
    || plans.filter((p) => p.is_free && p.is_active).sort((a, b) => a.sort - b.sort)[0]
    || null;
}

export interface PlanInput {
  category?: Category;
  code?: string;
  name?: string;
  tagline?: string;
  description?: string;
  price_paise?: number;
  billing_period?: BillingPeriod;
  period_months?: number;
  billing_unit?: BillingUnit;
  min_quantity?: number;
  max_quantity?: number | null;
  is_active?: boolean;
  recommended?: boolean;
  sort?: number;
  features?: Record<string, boolean>;
  limits?: Record<string, number | null>;
  limit_periods?: Record<string, UsagePeriod>;
}

export async function createPlan(input: Required<Pick<PlanInput, 'category' | 'code' | 'name'>> & PlanInput, actor: string): Promise<Plan> {
  if (!CATEGORIES.includes(input.category)) throw new Error('Unknown category');
  await ensureSchema();
  const price = Math.max(0, Math.round(input.price_paise || 0));
  const r = await sql(
    `INSERT INTO sub_plans (id, category, code, name, tagline, description, price_paise, billing_period, period_months, billing_unit,
       min_quantity, max_quantity, is_free, is_active, recommended, sort, features, limits, limit_periods)
     VALUES ($1,$2,$1,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17::jsonb,$18::jsonb) RETURNING *`,
    [input.code, input.category, input.name, input.tagline || '', input.description || '', price, input.billing_period || 'month',
      input.period_months ?? 1, input.billing_unit || 'account', input.min_quantity ?? 1, input.max_quantity ?? null, price === 0,
      input.is_active ?? true, !!input.recommended, input.sort ?? 99, JSON.stringify(input.features || {}),
      JSON.stringify(input.limits || {}), JSON.stringify(input.limit_periods || {})],
  );
  clearCaches();
  await audit(actor, 'plan.create', 'plan', input.code, { input });
  return toPlan(r.rows[0]);
}

export async function updatePlan(id: string, patch: PlanInput, actor: string): Promise<Plan> {
  const before = await getPlan(id);
  if (!before) throw new Error('Plan not found');
  const next = { ...before, ...patch };
  const price = Math.max(0, Math.round(next.price_paise));
  const r = await sql(
    `UPDATE sub_plans SET name=$2, tagline=$3, description=$4, price_paise=$5, billing_period=$6, period_months=$7, billing_unit=$8,
       min_quantity=$9, max_quantity=$10, is_free=$11, is_active=$12, recommended=$13, sort=$14, features=$15::jsonb, limits=$16::jsonb,
       limit_periods=$17::jsonb, updated_at=now() WHERE id=$1 RETURNING *`,
    [before.id, next.name, next.tagline, next.description, price, next.billing_period, next.period_months, next.billing_unit,
      Math.max(1, next.min_quantity), next.max_quantity, price === 0, next.is_active, next.recommended, next.sort,
      JSON.stringify(next.features), JSON.stringify(next.limits), JSON.stringify(next.limit_periods)],
  );
  clearCaches();
  await audit(actor, 'plan.update', 'plan', before.id, { before: pick(before), after: pick(next) });
  return toPlan(r.rows[0]);
}

const pick = (p: Plan | PlanInput) => ({ price_paise: p.price_paise, billing_period: p.billing_period, period_months: p.period_months, is_active: p.is_active, features: p.features, limits: p.limits, limit_periods: p.limit_periods, name: p.name });

// ---- audit & history ----------------------------------------------------------
export async function audit(actor: string, action: string, targetType: string, targetId: string, detail: Record<string, unknown> = {}, q: Sql = sql) {
  await q(`INSERT INTO sub_audit (actor, action, target_type, target_id, detail) VALUES ($1,$2,$3,$4,$5::jsonb)`,
    [actor || 'system', action, targetType, targetId, JSON.stringify(detail)]);
}

export async function history(e: {
  subscription_id?: string | null; user_id: string; category: string; action: string;
  from_plan?: string | null; to_plan?: string | null; from_status?: string | null; to_status?: string | null;
  detail?: Record<string, unknown>; actor?: string;
}, q: Sql = sql) {
  await q(
    `INSERT INTO sub_history (subscription_id, user_id, category, action, from_plan, to_plan, from_status, to_status, detail, actor)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)`,
    [e.subscription_id || null, e.user_id, e.category, e.action, e.from_plan || null, e.to_plan || null, e.from_status || null,
      e.to_status || null, JSON.stringify(e.detail || {}), e.actor || 'system'],
  );
}

/** Next number in a named sequence, atomically (invoice numbers). */
export async function nextCounter(key: string, q: Sql = sql): Promise<number> {
  const r = await q(`INSERT INTO sub_counters (k, n) VALUES ($1, 1) ON CONFLICT (k) DO UPDATE SET n = sub_counters.n + 1 RETURNING n`, [key]);
  return Number(r.rows[0].n);
}

export const newId = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
