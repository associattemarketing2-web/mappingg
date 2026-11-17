import { mySubscription } from '@/lib/subscriptions/summary';
import { errorResponse, ok, requireAccount } from '@/lib/subscriptions/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/subscriptions/current — the signed-in account's plan, status, usage,
// days left and the plans they can move to. Only ever their own.
export async function GET() {
  const a = await requireAccount();
  if ('res' in a) return a.res;
  try {
    return ok(await mySubscription(a.user));
  } catch (e) {
    return errorResponse(e);
  }
}
