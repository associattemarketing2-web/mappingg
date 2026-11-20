import { NextResponse } from 'next/server';
import { getGreenByNumber } from '@/lib/home/quickview';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/map/green — { "<pin number>": "IGBC certified · Gold rating", … } for every
// live pin whose Projects Intake record names a green certification. The live map's
// pin card shows it (the full details panel already does, via /api/project-quickview).
export async function GET() {
  try {
    return NextResponse.json({ data: await getGreenByNumber() }, {
      headers: { 'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600' },
    });
  } catch (e) {
    console.error('[map/green]', e);
    return NextResponse.json({ data: {}, error: { message: 'Could not load certifications' } }, { status: 500 });
  }
}
