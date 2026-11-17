import { NextRequest } from 'next/server';
import { z } from 'zod';
import * as A from '@/lib/subscriptions/admin';
import { adminActivate, adminUpdateSubscription, refundPayment, runLifecycle, SubError } from '@/lib/subscriptions/lifecycle';
import { createPlan, envEnabled, getSettings, saveSettings, updatePlan, audit } from '@/lib/subscriptions/store';
import { reviewMedia, setPriceOutlook, updateServiceRequest } from '@/lib/subscriptions/features';
import { forgetEntitlements } from '@/lib/subscriptions/entitlements';
import { BILLING_PERIODS, BILLING_UNITS, CATEGORIES, FEATURE_BY_KEY, PERIOD_MONTHS, USAGE_PERIODS } from '@/lib/subscriptions/catalog';
import { errorResponse, fail, ok, readJson, requireOwner } from '@/lib/subscriptions/http';
import { sql } from '@/lib/subscriptions/db';
import { getDb } from '@/lib/mongodb';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Super admin → Subscriptions. Owner only (money, prices and entitlements);
// every change is written to sub_audit with the owner's email.
//   GET  ?view=overview|plans|subscriptions|payments|refunds|coupons|reports|webhooks|audit|ops|outlook|settings|user
//   POST { action, ... } — see ACTIONS below.

export async function GET(req: NextRequest) {
  const a = await requireOwner();
  if ('res' in a) return a.res;
  const q = req.nextUrl.searchParams;
  try {
    switch (q.get('view') || 'overview') {
      case 'overview': return ok(await A.overview());
      case 'plans': return ok(await A.planCatalog());
      case 'subscriptions': return ok(await A.listAllSubscriptions({ category: q.get('category') || undefined, status: q.get('status') || undefined, q: q.get('q') || undefined }));
      case 'payments': return ok(await A.listAllPayments({ status: q.get('status') || undefined, category: q.get('category') || undefined, q: q.get('q') || undefined }));
      case 'refunds': return ok(await A.listRefunds());
      case 'coupons': return ok(await A.listCoupons());
      case 'reports': return ok(await A.reports());
      case 'webhooks': return ok(await A.listWebhooks());
      case 'audit': return ok(await A.listAudit());
      case 'ops': return ok(await A.servicesAndMedia());
      case 'outlook': return ok(await A.outlooks());
      case 'settings': return ok(await getSettings());
      case 'master': {
        // The master ON/OFF switch shown above every Subscriptions section.
        const env = envEnabled();
        const setting = !!(await getSettings()).enabled;
        return ok({ setting, env: env === null ? null : (process.env.SUBSCRIPTIONS_ENABLED || '').trim(), effective: env ?? setting });
      }
      case 'user': return ok(await A.userDetail(String(q.get('q') || '')));
      default: return fail('Unknown view');
    }
  } catch (e) {
    return errorResponse(e);
  }
}

const planSchema = z.object({
  category: z.enum(CATEGORIES).optional(),
  code: z.string().regex(/^[a-z0-9_]{3,40}$/).optional(),
  name: z.string().trim().min(2).max(80).optional(),
  tagline: z.string().max(200).optional(),
  description: z.string().max(2000).optional(),
  price_paise: z.number().int().min(0).max(100_000_000).optional(),
  billing_period: z.enum(BILLING_PERIODS).optional(),
  billing_unit: z.enum(BILLING_UNITS).optional(),
  min_quantity: z.number().int().min(1).max(1000).optional(),
  max_quantity: z.number().int().min(1).max(10000).nullable().optional(),
  is_active: z.boolean().optional(),
  recommended: z.boolean().optional(),
  sort: z.number().int().min(0).max(999).optional(),
  features: z.record(z.boolean()).optional(),
  limits: z.record(z.number().int().min(0).max(1_000_000).nullable()).optional(),
  limit_periods: z.record(z.enum(USAGE_PERIODS)).optional(),
}).strict();

function cleanPlan(input: z.infer<typeof planSchema>) {
  const out = { ...input } as z.infer<typeof planSchema> & { period_months?: number };
  // Only known feature / limit keys of the plan's category are stored.
  const keep = (rec: Record<string, unknown> | undefined, kind: 'flag' | 'limit') =>
    rec && Object.fromEntries(Object.entries(rec).filter(([k]) => FEATURE_BY_KEY.get(k)?.kind === kind));
  if (out.features) out.features = keep(out.features, 'flag') as Record<string, boolean>;
  if (out.limits) out.limits = keep(out.limits, 'limit') as Record<string, number | null>;
  if (out.billing_period) out.period_months = PERIOD_MONTHS[out.billing_period];
  return out;
}

const settingsSchema = z.object({
  enabled: z.boolean().optional(),
  enforce: z.boolean().optional(),
  grace_days: z.number().int().min(0).max(60).optional(),
  reminder_days: z.array(z.number().int().min(1).max(60)).max(5).optional(),
  pending_order_ttl_hours: z.number().int().min(1).max(168).optional(),
  refund_window_days: z.number().int().min(0).max(365).optional(),
  invoice_prefix: z.string().regex(/^[A-Za-z0-9-]{1,10}$/).optional(),
  terms_url: z.string().max(200).optional(),
  support_email: z.string().max(200).optional(),
  tax: z.object({
    registered: z.boolean().optional(),
    rate: z.number().min(0).max(28).optional(),
    inclusive: z.boolean().optional(),
    gstin: z.string().max(15).optional(),
    legal_name: z.string().max(200).optional(),
    address: z.string().max(400).optional(),
    state: z.string().max(60).optional(),
    state_code: z.string().regex(/^\d{2}$/).optional(),
    sac: z.string().max(10).optional(),
  }).optional(),
}).strict();

export async function POST(req: NextRequest) {
  const a = await requireOwner();
  if ('res' in a) return a.res;
  const limited = rateLimit(`sub-admin:${a.user.id}`, 120, 60_000);
  if (limited) return limited;
  const actor = a.user.email;
  const b = await readJson(req);
  try {
    switch (String(b.action || '')) {
      case 'plan.create': {
        const p = planSchema.parse(b.plan || {});
        if (!p.category || !p.code || !p.name) throw new SubError('Category, code and name are required.');
        const created = await createPlan({ ...cleanPlan(p), category: p.category, code: p.code, name: p.name }, actor);
        forgetEntitlements();
        return ok(created, 201);
      }
      case 'plan.update': {
        const p = planSchema.parse(b.plan || {});
        delete (p as { category?: unknown }).category;
        delete (p as { code?: unknown }).code;
        const updated = await updatePlan(String(b.id || ''), cleanPlan(p), actor);
        forgetEntitlements();
        return ok(updated);
      }
      case 'settings.update': {
        const s = settingsSchema.parse(b.settings || {});
        if (s.tax?.registered && s.tax.gstin !== undefined && s.tax.gstin && !/^[0-9]{2}[A-Z0-9]{13}$/.test(s.tax.gstin)) throw new SubError('GSTIN must be 15 characters (e.g. 27ABCDE1234F1Z5).');
        const cur = await getSettings();
        const next = await saveSettings(s as never, actor);
        if (cur.enforce !== next.enforce || cur.enabled !== next.enabled) forgetEntitlements();
        return ok(next);
      }
      case 'coupon.save': return ok({ code: await A.saveCoupon(b.coupon || {}, actor) });
      case 'sub.activate': {
        const userId = await A.userIdByEmail(String(b.user || ''));
        if (!userId) throw new SubError('No account with that email.', 404);
        return ok(await adminActivate({ userId, plan: String(b.plan || ''), months: Number(b.months) || 1, projectIds: Array.isArray(b.project_ids) ? b.project_ids.map(String) : [], city: b.city ? String(b.city) : null, reason: String(b.reason || ''), actor }), 201);
      }
      case 'sub.update': {
        const allowed = ['extend', 'cancel_now', 'cancel_at_end', 'suspend', 'resume', 'set_city', 'set_projects'] as const;
        const act = allowed.find((x) => x === b.op);
        if (!act) throw new SubError('Unknown action');
        await adminUpdateSubscription(String(b.id || ''), act, { days: Number(b.days) || undefined, city: b.city ? String(b.city) : undefined, projectIds: Array.isArray(b.project_ids) ? b.project_ids.map(String) : undefined, reason: String(b.reason || ''), actor });
        return ok({ ok: true });
      }
      case 'refund': {
        if (!b.reason || String(b.reason).trim().length < 3) throw new SubError('A reason is required for a refund.');
        const amount = b.amount_paise == null || b.amount_paise === '' ? null : Math.round(Number(b.amount_paise));
        return ok(await refundPayment(String(b.payment_id || ''), amount, String(b.reason), actor, { revoke: b.revoke === true }));
      }
      case 'service.update': return ok(await updateServiceRequest(String(b.id || ''), { status: b.status, admin_note: b.admin_note, assigned_to: b.assigned_to }, actor));
      case 'media.review': { await reviewMedia(String(b.id || ''), b.approve === true, String(b.note || ''), actor); return ok({ ok: true }); }
      case 'outlook.set': {
        // Accept a map pin number ("216") or a pin id.
        const ref = String(b.pin_id || '').trim().slice(0, 100);
        const pins = (await getDb()).collection('pins');
        const pin = /^\d+$/.test(ref)
          ? await pins.findOne({ number: Number(ref) }, { projection: { id: 1 } })
          : await pins.findOne({ id: ref }, { projection: { id: 1 } });
        if (!pin) throw new SubError('No project with that pin number / id.', 404);
        return ok(await setPriceOutlook(String(pin.id), b, actor));
      }
      case 'payment.mark_failed': {
        // For an order stuck in "created" that the customer confirms they abandoned.
        const r = await sql(`UPDATE sub_payments SET status = 'cancelled', failure_reason = $2, updated_at = now() WHERE id = $1 AND status IN ('created','pending') RETURNING id`, [String(b.id || ''), `Closed by admin: ${String(b.reason || '').slice(0, 200)}`]);
        if (!r.rows.length) throw new SubError('Only unpaid orders can be closed.');
        await audit(actor, 'payment.close', 'payment', String(b.id), { reason: b.reason });
        return ok({ ok: true });
      }
      case 'cron.run': return ok(await runLifecycle());
      default: return fail('Unknown action');
    }
  } catch (e) {
    if (e instanceof z.ZodError) return fail(`Invalid input: ${e.issues.map((i) => i.path.join('.') + ' ' + i.message).join('; ')}`.slice(0, 400));
    return errorResponse(e);
  }
}
