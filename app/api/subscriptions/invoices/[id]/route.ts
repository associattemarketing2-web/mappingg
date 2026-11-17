import { getCurrentUser, isStaffRole } from '@/lib/auth';
import { getInvoice } from '@/lib/subscriptions/invoices';
import { fail, ok } from '@/lib/subscriptions/http';
import { ensureSchema, isAvailable } from '@/lib/subscriptions/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/subscriptions/invoices/<id> — one invoice: its owner, or staff.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  if (!isAvailable()) return fail('Unavailable', 503);
  const user = await getCurrentUser();
  if (!user) return fail('Please sign in.', 401);
  await ensureSchema();
  const inv = await getInvoice(String(params.id).slice(0, 60), isStaffRole(user.role) ? null : user.id);
  return inv ? ok(inv) : fail('Invoice not found', 404);
}
