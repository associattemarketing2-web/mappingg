import { listHistory, listPayments, listSubscriptions } from '@/lib/subscriptions/lifecycle';
import { errorResponse, ok, requireAccount } from '@/lib/subscriptions/http';
import { ensureSchema } from '@/lib/subscriptions/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/subscriptions/history — the account's subscriptions, payments and
// subscription events (own data only).
export async function GET() {
  const a = await requireAccount();
  if ('res' in a) return a.res;
  try {
    await ensureSchema();
    const [subscriptions, payments, events] = await Promise.all([listSubscriptions(a.user.id), listPayments(a.user.id), listHistory(a.user.id)]);
    return ok({ subscriptions, payments, events });
  } catch (e) {
    return errorResponse(e);
  }
}
