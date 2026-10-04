import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/pg';
import { localitiesOf } from '@/lib/locality';
import { slugForProject, primaryLocality, STATUS_ROUTES, type Pin } from '@/lib/seo/entities';
import { slugify } from '@/lib/seo/slug';

export const runtime = 'nodejs';
// force-dynamic is intentional: the response depends entirely on request query
// params (bounds/zoom/filters), so it must never be statically cached at build.
// Freshness is handled by the short public Cache-Control header set below.
export const dynamic = 'force-dynamic';

// GET /api/map/pins?north&south&east&west[&zoom&limit&status&propertyType&developer&locality]
//
// Returns ONLY the pins inside the current viewport (bounds filtered in SQL via
// the pins_latlng indexes — see migration/pg-indexes-map.sql), as a lightweight
// payload (no base64, no descriptions, no video). At low zoom it returns grid
// CLUSTERS instead of hundreds of markers; at high zoom it returns individual
// pins. This never returns the whole dataset.
const ZOOM_CLUSTER_BELOW = 13;
const DEFAULT_LIMIT = 500;

type Row = {
  id: string; lat: string; lng: string; title: string | null; status: string | null;
  type: string | null; developer: string | null; location: string | null;
  number: string | null; thumb: string | null;
};

function num(v: string | null): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const north = num(sp.get('north'));
  const south = num(sp.get('south'));
  const east = num(sp.get('east'));
  const west = num(sp.get('west'));
  if (north == null || south == null || east == null || west == null) {
    return NextResponse.json({ error: 'north, south, east and west bounds are required' }, { status: 400 });
  }
  const zoom = num(sp.get('zoom'));
  const limit = Math.min(Math.max(num(sp.get('limit')) ?? DEFAULT_LIMIT, 1), 2000);

  // Bounds in SQL (index-backed). hidden pins stay staff-only / out of the public API.
  const { rows } = await query<Row>(
    `SELECT id,
            doc->>'lat'       AS lat,
            doc->>'lng'       AS lng,
            doc->>'title'     AS title,
            doc->>'status'    AS status,
            doc->>'type'      AS type,
            doc->>'developer' AS developer,
            doc->>'location'  AS location,
            doc->>'number'    AS number,
            doc->'image_meta'->>'thumbnailUrl' AS thumb
     FROM pins
     WHERE (doc->>'hidden') IS DISTINCT FROM 'true'
       AND (doc->>'lat')::double precision BETWEEN $1 AND $2
       AND (doc->>'lng')::double precision BETWEEN $3 AND $4
     LIMIT $5`,
    [Math.min(south, north), Math.max(south, north), Math.min(west, east), Math.max(west, east), limit],
  );

  // Optional filters (small dataset → applied in-memory after the index scan).
  const statusParam = (sp.get('status') || '').toLowerCase();
  const statusDbValues: readonly string[] | null =
    STATUS_ROUTES.find((r) => r.slug === statusParam)?.match ?? (statusParam ? [statusParam] : null);
  const typeParam = sp.get('propertyType') ? slugify(sp.get('propertyType')!) : null;
  const devParam = sp.get('developer') ? slugify(sp.get('developer')!) : null;
  const locParam = sp.get('locality') ? slugify(sp.get('locality')!) : null;

  const kept = rows.filter((r) => {
    if (statusDbValues && !statusDbValues.includes((r.status || '').toLowerCase())) return false;
    if (typeParam && slugify(r.type || '') !== typeParam) return false;
    if (devParam && slugify(r.developer || '') !== devParam) return false;
    if (locParam && !localitiesOf(r.location).some((l) => slugify(l) === locParam)) return false;
    return true;
  });

  const toMarker = (r: Row) => {
    const lat = num(r.lat)!;
    const lng = num(r.lng)!;
    const pin: Pin = { id: r.id, number: Number(r.number) || 0, title: r.title || undefined, location: r.location || undefined };
    return {
      id: r.id,
      lat,
      lng,
      title: r.title || `Project #${r.number ?? ''}`.trim(),
      slug: slugForProject(pin),
      status: r.status || undefined,
      propertyType: r.type || undefined,
      developer: r.developer || undefined,
      locality: primaryLocality(pin) || undefined,
      thumbnailUrl: r.thumb || undefined,
    };
  };

  const withCoords = kept.filter((r) => num(r.lat) != null && num(r.lng) != null);

  // Low zoom → cluster on a grid; high zoom (or no zoom) → individual markers.
  let body: Record<string, unknown>;
  if (zoom != null && zoom < ZOOM_CLUSTER_BELOW) {
    const decimals = zoom <= 8 ? 1 : zoom <= 10 ? 2 : 3;
    const f = Math.pow(10, decimals);
    const cells = new Map<string, { latSum: number; lngSum: number; count: number; one: Row }>();
    for (const r of withCoords) {
      const lat = num(r.lat)!, lng = num(r.lng)!;
      const key = `${Math.round(lat * f)}:${Math.round(lng * f)}`;
      const c = cells.get(key) || { latSum: 0, lngSum: 0, count: 0, one: r };
      c.latSum += lat; c.lngSum += lng; c.count += 1; c.one = r;
      cells.set(key, c);
    }
    const clusters: { lat: number; lng: number; count: number }[] = [];
    const singles: Row[] = [];
    for (const c of cells.values()) {
      if (c.count === 1) singles.push(c.one);
      else clusters.push({ lat: c.latSum / c.count, lng: c.lngSum / c.count, count: c.count });
    }
    body = { bounds: { north, south, east, west }, zoom, total: withCoords.length, clusters, pins: singles.map(toMarker) };
  } else {
    body = { bounds: { north, south, east, west }, zoom, total: withCoords.length, clusters: [], pins: withCoords.map(toMarker) };
  }

  const res = NextResponse.json(body);
  // Public, short-lived shared cache (pins change only via the editor).
  res.headers.set('Cache-Control', 'public, max-age=15, s-maxage=30, stale-while-revalidate=300');
  return res;
}
