import { NextRequest } from 'next/server';
import { createCheckout } from '@/lib/subscriptions/lifecycle';
import { checkoutBody, errorResponse, ok, readJson, requireAccount } from '@/lib/subscriptions/http';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/subscriptions/checkout { plan, project_ids?, city?, coupon?, billing? }
// Creates our payment record + the gateway order. Only the plan CODE is taken
// from the browser — price, quantity rules, credit and tax are computed here.
// Also handles upgrades, renewals and (scheduled, uncharged) downgrades.
export async function POST(req: NextRequest) {
  const a = await requireAccount();
  if ('res' in a) return a.res;
  const limited = rateLimit(`sub-checkout:${a.user.id}`, 10, 10 * 60_000);
  if (limited) return limited;
  try {
    return ok(await createCheckout(a.user, checkoutBody(await readJson(req))), 201);
  } catch (e) {
    return errorResponse(e);
  }
}
