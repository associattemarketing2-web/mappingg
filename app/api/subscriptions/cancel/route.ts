import { NextRequest } from 'next/server';
import { cancelSubscription, resumeSubscription } from '@/lib/subscriptions/lifecycle';
import { errorResponse, ok, readJson, requireAccount } from '@/lib/subscriptions/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/subscriptions/cancel — stop renewal: the plan keeps working until
// the end of the paid term, then the account returns to Free. { resume: true }
// undoes a scheduled cancellation or downgrade.
export async function POST(req: NextRequest) {
  const a = await requireAccount();
  if ('res' in a) return a.res;
  const b = await readJson(req);
  try {
    if (b.resume === true) { await resumeSubscription(a.user); return ok({ resumed: true }); }
    return ok(await cancelSubscription(a.user));
  } catch (e) {
    return errorResponse(e);
  }
}
