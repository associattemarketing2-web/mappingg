import { NextRequest, NextResponse } from 'next/server';
import { directory, logoData } from '@/lib/developers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Developer names + logo URLs for the map editor's "Developer" suggestions
// (lib/developers.ts). Public data — the same logos are shown on the map.
// ?id=… returns that developer's logo exactly as stored, which the editor saves
// on the pin — so every project of a developer carries the identical image.
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  try {
    if (id) return NextResponse.json({ data: { logo: await logoData(id) } }, { headers: { 'Cache-Control': 'private, no-store' } });
    return NextResponse.json({ data: await directory() }, { headers: { 'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600' } });
  } catch (e) {
    console.error('[developers]', e);
    return NextResponse.json({ data: [], error: { message: 'Could not load developers' } }, { status: 500 });
  }
}
