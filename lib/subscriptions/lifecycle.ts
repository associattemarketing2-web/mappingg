import { createHash } from 'node:crypto';
import { getDb } from '../mongodb';
import { ensureSchema, sql, tx, iso, type Row, type Sql } from './db';
import { ENTITLED_STATUSES, categoryForRole, type Category } from './catalog';
import { audit, freePlanFor, getPlan, getSettings, history, newId, type Plan } from './store';
import { addMonths, computeQuote, unusedCredit, type CouponTerms, type Quote } from './pricing';
import { forgetEntitlements, getEntitlements, getUserSubscription, toSubscription, type Subscription } from './entitlements';
import { getGateway, GatewayNotConfigured, type GatewayPayment } from './gateway';
import { issueInvoice, setInvoiceStatus } from './invoices';
import { notifySub, type SubNotice } from './notifications';
import { CITY_STATE, developerProjects, isCityKey, syncPromotion } from './projects';

// Subscription lifecycle: quote → checkout (gateway order) → verify / webhook →
// activate (one transaction: payment, subscription, coupon, invoice, history)
// → reminders → grace → expiry; plus upgrade, renewal, scheduled downgrade,
// cancellation, refunds and admin actions. Every state change is written to
// sub_history and every admin/money action to sub_audit.
//
// Nothing here trusts the browser: plan, amount, quantity and projects are
// re-derived on the server; activation happens only after the gateway's
// signature is verified AND the payment itself is fetched/confirmed for the
// exact order and amount.

export class SubError extends Error {
  constructor(message: string, public status = 400, public code = 'invalid') { super(message); }
}

export interface Actor { id: string; email: string; role: string }

export interface CheckoutRequest {
  plan: string;
  project_ids?: string[];
  city?: string | null;
  coupon?: string | null;
  billing?: { name?: string; gstin?: string; address?: string; state_code?: string };
}

export interface PreparedCheckout {
  plan: Plan;
  category: Category;
  kind: 'new' | 'renewal' | 'upgrade' | 'downgrade';
  quantity: number;
  project_ids: string[];
  city: string | null;
  quote: Quote;
  current: Subscription | null;
  coupon: CouponTerms | null;
  couponError: string | null;
  billing: Record<string, string>;
  /** When the new term starts (renewals start at the current expiry). */
  periodStart: Date;
}

const monthlyValue = (plan: Plan, qty: number) => (plan.period_months > 0 ? (plan.price_paise * qty) / plan.period_months : 0);

function cleanBilling(b: CheckoutRequest['billing']): Record<string, string> {
  const out: Record<string, string> = {};
  if (!b) return out;
  if (b.name) out.name = String(b.name).trim().slice(0, 120);
  if (b.gstin && /^[0-9]{2}[A-Z0-9]{13}$/i.test(String(b.gstin).trim())) out.gstin = String(b.gstin).trim().toUpperCase();
  if (b.address) out.address = String(b.address).trim().slice(0, 300);
  if (b.state_code && /^\d{2}$/.test(String(b.state_code))) out.state_code = String(b.state_code);
  if (!b.state_code && out.gstin) out.state_code = out.gstin.slice(0, 2);
  return out;
}

/** Validate a coupon for this user / plan. Returns terms or an error message. */
export async function validateCoupon(code: string | null | undefined, userId: string, plan: Plan, q: Sql = sql): Promise<{ coupon: CouponTerms | null; error: string | null }> {
  const c = String(code || '').trim().toUpperCase();
  if (!c) return { coupon: null, error: null };
  const r = await q(`SELECT * FROM sub_coupons WHERE code = $1`, [c]);
  const row = r.rows[0];
  const now = Date.now();
  if (!row || !row.is_active) return { coupon: null, error: 'This coupon code is not valid.' };
  if (row.valid_from && new Date(row.valid_from).getTime() > now) return { coupon: null, error: 'This coupon is not active yet.' };
  if (row.valid_until && new Date(row.valid_until).getTime() < now) return { coupon: null, error: 'This coupon has expired.' };
  if ((row.categories || []).length && !row.categories.includes(plan.category)) return { coupon: null, error: 'This coupon does not apply to this plan.' };
  if ((row.plan_codes || []).length && !row.plan_codes.includes(plan.code)) return { coupon: null, error: 'This coupon does not apply to this plan.' };
  if (row.max_redemptions != null && Number(row.redeemed) >= Number(row.max_redemptions)) return { coupon: null, error: 'This coupon has been fully used.' };
  const used = await q(`SELECT count(*)::int AS n FROM sub_coupon_redemptions WHERE code = $1 AND user_id = $2`, [c, userId]);
  if (Number(row.per_user_limit) > 0 && Number(used.rows[0]?.n || 0) >= Number(row.per_user_limit)) return { coupon: null, error: 'You have already used this coupon.' };
  return { coupon: { code: c, percent_off: Number(row.percent_off) || 0, amount_off_paise: Number(row.amount_off_paise) || 0 }, error: null };
}

/**
 * Everything about a checkout, computed on the server from the plan code and
 * the account — used by both the price preview (quote) and the real checkout.
 */
export async function prepareCheckout(user: Actor, req: CheckoutRequest, now = new Date()): Promise<PreparedCheckout> {
  await ensureSchema();
  const category = categoryForRole(user.role);
  if (!category) throw new SubError('Subscriptions are for buyer, channel partner and developer accounts.', 403, 'wrong_role');
  const plan = await getPlan(String(req.plan || ''));
  if (!plan || plan.category !== category) throw new SubError('This plan is not available for your account type.', 400, 'wrong_plan');
  if (!plan.is_active) throw new SubError('This plan is no longer offered.', 400, 'inactive_plan');
  if (plan.is_free || plan.price_paise <= 0) throw new SubError('The free plan needs no checkout.', 400, 'free_plan');

  const settings = await getSettings();
  const current = await getUserSubscription(user.id, category);
  const entitled = !!current && ENTITLED_STATUSES.includes(current.effective_status);

  // Developer per-project plans: the projects must be the developer's own.
  let projectIds: string[] = [];
  let quantity = 1;
  if (plan.billing_unit === 'project') {
    const want = [...new Set((req.project_ids || []).map(String))].slice(0, 500);
    if (!want.length && entitled && current!.project_ids.length) want.push(...current!.project_ids);
    if (!want.length) throw new SubError('Choose at least one of your projects for this plan.', 400, 'no_projects');
    const mine = await developerProjects(user.id);
    const byId = new Map(mine.map((p) => [p.id, p]));
    const chosen = want.map((id) => byId.get(id));
    if (chosen.some((p) => !p)) throw new SubError('You can only subscribe projects that you listed.', 403, 'not_owner');
    if (chosen.some((p) => p!.review === 'rejected')) throw new SubError('A project that was not approved cannot be subscribed. Fix and resubmit it first.', 400, 'rejected_project');
    const maxStates = plan.limits.dev_max_states;
    const states = new Set(chosen.map((p) => p!.state || 'Unknown'));
    if (maxStates != null && states.size > Number(maxStates)) {
      throw new SubError(`This plan covers projects in ${maxStates} state${Number(maxStates) === 1 ? '' : 's'}; you chose projects in ${states.size} (${[...states].join(', ')}). Choose Large Bulk for multiple states.`, 400, 'too_many_states');
    }
    if (want.length < plan.min_quantity) throw new SubError(`This plan needs at least ${plan.min_quantity} projects.`, 400, 'min_quantity');
    if (plan.max_quantity != null && want.length > plan.max_quantity) throw new SubError(`This plan covers at most ${plan.max_quantity} projects.`, 400, 'max_quantity');
    projectIds = want;
    quantity = want.length;
  }

  // CP plans limited to one city: the city is chosen at checkout.
  let city: string | null = null;
  const maxCities = plan.limits.cp_max_cities;
  if (category === 'cp' && maxCities != null) {
    const c = req.city || (entitled ? current!.city : null);
    if (!isCityKey(c)) throw new SubError('Choose the city your plan should cover.', 400, 'city_required');
    city = c;
  }

  // What kind of change is this?
  let kind: PreparedCheckout['kind'] = 'new';
  let credit = 0;
  let periodStart = now;
  if (entitled) {
    const cur = current!;
    const curPlan = await getPlan(cur.plan_id);
    const samePlan = cur.plan_id === plan.id;
    const sameScope = samePlan && (plan.billing_unit !== 'project' || (projectIds.length === cur.project_ids.length && projectIds.every((id) => cur.project_ids.includes(id))));
    if (samePlan && sameScope) {
      kind = 'renewal';
      const exp = cur.expires_at ? new Date(cur.expires_at) : now;
      periodStart = exp > now ? exp : now;
    } else if (curPlan && monthlyValue(plan, quantity) < monthlyValue(curPlan, cur.quantity) && !(samePlan && projectIds.length > cur.project_ids.length)) {
      kind = 'downgrade';
    } else {
      kind = 'upgrade';
      if (cur.last_payment_id && cur.expires_at) {
        const lp = await sql(`SELECT taxable_paise, credit_paise FROM sub_payments WHERE id = $1 AND status IN ('paid','partially_refunded')`, [cur.last_payment_id]);
        const paid = Number(lp.rows[0]?.taxable_paise || 0) + Number(lp.rows[0]?.credit_paise || 0);
        credit = unusedCredit(paid, new Date(cur.start_at), new Date(cur.expires_at), now);
      }
    }
  }

  const { coupon, error: couponError } = await validateCoupon(req.coupon, user.id, plan);
  const billing = cleanBilling(req.billing);
  const quote = computeQuote({
    unit_price_paise: plan.price_paise, quantity, coupon, credit_paise: credit,
    tax: { registered: settings.tax.registered, rate: settings.tax.rate, inclusive: settings.tax.inclusive, state_code: settings.tax.state_code },
    customer_state_code: billing.state_code || null,
  });
  return { plan, category, kind, quantity, project_ids: projectIds, city, quote, current, coupon, couponError, billing, periodStart };
}

export interface CheckoutResult {
  payment_id: string;
  status: 'awaiting_payment' | 'activated' | 'scheduled';
  gateway?: { name: string; key: string; order_id: string; amount: number; currency: string; mode: 'test' | 'live' | null };
  quote: Quote;
  kind: PreparedCheckout['kind'];
  plan: { code: string; name: string };
}

/** Start a checkout: create our payment record and the gateway order. */
export async function createCheckout(user: Actor, req: CheckoutRequest): Promise<CheckoutResult> {
  const prep = await prepareCheckout(user, req);
  if (prep.couponError) throw new SubError(prep.couponError, 400, 'coupon');
  const { plan, quote, category } = prep;

  // A cheaper plan while a paid one is running: switch at the end of the term, no charge now.
  if (prep.kind === 'downgrade') {
    const cur = prep.current!;
    await sql(`UPDATE subscriptions SET next_plan_id = $2, cancel_at_period_end = false, updated_at = now() WHERE id = $1`, [cur.id, plan.id]);
    await history({ subscription_id: cur.id, user_id: user.id, category, action: 'downgrade_scheduled', from_plan: cur.plan_code, to_plan: plan.code, actor: user.email });
    await notifySub(user.id, category, 'downgraded', { plan: plan.name, expires_at: cur.expires_at }, { dedupeKey: `down:${cur.id}:${plan.id}` });
    forgetEntitlements(user.id);
    return { payment_id: '', status: 'scheduled', quote, kind: 'downgrade', plan: { code: plan.code, name: plan.name } };
  }

  const gw = getGateway();
  if (quote.total_paise > 0 && !gw.configured()) throw new SubError('Online payments are not configured yet. Please try again later or contact Mappingg.', 503, 'gateway_not_configured');

  const settings = await getSettings();
  const paymentId = newId('pay');
  const expiresAt = new Date(Date.now() + Math.max(1, settings.pending_order_ttl_hours) * 3_600_000);
  await sql(
    `INSERT INTO sub_payments (id, user_id, category, subscription_id, kind, plan_id, plan_code, plan_name, quantity, project_ids, city, period_months,
       unit_price_paise, base_paise, discount_paise, credit_paise, taxable_paise, cgst_paise, sgst_paise, igst_paise, tax_paise, total_paise,
       currency, coupon_code, tax_mode, tax_rate, billing, gateway, status, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,'INR',$23,$24,$25,$26::jsonb,$27,'created',$28)`,
    [paymentId, user.id, category, prep.current?.id || null, prep.kind, plan.id, plan.code, plan.name, prep.quantity, prep.project_ids, prep.city,
      plan.period_months, quote.unit_price_paise, quote.base_paise, quote.discount_paise, quote.credit_paise, quote.taxable_paise, quote.cgst_paise,
      quote.sgst_paise, quote.igst_paise, quote.tax_paise, quote.total_paise, quote.coupon_code, quote.tax_mode, quote.tax_rate,
      JSON.stringify(prep.billing), quote.total_paise > 0 ? gw.name : 'none', expiresAt],
  );
  await history({ user_id: user.id, category, action: 'checkout_started', to_plan: plan.code, detail: { payment_id: paymentId, kind: prep.kind, total_paise: quote.total_paise }, actor: user.email });

  // Fully covered by a coupon / upgrade credit: nothing to collect, activate now.
  if (quote.total_paise === 0) {
    await audit(user.email, 'payment.zero_amount', 'payment', paymentId, { coupon: quote.coupon_code, credit_paise: quote.credit_paise });
    await processSuccessfulPayment(paymentId, null, 'zero_amount');
    return { payment_id: paymentId, status: 'activated', quote, kind: prep.kind, plan: { code: plan.code, name: plan.name } };
  }

  try {
    const order = await gw.createOrder({ amount: quote.total_paise, currency: 'INR', receipt: paymentId, notes: { payment_id: paymentId, user_id: user.id, plan: plan.code } });
    if (order.amount !== quote.total_paise) throw new Error('Gateway order amount mismatch');
    await sql(`UPDATE sub_payments SET gateway_order_id = $2, updated_at = now() WHERE id = $1`, [paymentId, order.id]);
    return {
      payment_id: paymentId, status: 'awaiting_payment', quote, kind: prep.kind, plan: { code: plan.code, name: plan.name },
      gateway: { name: gw.name, key: gw.publicKey() || '', order_id: order.id, amount: order.amount, currency: order.currency, mode: gw.mode() },
    };
  } catch (e) {
    await sql(`UPDATE sub_payments SET status = 'failed', failure_reason = $2, updated_at = now() WHERE id = $1`, [paymentId, `order_create: ${(e as Error).message}`.slice(0, 300)]);
    if (e instanceof GatewayNotConfigured) throw new SubError(e.message, 503, 'gateway_not_configured');
    throw new SubError('Could not start the payment. Please try again.', 502, 'gateway_error');
  }
}

/** Confirm a payment from the browser's checkout callback (signature + server-side fetch). */
export async function verifyPayment(user: Actor, b: { order_id: string; payment_id: string; signature: string }): Promise<{ status: 'paid' | 'pending' | 'failed'; payment_id: string; invoice_id?: string | null }> {
  await ensureSchema();
  const r = await sql(`SELECT * FROM sub_payments WHERE gateway_order_id = $1 AND user_id = $2`, [String(b.order_id || ''), user.id]);
  const p = r.rows[0];
  if (!p) throw new SubError('Payment not found.', 404, 'not_found');
  if (p.status === 'paid') return { status: 'paid', payment_id: p.id, invoice_id: await invoiceIdFor(p.id) };
  const gw = getGateway();
  if (!gw.verifyCheckoutSignature({ orderId: p.gateway_order_id, paymentId: String(b.payment_id || ''), signature: String(b.signature || '') })) {
    await recordTxn(p.id, gw.name, String(b.payment_id || 'unknown'), 'payment', 'signature_invalid', 0, null, { order_id: p.gateway_order_id });
    await audit(user.email, 'payment.signature_invalid', 'payment', p.id, { gateway_payment_id: b.payment_id });
    throw new SubError('Payment could not be verified.', 400, 'invalid_signature');
  }
  let gp = await gw.fetchPayment(String(b.payment_id));
  if (gp.order_id !== p.gateway_order_id) throw new SubError('Payment does not belong to this order.', 400, 'order_mismatch');
  if (gp.status === 'authorized') gp = await gw.capturePayment(gp.id, Number(p.total_paise), p.currency);
  if (gp.status === 'captured') {
    await processSuccessfulPayment(p.id, gp, 'verify');
    return { status: 'paid', payment_id: p.id, invoice_id: await invoiceIdFor(p.id) };
  }
  if (gp.status === 'failed') {
    await processFailedPayment(p.id, gp, 'verify');
    return { status: 'failed', payment_id: p.id };
  }
  await sql(`UPDATE sub_payments SET status = 'pending', gateway_payment_id = COALESCE(gateway_payment_id, $2), updated_at = now() WHERE id = $1 AND status IN ('created','pending')`, [p.id, gp.id]);
  return { status: 'pending', payment_id: p.id };
}

async function invoiceIdFor(paymentId: string): Promise<string | null> {
  return (await sql(`SELECT id FROM sub_invoices WHERE payment_id = $1`, [paymentId])).rows[0]?.id || null;
}

async function recordTxn(paymentId: string, gateway: string, ref: string, type: 'payment' | 'refund', status: string, amount: number, method: string | null, detail: Record<string, unknown>, q: Sql = sql) {
  await q(
    `INSERT INTO sub_transactions (id, payment_id, gateway, gateway_ref, type, status, amount_paise, method, detail) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
     ON CONFLICT (gateway, gateway_ref, type, status) DO NOTHING`,
    [newId('txn'), paymentId, gateway, ref, type, status, amount, method, JSON.stringify(detail)],
  );
}

/**
 * Mark a payment paid and grant the plan — exactly once. Safe to call from the
 * checkout callback, the webhook and the reconciliation cron at the same time:
 * the payment row is locked and an already-paid payment is a no-op.
 */
export async function processSuccessfulPayment(paymentId: string, gp: GatewayPayment | null, source: string): Promise<{ activated: boolean; subscription_id: string | null }> {
  await ensureSchema();
  const settings = await getSettings();
  const out = await tx(async (q) => {
    const r = await q(`SELECT * FROM sub_payments WHERE id = $1 FOR UPDATE`, [paymentId]);
    const p = r.rows[0];
    if (!p) throw new SubError('Payment not found', 404, 'not_found');
    if (['paid', 'refunded', 'partially_refunded'].includes(p.status)) return { activated: false, subscription_id: p.subscription_id as string | null, p, notice: null as null | SubNotice, sub: null as Subscription | null, invoice: '' };
    if (gp) {
      if (gp.amount !== Number(p.total_paise) || (p.gateway_order_id && gp.order_id && gp.order_id !== p.gateway_order_id)) {
        await audit('system', 'payment.amount_mismatch', 'payment', p.id, { expected: p.total_paise, got: gp.amount, source });
        throw new SubError('Payment amount does not match the order.', 400, 'amount_mismatch');
      }
    } else if (Number(p.total_paise) !== 0) {
      throw new SubError('A paid order needs a confirmed gateway payment.', 400, 'unconfirmed');
    }
    const now = new Date();
    await q(`UPDATE sub_payments SET status = 'paid', gateway_payment_id = COALESCE($2, gateway_payment_id), paid_at = now(), failure_reason = NULL, updated_at = now() WHERE id = $1`, [p.id, gp?.id || null]);
    if (gp) await recordTxn(p.id, p.gateway, gp.id, 'payment', 'captured', gp.amount, gp.method, { source, order_id: gp.order_id }, q);
    if (p.coupon_code) {
      const ins = await q(`INSERT INTO sub_coupon_redemptions (payment_id, code, user_id, discount_paise) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING payment_id`, [p.id, p.coupon_code, p.user_id, p.discount_paise]);
      if (ins.rows.length) await q(`UPDATE sub_coupons SET redeemed = redeemed + 1, updated_at = now() WHERE code = $1`, [p.coupon_code]);
    }

    // Grant the plan.
    const cur = await getUserSubscription(p.user_id, p.category, q);
    const curEntitled = !!cur && ENTITLED_STATUSES.includes(cur.effective_status);
    const months = Number(p.period_months) || 1;
    const graceMs = Math.max(0, settings.grace_days) * 86_400_000;
    let subId: string;
    let notice: SubNotice = 'activated';
    let start = now;
    let expires: Date;
    if (p.kind === 'renewal' && curEntitled && cur!.plan_id === p.plan_id) {
      const base = cur!.expires_at && new Date(cur!.expires_at) > now ? new Date(cur!.expires_at) : now;
      start = base;
      expires = addMonths(base, months);
      await q(
        `UPDATE subscriptions SET status='ACTIVE', payment_status='paid', expires_at=$2, renew_at=$2, grace_until=$3, cancel_at_period_end=false,
           cancelled_at=NULL, next_plan_id=NULL, last_payment_id=$4, amount_paise=$5, project_ids=$6, quantity=$7, city=COALESCE($8, city), updated_at=now() WHERE id=$1`,
        [cur!.id, expires, new Date(expires.getTime() + graceMs), p.id, p.total_paise, p.project_ids, p.quantity, p.city],
      );
      subId = cur!.id;
      notice = 'renewed';
      await history({ subscription_id: subId, user_id: p.user_id, category: p.category, action: 'renewed', from_plan: cur!.plan_code, to_plan: p.plan_code, from_status: cur!.status, to_status: 'ACTIVE', detail: { payment_id: p.id, expires_at: expires.toISOString(), source } }, q);
    } else {
      // New plan (or an upgrade): close whatever is open, then start a fresh term now.
      if (cur) {
        const closed = curEntitled ? 'CANCELLED' : cur.effective_status === 'EXPIRED' ? 'EXPIRED' : 'CANCELLED';
        await q(`UPDATE subscriptions SET status=$2, cancelled_at=CASE WHEN $2='CANCELLED' THEN now() ELSE cancelled_at END, updated_at=now() WHERE id=$1`, [cur.id, closed]);
        await history({ subscription_id: cur.id, user_id: p.user_id, category: p.category, action: p.kind === 'upgrade' ? 'replaced_by_upgrade' : 'replaced', from_plan: cur.plan_code, from_status: cur.status, to_status: closed, detail: { payment_id: p.id } }, q);
      }
      expires = addMonths(now, months);
      subId = newId('sub');
      const plan = await getPlan(p.plan_id, q);
      await q(
        `INSERT INTO subscriptions (id, user_id, category, plan_id, plan_code, plan_name, status, payment_status, billing_period, period_months, billing_unit,
           quantity, project_ids, city, amount_paise, currency, start_at, expires_at, renew_at, grace_until, source, last_payment_id)
         VALUES ($1,$2,$3,$4,$5,$6,'ACTIVE','paid',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16,$17,$18,$19)`,
        [subId, p.user_id, p.category, p.plan_id, p.plan_code, p.plan_name, plan?.billing_period || 'month', months, plan?.billing_unit || 'account',
          p.quantity, p.project_ids, p.city, p.total_paise, p.currency, now, expires, new Date(expires.getTime() + graceMs), p.total_paise === 0 ? 'coupon' : 'payment', p.id],
      );
      notice = p.kind === 'upgrade' && curEntitled ? 'upgraded' : 'activated';
      await history({ subscription_id: subId, user_id: p.user_id, category: p.category, action: notice, from_plan: cur?.plan_code || null, to_plan: p.plan_code, from_status: cur?.status || 'FREE', to_status: 'ACTIVE', detail: { payment_id: p.id, expires_at: expires.toISOString(), source } }, q);
    }
    await q(`UPDATE sub_payments SET subscription_id = $2 WHERE id = $1`, [p.id, subId]);

    const u = await (await getDb()).collection('users').findOne({ id: p.user_id }, { projection: { name: 1, email: 1, mobile: 1 } }).catch(() => null);
    const inv = await issueInvoice({ ...p, status: 'paid', gateway_payment_id: gp?.id || p.gateway_payment_id }, {
      settings, customer: { name: String(u?.name || ''), email: String(u?.email || ''), mobile: String(u?.mobile || '') },
      subscriptionId: subId, periodStart: start, periodEnd: expires,
    }, q);
    const sub = toSubscription((await q(`SELECT * FROM subscriptions WHERE id = $1`, [subId])).rows[0]);
    return { activated: true, subscription_id: subId, p, notice, sub, invoice: inv.number };
  });

  if (out.activated && out.sub) {
    forgetEntitlements(out.p.user_id);
    const cat = out.p.category as Category;
    await notifySub(out.p.user_id, cat, 'payment_success', { plan: out.p.plan_name, amount_paise: Number(out.p.total_paise), invoice: out.invoice }, { dedupeKey: `paid:${out.p.id}` }).catch(() => {});
    await notifySub(out.p.user_id, cat, out.notice!, { plan: out.p.plan_name, expires_at: out.sub.expires_at }, { dedupeKey: `act:${out.p.id}`, email: false }).catch(() => {});
    if (cat === 'developer') await refreshDeveloperPromotion(out.p.user_id).catch((e) => console.warn('[subscriptions] promotion sync failed', e));
  }
  return { activated: out.activated, subscription_id: out.subscription_id };
}

export async function processFailedPayment(paymentId: string, gp: GatewayPayment | null, source: string, reason?: string) {
  const r = await sql(
    `UPDATE sub_payments SET status = 'failed', failure_reason = $2, gateway_payment_id = COALESCE(gateway_payment_id, $3), updated_at = now()
     WHERE id = $1 AND status IN ('created','pending','failed') RETURNING *`,
    [paymentId, String(reason || gp?.error_reason || 'Payment failed').slice(0, 300), gp?.id || null],
  );
  const p = r.rows[0];
  if (!p) return;
  if (gp) await recordTxn(p.id, p.gateway, gp.id, 'payment', 'failed', gp.amount, gp.method, { source, reason: gp.error_reason });
  await history({ user_id: p.user_id, category: p.category, action: 'payment_failed', to_plan: p.plan_code, detail: { payment_id: p.id, reason: p.failure_reason, source } });
  await notifySub(p.user_id, p.category, 'payment_failed', { plan: p.plan_name, reason: gp?.error_reason || undefined }, { dedupeKey: `fail:${p.id}:${gp?.id || 'x'}` }).catch(() => {});
}

/** The browser closed the checkout without paying. */
export async function cancelPendingPayment(user: Actor, paymentId: string) {
  await sql(`UPDATE sub_payments SET status = 'cancelled', failure_reason = 'Closed by the customer', updated_at = now() WHERE id = $1 AND user_id = $2 AND status = 'created'`, [paymentId, user.id]);
}

// ---- webhooks -----------------------------------------------------------------

export async function handleWebhook(rawBody: string, signature: string | null, eventIdHeader: string | null): Promise<{ status: number; outcome: string }> {
  await ensureSchema();
  const gw = getGateway();
  if (!gw.webhookConfigured()) return { status: 503, outcome: 'webhook_not_configured' };
  if (!gw.verifyWebhook(rawBody, signature)) {
    await audit('gateway', 'webhook.signature_invalid', 'webhook', eventIdHeader || '', {});
    return { status: 400, outcome: 'invalid_signature' };
  }
  let body: unknown;
  try { body = JSON.parse(rawBody); } catch { return { status: 400, outcome: 'invalid_json' }; }
  const ev = gw.parseWebhook(body, eventIdHeader);
  const sha = createHash('sha256').update(rawBody).digest('hex');
  const id = ev.eventId || `sha:${sha}`;
  const ins = await sql(`INSERT INTO sub_webhook_events (id, gateway, event, payload_sha) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING RETURNING id`, [id, gw.name, ev.event, sha]);
  if (!ins.rows.length) {
    const prev = await sql(`SELECT outcome FROM sub_webhook_events WHERE id = $1`, [id]);
    // A duplicate of an event that already finished is acknowledged; one that errored is retried.
    if (prev.rows[0]?.outcome !== 'error') return { status: 200, outcome: 'duplicate' };
  }
  let outcome = 'ignored';
  try {
    const pay = ev.orderId ? (await sql(`SELECT * FROM sub_payments WHERE gateway_order_id = $1`, [ev.orderId])).rows[0] : null;
    if ((ev.event === 'payment.captured' || ev.event === 'order.paid') && pay && ev.paymentId) {
      const gp: GatewayPayment = { id: ev.paymentId, order_id: ev.orderId, status: 'captured', amount: Number(ev.amount ?? pay.total_paise), currency: pay.currency, method: ev.method, error_reason: null };
      if (ev.event === 'order.paid' && ev.amount == null) gp.amount = Number(pay.total_paise);
      const r = await processSuccessfulPayment(pay.id, gp, `webhook:${ev.event}`);
      outcome = r.activated ? 'activated' : 'already_processed';
    } else if (ev.event === 'payment.authorized' && pay && ev.paymentId) {
      const gp = await gw.capturePayment(ev.paymentId, Number(pay.total_paise), pay.currency).catch(() => null);
      if (gp?.status === 'captured') { await processSuccessfulPayment(pay.id, gp, 'webhook:authorized'); outcome = 'captured'; } else outcome = 'capture_pending';
    } else if (ev.event === 'payment.failed' && pay && ev.paymentId) {
      await processFailedPayment(pay.id, { id: ev.paymentId, order_id: ev.orderId, status: 'failed', amount: Number(ev.amount || 0), currency: pay.currency, method: ev.method, error_reason: ev.errorReason }, 'webhook');
      outcome = 'failed_recorded';
    } else if ((ev.event === 'refund.processed' || ev.event === 'refund.failed') && ev.refundId) {
      outcome = await settleRefund(ev.refundId, ev.event === 'refund.processed' ? 'processed' : 'failed');
    } else if (!pay && ev.orderId) {
      outcome = 'unknown_order';
    }
    await sql(`UPDATE sub_webhook_events SET processed_at = now(), outcome = $2, error = NULL WHERE id = $1`, [id, outcome]);
    return { status: 200, outcome };
  } catch (e) {
    // A permanent problem (amount mismatch, unknown payment) is recorded and
    // acknowledged — retrying would never succeed. Anything else gets a 5xx.
    if (e instanceof SubError && e.status < 500) {
      await sql(`UPDATE sub_webhook_events SET processed_at = now(), outcome = $2, error = $3 WHERE id = $1`, [id, `rejected_${e.code}`, e.message.slice(0, 500)]);
      return { status: 200, outcome: `rejected_${e.code}` };
    }
    await sql(`UPDATE sub_webhook_events SET outcome = 'error', error = $2 WHERE id = $1`, [id, String((e as Error).message).slice(0, 500)]);
    // 5xx so the gateway retries later (the event row allows a retry after an error).
    return { status: 500, outcome: 'error' };
  }
}

// ---- refunds --------------------------------------------------------------------

export async function refundPayment(paymentId: string, amountPaise: number | null, reason: string, actor: string, opts: { revoke?: boolean } = {}) {
  await ensureSchema();
  const r = await sql(`SELECT * FROM sub_payments WHERE id = $1`, [paymentId]);
  const p = r.rows[0];
  if (!p) throw new SubError('Payment not found', 404);
  if (!['paid', 'partially_refunded'].includes(p.status)) throw new SubError('Only paid payments can be refunded.');
  if (p.gateway === 'none' || !p.gateway_payment_id) throw new SubError('This payment was not collected online (nothing to refund).');
  const left = Number(p.total_paise) - Number(p.refunded_paise);
  const amount = amountPaise == null ? left : Math.round(amountPaise);
  if (amount <= 0 || amount > left) throw new SubError(`Refund must be between ₹0.01 and ₹${(left / 100).toFixed(2)}.`);
  const gw = getGateway();
  const res = await gw.refund(p.gateway_payment_id, amount, { payment_id: p.id, reason: reason.slice(0, 200) });
  const refundId = newId('rfd');
  const status = res.status === 'processed' ? 'processed' : 'pending';
  await tx(async (q) => {
    await q(`INSERT INTO sub_refunds (id, payment_id, gateway_refund_id, amount_paise, status, reason, actor) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [refundId, p.id, res.id, amount, status, reason, actor]);
    const refunded = Number(p.refunded_paise) + amount;
    const full = refunded >= Number(p.total_paise);
    await q(`UPDATE sub_payments SET refunded_paise = $2, status = $3, updated_at = now() WHERE id = $1`, [p.id, refunded, full ? 'refunded' : 'partially_refunded']);
    await setInvoiceStatus(p.id, full ? 'refunded' : 'partially_refunded', q);
    await recordTxn(p.id, p.gateway, res.id, 'refund', status, amount, null, { reason, actor }, q);
    if ((full || opts.revoke) && p.subscription_id) {
      const s = (await q(`SELECT * FROM subscriptions WHERE id = $1`, [p.subscription_id])).rows[0];
      if (s && s.last_payment_id === p.id && ['ACTIVE', 'PAST_DUE', 'SUSPENDED'].includes(s.status)) {
        await q(`UPDATE subscriptions SET status = 'REFUNDED', payment_status = 'refunded', cancelled_at = now(), updated_at = now() WHERE id = $1`, [s.id]);
        await history({ subscription_id: s.id, user_id: s.user_id, category: s.category, action: 'refunded', from_plan: s.plan_code, from_status: s.status, to_status: 'REFUNDED', detail: { refund_id: refundId, amount_paise: amount }, actor }, q);
      }
    }
    await audit(actor, 'refund.create', 'payment', p.id, { refund_id: refundId, amount_paise: amount, reason, gateway_status: res.status }, q);
  });
  forgetEntitlements(p.user_id);
  if (p.category === 'developer') await refreshDeveloperPromotion(p.user_id).catch(() => {});
  if (status === 'processed') await notifySub(p.user_id, p.category, 'refund_processed', { amount_paise: amount }, { dedupeKey: `refund:${refundId}` }).catch(() => {});
  return { refund_id: refundId, status, amount_paise: amount };
}

async function settleRefund(gatewayRefundId: string, status: 'processed' | 'failed'): Promise<string> {
  const r = await sql(`UPDATE sub_refunds SET status = $2, updated_at = now() WHERE gateway_refund_id = $1 AND status <> $2 RETURNING *`, [gatewayRefundId, status]);
  const rf = r.rows[0];
  if (!rf) return 'refund_unchanged';
  const p = (await sql(`SELECT user_id, category FROM sub_payments WHERE id = $1`, [rf.payment_id])).rows[0];
  if (p && status === 'processed') await notifySub(p.user_id, p.category, 'refund_processed', { amount_paise: Number(rf.amount_paise) }, { dedupeKey: `refund:${rf.id}` }).catch(() => {});
  if (status === 'failed') await audit('gateway', 'refund.failed', 'refund', rf.id, { payment_id: rf.payment_id });
  return `refund_${status}`;
}

// ---- cancellation & admin actions -------------------------------------------------

/** User cancels: the plan keeps working until the end of the paid term and is not renewed. */
export async function cancelSubscription(user: Actor): Promise<Subscription> {
  const category = categoryForRole(user.role);
  if (!category) throw new SubError('No subscription for this account type.', 403);
  const cur = await getUserSubscription(user.id, category);
  if (!cur || !ENTITLED_STATUSES.includes(cur.effective_status)) throw new SubError('You have no active paid plan to cancel.', 400);
  await sql(`UPDATE subscriptions SET cancel_at_period_end = true, auto_renew = false, next_plan_id = NULL, updated_at = now() WHERE id = $1`, [cur.id]);
  await history({ subscription_id: cur.id, user_id: user.id, category, action: 'cancel_requested', from_plan: cur.plan_code, from_status: cur.status, to_status: cur.status, actor: user.email });
  await notifySub(user.id, category, 'cancelled', { plan: cur.plan_name, expires_at: cur.expires_at }, { dedupeKey: `cancel:${cur.id}:${cur.expires_at}` });
  forgetEntitlements(user.id);
  return (await getUserSubscription(user.id, category))!;
}

/** Undo a scheduled cancellation / downgrade. */
export async function resumeSubscription(user: Actor): Promise<void> {
  const category = categoryForRole(user.role);
  if (!category) throw new SubError('No subscription for this account type.', 403);
  const cur = await getUserSubscription(user.id, category);
  if (!cur || !ENTITLED_STATUSES.includes(cur.effective_status)) throw new SubError('You have no active paid plan.', 400);
  await sql(`UPDATE subscriptions SET cancel_at_period_end = false, next_plan_id = NULL, updated_at = now() WHERE id = $1`, [cur.id]);
  await history({ subscription_id: cur.id, user_id: user.id, category, action: 'resumed', from_plan: cur.plan_code, actor: user.email });
  forgetEntitlements(user.id);
}

/** CP plans with one city: choose it once (later changes are done by Mappingg support). */
export async function chooseCity(user: Actor, city: string): Promise<void> {
  if (user.role !== 'agent') throw new SubError('Only channel partners choose a city.', 403);
  if (!isCityKey(city)) throw new SubError('Unknown city.');
  const cur = await getUserSubscription(user.id, 'cp');
  const entitled = !!cur && ENTITLED_STATUSES.includes(cur.effective_status);
  const plan = entitled ? await getPlan(cur!.plan_id) : null;
  if (entitled && plan && plan.limits.cp_max_cities != null) {
    // A paid one-city plan keeps its city on the subscription.
    if (cur!.city && cur!.city !== city) throw new SubError('Your plan city is already set. Contact Mappingg support to change it.', 409, 'city_locked');
    await sql(`UPDATE subscriptions SET city = $2, updated_at = now() WHERE id = $1`, [cur!.id, city]);
  } else {
    // Free (or an every-city plan): the CP's own city, used whenever a one-city plan applies.
    const r = await sql(`INSERT INTO cp_city (user_id, city) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING RETURNING city`, [user.id, city]);
    if (!r.rows.length) {
      const set = (await sql(`SELECT city FROM cp_city WHERE user_id = $1`, [user.id])).rows[0]?.city;
      if (set !== city) throw new SubError('Your city is already set. Contact Mappingg support to change it.', 409, 'city_locked');
    }
  }
  await history({ subscription_id: entitled ? cur!.id : null, user_id: user.id, category: 'cp', action: 'city_selected', detail: { city }, actor: user.email });
  forgetEntitlements(user.id);
}

export async function adminActivate(o: { userId: string; plan: string; months: number; projectIds?: string[]; city?: string | null; reason: string; actor: string }): Promise<Subscription> {
  await ensureSchema();
  if (!o.reason || o.reason.trim().length < 3) throw new SubError('A reason is required for a manual activation.');
  const u = await (await getDb()).collection('users').findOne({ id: o.userId }, { projection: { id: 1, role: 1, email: 1 } });
  if (!u) throw new SubError('Account not found', 404);
  const category = categoryForRole(String(u.role));
  const plan = await getPlan(o.plan);
  if (!category || !plan || plan.category !== category) throw new SubError('That plan does not match this account type.');
  const months = Math.min(36, Math.max(1, Math.round(o.months || plan.period_months || 1)));
  const settings = await getSettings();
  let projectIds: string[] = [];
  if (plan.billing_unit === 'project') {
    const mine = new Set((await developerProjects(o.userId)).map((p) => p.id));
    projectIds = (o.projectIds || []).filter((id) => mine.has(id));
    if (!projectIds.length) throw new SubError('Choose at least one of this developer’s projects.');
  }
  const city = isCityKey(o.city) ? o.city : null;
  const subId = newId('sub');
  const now = new Date();
  const expires = addMonths(now, months);
  await tx(async (q) => {
    const cur = await getUserSubscription(o.userId, category, q);
    if (cur) {
      await q(`UPDATE subscriptions SET status = 'CANCELLED', cancelled_at = now(), updated_at = now() WHERE id = $1`, [cur.id]);
      await history({ subscription_id: cur.id, user_id: o.userId, category, action: 'replaced_by_admin', from_plan: cur.plan_code, from_status: cur.status, to_status: 'CANCELLED', actor: o.actor, detail: { reason: o.reason } }, q);
    }
    await q(
      `INSERT INTO subscriptions (id, user_id, category, plan_id, plan_code, plan_name, status, payment_status, billing_period, period_months, billing_unit,
         quantity, project_ids, city, amount_paise, start_at, expires_at, renew_at, grace_until, source)
       VALUES ($1,$2,$3,$4,$5,$6,'ACTIVE','complimentary',$7,$8,$9,$10,$11,$12,0,$13,$14,$14,$15,'admin')`,
      [subId, o.userId, category, plan.id, plan.code, plan.name, plan.billing_period, months, plan.billing_unit, Math.max(1, projectIds.length), projectIds, city, now, expires, new Date(expires.getTime() + settings.grace_days * 86_400_000)],
    );
    await history({ subscription_id: subId, user_id: o.userId, category, action: 'admin_activated', to_plan: plan.code, to_status: 'ACTIVE', actor: o.actor, detail: { months, reason: o.reason } }, q);
    await audit(o.actor, 'subscription.manual_activate', 'subscription', subId, { user_id: o.userId, plan: plan.code, months, reason: o.reason, project_ids: projectIds, city }, q);
  });
  forgetEntitlements(o.userId);
  if (category === 'developer') await refreshDeveloperPromotion(o.userId).catch(() => {});
  await notifySub(o.userId, category, 'activated', { plan: plan.name, expires_at: expires.toISOString() }, { dedupeKey: `act:${subId}` }).catch(() => {});
  return toSubscription((await sql(`SELECT * FROM subscriptions WHERE id = $1`, [subId])).rows[0]);
}

export async function adminUpdateSubscription(subId: string, action: 'extend' | 'cancel_now' | 'cancel_at_end' | 'suspend' | 'resume' | 'set_city' | 'set_projects', o: { days?: number; city?: string; projectIds?: string[]; reason: string; actor: string }) {
  if (!o.reason || o.reason.trim().length < 3) throw new SubError('A reason is required.');
  const s = (await sql(`SELECT * FROM subscriptions WHERE id = $1`, [subId])).rows[0];
  if (!s) throw new SubError('Subscription not found', 404);
  const before = toSubscription(s);
  let to = s.status as string;
  if (action === 'extend') {
    const days = Math.round(Number(o.days) || 0);
    if (days < 1 || days > 730) throw new SubError('Extend by 1–730 days.');
    const settings = await getSettings();
    const base = s.expires_at && new Date(s.expires_at) > new Date() ? new Date(s.expires_at) : new Date();
    const exp = new Date(base.getTime() + days * 86_400_000);
    to = ['EXPIRED', 'PAST_DUE'].includes(before.effective_status) || s.status === 'PAST_DUE' || s.status === 'EXPIRED' ? 'ACTIVE' : s.status;
    // Reopening an expired subscription must not collide with a newer open one.
    if (s.status === 'EXPIRED' || s.status === 'CANCELLED') {
      const open = await getUserSubscription(s.user_id, s.category);
      if (open && open.id !== s.id) throw new SubError('This account already has a newer subscription — extend that one instead.');
      to = 'ACTIVE';
    }
    await sql(`UPDATE subscriptions SET expires_at = $2, renew_at = $2, grace_until = $3, status = $4, updated_at = now() WHERE id = $1`, [subId, exp, new Date(exp.getTime() + settings.grace_days * 86_400_000), to]);
  } else if (action === 'cancel_now') {
    to = 'CANCELLED';
    await sql(`UPDATE subscriptions SET status = 'CANCELLED', cancelled_at = now(), updated_at = now() WHERE id = $1`, [subId]);
  } else if (action === 'cancel_at_end') {
    await sql(`UPDATE subscriptions SET cancel_at_period_end = true, updated_at = now() WHERE id = $1`, [subId]);
  } else if (action === 'suspend') {
    if (!['ACTIVE', 'PAST_DUE'].includes(s.status)) throw new SubError('Only active subscriptions can be suspended.');
    to = 'SUSPENDED';
    await sql(`UPDATE subscriptions SET status = 'SUSPENDED', updated_at = now() WHERE id = $1`, [subId]);
  } else if (action === 'resume') {
    if (s.status !== 'SUSPENDED') throw new SubError('Only suspended subscriptions can be resumed.');
    to = 'ACTIVE';
    await sql(`UPDATE subscriptions SET status = 'ACTIVE', updated_at = now() WHERE id = $1`, [subId]);
  } else if (action === 'set_city') {
    if (!isCityKey(o.city)) throw new SubError('Unknown city.');
    await sql(`UPDATE subscriptions SET city = $2, updated_at = now() WHERE id = $1`, [subId, o.city]);
  } else if (action === 'set_projects') {
    const mine = new Set((await developerProjects(s.user_id)).map((p) => p.id));
    const ids = (o.projectIds || []).filter((id) => mine.has(id));
    if (!ids.length) throw new SubError('Choose at least one of this developer’s projects.');
    await sql(`UPDATE subscriptions SET project_ids = $2, quantity = $3, updated_at = now() WHERE id = $1`, [subId, ids, ids.length]);
  }
  await history({ subscription_id: subId, user_id: s.user_id, category: s.category, action: `admin_${action}`, from_plan: s.plan_code, to_plan: s.plan_code, from_status: s.status, to_status: to, actor: o.actor, detail: { reason: o.reason, days: o.days, city: o.city, project_ids: o.projectIds } });
  await audit(o.actor, `subscription.${action}`, 'subscription', subId, { reason: o.reason, days: o.days, city: o.city, project_ids: o.projectIds, before: { status: before.status, expires_at: before.expires_at } });
  forgetEntitlements(s.user_id);
  if (s.category === 'developer') await refreshDeveloperPromotion(s.user_id).catch(() => {});
}

// ---- developer promotion --------------------------------------------------------

export async function refreshDeveloperPromotion(userId: string) {
  forgetEntitlements(userId);
  const ent = await getEntitlements({ id: userId, role: 'developer' });
  const f = ent.plan?.features || {};
  const level = f.dev_priority_promotion ? 'priority' : f.dev_enhanced_visibility ? 'enhanced' : null;
  await syncPromotion(userId, ent.coveredProjects, ent.coveredProjects.length ? level : null);
}

// ---- scheduled lifecycle (cron) ---------------------------------------------------

export interface CronSummary { reminders: number; past_due: number; expired: number; reconciled: number; abandoned: number; errors: string[] }

/** Daily (or more frequent) job: reminders, grace, expiry, stale-order reconciliation. Idempotent. */
export async function runLifecycle(now = new Date()): Promise<CronSummary> {
  await ensureSchema();
  const settings = await getSettings();
  const out: CronSummary = { reminders: 0, past_due: 0, expired: 0, reconciled: 0, abandoned: 0, errors: [] };
  const days = [...new Set((settings.reminder_days || []).map(Number).filter((d) => d > 0))].sort((a, b) => a - b);
  const maxDay = days.length ? days[days.length - 1] : 0;

  // 1) Reminders before expiry (the smallest window that applies, once per term).
  if (maxDay) {
    const soon = await sql(`SELECT * FROM subscriptions WHERE status = 'ACTIVE' AND cancel_at_period_end = false AND expires_at > $1 AND expires_at <= $2`, [now, new Date(now.getTime() + maxDay * 86_400_000)]);
    for (const r of soon.rows) {
      const left = Math.ceil((new Date(r.expires_at).getTime() - now.getTime()) / 86_400_000);
      const d = days.find((x) => left <= x);
      if (d == null) continue;
      const sent = await notifySub(r.user_id, r.category, 'expiring', { plan: r.plan_name, expires_at: iso(r.expires_at), days: left }, { dedupeKey: `remind:${r.id}:${iso(r.expires_at)}:${d}` }).catch((e) => { out.errors.push(String(e)); return false; });
      if (sent) out.reminders++;
    }
  }

  // 2) Term ended: into grace (PAST_DUE) or straight to EXPIRED.
  const ended = await sql(`SELECT * FROM subscriptions WHERE status IN ('ACTIVE','PAST_DUE') AND expires_at <= $1`, [now]);
  for (const r of ended.rows) {
    try {
      const grace = r.grace_until ? new Date(r.grace_until) : new Date(r.expires_at);
      if (r.status === 'ACTIVE' && grace > now && !r.cancel_at_period_end) {
        await sql(`UPDATE subscriptions SET status = 'PAST_DUE', payment_status = 'renewal_due', updated_at = now() WHERE id = $1 AND status = 'ACTIVE'`, [r.id]);
        await history({ subscription_id: r.id, user_id: r.user_id, category: r.category, action: 'past_due', from_plan: r.plan_code, from_status: 'ACTIVE', to_status: 'PAST_DUE' });
        await notifySub(r.user_id, r.category, 'past_due', { plan: r.plan_name, expires_at: iso(r.expires_at) }, { dedupeKey: `pastdue:${r.id}:${iso(r.expires_at)}` });
        out.past_due++;
      } else if (grace <= now || r.cancel_at_period_end) {
        await expireSubscription(r.id, 'system');
        out.expired++;
      }
    } catch (e) { out.errors.push(`${r.id}: ${(e as Error).message}`); }
  }

  // 3) Stale checkouts: confirm with the gateway (a webhook may have been missed), else close.
  const stale = await sql(`SELECT * FROM sub_payments WHERE status IN ('created','pending') AND expires_at <= $1 LIMIT 200`, [now]);
  const gw = getGateway();
  for (const p of stale.rows) {
    try {
      let done = false;
      if (p.gateway_order_id && gw.configured()) {
        const pays = await gw.listOrderPayments(p.gateway_order_id);
        const captured = pays.find((x) => x.status === 'captured');
        if (captured) { await processSuccessfulPayment(p.id, captured, 'cron_reconcile'); out.reconciled++; done = true; }
        else if (pays.some((x) => x.status === 'authorized')) continue; // still settling
      }
      if (!done) {
        await sql(`UPDATE sub_payments SET status = 'cancelled', failure_reason = COALESCE(failure_reason, 'Not completed in time'), updated_at = now() WHERE id = $1 AND status IN ('created','pending')`, [p.id]);
        out.abandoned++;
      }
    } catch (e) { out.errors.push(`${p.id}: ${(e as Error).message}`); }
  }
  await audit('cron', 'lifecycle.run', 'cron', now.toISOString(), { ...out, errors: out.errors.slice(0, 20) });
  return out;
}

/** End a subscription's paid entitlements. The account, projects and leads are kept untouched. */
export async function expireSubscription(subId: string, actor: string) {
  const r = await sql(`UPDATE subscriptions SET status = 'EXPIRED', payment_status = CASE WHEN payment_status = 'paid' THEN 'expired' ELSE payment_status END, updated_at = now() WHERE id = $1 AND status IN ('ACTIVE','PAST_DUE') RETURNING *`, [subId]);
  const s = r.rows[0];
  if (!s) return;
  await history({ subscription_id: s.id, user_id: s.user_id, category: s.category, action: 'expired', from_plan: s.plan_code, to_status: 'EXPIRED', actor, detail: { next_plan_id: s.next_plan_id } });
  forgetEntitlements(s.user_id);
  if (s.category === 'developer') await refreshDeveloperPromotion(s.user_id).catch(() => {});
  await notifySub(s.user_id, s.category, 'expired', { plan: s.plan_name }, { dedupeKey: `expired:${s.id}:${iso(s.expires_at)}` }).catch(() => {});
}

// ---- reads for dashboards ---------------------------------------------------------

export async function listPayments(userId: string) {
  return (await sql(`SELECT id, kind, plan_code, plan_name, quantity, total_paise, refunded_paise, currency, status, failure_reason, gateway, gateway_payment_id, created_at, paid_at FROM sub_payments WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`, [userId])).rows
    .map((r) => ({ ...r, created_at: iso(r.created_at), paid_at: iso(r.paid_at) }));
}

export async function listHistory(userId: string) {
  return (await sql(`SELECT id, subscription_id, action, from_plan, to_plan, from_status, to_status, detail, at FROM sub_history WHERE user_id = $1 ORDER BY at DESC LIMIT 100`, [userId])).rows
    .map((r) => ({ ...r, id: String(r.id), at: iso(r.at) }));
}

export async function listSubscriptions(userId: string) {
  return (await sql(`SELECT * FROM subscriptions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`, [userId])).rows.map(toSubscription);
}

export { CITY_STATE, type Row };
