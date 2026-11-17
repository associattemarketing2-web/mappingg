import { NextRequest, NextResponse } from 'next/server';
import { CATEGORIES, type Category } from '@/lib/subscriptions/catalog';
import { isAvailable } from '@/lib/subscriptions/db';
import { publicCatalog } from '@/lib/subscriptions/summary';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/subscriptions/plans[?category=developer|cp|buyer] — the active plans
// (database-driven) with their feature list. Public: the pricing page uses it.
export async function GET(req: NextRequest) {
  if (!isAvailable()) return NextResponse.json({ error: { message: 'Subscriptions are temporarily unavailable.' } }, { status: 503 });
  const c = req.nextUrl.searchParams.get('category');
  const category = CATEGORIES.includes(c as Category) ? (c as Category) : undefined;
  const data = await publicCatalog(category);
  return NextResponse.json({ data }, { headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' } });
}
