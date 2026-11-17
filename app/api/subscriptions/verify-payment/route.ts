import { NextRequest } from 'next/server';
import { verifyPayment } from '@/lib/subscriptions/lifecycle';
import { errorResponse, fail, ok, readJson, requireAccount } from '@/lib/subscriptions/http';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/subscriptions/verify-payment { razorpay_order_id, razorpay_payment_id, razorpay_signature }
// Called by the checkout widget's success handler. The signature is verified
// with the secret key, then the payment is fetched from the gateway and must be
// captured for this exact order and amount before anything is activated.
export async function POST(req: NextRequest) {
  const a = await requireAccount();
  if ('res' in a) return a.res;
  const limited = rateLimit(`sub-verify:${a.user.id}`, 20, 10 * 60_000);
  if (limited) return limited;
  const b = await readJson(req);
  const order_id = String(b.razorpay_order_id || b.order_id || '').slice(0, 100);
  const payment_id = String(b.razorpay_payment_id || b.payment_id || '').slice(0, 100);
  const signature = String(b.razorpay_signature || b.signature || '').slice(0, 200);
  if (!order_id || !payment_id || !signature) return fail('Missing payment details.', 400);
  try {
    return ok(await verifyPayment(a.user, { order_id, payment_id, signature }));
  } catch (e) {
    return errorResponse(e);
  }
}
