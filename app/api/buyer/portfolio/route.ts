import { NextRequest } from 'next/server';
import { guardFeature } from '@/lib/subscriptions/guards';
import { deleteHolding, listPortfolio, saveHolding } from '@/lib/subscriptions/features';
import { errorResponse, fail, ok, readJson, requireAccount } from '@/lib/subscriptions/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Buyer Premium portfolio manager: the properties a buyer owns or booked, with
// what they paid, their own estimate of today's value and loan outstanding.
// Values are the buyer's own entries — Mappingg does not value property.
// GET lists (always — your own data), POST/PATCH/DELETE need Buyer Premium.

async function buyer() {
  const a = await requireAccount();
  if ('res' in a) return a;
  if (a.user.role !== 'buyer') return { res: fail('The portfolio manager is for buyer accounts.', 403, 'wrong_role') };
  return a;
}

export async function GET() {
  const a = await buyer();
  if ('res' in a) return a.res;
  try {
    return ok(await listPortfolio(a.user.id));
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  const a = await buyer();
  if ('res' in a) return a.res;
  const gate = await guardFeature(a.user, 'buyer_portfolio');
  if (gate) return gate;
  try {
    return ok({ id: await saveHolding(a.user.id, null, await readJson(req)) }, 201);
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PATCH(req: NextRequest) {
  const a = await buyer();
  if ('res' in a) return a.res;
  const gate = await guardFeature(a.user, 'buyer_portfolio');
  if (gate) return gate;
  const b = await readJson(req);
  if (!b.id) return fail('Missing id');
  try {
    return ok({ id: await saveHolding(a.user.id, String(b.id), b) });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(req: NextRequest) {
  const a = await buyer();
  if ('res' in a) return a.res;
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return fail('Missing id');
  try {
    await deleteHolding(a.user.id, id);
    return ok({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
