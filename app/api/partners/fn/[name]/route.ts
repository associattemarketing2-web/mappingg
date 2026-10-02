import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Edge-function equivalent: resolve-maps-link
// Turns a short Google Maps link (maps.app.goo.gl / goo.gl/maps / g.co/kgs) into
// a { lat, lng } pin by following the redirect server-side and parsing the final
// URL. Restricted to those hosts so it can't be abused as a generic fetch proxy.
const SHORT_HOSTS = /^(?:[a-z0-9-]+\.)?(maps\.app\.goo\.gl|goo\.gl|g\.co)$/i;

function parseLatLng(text: string): { lat: number; lng: number } | null {
  if (!text) return null;
  let s = text;
  try { s = decodeURIComponent(text); } catch { /* keep raw */ }
  const valid = (lat: number, lng: number) => Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
  const place = [...s.matchAll(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/g)].pop();
  if (place && valid(+place[1], +place[2])) return { lat: +place[1], lng: +place[2] };
  const pats = [
    /[?&](?:q|query|ll|destination|center|daddr)=(-?\d+(?:\.\d+)?),\s*\+?(-?\d+(?:\.\d+)?)/,
    /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
    /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/,
  ];
  for (const p of pats) {
    const m = s.match(p);
    if (m && valid(+m[1], +m[2])) return { lat: +m[1], lng: +m[2] };
  }
  return null;
}

export async function POST(req: NextRequest, { params }: { params: { name: string } }) {
  if (params.name !== 'resolve-maps-link') {
    return NextResponse.json({ data: null, error: { message: 'Unknown function' } }, { status: 404 });
  }
  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }
  const url = String(body.url || '');

  const direct = parseLatLng(url);
  if (direct) return NextResponse.json({ data: direct, error: null });

  let host = '';
  try { host = new URL(url).host; } catch {
    return NextResponse.json({ data: { lat: null, lng: null }, error: null });
  }
  if (!SHORT_HOSTS.test(host)) {
    return NextResponse.json({ data: { lat: null, lng: null }, error: null });
  }

  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(7000) });
    const resolved = parseLatLng(res.url) || parseLatLng(await res.text().catch(() => ''));
    if (resolved) return NextResponse.json({ data: resolved, error: null });
  } catch { /* fall through */ }
  return NextResponse.json({ data: { lat: null, lng: null }, error: null });
}
