import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Compatibility endpoint for the pre-boot inline script in the legacy pages,
// which fetches GET /rest/v1/map_settings?id=eq.1&select=... directly (before
// the client shim loads) to read the GTM / Search Console / intro-video config.
// map_settings is a public-read table, exactly as it was under Supabase.
export async function GET() {
  try {
    const db = await getDb();
    const rows = await db.collection('map_settings').find({}).toArray();
    const clean = rows.map(({ _id, ...rest }) => rest);
    return NextResponse.json(clean, {
      headers: { 'Cache-Control': 'public, max-age=30, s-maxage=60, stale-while-revalidate=300' },
    });
  } catch (e) {
    console.error('[rest/map_settings]', e);
    return NextResponse.json([]);
  }
}
