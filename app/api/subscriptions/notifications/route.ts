import { listNotifications, markNotificationsRead } from '@/lib/subscriptions/notifications';
import { errorResponse, ok, requireAccount } from '@/lib/subscriptions/http';
import { ensureSchema } from '@/lib/subscriptions/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET — the account's subscription notifications; POST — mark them all read.
export async function GET() {
  const a = await requireAccount();
  if ('res' in a) return a.res;
  try {
    await ensureSchema();
    return ok(await listNotifications(a.user.id));
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST() {
  const a = await requireAccount();
  if ('res' in a) return a.res;
  await ensureSchema();
  await markNotificationsRead(a.user.id);
  return ok({ ok: true });
}
