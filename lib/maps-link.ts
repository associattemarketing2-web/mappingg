// Turns a Google Maps link (or "lat, lng" text) into coordinates. Short links
// (maps.app.goo.gl / goo.gl/maps / g.co/kgs) are followed server-side; only those
// hosts are fetched, so this can't be used as a generic fetch proxy.
const SHORT_HOSTS = /^(?:[a-z0-9-]+\.)?(maps\.app\.goo\.gl|goo\.gl|g\.co)$/i;

export function parseLatLng(text: string): { lat: number; lng: number } | null {
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

/** Coordinates from a maps link, following short links. Null if none can be found. */
export async function resolveMapsLink(url: string): Promise<{ lat: number; lng: number } | null> {
  const direct = parseLatLng(url);
  if (direct) return direct;
  let host = '';
  try { host = new URL(url).host; } catch { return null; }
  if (!SHORT_HOSTS.test(host)) return null;
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(7000) });
    return parseLatLng(res.url) || parseLatLng(await res.text().catch(() => ''));
  } catch {
    return null;
  }
}
