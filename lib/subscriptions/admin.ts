import { getDb } from '../mongodb';
import { ensureSchema, iso, sql } from './db';
import { effectiveStatus, toSubscription } from './entitlements';
import { getGateway } from './gateway';
import { audit, envEnabled, getSettings, listPlans } from './store';
import { listMedia, listPriceOutlooks, listServiceRequests } from './features';
import { publicPlan } from './summary';
import { SubError } from './lifecycle';

// Read models for Super admin → Subscriptions. All amounts in paise.

async function emailsFor(ids: string[]): Promise<Map<string, { email: string; name: string; role: string }>> {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return new Map();
  const rows = await (await getDb()).collection('users').find({ id: { $in: uniq } }, { projection: { id: 1, email: 1, name: 1, role: 1 } }).toArray();
  return new Map(rows.map((u) => [String(u.id), { email: String(u.email || ''), name: String(u.name || ''), role: String(u.role || '') }]));
}

export async function userIdByEmail(emailOrId: string): Promise<string | null> {
  const v = emailOrId.trim();
  if (!v) return null;
  const u = await (await getDb()).collection('users').findOne(v.includes('@') ? { email: v.toLowerCase() } : { id: v }, { projection: { id: 1 } });
  return u ? String(u.id) : null;
}

export async function overview() {
  await ensureSchema();
  const now = new Date();
  const subs = (await sql(`SELECT id, category, status, expires_at, grace_until, amount_paise, period_months, plan_code FROM subscriptions WHERE status IN ('ACTIVE','PAST_DUE','SUSPENDED','PENDING')`)).rows;
  const counts: Record<string, Record<string, number>> = { developer: {}, cp: {}, buyer: {} };
  let mrr = 0;
  let expiring7 = 0;
  for (const s of subs) {
    const st = effectiveStatus(s as { status: string; expires_at: unknown; grace_until: unknown });
    counts[s.category] ||= {};
    counts[s.category][st] = (counts[s.category][st] || 0) + 1;
    if (st === 'ACTIVE' && Number(s.period_months) > 0) mrr += Number(s.amount_paise) / Number(s.period_months);
    if (st === 'ACTIVE' && s.expires_at && new Date(s.expires_at).getTime() - now.getTime() < 7 * 86_400_000) expiring7++;
  }
  const rev = (await sql(`SELECT coalesce(sum(total_paise),0)::bigint AS paid, coalesce(sum(refunded_paise),0)::bigint AS refunded, count(*)::int AS n FROM sub_payments WHERE status IN ('paid','refunded','partially_refunded') AND paid_at > now() - interval '30 days'`)).rows[0];
  const failed = (await sql(`SELECT count(*)::int AS n FROM sub_payments WHERE status = 'failed' AND created_at > now() - interval '30 days'`)).rows[0];
  const pendingMedia = (await sql(`SELECT count(*)::int AS n FROM dev_media_submissions WHERE status = 'pending'`)).rows[0];
  const openRequests = (await sql(`SELECT count(*)::int AS n FROM buyer_service_requests WHERE status IN ('requested','scheduled','in_progress')`)).rows[0];
  const lastHook = (await sql(`SELECT received_at, event, outcome FROM sub_webhook_events ORDER BY received_at DESC LIMIT 1`)).rows[0];
  const lastCron = (await sql(`SELECT at, detail FROM sub_audit WHERE action = 'lifecycle.run' ORDER BY at DESC LIMIT 1`)).rows[0];
  const settings = await getSettings();
  const gw = getGateway();
  const envEnforce = (process.env.SUBSCRIPTION_ENFORCE || '').trim();
  const envOn = envEnabled();
  return {
    counts, mrr_paise: Math.round(mrr), expiring_7d: expiring7,
    revenue_30d: { paid_paise: Number(rev.paid), refunded_paise: Number(rev.refunded), payments: Number(rev.n) },
    failed_30d: Number(failed.n), pending_media: Number(pendingMedia.n), open_requests: Number(openRequests.n),
    gateway: { name: gw.name, configured: gw.configured(), webhook: gw.webhookConfigured(), mode: gw.mode() },
    cron: { configured: !!process.env.CRON_SECRET, last_run: lastCron ? iso(lastCron.at) : null, last: lastCron?.detail || null },
    last_webhook: lastHook ? { at: iso(lastHook.received_at), event: lastHook.event, outcome: lastHook.outcome } : null,
    enabled: { setting: !!settings.enabled, env: envOn === null ? null : (process.env.SUBSCRIPTIONS_ENABLED || '').trim(), effective: envOn ?? !!settings.enabled },
    enforce: { setting: settings.enforce, env: envEnforce || null, effective: envEnforce ? ['1', 'true'].includes(envEnforce.toLowerCase()) : settings.enforce },
  };
}

export async function listAllSubscriptions(f: { category?: string; status?: string; q?: string; limit?: number }) {
  await ensureSchema();
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (clause: string, v: unknown) => { params.push(v); where.push(clause.replace('?', `$${params.length}`)); };
  if (f.category) add('category = ?', f.category);
  if (f.status === 'expiring') where.push(`status = 'ACTIVE' AND expires_at > now() AND expires_at <= now() + interval '7 days'`);
  else if (f.status === 'expired') where.push(`(status = 'EXPIRED' OR (status IN ('ACTIVE','PAST_DUE') AND coalesce(grace_until, expires_at) <= now()))`);
  else if (f.status === 'past_due') where.push(`(status = 'PAST_DUE' OR (status = 'ACTIVE' AND expires_at <= now()))`);
  else if (f.status) add('status = ?', f.status.toUpperCase());
  if (f.q) {
    const id = await userIdByEmail(f.q);
    if (!id) return [];
    add('user_id = ?', id);
  }
  params.push(Math.min(Math.max(f.limit || 200, 1), 1000));
  const rows = (await sql(`SELECT * FROM subscriptions ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY updated_at DESC LIMIT $${params.length}`, params)).rows.map(toSubscription);
  const users = await emailsFor(rows.map((r) => r.user_id));
  return rows.map((r) => ({ ...r, user: users.get(r.user_id) || null }));
}

export async function listAllPayments(f: { status?: string; category?: string; q?: string }) {
  await ensureSchema();
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.status) { params.push(f.status); where.push(`status = $${params.length}`); }
  if (f.category) { params.push(f.category); where.push(`category = $${params.length}`); }
  if (f.q) {
    const id = await userIdByEmail(f.q);
    if (!id) { params.push(f.q); where.push(`(gateway_payment_id = $${params.length} OR gateway_order_id = $${params.length} OR id = $${params.length})`); }
    else { params.push(id); where.push(`user_id = $${params.length}`); }
  }
  const rows = (await sql(`SELECT * FROM sub_payments ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT 300`, params)).rows;
  const users = await emailsFor(rows.map((r) => r.user_id));
  return rows.map((r) => ({ ...r, created_at: iso(r.created_at), paid_at: iso(r.paid_at), updated_at: iso(r.updated_at), expires_at: iso(r.expires_at), user: users.get(r.user_id) || null }));
}

export async function listRefunds() {
  await ensureSchema();
  const rows = (await sql(`SELECT r.*, p.user_id, p.plan_name, p.total_paise FROM sub_refunds r JOIN sub_payments p ON p.id = r.payment_id ORDER BY r.created_at DESC LIMIT 300`)).rows;
  const users = await emailsFor(rows.map((r) => r.user_id));
  return rows.map((r) => ({ ...r, created_at: iso(r.created_at), updated_at: iso(r.updated_at), user: users.get(r.user_id) || null }));
}

export async function listCoupons() {
  await ensureSchema();
  return (await sql(`SELECT * FROM sub_coupons ORDER BY created_at DESC`)).rows.map((c) => ({ ...c, valid_from: iso(c.valid_from), valid_until: iso(c.valid_until), created_at: iso(c.created_at), updated_at: iso(c.updated_at) }));
}

export async function saveCoupon(b: Record<string, any>, actor: string) {
  const code = String(b.code || '').trim().toUpperCase();
  if (!/^[A-Z0-9_-]{3,30}$/.test(code)) throw new SubError('Coupon code: 3–30 letters, numbers, - or _.');
  const pct = Math.round(Number(b.percent_off) || 0);
  const amt = Math.round(Number(b.amount_off_paise) || 0);
  if (pct < 0 || pct > 100 || amt < 0) throw new SubError('Discount must be 0–100% and/or a positive amount.');
  if (!pct && !amt) throw new SubError('Set a percentage or an amount off.');
  const arr = (v: unknown) => (Array.isArray(v) ? v.map(String).map((s) => s.trim()).filter(Boolean) : String(v || '').split(',').map((s) => s.trim()).filter(Boolean));
  const date = (v: unknown) => (v ? new Date(String(v)) : null);
  await sql(
    `INSERT INTO sub_coupons (code, description, percent_off, amount_off_paise, categories, plan_codes, max_redemptions, per_user_limit, valid_from, valid_until, is_active, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (code) DO UPDATE SET description=$2, percent_off=$3, amount_off_paise=$4, categories=$5, plan_codes=$6, max_redemptions=$7, per_user_limit=$8,
       valid_from=$9, valid_until=$10, is_active=$11, updated_at=now()`,
    [code, String(b.description || '').slice(0, 300), pct, amt, arr(b.categories), arr(b.plan_codes),
      b.max_redemptions === '' || b.max_redemptions == null ? null : Math.max(0, Math.round(Number(b.max_redemptions))),
      Math.max(0, Math.round(Number(b.per_user_limit ?? 1))), date(b.valid_from), date(b.valid_until), b.is_active !== false, actor],
  );
  await audit(actor, 'coupon.save', 'coupon', code, { percent_off: pct, amount_off_paise: amt, categories: arr(b.categories), plan_codes: arr(b.plan_codes), is_active: b.is_active !== false });
  return code;
}

export async function listWebhooks() {
  await ensureSchema();
  return (await sql(`SELECT id, gateway, event, received_at, processed_at, outcome, error FROM sub_webhook_events ORDER BY received_at DESC LIMIT 200`)).rows
    .map((r) => ({ ...r, received_at: iso(r.received_at), processed_at: iso(r.processed_at) }));
}

export async function listAudit() {
  await ensureSchema();
  return (await sql(`SELECT * FROM sub_audit ORDER BY at DESC LIMIT 300`)).rows.map((r) => ({ ...r, id: String(r.id), at: iso(r.at) }));
}

export async function reports() {
  await ensureSchema();
  const monthly = (await sql(`
    SELECT to_char(date_trunc('month', paid_at AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM') AS month, category,
           count(*)::int AS payments, sum(total_paise)::bigint AS revenue_paise, sum(refunded_paise)::bigint AS refunded_paise
    FROM sub_payments WHERE status IN ('paid','refunded','partially_refunded') AND paid_at > now() - interval '12 months'
    GROUP BY 1, 2 ORDER BY 1`)).rows.map((r) => ({ ...r, revenue_paise: Number(r.revenue_paise), refunded_paise: Number(r.refunded_paise) }));
  const byPlan = (await sql(`SELECT plan_code, count(*)::int AS active FROM subscriptions WHERE status IN ('ACTIVE','PAST_DUE') GROUP BY 1 ORDER BY 2 DESC`)).rows;
  const events = (await sql(`
    SELECT to_char(date_trunc('month', at AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM') AS month, action, count(*)::int AS n
    FROM sub_history WHERE at > now() - interval '12 months' AND action IN ('activated','upgraded','renewed','expired','cancel_requested','refunded')
    GROUP BY 1, 2 ORDER BY 1`)).rows;
  const coupons = (await sql(`SELECT code, count(*)::int AS uses, sum(discount_paise)::bigint AS discount_paise FROM sub_coupon_redemptions GROUP BY 1 ORDER BY 2 DESC LIMIT 20`)).rows.map((r) => ({ ...r, discount_paise: Number(r.discount_paise) }));
  return { monthly, byPlan, events, coupons };
}

export async function userDetail(emailOrId: string) {
  const id = await userIdByEmail(emailOrId);
  if (!id) throw new SubError('No account with that email.', 404);
  const [subs, payments, history, usage, users] = await Promise.all([
    sql(`SELECT * FROM subscriptions WHERE user_id = $1 ORDER BY created_at DESC`, [id]),
    sql(`SELECT * FROM sub_payments WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`, [id]),
    sql(`SELECT * FROM sub_history WHERE user_id = $1 ORDER BY at DESC LIMIT 200`, [id]),
    sql(`SELECT metric, period_key, count(*)::int AS n FROM sub_usage WHERE user_id = $1 GROUP BY 1, 2 ORDER BY 2 DESC LIMIT 20`, [id]),
    emailsFor([id]),
  ]);
  return {
    user: { id, ...(users.get(id) || {}) },
    subscriptions: subs.rows.map(toSubscription),
    payments: payments.rows.map((r) => ({ ...r, created_at: iso(r.created_at), paid_at: iso(r.paid_at) })),
    history: history.rows.map((r) => ({ ...r, id: String(r.id), at: iso(r.at) })),
    usage: usage.rows,
  };
}

export async function planCatalog() {
  await ensureSchema();
  const plans = await listPlans();
  const features = (await sql(`SELECT * FROM sub_features ORDER BY category, sort`)).rows;
  return { plans: plans.map((p) => ({ ...p, public: publicPlan(p) })), features };
}

export async function servicesAndMedia() {
  const [services, media] = await Promise.all([listServiceRequests(null), listMedia({})]);
  const users = await emailsFor([...services.map((s) => s.user_id), ...media.map((m) => m.user_id)]);
  const pinIds = [...new Set(media.map((m) => String(m.pin_id)))];
  const pins = pinIds.length ? await (await getDb()).collection('pins').find({ id: { $in: pinIds } }, { projection: { id: 1, title: 1, number: 1 } }).toArray() : [];
  const pinBy = new Map(pins.map((p) => [String(p.id), p]));
  return {
    services: services.map((s) => ({ ...s, user: users.get(s.user_id) || null })),
    media: media.map((m) => ({ ...m, user: users.get(m.user_id) || null, project: pinBy.get(String(m.pin_id))?.title || '' })),
  };
}

export async function outlooks() {
  const rows = await listPriceOutlooks();
  const ids = rows.map((r) => String(r.pin_id));
  const pins = ids.length ? await (await getDb()).collection('pins').find({ id: { $in: ids } }, { projection: { id: 1, title: 1, number: 1, price: 1 } }).toArray() : [];
  const by = new Map(pins.map((p) => [String(p.id), p]));
  return rows.map((r) => ({ ...r, title: String(by.get(String(r.pin_id))?.title || ''), number: by.get(String(r.pin_id))?.number ?? null, current_price: String(by.get(String(r.pin_id))?.price || '') }));
}
