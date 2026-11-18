import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { startTestDb } from './helpers/api-db';

// Subscription engine — integration tests against an in-process PostgreSQL
// (PGlite): real SQL, real entitlement checks, real Razorpay provider code with
// the Razorpay HTTP API stubbed (no network, no real money, clearly fake ids).

const KEY_SECRET = 'test_key_secret';
const WH_SECRET = 'test_webhook_secret';
process.env.RAZORPAY_KEY_ID = 'rzp_test_FAKEKEY';
process.env.RAZORPAY_KEY_SECRET = KEY_SECRET;
process.env.RAZORPAY_WEBHOOK_SECRET = WH_SECRET;
process.env.SUBSCRIPTIONS_ENABLED = '1'; // master switch on: these tests cover the live system
process.env.SUBSCRIPTION_ENFORCE = '1';

let P: typeof import('../lib/subscriptions/pricing');
let E: typeof import('../lib/subscriptions/entitlements');
let L: typeof import('../lib/subscriptions/lifecycle');
let S: typeof import('../lib/subscriptions/store');
let I: typeof import('../lib/subscriptions/invoices');
let H: typeof import('../lib/subscriptions/http');
let pgq: (sql: string, p?: unknown[]) => Promise<{ rows: any[] }>;

// ---- fake Razorpay API ----------------------------------------------------------
const rz = { orders: new Map<string, any>(), payments: new Map<string, any>(), refunds: 0, seq: 0, failNextOrder: false };
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (!url.startsWith('https://api.razorpay.com/v1')) return realFetch(input as RequestInfo, init);
  const auth = String((init?.headers as Record<string, string>)?.Authorization || '');
  assert.equal(auth, `Basic ${Buffer.from(`rzp_test_FAKEKEY:${KEY_SECRET}`).toString('base64')}`, 'Razorpay is called with server-side Basic auth');
  const path = url.slice('https://api.razorpay.com/v1'.length);
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
  if (path === '/orders' && init?.method === 'POST') {
    if (rz.failNextOrder) { rz.failNextOrder = false; return json({ error: { description: 'boom' } }, 500); }
    const o = { id: `order_FAKE${++rz.seq}`, amount: body.amount, currency: body.currency, status: 'created' };
    rz.orders.set(o.id, o);
    return json(o);
  }
  let m = path.match(/^\/payments\/([^/]+)$/);
  if (m) return rz.payments.has(m[1]) ? json(rz.payments.get(m[1])) : json({ error: { description: 'not found' } }, 404);
  m = path.match(/^\/payments\/([^/]+)\/capture$/);
  if (m) { const p = rz.payments.get(m[1]); p.status = 'captured'; return json(p); }
  m = path.match(/^\/payments\/([^/]+)\/refund$/);
  if (m) return json({ id: `rfnd_FAKE${++rz.refunds}`, status: 'processed', amount: body.amount });
  m = path.match(/^\/orders\/([^/]+)\/payments$/);
  if (m) return json({ items: [...rz.payments.values()].filter((p) => p.order_id === m![1]) });
  return json({ error: { description: 'unhandled' } }, 400);
}) as typeof fetch;

/** The customer "pays" an order in the fake gateway; returns what the checkout widget would hand back. */
function payOrder(orderId: string, status: 'captured' | 'authorized' | 'failed' | 'created' = 'captured', amount?: number) {
  const o = rz.orders.get(orderId);
  const id = `pay_FAKE${++rz.seq}`;
  rz.payments.set(id, { id, order_id: orderId, amount: amount ?? o.amount, currency: 'INR', status, method: 'upi', error_description: status === 'failed' ? 'Bank declined' : null });
  return { order_id: orderId, payment_id: id, signature: createHmac('sha256', KEY_SECRET).update(`${orderId}|${id}`).digest('hex') };
}

function webhookBody(event: string, pay: any) {
  return JSON.stringify({ event, payload: { payment: { entity: pay } } });
}
const sign = (raw: string) => createHmac('sha256', WH_SECRET).update(raw).digest('hex');

// ---- fixtures ---------------------------------------------------------------------
const DEV = { id: 'u-dev', email: 'dev@example.test', role: 'developer' };
const DEV2 = { id: 'u-dev2', email: 'dev2@example.test', role: 'developer' };
const CP = { id: 'u-cp', email: 'cp@example.test', role: 'agent' };
const CP2 = { id: 'u-cp2', email: 'cp2@example.test', role: 'agent' };
const CP3 = { id: 'u-cp3', email: 'cp3@example.test', role: 'agent' };
const BUYER = { id: 'u-buyer', email: 'buyer@example.test', role: 'buyer' };
const BUYER2 = { id: 'u-buyer2', email: 'buyer2@example.test', role: 'buyer' };

const punePins = Array.from({ length: 25 }, (_, i) => ({ id: `pp${i}`, number: 100 + i, title: `Pune Test ${i}`, location: 'Kharadi, Pune', lat: 18.55, lng: 73.94 }));
const mumbaiPins = Array.from({ length: 3 }, (_, i) => ({ id: `mp${i}`, number: 200 + i, title: `Thane Test ${i}`, location: 'Thane', lat: 19.2, lng: 72.97 }));
const devPins = [
  { id: 'd1', number: 301, title: 'Dev One', location: 'Kharadi, Pune', lat: 18.55, lng: 73.94, owner_user_id: DEV.id },
  { id: 'd2', number: 302, title: 'Dev Two', location: 'Wakad, Pune', lat: 18.6, lng: 73.76, owner_user_id: DEV.id },
  { id: 'd3', number: 303, title: 'Dev Bengaluru', location: 'Whitefield, Bengaluru', lat: 12.97, lng: 77.75, owner_user_id: DEV.id },
  { id: 'd4', number: 304, title: 'Other dev', location: 'Baner, Pune', lat: 18.56, lng: 73.78, owner_user_id: DEV2.id },
];

before(async () => {
  const { pg, insert } = await startTestDb();
  pgq = (s, p) => pg.query(s, p as never[]) as never;
  await insert('pins', [...punePins, ...mumbaiPins, ...devPins]);
  await insert('users', [DEV, DEV2, CP, CP2, CP3, BUYER, BUYER2].map((u) => ({ ...u, name: `Test ${u.role}`, mobile: '+91 9000000000' })));
  P = await import('../lib/subscriptions/pricing');
  E = await import('../lib/subscriptions/entitlements');
  L = await import('../lib/subscriptions/lifecycle');
  S = await import('../lib/subscriptions/store');
  I = await import('../lib/subscriptions/invoices');
  H = await import('../lib/subscriptions/http');
  await (await import('../lib/subscriptions/db')).ensureSchema();
});

beforeEach(() => { process.env.SUBSCRIPTION_ENFORCE = '1'; E.forgetEntitlements(); S.clearCaches(); });

const ent = (u: { id: string; role: string }) => { E.forgetEntitlements(u.id); return E.getEntitlements(u); };
const pin = (id: string) => { const p = [...punePins, ...mumbaiPins].find((x) => x.id === id)!; return { id, cityKey: p.lat > 19 ? 'mumbai' : 'pune' }; };
async function expire(userId: string, daysAgo = 10) {
  await pgq(`UPDATE subscriptions SET expires_at = now() - ($2 || ' days')::interval, grace_until = now() - ($2 || ' days')::interval + interval '1 day' WHERE user_id = $1 AND status IN ('ACTIVE','PAST_DUE')`, [userId, String(daysAgo)]);
  E.forgetEntitlements(userId);
}

// ---- pure maths -------------------------------------------------------------------

test('quote: not GST-registered → no tax; coupon and credit never go below zero', () => {
  const tax = { registered: false, rate: 18, inclusive: false, state_code: '27' };
  const q = P.computeQuote({ unit_price_paise: 100_000, quantity: 3, tax });
  assert.deepEqual([q.base_paise, q.tax_paise, q.total_paise, q.tax_mode], [300_000, 0, 300_000, 'none']);
  const c = P.computeQuote({ unit_price_paise: 100_000, quantity: 1, coupon: { code: 'X', percent_off: 50, amount_off_paise: 80_000 }, tax });
  assert.equal(c.discount_paise, 100_000);
  assert.equal(c.total_paise, 0);
  const cr = P.computeQuote({ unit_price_paise: 200_000, quantity: 1, credit_paise: 999_999, tax });
  assert.equal(cr.credit_paise, 200_000);
  assert.equal(cr.total_paise, 0);
});

test('quote: GST exclusive (CGST+SGST intra-state, IGST inter-state) and inclusive', () => {
  const ex = P.computeQuote({ unit_price_paise: 100_000, quantity: 1, tax: { registered: true, rate: 18, inclusive: false, state_code: '27' } });
  assert.deepEqual([ex.taxable_paise, ex.cgst_paise, ex.sgst_paise, ex.igst_paise, ex.total_paise], [100_000, 9_000, 9_000, 0, 118_000]);
  const inter = P.computeQuote({ unit_price_paise: 100_000, quantity: 1, tax: { registered: true, rate: 18, inclusive: false, state_code: '27' }, customer_state_code: '29' });
  assert.deepEqual([inter.cgst_paise, inter.igst_paise, inter.total_paise], [0, 18_000, 118_000]);
  const inc = P.computeQuote({ unit_price_paise: 199_900, quantity: 1, tax: { registered: true, rate: 18, inclusive: true, state_code: '27' } });
  assert.equal(inc.total_paise, 199_900);
  assert.equal(inc.taxable_paise + inc.tax_paise, 199_900);
  assert.equal(inc.taxable_paise, 169_407);
});

test('weekly limits reset at Monday 00:00 India time', () => {
  // Sunday 23:30 IST = Sunday 18:00 UTC; Monday 00:30 IST = Sunday 19:00 UTC.
  assert.notEqual(P.isoWeekKey(new Date('2026-11-15T18:00:00Z')), P.isoWeekKey(new Date('2026-11-15T19:00:00Z')));
  assert.equal(P.isoWeekKey(new Date('2026-11-16T19:00:00Z')), P.isoWeekKey(new Date('2026-11-21T10:00:00Z')));
  assert.equal(P.periodResetsAt('week', new Date('2026-11-18T10:00:00Z'))!.toISOString(), '2026-11-22T18:30:00.000Z');
  assert.equal(P.addMonths(new Date('2026-01-31T00:00:00Z'), 1).toISOString().slice(0, 10), '2026-02-28');
  assert.equal(P.unusedCredit(100_000, new Date('2026-01-01'), new Date('2026-01-31'), new Date('2026-01-16')), 50_000);
});

// ---- catalogue ----------------------------------------------------------------------

test('default plans are seeded with the configured prices and billing cycles', async () => {
  const plans = await S.listPlans();
  const by = Object.fromEntries(plans.map((p) => [p.code, p]));
  assert.equal(by.dev_medium.price_paise, 100_000);
  assert.equal(by.dev_large.price_paise, 150_000);
  assert.equal(by.dev_bulk.price_paise, 200_000);
  assert.equal(by.dev_medium.billing_unit, 'project');
  assert.equal(by.cp_pro.price_paise, 100_000);
  assert.equal(by.cp_promax.price_paise, 200_000);
  assert.equal(by.buyer_premium.price_paise, 199_900);
  assert.equal(by.buyer_premium.period_months, 3);
  assert.equal(by.cp_free.limits.cp_weekly_project_access, 3);
  assert.equal(by.cp_free.limits.cp_max_cities, 1);
  assert.equal(by.cp_pro.limits.cp_max_cities, null);
  assert.equal(by.buyer_free.limits.buyer_listing_limit, 20);
});

// ---- channel partner ------------------------------------------------------------------

test('CP free: one chosen city, locked once set', async () => {
  let e = await ent(CP);
  assert.equal(e.plan!.code, 'cp_free');
  assert.equal((await E.validateProjectAccess(e, pin('pp0'))).code, 'city_not_selected');
  await L.chooseCity(CP, 'pune');
  await L.chooseCity(CP, 'pune'); // same city again is fine
  await assert.rejects(L.chooseCity(CP, 'mumbai'), /already set/);
  e = await ent(CP);
  assert.equal(e.city, 'pune');
  assert.equal((await E.validateProjectAccess(e, pin('mp0'))).code, 'city_not_allowed');
  assert.equal((await E.checkUsageLimit(e, 'project_access')).used, 0); // refusals are not counted
  await L.chooseCity(CP2, 'pune');
});

test('CP free: 3 unique projects a week; repeats are free; the 4th is blocked', async () => {
  const e = await ent(CP);
  assert.equal(e.plan!.code, 'cp_free');
  for (const id of ['pp0', 'pp1', 'pp2']) assert.equal((await E.validateProjectAccess(e, pin(id))).allowed, true);
  // Refresh / other tab / repeated API call for an already-opened project: allowed, not counted again.
  for (let i = 0; i < 5; i++) {
    const r = await E.validateProjectAccess(e, pin('pp1')) as Awaited<ReturnType<typeof E.consumeUsage>>;
    assert.equal(r.allowed, true);
    assert.equal(r.counted, false);
  }
  const fourth = await E.validateProjectAccess(e, pin('pp3'));
  assert.equal(fourth.allowed, false);
  assert.equal(fourth.code, 'limit_reached');
  const state = await E.checkUsageLimit(e, 'project_access');
  assert.equal(state.used, 3);
  assert.equal(state.remaining, 0);
});

test('CP free: parallel requests for different projects cannot overshoot the limit', async () => {
  const e = await ent(CP2);
  const results = await Promise.all(['pp10', 'pp11', 'pp12', 'pp13', 'pp14', 'pp15'].map((id) => E.validateProjectAccess(e, pin(id))));
  assert.equal(results.filter((r) => r.allowed).length, 3);
  assert.equal((await E.checkUsageLimit(e, 'project_access')).used, 3);
});

test('with enforcement off, nothing is blocked but usage is still recorded', async () => {
  process.env.SUBSCRIPTION_ENFORCE = '0';
  const e = await ent(CP);
  const r = await E.validateProjectAccess(e, pin('pp9'));
  assert.equal(r.allowed, true);
  assert.equal(r.wouldBlock, true);
  assert.equal(E.checkFeatureAccess(e, 'cp_crm').allowed, true);
  assert.equal(E.checkFeatureAccess(e, 'cp_crm').wouldBlock, true);
});

test('CP Pro: 10 a week in every city; Pro Max: unlimited', async () => {
  await L.adminActivate({ userId: CP2.id, plan: 'cp_pro', months: 1, reason: 'test grant', actor: 'owner@test' });
  let e = await ent(CP2);
  assert.equal(e.plan!.code, 'cp_pro');
  assert.equal(E.checkFeatureAccess(e, 'cp_brochure_access').allowed, true);
  assert.equal(E.checkFeatureAccess(e, 'cp_crm').allowed, false);
  // Outside the Free city: allowed on Pro (counts toward the week).
  assert.equal((await E.validateProjectAccess(e, pin('mp0'))).allowed, true);
  // 3 already used this week on Free + 1 above count toward the week; 6 more allowed.
  const ids = punePins.map((p) => p.id).filter((id) => !['pp10', 'pp11', 'pp12'].includes(id));
  let allowed = 0;
  for (const id of ids.slice(0, 9)) if ((await E.validateProjectAccess(e, pin(id))).allowed) allowed++;
  assert.equal(allowed, 6);

  await L.adminActivate({ userId: CP2.id, plan: 'cp_promax', months: 1, reason: 'test upgrade', actor: 'owner@test' });
  e = await ent(CP2);
  assert.equal(E.limitOf(e, 'cp_weekly_project_access'), null);
  assert.equal((await E.validateProjectAccess(e, pin('mp1'))).allowed, true);
  for (const id of ids.slice(9, 15)) assert.equal((await E.validateProjectAccess(e, pin(id))).allowed, true);
  assert.equal(E.checkFeatureAccess(e, 'cp_crm').allowed, true);
  assert.equal(E.checkFeatureAccess(e, 'cp_future_price').allowed, true);
});

test('CP back on Free after Pro ends is limited to the Free city again', async () => {
  await L.chooseCity(CP3, 'pune');
  await L.adminActivate({ userId: CP3.id, plan: 'cp_pro', months: 1, reason: 'test', actor: 'owner@test' });
  assert.equal((await E.validateProjectAccess(await ent(CP3), pin('mp2'))).allowed, true);
  await expire(CP3.id);
  const e = await ent(CP3);
  assert.equal(e.plan!.code, 'cp_free');
  assert.equal(e.city, 'pune');
  assert.equal((await E.validateProjectAccess(e, pin('mp1'))).code, 'city_not_allowed');
});

// ---- buyer ------------------------------------------------------------------------------

test('buyer free: 20 listings, compare/favourites/share yes, premium tools no', async () => {
  const e = await ent(BUYER);
  for (const k of ['buyer_compare', 'buyer_favourites', 'buyer_share', 'buyer_loan_tools']) assert.equal(E.checkFeatureAccess(e, k).allowed, true, k);
  for (const k of ['buyer_vastu', 'buyer_legal_info', 'buyer_expert_assist', 'buyer_portfolio']) assert.equal(E.checkFeatureAccess(e, k).allowed, false, k);
  let ok = 0;
  for (const p of punePins.slice(0, 22)) if ((await E.validateProjectAccess(e, pin(p.id))).allowed) ok++;
  assert.equal(ok, 20);
  assert.equal((await E.validateProjectAccess(e, pin('pp0'))).allowed, true, 'an already-opened listing stays open');
});

// ---- payments ----------------------------------------------------------------------------

test('buyer premium: checkout → verified payment → active, invoiced, premium unlocked', async () => {
  const c = await L.createCheckout(BUYER, { plan: 'buyer_premium' });
  assert.equal(c.status, 'awaiting_payment');
  assert.equal(c.quote.total_paise, 199_900);
  assert.equal(c.gateway!.key, 'rzp_test_FAKEKEY');
  assert.equal(c.gateway!.mode, 'test');
  const paid = payOrder(c.gateway!.order_id);
  const v = await L.verifyPayment(BUYER, paid);
  assert.equal(v.status, 'paid');
  assert.ok(v.invoice_id);
  const e = await ent(BUYER);
  assert.equal(e.plan!.code, 'buyer_premium');
  assert.equal(E.checkFeatureAccess(e, 'buyer_vastu').allowed, true);
  assert.equal((await E.validateProjectAccess(e, pin('pp24'))).allowed, true, 'premium lifts the listing limit');
  const inv = await I.getInvoice(v.invoice_id!, BUYER.id);
  assert.match(inv!.number, /^MPG\/\d{4}-\d{2}\/00001$/);
  assert.equal(inv!.totals.total_paise, 199_900);
  assert.equal(inv!.seller.registered, false);
  // Another account can't read it.
  assert.equal(await I.getInvoice(v.invoice_id!, BUYER2.id), null);
  // Verifying again (double click / reload) is a no-op.
  const again = await L.verifyPayment(BUYER, paid);
  assert.equal(again.status, 'paid');
  assert.equal((await pgq(`SELECT count(*)::int n FROM subscriptions WHERE user_id = $1 AND status = 'ACTIVE'`, [BUYER.id])).rows[0].n, 1);
  assert.equal((await pgq(`SELECT count(*)::int n FROM sub_invoices WHERE user_id = $1`, [BUYER.id])).rows[0].n, 1);
});

test('expired buyer premium loses premium features; data is kept', async () => {
  await expire(BUYER.id, 30);
  const e = await ent(BUYER);
  assert.equal(e.status, 'EXPIRED');
  assert.equal(e.plan!.code, 'buyer_free');
  assert.equal(E.checkFeatureAccess(e, 'buyer_vastu').allowed, false);
  const s = await L.runLifecycle();
  assert.ok(s.expired >= 1);
  assert.equal((await pgq(`SELECT status FROM subscriptions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`, [BUYER.id])).rows[0].status, 'EXPIRED');
  assert.equal((await pgq(`SELECT count(*)::int n FROM sub_invoices WHERE user_id = $1`, [BUYER.id])).rows[0].n, 1, 'invoices survive expiry');
});

test('invalid signature, wrong order, tampered amount and another user are all rejected', async () => {
  const c = await L.createCheckout(BUYER2, { plan: 'buyer_premium' });
  const good = payOrder(c.gateway!.order_id);
  await assert.rejects(L.verifyPayment(BUYER2, { ...good, signature: 'deadbeef' }), /could not be verified/);
  await assert.rejects(L.verifyPayment(BUYER, good), /not found/, 'cannot confirm someone else’s order');
  const underpaid = payOrder(c.gateway!.order_id, 'captured', 100);
  await assert.rejects(L.verifyPayment(BUYER2, underpaid), /amount/);
  assert.equal((await ent(BUYER2)).plan!.code, 'buyer_free', 'nothing was activated');
  // The browser can't choose the price: unknown fields are dropped before the engine sees them.
  const body = H.checkoutBody({ plan: 'buyer_premium', amount: 1, price_paise: 1, user_id: 'u-dev', status: 'ACTIVE' } as Record<string, unknown>);
  assert.deepEqual(Object.keys(body).sort(), ['billing', 'city', 'coupon', 'plan', 'project_ids']);
  const q = await L.prepareCheckout(BUYER2, body);
  assert.equal(q.quote.total_paise, 199_900);
});

test('webhooks: bad signature refused; duplicate events processed once; failed payments recorded', async () => {
  const c = await L.createCheckout(BUYER2, { plan: 'buyer_premium' });
  const paid = payOrder(c.gateway!.order_id);
  const raw = webhookBody('payment.captured', rz.payments.get(paid.payment_id));
  assert.equal((await L.handleWebhook(raw, 'nope', 'evt_1')).status, 400);
  const first = await L.handleWebhook(raw, sign(raw), 'evt_1');
  assert.deepEqual(first, { status: 200, outcome: 'activated' });
  const dup = await L.handleWebhook(raw, sign(raw), 'evt_1');
  assert.equal(dup.outcome, 'duplicate');
  const redelivered = await L.handleWebhook(raw, sign(raw), 'evt_2');
  assert.equal(redelivered.outcome, 'already_processed');
  // The browser callback arriving after the webhook is also a no-op.
  assert.equal((await L.verifyPayment(BUYER2, paid)).status, 'paid');
  assert.equal((await pgq(`SELECT count(*)::int n FROM subscriptions WHERE user_id = $1`, [BUYER2.id])).rows[0].n, 1);

  // A failed attempt on a new order.
  await expire(BUYER2.id, 30);
  const c2 = await L.createCheckout(BUYER2, { plan: 'buyer_premium' });
  const failed = payOrder(c2.gateway!.order_id, 'failed');
  const fraw = webhookBody('payment.failed', rz.payments.get(failed.payment_id));
  assert.equal((await L.handleWebhook(fraw, sign(fraw), 'evt_3')).outcome, 'failed_recorded');
  assert.equal((await pgq(`SELECT status FROM sub_payments WHERE id = $1`, [c2.payment_id])).rows[0].status, 'failed');
  assert.equal((await ent(BUYER2)).plan!.code, 'buyer_free');
});

test('pending payment stays pending; the cron reconciles it once captured; abandoned orders close', async () => {
  const c = await L.createCheckout(BUYER2, { plan: 'buyer_premium' });
  const p = payOrder(c.gateway!.order_id, 'created');
  assert.equal((await L.verifyPayment(BUYER2, p)).status, 'pending');
  assert.equal((await ent(BUYER2)).plan!.code, 'buyer_free');
  rz.payments.get(p.payment_id).status = 'captured';
  await pgq(`UPDATE sub_payments SET expires_at = now() - interval '1 minute' WHERE id = $1`, [c.payment_id]);
  const abandoned = await L.createCheckout(DEV2, { plan: 'dev_medium', project_ids: ['d4'] });
  await pgq(`UPDATE sub_payments SET expires_at = now() - interval '1 minute' WHERE id = $1`, [abandoned.payment_id]);
  const s = await L.runLifecycle();
  assert.equal(s.reconciled, 1);
  assert.ok(s.abandoned >= 1);
  assert.equal((await ent(BUYER2)).plan!.code, 'buyer_premium');
  assert.equal((await pgq(`SELECT status FROM sub_payments WHERE id = $1`, [abandoned.payment_id])).rows[0].status, 'cancelled');
});

test('payment cancelled in the widget closes the order; gateway errors never activate', async () => {
  const c = await L.createCheckout(DEV2, { plan: 'dev_medium', project_ids: ['d4'] });
  await L.cancelPendingPayment(DEV2, c.payment_id);
  assert.equal((await pgq(`SELECT status FROM sub_payments WHERE id = $1`, [c.payment_id])).rows[0].status, 'cancelled');
  rz.failNextOrder = true;
  await assert.rejects(L.createCheckout(DEV2, { plan: 'dev_medium', project_ids: ['d4'] }), /Could not start the payment/);
  assert.equal((await ent(DEV2)).plan!.code, 'dev_free');
});

test('refund: full refund ends the plan; partial keeps it', async () => {
  const c = await L.createCheckout(BUYER, { plan: 'buyer_premium' });
  await L.verifyPayment(BUYER, payOrder(c.gateway!.order_id));
  assert.equal((await ent(BUYER)).plan!.code, 'buyer_premium');
  const part = await L.refundPayment(c.payment_id, 50_000, 'goodwill', 'owner@test');
  assert.equal(part.status, 'processed');
  assert.equal((await ent(BUYER)).plan!.code, 'buyer_premium');
  await assert.rejects(L.refundPayment(c.payment_id, 999_999, 'too much', 'owner@test'), /Refund must be/);
  await L.refundPayment(c.payment_id, null, 'customer request', 'owner@test');
  assert.equal((await pgq(`SELECT status, refunded_paise FROM sub_payments WHERE id = $1`, [c.payment_id])).rows[0].status, 'refunded');
  const e = await ent(BUYER);
  assert.equal(e.plan!.code, 'buyer_free');
  assert.equal(e.status, 'FREE');
  assert.equal((await pgq(`SELECT status FROM subscriptions WHERE last_payment_id = $1`, [c.payment_id])).rows[0].status, 'REFUNDED');
  assert.equal((await pgq(`SELECT status FROM sub_invoices WHERE payment_id = $1`, [c.payment_id])).rows[0].status, 'refunded');
});

// ---- developer -----------------------------------------------------------------------------

test('developer: free has no media uploads; Medium unlocks them only on covered projects', async () => {
  let e = await ent(DEV);
  assert.equal(E.checkFeatureAccess(e, 'dev_brochure_upload', { projectId: 'd1' }).allowed, false);
  assert.equal(E.limitOf(e, 'dev_max_projects'), 3);
  await assert.rejects(L.createCheckout(DEV, { plan: 'dev_medium', project_ids: ['d4'] }), /only subscribe projects that you listed/);
  await assert.rejects(L.createCheckout(DEV, { plan: 'dev_medium', project_ids: ['d1', 'd3'] }), /state/, 'Medium covers one state');
  const c = await L.createCheckout(DEV, { plan: 'dev_medium', project_ids: ['d1', 'd2'] });
  assert.equal(c.quote.quantity, 2);
  assert.equal(c.quote.total_paise, 200_000, '₹1,000 × 2 projects');
  await L.verifyPayment(DEV, payOrder(c.gateway!.order_id));
  e = await ent(DEV);
  assert.equal(E.checkFeatureAccess(e, 'dev_brochure_upload', { projectId: 'd1' }).allowed, true);
  assert.equal(E.checkFeatureAccess(e, 'dev_floor_plan_upload', { projectId: 'd2' }).allowed, true);
  assert.equal(E.checkFeatureAccess(e, 'dev_brochure_upload', { projectId: 'd3' }).code, 'project_not_covered');
  assert.equal(E.checkFeatureAccess(e, 'dev_site_visit_booking', { projectId: 'd1' }).allowed, false);
  assert.equal(E.checkFeatureAccess(e, 'dev_bulk_listing').allowed, false);
  assert.equal(E.checkFeatureAccess(e, 'dev_advanced_dashboard').allowed, true);
});

test('developer upgrade to Large is charged with credit for the unused term and adds site visits', async () => {
  const q = await L.prepareCheckout(DEV, { plan: 'dev_large', project_ids: ['d1', 'd2'] });
  assert.equal(q.kind, 'upgrade');
  assert.ok(q.quote.credit_paise > 190_000 && q.quote.credit_paise <= 200_000, `credit ${q.quote.credit_paise}`);
  assert.equal(q.quote.total_paise, 300_000 - q.quote.credit_paise);
  const c = await L.createCheckout(DEV, { plan: 'dev_large', project_ids: ['d1', 'd2'] });
  await L.verifyPayment(DEV, payOrder(c.gateway!.order_id));
  const e = await ent(DEV);
  assert.equal(e.plan!.code, 'dev_large');
  assert.equal(E.checkFeatureAccess(e, 'dev_site_visit_booking', { projectId: 'd1' }).allowed, true);
  const promoted = await pgq(`SELECT id, doc->>'sub_promotion' AS p FROM pins WHERE id IN ('d1','d2','d3') ORDER BY id`);
  assert.deepEqual(promoted.rows.map((r) => r.p), ['enhanced', 'enhanced', null]);
  assert.equal((await pgq(`SELECT count(*)::int n FROM subscriptions WHERE user_id = $1 AND status = 'ACTIVE'`, [DEV.id])).rows[0].n, 1);
});

test('renewal extends from the current expiry; downgrade is scheduled, not charged', async () => {
  const before = (await ent(DEV)).subscription!;
  const r = await L.createCheckout(DEV, { plan: 'dev_large', project_ids: ['d1', 'd2'] });
  assert.equal(r.kind, 'renewal');
  await L.verifyPayment(DEV, payOrder(r.gateway!.order_id));
  const after = (await ent(DEV)).subscription!;
  assert.equal(after.id, before.id);
  assert.equal(after.expires_at, P.addMonths(new Date(before.expires_at!), 1).toISOString());
  const d = await L.createCheckout(DEV, { plan: 'dev_medium', project_ids: ['d1', 'd2'] });
  assert.equal(d.status, 'scheduled');
  assert.equal((await ent(DEV)).subscription!.next_plan_id, 'dev_medium');
  assert.equal((await ent(DEV)).plan!.code, 'dev_large', 'still Large until the term ends');
});

test('Large Bulk: bulk listing, multi-state; expiry removes paid entitlements and promotion', async () => {
  const c = await L.createCheckout(DEV, { plan: 'dev_bulk', project_ids: ['d1', 'd2', 'd3'] });
  await L.verifyPayment(DEV, payOrder(c.gateway!.order_id));
  let e = await ent(DEV);
  assert.equal(E.checkFeatureAccess(e, 'dev_bulk_listing').allowed, true);
  assert.equal(E.checkFeatureAccess(e, 'dev_video_highlight', { projectId: 'd3' }).allowed, true);
  await expire(DEV.id, 30);
  await L.runLifecycle();
  e = await ent(DEV);
  assert.equal(e.plan!.code, 'dev_free');
  assert.equal(E.checkFeatureAccess(e, 'dev_bulk_listing').allowed, false);
  const promoted = await pgq(`SELECT count(*)::int n FROM pins WHERE doc->>'sub_promotion' IS NOT NULL`);
  assert.equal(promoted.rows[0].n, 0);
  assert.equal((await pgq(`SELECT count(*)::int n FROM pins WHERE doc->>'owner_user_id' = $1`, [DEV.id])).rows[0].n, 3, 'projects kept');
});

test('grace period: past due keeps entitlements, then expires; reminders are sent once', async () => {
  await L.adminActivate({ userId: CP.id, plan: 'cp_promax', months: 1, reason: 'grace test', actor: 'owner@test' });
  await pgq(`UPDATE subscriptions SET expires_at = now() + interval '20 hours' WHERE user_id = $1 AND status = 'ACTIVE'`, [CP.id]);
  const r1 = await L.runLifecycle();
  const r2 = await L.runLifecycle();
  assert.ok(r1.reminders >= 1);
  assert.equal(r2.reminders, 0, 'reminder is idempotent');
  await pgq(`UPDATE subscriptions SET expires_at = now() - interval '1 hour', grace_until = now() + interval '2 days' WHERE user_id = $1 AND status = 'ACTIVE'`, [CP.id]);
  E.forgetEntitlements(CP.id);
  assert.equal((await ent(CP)).status, 'PAST_DUE');
  assert.equal((await ent(CP)).plan!.code, 'cp_promax');
  await L.runLifecycle();
  assert.equal((await pgq(`SELECT status FROM subscriptions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`, [CP.id])).rows[0].status, 'PAST_DUE');
  await pgq(`UPDATE subscriptions SET grace_until = now() - interval '1 minute' WHERE user_id = $1 AND status = 'PAST_DUE'`, [CP.id]);
  await L.runLifecycle();
  assert.equal((await ent(CP)).plan!.code, 'cp_free');
  const n = await pgq(`SELECT type FROM sub_notifications WHERE user_id = $1 ORDER BY created_at`, [CP.id]);
  assert.deepEqual(n.rows.map((r) => r.type).filter((t) => ['expiring', 'past_due', 'expired'].includes(t)), ['expiring', 'past_due', 'expired']);
});

test('cancellation keeps the plan until the end of the term, then it is not renewed', async () => {
  await L.adminActivate({ userId: CP2.id, plan: 'cp_promax', months: 1, reason: 'cancel test', actor: 'owner@test' });
  const s = await L.cancelSubscription(CP2);
  assert.equal(s.cancel_at_period_end, true);
  assert.equal((await ent(CP2)).plan!.code, 'cp_promax');
  await pgq(`UPDATE subscriptions SET expires_at = now() - interval '1 minute' WHERE id = $1`, [s.id]);
  await L.runLifecycle();
  assert.equal((await pgq(`SELECT status FROM subscriptions WHERE id = $1`, [s.id])).rows[0].status, 'EXPIRED', 'no grace for a cancelled plan');
});

test('coupons: validated server-side, per-user limit, 100% coupon activates without a gateway payment', async () => {
  await pgq(`INSERT INTO sub_coupons (code, percent_off, categories, per_user_limit, max_redemptions) VALUES ('FREEMONTH', 100, '{developer}', 1, 10)`);
  await assert.rejects(L.createCheckout(BUYER2, { plan: 'buyer_premium', coupon: 'FREEMONTH' }), /does not apply/);
  await assert.rejects(L.createCheckout(DEV2, { plan: 'dev_medium', project_ids: ['d4'], coupon: 'NOPE' }), /not valid/);
  const r = await L.createCheckout(DEV2, { plan: 'dev_medium', project_ids: ['d4'], coupon: 'freemonth' });
  assert.equal(r.status, 'activated');
  assert.equal(r.quote.total_paise, 0);
  assert.equal((await ent(DEV2)).plan!.code, 'dev_medium');
  await expire(DEV2.id, 30);
  await assert.rejects(L.createCheckout(DEV2, { plan: 'dev_medium', project_ids: ['d4'], coupon: 'FREEMONTH' }), /already used/);
  assert.equal((await pgq(`SELECT redeemed FROM sub_coupons WHERE code = 'FREEMONTH'`)).rows[0].redeemed, 1);
});

// ---- role isolation ---------------------------------------------------------------------------

test('roles never cross: buyer ≠ developer features, staff have no plan, wrong-category plans refused', async () => {
  const b = await ent(BUYER2);
  assert.equal(E.checkFeatureAccess(b, 'dev_brochure_upload').code, 'wrong_role');
  assert.equal(E.checkFeatureAccess(b, 'cp_crm').code, 'wrong_role');
  const d = await ent(DEV2);
  assert.equal(E.checkFeatureAccess(d, 'buyer_vastu').code, 'wrong_role');
  await assert.rejects(L.createCheckout(BUYER2, { plan: 'cp_promax' }), /not available for your account type/);
  await assert.rejects(L.createCheckout(DEV2, { plan: 'buyer_premium' }), /not available for your account type/);
  await assert.rejects(L.createCheckout({ id: 'staff', email: 's@x', role: 'admin' }, { plan: 'buyer_premium' }), /buyer, channel partner and developer/);
  const staff = await E.getEntitlements({ id: 'staff', role: 'admin' });
  assert.equal(staff.category, null);
  // Admin activation needs a reason and is audited.
  await assert.rejects(L.adminActivate({ userId: BUYER2.id, plan: 'buyer_premium', months: 1, reason: '', actor: 'owner@test' }), /reason/);
  const audits = await pgq(`SELECT count(*)::int n FROM sub_audit WHERE action = 'subscription.manual_activate'`);
  assert.ok(audits.rows[0].n >= 4);
});
