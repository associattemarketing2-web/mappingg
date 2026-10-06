import { NextRequest, NextResponse } from 'next/server';
import { resolveMapsLink } from '@/lib/maps-link';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Edge-function equivalent: resolve-maps-link
// Turns a Google Maps link (incl. short maps.app.goo.gl / goo.gl/maps / g.co/kgs
// links) into a { lat, lng } pin. See lib/maps-link.ts.
export async function POST(req: NextRequest, { params }: { params: { name: string } }) {
  if (params.name !== 'resolve-maps-link') {
    return NextResponse.json({ data: null, error: { message: 'Unknown function' } }, { status: 404 });
  }
  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }
  const hit = await resolveMapsLink(String(body.url || ''));
  return NextResponse.json({ data: hit || { lat: null, lng: null }, error: null });
}
