import { NextRequest } from 'next/server';
import { chooseCity } from '@/lib/subscriptions/lifecycle';
import { errorResponse, ok, readJson, requireAccount } from '@/lib/subscriptions/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/subscriptions/city { city } — a CP on a one-city plan picks the city
// (once; later changes go through Mappingg support / the admin).
export async function POST(req: NextRequest) {
  const a = await requireAccount();
  if ('res' in a) return a.res;
  const b = await readJson(req);
  try {
    await chooseCity(a.user, String(b.city || ''));
    return ok({ city: b.city });
  } catch (e) {
    return errorResponse(e);
  }
}
