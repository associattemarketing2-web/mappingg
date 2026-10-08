import { NextRequest, NextResponse } from 'next/server';
import { getStaffUser } from '@/lib/auth';
import { trafficReport } from '@/lib/site-analytics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Website traffic for the super-admin Dashboard (any signed-in staff member).
// ?days=1|7|30|90 — today, or the last N India-time days including today.
export async function GET(req: NextRequest) {
  if (!(await getStaffUser())) return NextResponse.json({ error: { message: 'Not authorized' } }, { status: 401 });
  const d = Number(req.nextUrl.searchParams.get('days'));
  const days = [1, 7, 30, 90].includes(d) ? d : 7;
  try {
    return NextResponse.json({ data: await trafficReport(days) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (e) {
    console.error('[traffic]', e);
    return NextResponse.json({ error: { message: 'Could not load website traffic' } }, { status: 500 });
  }
}
