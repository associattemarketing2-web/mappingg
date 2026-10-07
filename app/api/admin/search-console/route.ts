import { NextRequest, NextResponse } from 'next/server';
import { hasPermission } from '@/lib/staff';
import { GscError, gscConfigured, searchConsoleReport, serviceAccountEmail } from '@/lib/search-console';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Live Google Search Console numbers (clicks, impressions, CTR, ranking,
// queries, pages, sitemaps, homepage index status) for the SEO & Health tab.
// Google refreshes this data a few times a day, so a short in-memory cache
// keeps the tab fast without ever showing stale-by-hours numbers.
const TTL = 10 * 60 * 1000;
const cache = new Map<number, { at: number; data: unknown }>();

export async function GET(req: NextRequest) {
  if (!(await hasPermission('seo'))) {
    return NextResponse.json({ error: { message: 'Not authorized' } }, { status: 401 });
  }
  const headers = { 'Cache-Control': 'private, no-store' };
  if (!gscConfigured()) {
    return NextResponse.json({ data: { status: 'not_configured' } }, { headers });
  }

  const asked = Number(req.nextUrl.searchParams.get('days'));
  const days = [7, 28, 90].includes(asked) ? asked : 28;
  const fresh = req.nextUrl.searchParams.get('refresh') === '1';
  const hit = cache.get(days);
  if (hit && !fresh && Date.now() - hit.at < TTL) {
    return NextResponse.json({ data: hit.data }, { headers });
  }

  try {
    const report = await searchConsoleReport(days);
    const data = { status: 'ok', days, fetchedAt: new Date().toISOString(), ...report };
    cache.set(days, { at: Date.now(), data });
    return NextResponse.json({ data }, { headers });
  } catch (e) {
    const code = e instanceof GscError ? e.code : 'api_error';
    return NextResponse.json({
      data: { status: code, message: (e as Error).message, serviceAccount: serviceAccountEmail() },
    }, { headers });
  }
}
