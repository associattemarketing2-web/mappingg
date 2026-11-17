import { NextRequest } from 'next/server';
import { getEntitlements } from '@/lib/subscriptions/entitlements';
import { createCheckout } from '@/lib/subscriptions/lifecycle';
import { checkoutBody, errorResponse, fail, ok, readJson, requireAccount } from '@/lib/subscriptions/http';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/subscriptions/upgrade { plan, project_ids?, city?, coupon? } — change
// the plan of a running paid subscription. Same engine as checkout: a higher
// plan is charged now with credit for the unused part of the current term; a
// lower plan is scheduled for the end of the term (no charge).
export async function POST(req: NextRequest) {
  const a = await requireAccount();
  if ('res' in a) return a.res;
  const limited = rateLimit(`sub-checkout:${a.user.id}`, 10, 10 * 60_000);
  if (limited) return limited;
  const ent = await getEntitlements(a.user);
  if (!ent.subscription || !['ACTIVE', 'PAST_DUE'].includes(ent.subscription.effective_status)) {
    return fail('You have no active paid plan to change — choose a plan instead.', 400, 'no_active_plan');
  }
  try {
    return ok(await createCheckout(a.user, checkoutBody(await readJson(req))), 201);
  } catch (e) {
    return errorResponse(e);
  }
}
