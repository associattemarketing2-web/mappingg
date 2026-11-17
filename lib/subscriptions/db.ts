import { getPool, query } from '../pg';
import { usingMongo } from '../mongodb';
import { DEFAULT_PLANS, FEATURES, PERIOD_MONTHS } from './catalog';

// Storage for subscriptions & billing. Plain relational tables (not the app's
// JSONB documents): money, unique constraints, atomic usage counters and
// transactions need real columns. Additive only — no existing table is touched.
// The tables are created on first use (like api_apps / lead_portals);
// migration/pg-subscriptions.sql is the same DDL for review or a manual run.
// Postgres only: with DB_PROVIDER=mongodb the subscription APIs answer 503 and
// every entitlement check falls back to "not enforced" so nothing breaks.

export type Row = Record<string, any>;
export type Sql = (text: string, params?: unknown[]) => Promise<{ rows: Row[]; rowCount?: number | null }>;
export const sql: Sql = (text, params = []) => query(text, params);

export const SCHEMA_SQL: string[] = [
  `CREATE TABLE IF NOT EXISTS sub_settings (
    key text PRIMARY KEY,
    value jsonb NOT NULL,
    updated_by text NOT NULL DEFAULT '',
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS sub_features (
    key text PRIMARY KEY,
    category text NOT NULL,
    kind text NOT NULL DEFAULT 'flag',
    label text NOT NULL,
    description text NOT NULL DEFAULT '',
    sort integer NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS sub_plans (
    id text PRIMARY KEY,
    category text NOT NULL,
    code text NOT NULL UNIQUE,
    name text NOT NULL,
    tagline text NOT NULL DEFAULT '',
    description text NOT NULL DEFAULT '',
    price_paise integer NOT NULL DEFAULT 0 CHECK (price_paise >= 0),
    currency text NOT NULL DEFAULT 'INR',
    billing_period text NOT NULL DEFAULT 'month',
    period_months integer NOT NULL DEFAULT 1,
    billing_unit text NOT NULL DEFAULT 'account',
    min_quantity integer NOT NULL DEFAULT 1,
    max_quantity integer,
    is_free boolean NOT NULL DEFAULT false,
    is_active boolean NOT NULL DEFAULT true,
    recommended boolean NOT NULL DEFAULT false,
    sort integer NOT NULL DEFAULT 0,
    features jsonb NOT NULL DEFAULT '{}'::jsonb,
    limits jsonb NOT NULL DEFAULT '{}'::jsonb,
    limit_periods jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS sub_plans_category ON sub_plans (category, sort)`,
  `CREATE TABLE IF NOT EXISTS subscriptions (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    category text NOT NULL,
    plan_id text NOT NULL REFERENCES sub_plans(id),
    plan_code text NOT NULL,
    plan_name text NOT NULL DEFAULT '',
    status text NOT NULL,
    payment_status text NOT NULL DEFAULT 'none',
    billing_period text NOT NULL,
    period_months integer NOT NULL DEFAULT 1,
    billing_unit text NOT NULL DEFAULT 'account',
    quantity integer NOT NULL DEFAULT 1,
    project_ids text[] NOT NULL DEFAULT '{}',
    city text,
    amount_paise integer NOT NULL DEFAULT 0,
    currency text NOT NULL DEFAULT 'INR',
    start_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz,
    renew_at timestamptz,
    grace_until timestamptz,
    auto_renew boolean NOT NULL DEFAULT false,
    cancel_at_period_end boolean NOT NULL DEFAULT false,
    cancelled_at timestamptz,
    next_plan_id text,
    source text NOT NULL DEFAULT 'payment',
    last_payment_id text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  // One current (open) subscription per account per category.
  `CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_one_open ON subscriptions (user_id, category)
     WHERE status IN ('ACTIVE','PAST_DUE','PENDING','SUSPENDED')`,
  `CREATE INDEX IF NOT EXISTS subscriptions_user ON subscriptions (user_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS subscriptions_status_exp ON subscriptions (status, expires_at)`,
  `CREATE TABLE IF NOT EXISTS sub_payments (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    category text NOT NULL,
    subscription_id text,
    kind text NOT NULL DEFAULT 'new',
    plan_id text NOT NULL REFERENCES sub_plans(id),
    plan_code text NOT NULL,
    plan_name text NOT NULL DEFAULT '',
    quantity integer NOT NULL DEFAULT 1,
    project_ids text[] NOT NULL DEFAULT '{}',
    city text,
    period_months integer NOT NULL DEFAULT 1,
    unit_price_paise integer NOT NULL DEFAULT 0,
    base_paise integer NOT NULL DEFAULT 0,
    discount_paise integer NOT NULL DEFAULT 0,
    credit_paise integer NOT NULL DEFAULT 0,
    taxable_paise integer NOT NULL DEFAULT 0,
    cgst_paise integer NOT NULL DEFAULT 0,
    sgst_paise integer NOT NULL DEFAULT 0,
    igst_paise integer NOT NULL DEFAULT 0,
    tax_paise integer NOT NULL DEFAULT 0,
    total_paise integer NOT NULL DEFAULT 0 CHECK (total_paise >= 0),
    refunded_paise integer NOT NULL DEFAULT 0,
    currency text NOT NULL DEFAULT 'INR',
    coupon_code text,
    tax_mode text NOT NULL DEFAULT 'none',
    tax_rate numeric NOT NULL DEFAULT 0,
    billing jsonb NOT NULL DEFAULT '{}'::jsonb,
    gateway text NOT NULL DEFAULT 'razorpay',
    gateway_order_id text UNIQUE,
    gateway_payment_id text UNIQUE,
    status text NOT NULL DEFAULT 'created',
    failure_reason text,
    expires_at timestamptz,
    paid_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS sub_payments_user ON sub_payments (user_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS sub_payments_status ON sub_payments (status, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS sub_transactions (
    id text PRIMARY KEY,
    payment_id text NOT NULL,
    gateway text NOT NULL,
    gateway_ref text NOT NULL,
    type text NOT NULL,
    status text NOT NULL,
    amount_paise integer NOT NULL DEFAULT 0,
    method text,
    detail jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (gateway, gateway_ref, type, status)
  )`,
  `CREATE INDEX IF NOT EXISTS sub_transactions_payment ON sub_transactions (payment_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS sub_webhook_events (
    id text PRIMARY KEY,
    gateway text NOT NULL,
    event text NOT NULL,
    payload_sha text NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    processed_at timestamptz,
    outcome text NOT NULL DEFAULT 'received',
    error text
  )`,
  `CREATE INDEX IF NOT EXISTS sub_webhook_events_at ON sub_webhook_events (received_at DESC)`,
  `CREATE TABLE IF NOT EXISTS sub_usage (
    user_id text NOT NULL,
    metric text NOT NULL,
    period_key text NOT NULL,
    subject text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, metric, period_key, subject)
  )`,
  `CREATE TABLE IF NOT EXISTS sub_counters (
    k text PRIMARY KEY,
    n bigint NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS sub_invoices (
    id text PRIMARY KEY,
    number text NOT NULL UNIQUE,
    payment_id text NOT NULL UNIQUE,
    user_id text NOT NULL,
    subscription_id text,
    status text NOT NULL DEFAULT 'paid',
    tax_mode text NOT NULL DEFAULT 'none',
    seller jsonb NOT NULL DEFAULT '{}'::jsonb,
    customer jsonb NOT NULL DEFAULT '{}'::jsonb,
    lines jsonb NOT NULL DEFAULT '[]'::jsonb,
    totals jsonb NOT NULL DEFAULT '{}'::jsonb,
    period_start timestamptz,
    period_end timestamptz,
    issued_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS sub_invoices_user ON sub_invoices (user_id, issued_at DESC)`,
  `CREATE TABLE IF NOT EXISTS sub_history (
    id bigserial PRIMARY KEY,
    subscription_id text,
    user_id text NOT NULL,
    category text NOT NULL,
    action text NOT NULL,
    from_plan text,
    to_plan text,
    from_status text,
    to_status text,
    detail jsonb NOT NULL DEFAULT '{}'::jsonb,
    actor text NOT NULL DEFAULT 'system',
    at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS sub_history_user ON sub_history (user_id, at DESC)`,
  `CREATE TABLE IF NOT EXISTS sub_coupons (
    code text PRIMARY KEY,
    description text NOT NULL DEFAULT '',
    percent_off integer NOT NULL DEFAULT 0 CHECK (percent_off BETWEEN 0 AND 100),
    amount_off_paise integer NOT NULL DEFAULT 0 CHECK (amount_off_paise >= 0),
    categories text[] NOT NULL DEFAULT '{}',
    plan_codes text[] NOT NULL DEFAULT '{}',
    max_redemptions integer,
    redeemed integer NOT NULL DEFAULT 0,
    per_user_limit integer NOT NULL DEFAULT 1,
    valid_from timestamptz,
    valid_until timestamptz,
    is_active boolean NOT NULL DEFAULT true,
    created_by text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS sub_coupon_redemptions (
    payment_id text PRIMARY KEY,
    code text NOT NULL,
    user_id text NOT NULL,
    discount_paise integer NOT NULL DEFAULT 0,
    at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS sub_coupon_redemptions_user ON sub_coupon_redemptions (code, user_id)`,
  `CREATE TABLE IF NOT EXISTS sub_notifications (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    category text,
    type text NOT NULL,
    title text NOT NULL,
    body text NOT NULL DEFAULT '',
    link text,
    dedupe_key text UNIQUE,
    read_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS sub_notifications_user ON sub_notifications (user_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS sub_refunds (
    id text PRIMARY KEY,
    payment_id text NOT NULL,
    gateway_refund_id text UNIQUE,
    amount_paise integer NOT NULL CHECK (amount_paise > 0),
    status text NOT NULL DEFAULT 'pending',
    reason text NOT NULL DEFAULT '',
    actor text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS sub_refunds_payment ON sub_refunds (payment_id)`,
  `CREATE TABLE IF NOT EXISTS sub_audit (
    id bigserial PRIMARY KEY,
    at timestamptz NOT NULL DEFAULT now(),
    actor text NOT NULL,
    action text NOT NULL,
    target_type text NOT NULL DEFAULT '',
    target_id text NOT NULL DEFAULT '',
    detail jsonb NOT NULL DEFAULT '{}'::jsonb
  )`,
  `CREATE INDEX IF NOT EXISTS sub_audit_at ON sub_audit (at DESC)`,
  `CREATE TABLE IF NOT EXISTS sub_price_outlook (
    pin_id text PRIMARY KEY,
    expected_price text NOT NULL,
    horizon text NOT NULL DEFAULT '',
    note text NOT NULL DEFAULT '',
    source text NOT NULL DEFAULT '',
    updated_by text NOT NULL DEFAULT '',
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS cp_leads (
    id text PRIMARY KEY,
    owner_user_id text NOT NULL,
    name text NOT NULL,
    phone text NOT NULL DEFAULT '',
    email text NOT NULL DEFAULT '',
    pin_id text,
    project_title text NOT NULL DEFAULT '',
    budget text NOT NULL DEFAULT '',
    requirement text NOT NULL DEFAULT '',
    city text NOT NULL DEFAULT '',
    status text NOT NULL DEFAULT 'new',
    priority text NOT NULL DEFAULT 'normal',
    follow_up_at timestamptz,
    notes text NOT NULL DEFAULT '',
    activity jsonb NOT NULL DEFAULT '[]'::jsonb,
    archived boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS cp_leads_owner ON cp_leads (owner_user_id, updated_at DESC)`,
  `CREATE TABLE IF NOT EXISTS buyer_service_requests (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    type text NOT NULL,
    pin_id text,
    project_title text NOT NULL DEFAULT '',
    message text NOT NULL DEFAULT '',
    preferred_date text NOT NULL DEFAULT '',
    preferred_time text NOT NULL DEFAULT '',
    contact_phone text NOT NULL DEFAULT '',
    status text NOT NULL DEFAULT 'requested',
    admin_note text NOT NULL DEFAULT '',
    assigned_to text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS buyer_service_requests_user ON buyer_service_requests (user_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS buyer_service_requests_status ON buyer_service_requests (status, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS buyer_portfolio (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    name text NOT NULL,
    pin_id text,
    location text NOT NULL DEFAULT '',
    purchase_price_paise bigint NOT NULL DEFAULT 0,
    purchase_date text NOT NULL DEFAULT '',
    area_sqft integer,
    current_value_paise bigint,
    loan_outstanding_paise bigint,
    notes text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS buyer_portfolio_user ON buyer_portfolio (user_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS dev_media_submissions (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    pin_id text NOT NULL,
    kind text NOT NULL,
    url text NOT NULL,
    title text NOT NULL DEFAULT '',
    status text NOT NULL DEFAULT 'pending',
    note text NOT NULL DEFAULT '',
    reviewed_by text NOT NULL DEFAULT '',
    reviewed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS dev_media_submissions_pin ON dev_media_submissions (pin_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS dev_media_submissions_status ON dev_media_submissions (status, created_at DESC)`,
  // A channel partner's own city, for plans limited to one city when there is no
  // paid subscription row to hold it (the Free plan). Chosen once, like a plan city.
  `CREATE TABLE IF NOT EXISTS cp_city (
    user_id TEXT PRIMARY KEY,
    city TEXT NOT NULL,
    set_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
];

export const DEFAULT_SETTINGS = {
  /**
   * Master switch for the whole subscription system. Off = the site works as it
   * did before subscriptions: no /pricing, no plan pages/links, no checkout, no
   * limits. Plans, payments and history stay in the database untouched.
   * Env SUBSCRIPTIONS_ENABLED=1/0 overrides.
   */
  enabled: false,
  /** Limits & paid-feature checks are enforced only when this is on (env SUBSCRIPTION_ENFORCE overrides). */
  enforce: false,
  grace_days: 3,
  reminder_days: [7, 1],
  pending_order_ttl_hours: 24,
  refund_window_days: 7,
  invoice_prefix: 'MPG',
  terms_url: '/terms',
  support_email: '',
  tax: {
    /** Not GST-registered: no GST is charged and invoices say so. */
    registered: false,
    rate: 18,
    /** true = plan prices include GST; false = GST is added on top. */
    inclusive: false,
    gstin: '',
    legal_name: 'Mappingg',
    address: '',
    state: 'Maharashtra',
    state_code: '27',
    sac: '',
  },
};
export type SubSettings = typeof DEFAULT_SETTINGS;

export function isAvailable(): boolean {
  return !usingMongo() && !!(process.env.DATABASE_URL || (globalThis as { _pgPool?: unknown })._pgPool);
}

const ready = new WeakMap<Sql, Promise<void>>();

/** Create the tables (idempotent) and seed the default catalogue once. */
export function ensureSchema(q: Sql = sql): Promise<void> {
  if (usingMongo()) return Promise.reject(new Error('Subscriptions require the PostgreSQL backend.'));
  let p = ready.get(q);
  if (!p) {
    p = (async () => {
      for (const stmt of SCHEMA_SQL) await q(stmt);
      await seed(q);
    })();
    p.catch(() => ready.delete(q));
    ready.set(q, p);
  }
  return p;
}

async function seed(q: Sql) {
  let i = 0;
  for (const f of FEATURES) {
    await q(
      `INSERT INTO sub_features (key, category, kind, label, description, sort) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (key) DO NOTHING`,
      [f.key, f.category, f.kind, f.label, f.description || '', i++],
    );
  }
  // Plans are seeded per code, so a plan the admin deleted/renamed is never
  // re-created over their changes — only missing default codes are added.
  for (const p of DEFAULT_PLANS) {
    await q(
      `INSERT INTO sub_plans (id, category, code, name, tagline, price_paise, billing_period, period_months, billing_unit, is_free, recommended, sort, features, limits, limit_periods)
       VALUES ($1,$2,$1,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14::jsonb) ON CONFLICT (code) DO NOTHING`,
      [p.code, p.category, p.name, p.tagline, p.price_paise, p.billing_period, PERIOD_MONTHS[p.billing_period], p.billing_unit,
        p.price_paise === 0, !!p.recommended, p.sort, JSON.stringify(p.features), JSON.stringify(p.limits), JSON.stringify(p.limit_periods || {})],
    );
  }
  await q(`INSERT INTO sub_settings (key, value) VALUES ('main', $1::jsonb) ON CONFLICT (key) DO NOTHING`, [JSON.stringify(DEFAULT_SETTINGS)]);
}

let txChain: Promise<unknown> = Promise.resolve();

/**
 * Run `fn` in one database transaction. Production uses a dedicated pooled
 * client; the in-process test database (one connection) runs BEGIN/COMMIT on
 * the shared query function, which is equivalent there.
 */
export async function tx<T>(fn: (q: Sql) => Promise<T>): Promise<T> {
  const pool = getPool() as unknown as { connect?: () => Promise<{ query: Sql; release: () => void }> };
  if (typeof pool.connect !== 'function') {
    // Single shared connection: run transactions one at a time.
    const run = async () => {
      await sql('BEGIN');
      try { const r = await fn(sql); await sql('COMMIT'); return r; } catch (e) { await sql('ROLLBACK').catch(() => {}); throw e; }
    };
    const next = txChain.then(run, run);
    txChain = next.catch(() => undefined);
    return next;
  }
  const client = await pool.connect();
  const q: Sql = (text, params = []) => client.query(text, params);
  try {
    await q('BEGIN');
    const r = await fn(q);
    await q('COMMIT');
    return r;
  } catch (e) {
    await q('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export const iso = (v: unknown): string | null => (v == null ? null : new Date(v as string).toISOString());
