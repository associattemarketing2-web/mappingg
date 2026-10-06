import { NextResponse } from 'next/server';
import { getPublicSettings } from '@/lib/site-settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Compatibility endpoint for the pre-boot inline script in the legacy pages,
// which fetches GET /rest/v1/map_settings?id=eq.1&select=... directly (before
// the client shim loads) to read the GTM / Search Console / intro-video config.
// Returns only those fields (validated by getPublicSettings), not the whole
// settings row — the map apps load everything else through /api/db.
export async function GET() {
  const settings = await getPublicSettings(); // never throws
  return NextResponse.json([{ id: 1, ...settings }], {
    headers: { 'Cache-Control': 'public, max-age=30, s-maxage=60, stale-while-revalidate=300' },
  });
}
