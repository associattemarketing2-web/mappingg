import { NextRequest } from 'next/server';
import { cancelPendingPayment } from '@/lib/subscriptions/lifecycle';
import { ok, readJson, requireAccount } from '@/lib/subscriptions/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/subscriptions/payment-cancelled { payment_id } — the customer closed
// the payment window. Only an unpaid order of their own is closed; a payment
// that completes anyway is still activated by the webhook / reconciliation.
export async function POST(req: NextRequest) {
  const a = await requireAccount();
  if ('res' in a) return a.res;
  const b = await readJson(req);
  if (b.payment_id) await cancelPendingPayment(a.user, String(b.payment_id).slice(0, 60));
  return ok({ ok: true });
}
