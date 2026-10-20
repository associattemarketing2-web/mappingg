import { NextRequest, NextResponse } from 'next/server';
import { resolveMapsLink } from '@/lib/maps-link';
import { clientIp, rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Edge-function equivalent: resolve-maps-link
// Turns a Google Maps link (incl. short maps.app.goo.gl / goo.gl/maps / g.co/kgs
// links) into a { lat, lng } pin. See lib/maps-link.ts.
// Open to anonymous callers (the public project intake form uses it), so it is
// capped per IP: each call can make the server fetch a Google short link.
export async function POST(req: NextRequest, { params }: { params: { name: string } }) {
  if (params.name !== 'resolve-maps-link') {
    return NextResponse.json({ data: null, error: { message: 'Unknown function' } }, { status: 404 });
  }
  const limited = rateLimit(`maps-link:${clientIp(req)}`, 30, 60_000);
  if (limited) return limited;
  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }
  const url = String(body.url || '').slice(0, 2048);
  const hit = await resolveMapsLink(url);
  return NextResponse.json({ data: hit || { lat: null, lng: null }, error: null });
}
