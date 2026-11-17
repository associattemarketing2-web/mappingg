import { NextRequest } from 'next/server';
import { prepareCheckout } from '@/lib/subscriptions/lifecycle';
import { checkoutBody, errorResponse, ok, readJson, requireAccount } from '@/lib/subscriptions/http';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/subscriptions/quote — the server-computed price breakdown for a plan
// (coupon, upgrade credit, GST). Nothing is written; checkout recomputes it.
export async function POST(req: NextRequest) {
  const a = await requireAccount();
  if ('res' in a) return a.res;
  const limited = rateLimit(`sub-quote:${a.user.id}`, 60, 60_000);
  if (limited) return limited;
  try {
    const p = await prepareCheckout(a.user, checkoutBody(await readJson(req)));
    return ok({
      plan: { code: p.plan.code, name: p.plan.name, billing_period: p.plan.billing_period, period_months: p.plan.period_months, billing_unit: p.plan.billing_unit },
      kind: p.kind, quantity: p.quantity, project_ids: p.project_ids, city: p.city, quote: p.quote, coupon_error: p.couponError,
      period_start: p.periodStart.toISOString(), current: p.current ? { plan_code: p.current.plan_code, expires_at: p.current.expires_at } : null,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
