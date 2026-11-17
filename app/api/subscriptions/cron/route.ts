import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { isAvailable } from '@/lib/subscriptions/db';
import { runLifecycle } from '@/lib/subscriptions/lifecycle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// GET /api/subscriptions/cron — expiry reminders, grace → expiry, and
// reconciliation of unfinished payments with the gateway. Run daily (or more
// often; it is idempotent) by Vercel Cron (vercel.json) or any external
// scheduler sending "Authorization: Bearer <CRON_SECRET>".
function authorized(req: NextRequest): boolean {
  const secret = (process.env.CRON_SECRET || '').trim();
  if (!secret) return false;
  const got = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(got), b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: { message: 'Not authorized' } }, { status: 401 });
  if (!isAvailable()) return NextResponse.json({ error: { message: 'Unavailable' } }, { status: 503 });
  const summary = await runLifecycle();
  return NextResponse.json({ data: summary }, { headers: { 'Cache-Control': 'no-store' } });
}
