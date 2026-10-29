import { NextRequest, NextResponse } from 'next/server';
import { clientIp, rateLimit } from '@/lib/rate-limit';
import { getQuickView } from '@/lib/home/quickview';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/project-quickview?n=<pin number> — public details for the "Enquire
// now" popup (components/landing/ProjectQuickView.tsx). Same data as the
// project's public page; reads are cached (lib/home/quickview.ts).
export async function GET(req: NextRequest) {
  const limited = rateLimit(`quickview:${clientIp(req)}`, 120, 60_000);
  if (limited) return limited;
  const n = Number(req.nextUrl.searchParams.get('n'));
  if (!Number.isInteger(n) || n <= 0 || n > 1_000_000) return NextResponse.json({ error: { message: 'Unknown project' } }, { status: 400 });
  const data = await getQuickView(n).catch(() => undefined);
  if (data === undefined) return NextResponse.json({ error: { message: 'Could not load this project' } }, { status: 503 });
  if (!data) return NextResponse.json({ error: { message: 'Project not found' } }, { status: 404 });
  return NextResponse.json(data, { headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=600' } });
}
