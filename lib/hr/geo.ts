export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

/** Reverse geocode: Google Maps (key from env) -> OpenStreetMap fallback */
export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY;
  if (key) {
    try {
      const r = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${key}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      });
      const j = await r.json();
      if (j.status === "OK" && j.results?.[0]) return j.results[0].formatted_address;
    } catch {}
  }
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`, {
      headers: { "User-Agent": "employee-management-system/1.0" },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    const j = await r.json();
    if (j.display_name) return j.display_name as string;
  } catch {}
  return null;
}
