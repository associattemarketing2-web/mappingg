import { NextRequest, NextResponse } from 'next/server';
import { clientIp, rateLimit } from '@/lib/rate-limit';
import { getProjectCards } from '@/lib/home/cards';
import { coarseCoords } from '@/lib/home/finder';
import { nearbyFrom, nearbyLocality } from '@/lib/home/nearby';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/nearby?lat=&lng=   — projects closest to the visitor's location
// GET /api/nearby?locality=   — projects in and around a chosen locality
//
// Used by the home page's "Projects near you" carousel and to pre-fill the
// sign-up form's "Preferred area". Coordinates are rounded to ~100 m, used for
// this one calculation and never stored or logged. Results come from the
// cached public project cards (lib/home/cards.ts), so a call costs no DB read.
export async function GET(req: NextRequest) {
  const limited = rateLimit(`nearby:${clientIp(req)}`, 60, 60_000);
  if (limited) return limited;

  const sp = req.nextUrl.searchParams;
  const limit = Math.min(Math.max(parseInt(sp.get('limit') || '', 10) || 12, 1), 24);
  const cards = await getProjectCards();
  // Private: the answer depends on where this visitor is.
  const headers = { 'Cache-Control': 'private, max-age=300' };

  const slug = (sp.get('locality') || '').trim().toLowerCase();
  if (slug) {
    if (!/^[a-z0-9-]{1,80}$/.test(slug)) return NextResponse.json({ error: { message: 'Unknown locality' } }, { status: 400 });
    const res = nearbyLocality(cards, slug, limit);
    if (!res) return NextResponse.json({ error: { message: 'Unknown locality' } }, { status: 404 });
    return NextResponse.json(res, { headers });
  }

  const at = coarseCoords(sp.get('lat'), sp.get('lng'));
  if (!at) return NextResponse.json({ error: { message: 'Send lat & lng, or a locality' } }, { status: 400 });
  return NextResponse.json(nearbyFrom(cards, at.lat, at.lng, limit), { headers });
}
