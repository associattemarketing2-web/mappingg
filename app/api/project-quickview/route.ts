import { NextRequest, NextResponse } from 'next/server';
import { clientIp, rateLimit } from '@/lib/rate-limit';
import { getQuickView } from '@/lib/home/quickview';
import { SESSION_COOKIE, getCurrentUser } from '@/lib/auth';
import { guardProjectAccess } from '@/lib/subscriptions/guards';
import { publicPinByNumber } from '@/lib/subscriptions/projects';

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
  // Signed-in channel partners and buyers: opening a project's full details
  // counts against their plan (lib/subscriptions). Visitors are unchanged.
  const hasSession = !!req.cookies.get(SESSION_COOKIE)?.value;
  const user = hasSession ? await getCurrentUser() : null;
  const metered = !!user && (user.role === 'agent' || user.role === 'buyer');
  if (metered) {
    const pin = await publicPinByNumber(n).catch(() => null);
    if (pin) {
      const gate = await guardProjectAccess(user, pin.id);
      if (gate) return gate;
    }
  }
  const data = await getQuickView(n).catch(() => undefined);
  if (data === undefined) return NextResponse.json({ error: { message: 'Could not load this project' } }, { status: 503 });
  if (!data) return NextResponse.json({ error: { message: 'Project not found' } }, { status: 404 });
  // No browser/CDN copy: an admin's "Publish update" (new unit-type rows, price…)
  // must show on the next open. The server-side read is cached and cleared on publish.
  return NextResponse.json(data, { headers: { 'Cache-Control': metered ? 'private, no-store' : 'public, max-age=0, must-revalidate' } });
}
