import { NextRequest } from 'next/server';
import { guardFeature } from '@/lib/subscriptions/guards';
import { getPriceOutlook, listPriceOutlooks } from '@/lib/subscriptions/features';
import { errorResponse, fail, ok, requireAccount } from '@/lib/subscriptions/http';
import { getDb } from '@/lib/mongodb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/cp/future-price?pin=<id>  — Pro Max channel partners: the future
// price note Mappingg published for a project (with its source), or null when
// none was published. Without ?pin: every published note, with project names.
// Nothing is estimated or invented here — only what the admin entered.
export async function GET(req: NextRequest) {
  const a = await requireAccount();
  if ('res' in a) return a.res;
  if (a.user.role !== 'agent') return fail('Future prices are for channel partner accounts.', 403, 'wrong_role');
  const gate = await guardFeature(a.user, 'cp_future_price');
  if (gate) return gate;
  try {
    const pin = req.nextUrl.searchParams.get('pin');
    if (pin) return ok(await getPriceOutlook(pin.slice(0, 100)));
    const rows = await listPriceOutlooks();
    const ids = rows.map((r) => String(r.pin_id));
    const pins = ids.length ? await (await getDb()).collection('pins').find({ id: { $in: ids }, hidden: { $ne: true } }, { projection: { id: 1, title: 1, location: 1, price: 1, number: 1 } }).toArray() : [];
    const by = new Map(pins.map((p) => [String(p.id), p]));
    return ok(rows.filter((r) => by.has(String(r.pin_id))).map((r) => {
      const p = by.get(String(r.pin_id))!;
      return { ...r, title: String(p.title || ''), location: String(p.location || ''), current_price: String(p.price || ''), number: p.number ?? null };
    }));
  } catch (e) {
    return errorResponse(e);
  }
}
