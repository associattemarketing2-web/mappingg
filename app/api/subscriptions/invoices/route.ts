import { listInvoices } from '@/lib/subscriptions/invoices';
import { errorResponse, ok, requireAccount } from '@/lib/subscriptions/http';
import { ensureSchema } from '@/lib/subscriptions/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/subscriptions/invoices — the account's invoices (own only).
export async function GET() {
  const a = await requireAccount();
  if ('res' in a) return a.res;
  try {
    await ensureSchema();
    return ok(await listInvoices(a.user.id));
  } catch (e) {
    return errorResponse(e);
  }
}
